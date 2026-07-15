#!/usr/bin/env python3
"""Regression tests for the bridge's never-lose-a-block submit path.

Covers the four ways the previous code could drop a valid block:
  1. Local prefix-guard false negative -> refused submission
  2. Local PoW-check false negative    -> refused submission
  3. Transient RPC failure             -> no retry, exception killed the
                                          pool connection, block vanished
  4. Node fully down                   -> block never persisted, gone
Python 3 stdlib only (runs on the Umbrel host).
"""
import asyncio, os, struct, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "sv2", "bridge"))

import bch_tp_core as core            # noqa: E402
import bchn_sv2_bridge as bridge_mod  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    tag = "PASS" if cond else "FAIL"
    print(f"{tag}  {name}{': ' + detail if detail and not cond else ''}")
    if not cond:
        FAILURES.append(name)


class FakeNode:
    """Programmable BCHN stand-in: fail_first N submit calls, then succeed."""
    def __init__(self, fail_first=0, hard_down=False, result=None):
        self.fail_first = fail_first
        self.hard_down = hard_down
        self.result = result
        self.submits = []
        self.precious = []

    async def submit_block(self, hexblock):
        if self.hard_down or self.fail_first > 0:
            self.fail_first -= 1
            raise RuntimeError("rpc unreachable (simulated)")
        self.submits.append(hexblock)
        return self.result

    async def rpc(self, method, params=None):
        if method == "preciousblock":
            self.precious.append(params[0])
            return None
        raise RuntimeError("unexpected rpc " + method)


def varint(n):
    return core.varint(n)


def make_template_and_solution(mine_valid=True, break_prefix=False):
    """Regtest-difficulty template + a solution mined against it."""
    fake_tx = ("01000000010000000000000000000000000000000000000000000000000000"
               "000000000000ffffffff0451515151ffffffff0100f2052a01000000045151"
               "515100000000")
    txid = core.b2h_be(core.dsha(bytes.fromhex(fake_tx)))
    gbt = {"version": 0x20000000, "height": 858001,
           "previousblockhash": "00" * 32, "curtime": 1752170000,
           "bits": "207fffff", "coinbasevalue": 312501000, "mintime": 1752160000,
           "transactions": [{"txid": txid, "data": fake_tx}]}
    t = core.gbt_to_new_template(gbt)
    t["template_id"] = 7
    # SRI layout: script_sig = coinbase_prefix VERBATIM ++ OP_PUSHBYTES ++ en
    en = bytes(range(8))
    ssig = t["coinbase_prefix"] + bytes([len(en)]) + en
    outs = varint(1) + struct.pack("<q", t["coinbase_tx_value_remaining"]) \
        + varint(1) + b"\x51"
    cb = (struct.pack("<i", t["coinbase_tx_version"]) + varint(1)
          + b"\x00" * 32 + b"\xff" * 4 + varint(len(ssig)) + ssig
          + struct.pack("<I", t["coinbase_tx_input_sequence"])
          + outs + t["coinbase_tx_outputs"]
          + struct.pack("<I", t["coinbase_tx_locktime"]))
    nonce = 0
    if mine_valid:
        for n in range(500000):
            blk, warns = core.reconstruct_block_from_coinbase(
                t, cb, gbt["version"], gbt["curtime"], n)
            if not warns:
                nonce = n
                break
        else:
            raise SystemExit("could not mine a regtest nonce")
    else:
        # deliberately non-solving nonce (verify, else pick a neighbour)
        nonce = 0xdeadbeef
        blk, warns = core.reconstruct_block_from_coinbase(
            t, cb, gbt["version"], gbt["curtime"], nonce)
        if not warns:
            nonce += 1
    if break_prefix:
        pfx = t["coinbase_prefix"]
        cb = cb.replace(pfx, b"\x00" * len(pfx), 1)
    sol = {"template_id": 7, "version": gbt["version"],
           "header_timestamp": gbt["curtime"], "header_nonce": nonce,
           "coinbase_tx": cb}
    return gbt, t, sol


def make_bridge(node, datadir):
    os.environ["SV2_DATA"] = datadir
    logs = []
    b = bridge_mod.Bridge(node, log=lambda m: logs.append(m))
    return b, logs


