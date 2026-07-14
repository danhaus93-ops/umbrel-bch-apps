#!/usr/bin/env python3
"""bchn_sv2_bridge.py — SV2 Template Provider bridge for Bitcoin Cash Node.
Stdlib only. Serves the SV2 template distribution protocol on TP_PORT to an
SRI-style pool role; talks GBT/submitblock to stock BCHN over JSON-RPC and
detects new blocks via best-hash polling (ZMQ hookup is a drop-in upgrade).

Usage on the box (env or args):
  BCHN_RPC_URL=http://sslabs-bitcoin-cash-node_bitcoind_1:8332 \
  BCHN_RPC_USER=bchn BCHN_RPC_PASS=... TP_PORT=8336 \
  python3 bchn_sv2_bridge.py

Design notes:
  - CTOR: full-template-push only. Every refresh is a complete NewTemplate.
  - Template cache keyed by template_id, retained TEMPLATE_TTL seconds.
  - SubmitSolution: reconstruct via bch_tp_core, persist-to-disk FIRST, then
    submitblock with retry; local checks warn but never block submission,
    and unjudged blocks are resubmitted after restarts (never lose a block).
  - v1 scope: one downstream connection class, plaintext framing, no JD.
"""
import asyncio, base64, json, os, struct, time, urllib.request

import bch_tp_core as core
import sv2_framing as sv2

TEMPLATE_TTL = 120
REFRESH_SECS = 30
POLL_SECS = 2
POLL_SECS_ZMQ_OK = 15   # relaxed poll while ZMQ notifications are flowing

# --------------------------------------------- minimal ZMTP 3.x SUB client --
# Stdlib-only ZeroMQ subscriber: just enough to read bitcoind's PUB socket.
# Lesson from mkpool's zmq_client: notifications are edge-triggered in
# spirit -- drain every frame available, tolerate partial reads, and
# reconnect forever with backoff instead of going silent.
async def zmtp_sub_connect(host, port, topic: bytes):
    reader, writer = await asyncio.open_connection(host, port)
    greeting = (b"\xff" + b"\x00" * 8 + b"\x7f" + b"\x03\x01"
                + b"NULL" + b"\x00" * 16 + b"\x00" + b"\x00" * 31)
    writer.write(greeting); await writer.drain()
    peer = await reader.readexactly(64)
    if peer[:1] != b"\xff" or peer[10:11] != b"\x03":
        raise RuntimeError("peer is not ZMTP 3.x")

    async def read_frame():
        flags = (await reader.readexactly(1))[0]
        if flags & 0x02:
            ln = int.from_bytes(await reader.readexactly(8), "big")
        else:
            ln = (await reader.readexactly(1))[0]
        return flags, await reader.readexactly(ln)

    def meta(k, v):
        return bytes([len(k)]) + k + len(v).to_bytes(4, "big") + v
    ready = b"\x05READY" + meta(b"Socket-Type", b"SUB")
    writer.write(bytes([0x04, len(ready)]) + ready); await writer.drain()
    while True:                                   # peer handshake
        flags, body = await read_frame()
        if flags & 0x04:
            if body[:6] == b"\x05READY": break
            if body[:6] == b"\x05ERROR": raise RuntimeError("ZMTP ERROR from peer")
        else:
            break                                 # tolerate eager peers
    writer.write(bytes([0x00, 1 + len(topic)]) + b"\x01" + topic)
    await writer.drain()
    return reader, writer, read_frame

def target_le32_from_nbits(nbits: int) -> bytes:
    return core.target_from_nbits(nbits).to_bytes(32, "little")

