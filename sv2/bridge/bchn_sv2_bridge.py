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
  - SubmitSolution: reconstruct via bch_tp_core, local PoW gate, submitblock.
  - v1 scope: one downstream connection class, plaintext framing, no JD.
"""
import asyncio, base64, json, os, struct, time, urllib.request

import bch_tp_core as core
import sv2_framing as sv2

TEMPLATE_TTL = 120
REFRESH_SECS = 30
POLL_SECS = 2

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

    async def handle_submit_solution(self, sol):
        tid = sol["template_id"]
        entry = self.templates.get(tid)
        if entry is None:
            self.log(f"[bridge] !! solution for unknown/expired template {tid}")
            return
        _, t, gbt = entry
        cb = sol["coinbase_tx"]
        self.log(f"[bridge] SOLUTION for template {tid}: "
                 f"nonce={sol['header_nonce']} ts={sol['header_timestamp']} "
                 f"cb={len(cb)}B")
        try:
            block = core.reconstruct_block_from_coinbase(
                t, cb, sol["version"],
                sol["header_timestamp"], sol["header_nonce"])
        except (ValueError, AssertionError) as e:
            self.log(f"[bridge] !! reconstruction/PoW gate failed: {e}")
            return
        res = await self.node.submit_block(block.hex())
        if res is None:
            self.log(f"[bridge] ***** BLOCK ACCEPTED at height {gbt['height']} *****")
        else:
            self.log(f"[bridge] !! submitblock returned: {res}")
        return res

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
        best = None
        while True:
            try:
                cur = await self.node.best_hash()
                if best is not None and cur != best:
                    self.log(f"[bridge] new tip {cur[:16]}…")
                    await self.push_template("new-block")
                best = cur
            except Exception as e:
                self.log(f"[bridge] tip poll error: {e}")
            await asyncio.sleep(POLL_SECS)

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
                                 self.tip_watcher(), self.refresher())

if __name__ == "__main__":
    node = RealNode(os.environ.get("BCHN_RPC_URL", "http://127.0.0.1:8332"),
                    os.environ.get("BCHN_RPC_USER", "bchn"),
                    os.environ.get("BCHN_RPC_PASS", ""))
    b = Bridge(node)   # payout lives in the SRI pool config, per spec
    asyncio.run(b.run(os.environ.get("TP_HOST", "0.0.0.0"),
                      int(os.environ.get("TP_PORT", "8336"))))