def pending_files(datadir):
    d = os.path.join(datadir, "pending_blocks")
    try:
        return [f for f in os.listdir(d) if f.endswith(".hex")]
    except FileNotFoundError:
        return []


def run(coro):
    return asyncio.run(coro)


def scenario_warn_not_refuse_prefix():
    gbt, t, sol = make_template_and_solution(mine_valid=True, break_prefix=True)
    with tempfile.TemporaryDirectory() as dd:
        node = FakeNode()
        b, logs = make_bridge(node, dd)
        b.templates[7] = (0, t, gbt)
        run(b.handle_submit_solution(sol))
        check("prefix mismatch still submitted", len(node.submits) == 1,
              f"submits={len(node.submits)}")
        check("prefix mismatch logged as warning",
              any("template prefix" in l for l in logs))
        check("prefix mismatch: pending cleaned after node judged",
              pending_files(dd) == [], str(pending_files(dd)))


def scenario_warn_not_refuse_pow():
    gbt, t, sol = make_template_and_solution(mine_valid=False)
    with tempfile.TemporaryDirectory() as dd:
        node = FakeNode(result="high-hash")
        b, logs = make_bridge(node, dd)
        b.templates[7] = (0, t, gbt)
        run(b.handle_submit_solution(sol))
        check("local PoW failure still submitted", len(node.submits) == 1,
              f"submits={len(node.submits)}")
        check("local PoW failure logged as warning",
              any("PoW" in l and "warning" in l for l in logs))


def scenario_retry_then_success():
    gbt, t, sol = make_template_and_solution(mine_valid=True)
    with tempfile.TemporaryDirectory() as dd:
        node = FakeNode(fail_first=2)
        b, logs = make_bridge(node, dd)
        # collapse the retry backoff so the test runs in milliseconds
        orig = b._submit_with_retry

        async def fast_retry(block_hex, bh, height):
            real_sleep = asyncio.sleep

            async def no_sleep(_s):
                await real_sleep(0)
            asyncio.sleep, saved = no_sleep, asyncio.sleep
            try:
                return await orig(block_hex, bh, height)
            finally:
                asyncio.sleep = saved
        b._submit_with_retry = fast_retry
        b.templates[7] = (0, t, gbt)
        run(b.handle_submit_solution(sol))
        check("transient RPC failure retried to success",
              len(node.submits) == 1, f"submits={len(node.submits)}")
        check("accepted block recorded + preciousblock",
              len(node.precious) == 1 and
              os.path.exists(os.path.join(dd, "sv2_blocks.jsonl")))
        check("retry: pending cleaned after success", pending_files(dd) == [])


def scenario_node_down_persist_and_resubmit():
    gbt, t, sol = make_template_and_solution(mine_valid=True)
    with tempfile.TemporaryDirectory() as dd:
        down = FakeNode(hard_down=True)
        b, logs = make_bridge(down, dd)

        async def fast(block_hex, bh, height):
            # node hard down: every attempt raises; skip real backoff
            try:
                await down.submit_block(block_hex)
                return True, None
            except Exception:
                return False, None
        b._submit_with_retry = fast
        b.templates[7] = (0, t, gbt)
        run(b.handle_submit_solution(sol))
        pf = pending_files(dd)
        check("node down: block persisted to pending", len(pf) == 1, str(pf))
        check("node down: connection-preserving (no unhandled raise)",
              not any("unexpected error" in l for l in logs))

        # --- restart: a NEW bridge with a healthy node resubmits it ---
        node2 = FakeNode()
        b2, logs2 = make_bridge(node2, dd)

        async def one_pass():
            # run one resubmitter iteration without the 60s loop
            d = b2._pending_dir()
            for fn in sorted(os.listdir(d)):
                if not fn.endswith(".hex"):
                    continue
                p = os.path.join(d, fn)
                stem = fn[:-4]
                height, _, bh = stem.partition("_")
                with open(p) as f:
                    block_hex = f.read().strip()
                await b2._judge_and_finish(block_hex, bh, int(height), p)
        run(one_pass())
        check("restart resubmit: node judged the persisted block",
              len(node2.submits) == 1, f"submits={len(node2.submits)}")
        check("restart resubmit: pending cleaned", pending_files(dd) == [])