# ------------------------------------------------------------ node sources --
class RealNode:
    """Stock BCHN over JSON-RPC. Poll-based tip detection (2s); swap in ZMQ
    on 28332 later without touching the rest."""
    def __init__(self, url, user, password):
        self.url = url
        self.auth = base64.b64encode(f"{user}:{password}".encode()).decode()
    def _rpc(self, method, params=None):
        req = urllib.request.Request(
            self.url,
            data=json.dumps({"id": 1, "method": method,
                             "params": params or []}).encode(),
            headers={"Authorization": "Basic " + self.auth,
                     "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.loads(r.read())
        if out.get("error"): raise RuntimeError(str(out["error"]))
        return out["result"]
    async def rpc(self, method, params=None):
        return await asyncio.get_event_loop().run_in_executor(
            None, self._rpc, method, params)
    async def get_template(self):
        return await self.rpc("getblocktemplate", [{}])
    async def best_hash(self):
        return await self.rpc("getbestblockhash")
    async def submit_block(self, hexblock):
        return await self.rpc("submitblock", [hexblock])

# ------------------------------------------------------------------ bridge --
class Bridge:
    def __init__(self, node, log=print):
        self.node = node
        self.log = log
        self.templates = {}          # template_id -> (created, mapped, gbt)
        self.next_id = int(time.time())
        self.clients = set()
        self.last_prev = None
        self.last_tip = None         # RPC-form hex; shared by poll + ZMQ watchers
        self.zmq_ok = False

    def map_template(self, gbt, future=False):
        t = core.gbt_to_new_template(gbt)
        t["template_id"] = self.next_id; self.next_id += 1
        t["future_template"] = future
        return t

    async def push_template(self, reason):
        """SPEC FLOW: reasons 'constraints' and 'new-block' send
        NewTemplate(future=True) THEN SetNewPrevHash; 'mempool-refresh'
        sends NewTemplate(future=False) only (relates to last prevhash)."""
        with_prevhash = reason in ("constraints", "new-block")
        gbt = await self.node.get_template()
        t = self.map_template(gbt, future=with_prevhash)
        tid = t["template_id"]
        self.templates[tid] = (time.time(), t, gbt)
        cutoff = time.time() - TEMPLATE_TTL
        for k in [k for k, v in self.templates.items() if v[0] < cutoff]:
            del self.templates[k]
        self.last_prev = gbt["previousblockhash"]
        nt = sv2.build_new_template(t)
        pv = sv2.build_set_new_prev_hash(
            tid, core.h2b_le(gbt["previousblockhash"]), gbt["curtime"],
            t["nbits"], target_le32_from_nbits(t["nbits"]))
        dead = []
        for wtr in self.clients:
            try:
                wtr.write(nt)
                if with_prevhash:
                    wtr.write(pv)
                await wtr.drain()
            except Exception:
                dead.append(wtr)
        for d in dead: self.clients.discard(d)
        self.log(f"[bridge] template {tid} pushed ({reason}"
                 f"{', future+prevhash' if with_prevhash else ''}): "
                 f"h{gbt['height']} {len(gbt['transactions'])} txs "
                 f"-> {len(self.clients)} client(s)")
        return tid, nt, pv

    # ---- NEVER-LOSE-A-BLOCK submit path -----------------------------------
    # Contract: once a solution arrives, the candidate block hex is persisted
    # to disk BEFORE the first submit attempt; local reconstruction checks are
    # logged as warnings but never block submission; submitblock is retried
    # with backoff; anything the node never judged survives restarts and is
    # resubmitted until the node gives a definitive answer.
    def _pending_dir(self):
        d = os.path.join(os.environ.get("SV2_DATA", "/data"), "pending_blocks")
        os.makedirs(d, exist_ok=True)
        return d

    def _persist_pending(self, height, bh, block_hex):
        p = os.path.join(self._pending_dir(), f"{height}_{bh}.hex")
        tmp = p + ".tmp"
        with open(tmp, "w") as f:
            f.write(block_hex)
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, p)
        return p

    async def _submit_with_retry(self, block_hex, bh, height):
        """Returns (judged, result). judged=True means the node saw the block
        and answered (incl. rejection strings) — resubmitting cannot help.
        judged=False means transport failure; the pending file stays."""
        delays = (0, 0.5, 1, 2, 4, 8, 15, 30)
        last = None
        for i, d in enumerate(delays):
            if d:
                await asyncio.sleep(d)
            try:
                res = await self.node.submit_block(block_hex)
                return True, res
            except Exception as e:
                last = e
                self.log(f"[bridge] !! submitblock attempt {i+1}/{len(delays)} "
                         f"failed for {bh} (h{height}): {e}")
        self.log(f"[bridge] !!!! ALL submit attempts failed for h{height} {bh}; "
                 f"block persisted for resubmission: {last}")
        return False, None

    def _record_block(self, height, bh, res):
        try:
            rec = {"height": height, "hash": bh,
                   "time": int(time.time()), "result": res or "accepted"}
            with open(os.path.join(os.environ.get("SV2_DATA", "/data"),
                                   "sv2_blocks.jsonl"), "a") as f:
                f.write(json.dumps(rec) + "\n")
        except Exception as e:
            self.log(f"[bridge] block record write failed (non-fatal): {e}")

    async def _judge_and_finish(self, block_hex, bh, height, pending_path):
        judged, res = await self._submit_with_retry(block_hex, bh, height)
        if not judged:
            return None                      # pending file remains on disk
        if res is None:
            self.log(f"[bridge] ***** BLOCK ACCEPTED at height {height} "
                     f"hash {bh} *****")
        elif res in ("duplicate", "inconclusive"):
            # a soft result can still become canonical; do not treat as loss.
            self.log(f"[bridge] ** submitblock soft result '{res}' at height "
                     f"{height} hash {bh}; block may still win")
        else:
            self.log(f"[bridge] !! submitblock returned: {res} "
                     f"(h{height} {bh})")
        if res is None or res in ("duplicate", "inconclusive"):
            # same-height race protection: force our own node onto our block.
            # Runs for soft results too; that is exactly the race case.
            try:
                await self.node.rpc("preciousblock", [bh])
                self.log(f"[bridge] preciousblock set on {bh}")
            except Exception as e:
                self.log(f"[bridge] preciousblock failed (non-fatal): {e}")
        self._record_block(height, bh, res)
        if pending_path:
            try:
                os.unlink(pending_path)
            except Exception:
                pass
        return res

    async def handle_submit_solution(self, sol):
        try:
            return await self._handle_submit_solution(sol)
        except Exception as e:
            # A submit-path bug must never take the pool connection down.
            self.log(f"[bridge] !!!! unexpected error in submit path "
                     f"(connection preserved): {type(e).__name__}: {e}")

    async def _handle_submit_solution(self, sol):
        tid = sol["template_id"]
        entry = self.templates.get(tid)
        if entry is None:
            self.log(f"[bridge] !!!! solution for unknown/expired template {tid} "
                     f"— cannot reconstruct. Raw solution logged for forensics: "
                     f"{json.dumps({k: (v.hex() if isinstance(v, (bytes, bytearray)) else v) for k, v in sol.items()})}")
            return
        _, t, gbt = entry
        cb = sol["coinbase_tx"]
        self.log(f"[bridge] SOLUTION for template {tid}: "
                 f"nonce={sol['header_nonce']} ts={sol['header_timestamp']} "
                 f"cb={len(cb)}B")
        try:
            block, warns = core.reconstruct_block_from_coinbase(
                t, cb, sol["version"],
                sol["header_timestamp"], sol["header_nonce"])
        except (ValueError, AssertionError) as e:
            self.log(f"[bridge] !!!! coinbase unparseable, no block can be "
                     f"built: {e}; raw cb={cb.hex()}")
            return
        for w in warns:
            self.log(f"[bridge] !! reconstruction warning (submitting anyway): {w}")
        mintime = gbt.get("mintime")
        ts = sol["header_timestamp"]
        if mintime and (ts < int(mintime) or ts > int(time.time()) + 7200):
            # warn but NEVER self-censor a candidate block; the node decides.
            self.log(f"[bridge] !! header_timestamp {ts} outside sane range "
                     f"(mintime={mintime}); submitting anyway")
        bh = core.dsha(block[:80])[::-1].hex()
        block_hex = block.hex()
        pending_path = None
        try:
            pending_path = self._persist_pending(gbt["height"], bh, block_hex)
        except Exception as e:
            self.log(f"[bridge] !! could not persist pending block "
                     f"(continuing to submit): {e}")
        return await self._judge_and_finish(block_hex, bh, gbt["height"],
                                            pending_path)

    async def pending_resubmitter(self):
        """On startup and every 60s: resubmit any block the node never judged.
        submitblock of an already-known block returns 'duplicate' — harmless."""
        while True:
            try:
                d = self._pending_dir()
                for fn in sorted(os.listdir(d)):
                    if not fn.endswith(".hex"):
                        continue
                    p = os.path.join(d, fn)
                    stem = fn[:-4]
                    height, _, bh = stem.partition("_")
                    try:
                        with open(p) as f:
                            block_hex = f.read().strip()
                    except Exception:
                        continue
                    if not block_hex:
                        os.unlink(p)
                        continue
                    self.log(f"[bridge] resubmitting persisted block h{height} {bh}")
                    await self._judge_and_finish(block_hex, bh,
                                                 int(height or 0), p)
            except Exception as e:
                self.log(f"[bridge] pending resubmitter error: {e}")
            await asyncio.sleep(60)

    async def handle_client(self, reader, writer):
        peer = writer.get_extra_info("peername")
        self.log(f"[bridge] pool connected from {peer}")
        async def rd(n):
            d = await reader.readexactly(n)
            return d
        try:
            ext, mtype, payload = await self._read_frame(reader)
            if mtype != sv2.MSG_SETUP_CONNECTION:
                writer.close(); return
            sc = sv2.parse_setup_connection(payload)
            if sc["protocol"] != sv2.PROTOCOL_TEMPLATE_DISTRIBUTION:
                writer.write(sv2.frame(sv2.MSG_SETUP_CONNECTION_ERROR,
                    bytes(sv2.Writer().u32(0).str0_255("unsupported-protocol").b)))
                await writer.drain(); writer.close(); return
            writer.write(sv2.build_setup_success()); await writer.drain()
            self.clients.add(writer)
            # SPEC: template is sent in reply to CoinbaseOutputConstraints
            while True:
                ext, mtype, payload = await self._read_frame(reader)
                if mtype == sv2.MSG_COINBASE_OUTPUT_CONSTRAINTS:
                    c = sv2.parse_coinbase_output_constraints(payload)
                    self.log(f"[bridge] pool constraints: {c}")
                    await self.push_template("constraints")
                elif mtype == sv2.MSG_REQUEST_TX_DATA:
                    tid = sv2.parse_request_tx_data(payload)["template_id"]
                    entry = self.templates.get(tid)
                    if entry is None:
                        writer.write(sv2.frame(sv2.MSG_REQUEST_TX_DATA_ERROR,
                            bytes(sv2.Writer().u64(tid)
                                  .str0_255("template-id-not-found").b)))
                    else:
                        _, t, _g = entry
                        txs = [bytes.fromhex(h) for h in t["_tx_hex"]]
                        writer.write(sv2.build_request_tx_data_success(
                            tid, b"", txs))
                    await writer.drain()
                elif mtype == sv2.MSG_SUBMIT_SOLUTION:
                    await self.handle_submit_solution(
                        sv2.parse_submit_solution(payload))
                else:
                    self.log(f"[bridge] ignoring msg_type 0x{mtype:02x}")
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        except (ValueError, AssertionError, struct.error) as e:
            self.log(f"[bridge] !! malformed frame from {peer}; dropping connection: {e}")
        finally:
            self.clients.discard(writer)
            self.log(f"[bridge] pool disconnected {peer}")
            try: writer.close()
            except Exception: pass

    async def _read_frame(self, reader):
        hdr = await reader.readexactly(6)
        ext = struct.unpack("<H", hdr[0:2])[0]
        mtype = hdr[2]
        length = struct.unpack("<I", hdr[3:6] + b"\x00")[0]
        payload = await reader.readexactly(length) if length else b""
        return ext, mtype, payload

    async def tip_watcher(self):
        while True:
            try:
                cur = await self.node.best_hash()
                if self.last_tip is not None and cur != self.last_tip:
                    self.last_tip = cur
                    self.log(f"[bridge] new tip {cur[:16]}… (poll)")
                    await self.push_template("new-block")
                else:
                    self.last_tip = cur
            except Exception as e:
                self.log(f"[bridge] tip poll error: {e}")
            await asyncio.sleep(POLL_SECS_ZMQ_OK if self.zmq_ok else POLL_SECS)

    async def zmq_watcher(self):
        addr = os.environ.get("ZMQ_ADDR", "")
        if not addr:
            self.log("[bridge] ZMQ_ADDR unset; poll-only tip detection")
            return
        hp = addr.replace("tcp://", "").rsplit(":", 1)
        host, port = hp[0], int(hp[1])
        backoff = 1
        while True:
            writer = None
            try:
                reader, writer, read_frame = await zmtp_sub_connect(host, port, b"hashblock")
                self.zmq_ok = True
                backoff = 1
                self.log(f"[bridge] ZMQ hashblock subscribed at {host}:{port}")
                parts = []
                while True:
                    flags, body = await read_frame()
                    if flags & 0x04:
                        continue                       # command frames: ignore
                    parts.append(body)
                    if flags & 0x01:
                        continue                       # MORE parts coming
                    if parts and parts[0] == b"hashblock" and len(parts) >= 2:
                        # bitcoind publishes internal byte order; RPC hex is reversed
                        h = parts[1][::-1].hex()
                        if h != self.last_tip:
                            self.last_tip = h
                            self.log(f"[bridge] new tip {h[:16]}… (zmq)")
                            try:
                                await self.push_template("new-block")
                            except Exception as e:
                                self.log(f"[bridge] zmq-triggered push error: {e}")
                    parts = []
            except Exception as e:
                if self.zmq_ok:
                    self.log(f"[bridge] ZMQ lost ({e}); falling back to 2s poll, reconnecting")
                self.zmq_ok = False
                try:
                    if writer: writer.close()
                except Exception:
                    pass
                await asyncio.sleep(min(backoff, 30))
                backoff = min(backoff * 2, 30)

    async def refresher(self):
        while True:
            await asyncio.sleep(REFRESH_SECS)
            if self.clients:
                try: await self.push_template("mempool-refresh")
                except Exception as e: self.log(f"[bridge] refresh error: {e}")

    async def run(self, host, port):
        server = await asyncio.start_server(self.handle_client, host, port)
        self.log(f"[bridge] TP listening on {host}:{port}")
        async with server:
            await asyncio.gather(server.serve_forever(),
                                 self.tip_watcher(), self.refresher(),
                                 self.zmq_watcher(),
                                 self.pending_resubmitter())

if __name__ == "__main__":
    node = RealNode(os.environ.get("BCHN_RPC_URL", "http://127.0.0.1:8332"),
                    os.environ.get("BCHN_RPC_USER", "bchn"),
                    os.environ.get("BCHN_RPC_PASS", ""))
    b = Bridge(node)   # payout lives in the SRI pool config, per spec
    asyncio.run(b.run(os.environ.get("TP_HOST", "0.0.0.0"),
                      int(os.environ.get("TP_PORT", "8336"))))