def scenario_generation_retention():
    """A solution for an OLD template under the same/previous prevhash must
    still reconstruct and submit — regardless of wall-clock age. Only a
    template two generations back may expire."""
    class TemplNode(FakeNode):
        def __init__(self):
            super().__init__()
            self.gbts = []

        async def get_template(self):
            return self.gbts.pop(0)

    def gbt_for(prev, height, curtime):
        fake_tx = ("010000000100000000000000000000000000000000000000000000000000"
                   "00000000000000ffffffff0451515151ffffffff0100f2052a0100000004"
                   "5151515100000000")
        txid = core.b2h_be(core.dsha(bytes.fromhex(fake_tx)))
        return {"version": 0x20000000, "height": height,
                "previousblockhash": prev, "curtime": curtime,
                "bits": "207fffff", "coinbasevalue": 312501000,
                "transactions": [{"txid": txid, "data": fake_tx}]}

    with tempfile.TemporaryDirectory() as dd:
        node = TemplNode()
        b, logs = make_bridge(node, dd)
        # generation X: one 'constraints' push + two mempool refreshes
        node.gbts = [gbt_for("aa" * 32, 100, 1000),
                     gbt_for("aa" * 32, 100, 1030),
                     gbt_for("aa" * 32, 100, 1060)]
        run(b.push_template("constraints"))
        tid_x0 = min(b.templates)              # oldest template of gen X
        run(b.push_template("mempool-refresh"))
        run(b.push_template("mempool-refresh"))
        # generation Y arrives (new block)
        node.gbts = [gbt_for("bb" * 32, 101, 1600)]
        run(b.push_template("new-block"))
        check("gen retention: previous-generation template survives new block",
              tid_x0 in b.templates)
        # mine a solution against the surviving gen-X template and submit it
        _, t_x, gbt_x = b.templates[tid_x0]
        en = bytes(range(8))
        ssig = t_x["coinbase_prefix"] + bytes([len(en)]) + en
        outs = varint(1) + struct.pack("<q", t_x["coinbase_tx_value_remaining"]) \
            + varint(1) + b"\x51"
        cb = (struct.pack("<i", t_x["coinbase_tx_version"]) + varint(1)
              + b"\x00" * 32 + b"\xff" * 4 + varint(len(ssig)) + ssig
              + struct.pack("<I", t_x["coinbase_tx_input_sequence"])
              + outs + t_x["coinbase_tx_outputs"]
              + struct.pack("<I", t_x["coinbase_tx_locktime"]))
        nonce = 0
        for n in range(500000):
            blk, warns = core.reconstruct_block_from_coinbase(
                t_x, cb, gbt_x["version"], gbt_x["curtime"], n)
            if not warns:
                nonce = n
                break
        run(b.handle_submit_solution({
            "template_id": tid_x0, "version": gbt_x["version"],
            "header_timestamp": gbt_x["curtime"], "header_nonce": nonce,
            "coinbase_tx": cb}))
        check("gen retention: stale-generation solution submitted",
              len(node.submits) == 1, f"submits={len(node.submits)}")
        # generation Z: gen X (two back) is finally pruned, gen Y kept
        gen_y_tids = [k for k, v in b.templates.items()
                      if v[2]["previousblockhash"] == "bb" * 32]
        node.gbts = [gbt_for("cc" * 32, 102, 2200)]
        run(b.push_template("new-block"))
        check("gen retention: two-generations-back pruned",
              tid_x0 not in b.templates)
        check("gen retention: previous generation (Y) kept after Z",
              all(t in b.templates for t in gen_y_tids))
        # memory cap: flood refreshes on the same tip, cap must hold and the
        # newest template must always survive its own insertion
        node.gbts = [gbt_for("cc" * 32, 102, 2200 + i) for i in range(80)]
        for _ in range(80):
            run(b.push_template("mempool-refresh"))
        check("gen retention: MAX_TEMPLATES cap enforced",
              len(b.templates) <= bridge_mod.MAX_TEMPLATES,
              f"len={len(b.templates)}")
        newest = max(b.templates, key=lambda k: b.templates[k][0])
        check("gen retention: newest template retained under cap pressure",
              b.templates[newest][2]["curtime"] == 2200 + 79)


def scenario_pending_dir_selfheal():
    """The live 1.4.49 bug: /data is root-owned, the bridge runs as uid 1000,
    so pending_blocks could not be created and persistence was silently off.
    A block found during that window must persist to the fallback, and must be
    picked up and submitted once the volume is healed."""
    import shutil
    shutil.rmtree("/tmp/pending_blocks", ignore_errors=True)
    gbt, t, sol = make_template_and_solution(mine_valid=True)
    with tempfile.TemporaryDirectory() as dd:
        # make the primary location unusable (a FILE where a dir must be):
        # deterministic across uids, unlike chmod when tests run as root
        open(os.path.join(dd, "pending_blocks"), "w").write("blocked")
        down = FakeNode(hard_down=True)
        b, logs = make_bridge(down, dd)

        async def fast(block_hex, bh, height):
            try:
                await down.submit_block(block_hex)
                return True, None
            except Exception:
                return False, None
        b._submit_with_retry = fast
        b.templates[7] = (0, t, gbt)
        run(b.handle_submit_solution(sol))
        fb = [f for f in os.listdir("/tmp/pending_blocks") if f.endswith(".hex")]
        check("unwritable volume: block persisted to fallback", len(fb) == 1, fb)
        check("unwritable volume: warned exactly once",
              sum(1 for l in logs if "not writable" in l) == 1)

        # --- heal: the sv2-pool entrypoint now creates the dir root-side ---
        os.unlink(os.path.join(dd, "pending_blocks"))
        os.makedirs(os.path.join(dd, "pending_blocks"))
        node2 = FakeNode()
        b2, logs2 = make_bridge(node2, dd)
        check("after heal: primary dir is used again",
              b2._pending_dir() == os.path.join(dd, "pending_blocks"))
        check("after heal: fallback still scanned",
              "/tmp/pending_blocks" in b2._pending_dirs_all())

        async def one_pass():
            for d in b2._pending_dirs_all():
                for fn in sorted(os.listdir(d)):
                    if not fn.endswith(".hex"):
                        continue
                    p = os.path.join(d, fn)
                    height, _, bh = fn[:-4].partition("_")
                    with open(p) as f:
                        block_hex = f.read().strip()
                    await b2._judge_and_finish(block_hex, bh, int(height), p)
        run(one_pass())
        check("after heal: stranded block submitted to node",
              len(node2.submits) == 1, f"submits={len(node2.submits)}")
        check("after heal: fallback drained",
              not [f for f in os.listdir("/tmp/pending_blocks")
                   if f.endswith(".hex")])
    shutil.rmtree("/tmp/pending_blocks", ignore_errors=True)


def scenario_unknown_template_forensics():
    gbt, t, sol = make_template_and_solution(mine_valid=True)
    with tempfile.TemporaryDirectory() as dd:
        node = FakeNode()
        b, logs = make_bridge(node, dd)   # templates dict left EMPTY
        run(b.handle_submit_solution(sol))
        check("unknown template: raw solution logged for forensics",
              any("forensics" in l and sol["coinbase_tx"].hex() in l
                  for l in logs))


if __name__ == "__main__":
    print("bridge submit-path regression tests:")
    # the consensus core self-tests must still pass under the new contract
    import subprocess
    r = subprocess.run([sys.executable,
                        os.path.join(HERE, "..", "..", "sv2", "bridge",
                                     "bch_tp_core.py")],
                       capture_output=True, text=True)
    check("bch_tp_core self-tests", r.returncode == 0, r.stdout + r.stderr)
    scenario_warn_not_refuse_prefix()
    scenario_warn_not_refuse_pow()
    scenario_retry_then_success()
    scenario_node_down_persist_and_resubmit()
    scenario_generation_retention()
    scenario_pending_dir_selfheal()
    scenario_unknown_template_forensics()
    if FAILURES:
        print(f"\n{len(FAILURES)} FAILURE(S): {FAILURES}")
        sys.exit(1)
    print("\nALL BRIDGE SUBMIT TESTS PASSED")
