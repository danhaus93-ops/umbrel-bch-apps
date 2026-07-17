#!/usr/bin/env python3
"""Regression tests for the unified SV1/SV2 worker data model (#4).

THE PROBLEM: the two protocols emitted different shapes into the same UI.
  SV1 row: trend = [1m, 5m, 1hr, 1d, 7d]  <- window AVERAGES
  SV2 row: trend = five 1-minute buckets  <- a real TIME SERIES
Same field, different meaning, drawn as one sparkline. SV2 rows carried no
`accepted` at all, so per-worker accept/reject was impossible (Chris #4);
resets left the displayed counters untouched (Chris #1); and a block found by
one protocol did not clear the other's best, so the fleet number stayed pinned
to a stale value (Chris #2).

These tests assert the CONTRACT rather than re-deriving hashrate maths, which
the existing run_tests.js harness already covers against real logs.
Python 3 stdlib only.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SERVER = os.path.join(ROOT, "sslabs-solostrike-cash", "dashboard", "server.js")

FAILURES = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}"
          f"{': ' + str(detail) if detail and not cond else ''}")
    if not cond:
        FAILURES.append(name)


SRC = open(SERVER).read()


def row_block(marker):
    """Extract a workerList.push({...}) object literal following a marker."""
    i = SRC.index(marker)
    j = SRC.index("push({", i)
    depth, k = 0, j + 5
    while k < len(SRC):
        if SRC[k] == "{":
            depth += 1
        elif SRC[k] == "}":
            depth -= 1
            if depth == 0:
                return SRC[j:k + 1]
        k += 1
    return ""


UNIFIED_FIELDS = ["name", "proto", "conns", "declared", "accepted", "rejected",
                  "rejectReasons", "hashrate", "hs", "trend", "idle", "best",
                  "last", "firstSeen"]


def test_both_protocols_emit_one_schema():
    sv2 = row_block("UNIFIED SCHEMA -- identical field set to the SV1 rows")
    sv1 = row_block("UNIFIED SCHEMA -- identical field set to the SV2 rows")
    check("SV2 row block found", bool(sv2))
    check("SV1 row block found", bool(sv1))
    for f in UNIFIED_FIELDS:
        check(f"SV2 row has '{f}'", re.search(rf"\b{f}\s*:", sv2) is not None)
        check(f"SV1 row has '{f}'", re.search(rf"\b{f}\s*:", sv1) is not None)


def test_accepted_present_for_sv2():
    """Chris #4: per-worker accept/reject on the SV2 worker list."""
    sv2 = row_block("UNIFIED SCHEMA -- identical field set to the SV1 rows")
    check("SV2 reports accepted (was absent entirely)",
          "accepted:" in sv2 and "sv2CntFor" in sv2)
    check("SV2 reports rejected", "rejected:" in sv2)


def test_sv1_rejects_are_honest():
    """SV1 has no per-worker reject counter: report null, never a fake 0."""
    sv1 = row_block("UNIFIED SCHEMA -- identical field set to the SV2 rows")
    m = re.search(r"rejected:.*?(?=\n\s+\w+:)", sv1, re.S)
    check("SV1 rejected falls back to null, not 0",
          bool(m) and ": null" in m.group(0), m.group(0) if m else "")
    check("SV1 accepted is null when the counter is absent",
          "('shares' in w)" in sv1 and ": null" in sv1)


def test_trend_means_the_same_thing():
    """The core bug: `trend` must be the same quantity on both protocols."""
    sv1 = row_block("UNIFIED SCHEMA -- identical field set to the SV2 rows")
    sv2 = row_block("UNIFIED SCHEMA -- identical field set to the SV1 rows")
    check("SV1 trend comes from the shared ring", "ringTrend(" in sv1)
    check("SV2 trend comes from the shared ring", "ringTrend(" in sv2)
    check("SV1 no longer emits [1m,5m,1hr,1d,7d] as a fake time series",
          "hashrate7d" not in sv1)


def test_named_windows_exist():
    check("ringWin exists", "function ringWin(" in SRC)
    check("unifiedHashrate emits 1m/5m/1h/1d",
          all(f"'{w}':" in SRC for w in ("1m", "5m", "1h", "1d")))
    m = re.search(r"function unifiedHashrate\(key\) \{(.*?)\n\}", SRC, re.S)
    check("windows are 1/5/60/1440 minutes",
          bool(m) and "ringWin(key, 1)" in m.group(1)
          and "ringWin(key, 5)" in m.group(1)
          and "ringWin(key, 60)" in m.group(1)
          and "ringWin(key, 1440)" in m.group(1))
    check("rings retain 24h", "MINS_KEEP = 1440" in SRC)
    # 1h/1d are unreachable from sv2State.shares: it is pruned at 600s
    check("share buffer is still pruned at 600s (rings are the only 1h/1d path)",
          "600 * 1000" in SRC)


def test_sv2_restart_persistence():
    check("snapshot function exists", "function workersSave(" in SRC)
    check("load function exists", "function workersLoad(" in SRC)
    check("snapshot is atomic (tmp + rename)",
          "renameSync(tmp, WORKERS_STATE_FILE)" in SRC)
    check("snapshot runs on a 60s timer",
          re.search(r"workersSave\(\).*?\}, 60000\)", SRC, re.S) is not None)
    m = re.search(r"function workersSave\(\) \{(.*?)\n\}", SRC, re.S)
    for f in ("accepted", "rejected", "best", "firstSeen"):
        check(f"snapshot persists {f}", bool(m) and f in m.group(1))
    check("snapshot persists the rings", bool(m) and "mins: workerMins" in m.group(1))
    check("state file lives on the shared volume",
          "WORKERS_STATE_FILE = path.join(SV2_DIR, 'workers_state.json')" in SRC)


def test_reset_clears_counters():
    """Chris #1: an individual reset must also clear that row's acc/rej."""
    check("count-reset applies a baseline", "function sv2ApplyCountReset(" in SRC)
    check("rows report the delta, not the raw counter",
          "sv2CntFor(ch).accepted" in SRC)
    check("reset endpoint clears counters as well as best",
          "sv2ApplyReset(scope); sv2ApplyCountReset(scope);" in SRC)
    check("baselines survive restart", "SV2_CNT_BASE_FILE" in SRC
          and "sv2SaveCntBase" in SRC)
    m = re.search(r"function sv2ApplyCountReset\(scope\) \{(.*?)\n\}", SRC, re.S)
    check("reset all also clears SV2 rings",
          bool(m) and "startsWith('SV2:')" in m.group(1))


def test_block_resets_best_fleet_wide():
    """Chris #2: a block is a fleet event -- both protocols' best must clear."""
    m = re.search(r"if \(out\.blockList\.length !== sv2State\.lastBlockCount\) \{"
                  r"(.*?)\n      \}", SRC, re.S)
    check("block-found hook found", bool(m))
    if not m:
        return
    body = m.group(1)
    check("block clears SV2 best", "sv2ApplyReset('all')" in body)
    check("block clears SV1 best via reset_request", "reset_request" in body)
    check("first observation does not fire a reset",
          "sv2State.lastBlockCount >= 0" in body)


def test_fleet_aggregation_sums_unified_fields():
    """Rental fleets fan one identity across many channels; merged rows must
    sum the new counters instead of showing only the first channel's."""
    i = SRC.index("collapse same-name SV2 rows")
    blk = SRC[i:i + 2000]
    check("aggregation sums accepted", "m.accepted = (m.accepted || 0) + w.accepted" in blk)
    check("aggregation sums rejected", "m.rejected = (m.rejected || 0) + w.rejected" in blk)
    check("aggregation sums the named windows", "m.hs[k2] = (m.hs[k2] || 0)" in blk)
    check("aggregation keeps the earliest firstSeen", "w.firstSeen < m.firstSeen" in blk)


def test_no_temporal_dead_zone():
    """sv2CntBase was loaded above its own `let` and crashed the dashboard at
    boot. The harness caught it; keep it caught."""
    decl = SRC.index("let sv2CntBase")
    uses = [m.start() for m in re.finditer(r"\bsv2CntBase\b", SRC)]
    check("sv2CntBase is never touched before its declaration",
          all(u >= decl for u in uses),
          f"first use at {min(uses)}, declared at {decl}")




def test_extranonce2_setting():
    """Chris's request: tunable extranonce2, labelled, beside payout address.
    Stored and bounds-checked here; SRI hardcodes CLIENT_SEARCH_SPACE_BYTES=16
    so the Part B pool patch consumes this file."""
    check("extranonce2 file defined", "SV2_XN_FILE" in SRC)
    check("default matches SRI's current constant", "SV2_XN_DEFAULT  = 16" in SRC)
    m = re.search(r"function readSv2Xn\(\) \{(.*?)\n\}", SRC, re.S)
    check("reader clamps to 4..32 with a safe fallback",
          bool(m) and "n >= 4 && n <= 32" in m.group(1)
          and "SV2_XN_DEFAULT" in m.group(1))
    i = SRC.index("const xn = Number(req.body && req.body.extranonce2Bytes)")
    blk = SRC[i:i + 500]
    check("API rejects non-integers and out-of-range values",
          "Number.isInteger(xn)" in blk and "xn < 4 || xn > 32" in blk)
    check("API returns an explanatory error", "whole number from 4 to 32" in blk)
    check("current value exposed on status", "xn: readSv2Xn()" in SRC)
    html = open(os.path.join(ROOT, "sslabs-solostrike-cash", "dashboard",
                             "public", "index.html")).read()
    check("UI has the extranonce2 input", 'id="sv2XnInput"' in html)
    check("UI sends it on save", "extranonce2Bytes:parseInt" in html)


def test_ui_is_labelled():
    """Chris #3: every SV2 control needs a visible label, not a bare box."""
    html = open(os.path.join(ROOT, "sslabs-solostrike-cash", "dashboard",
                             "public", "index.html")).read()
    for label in ("Shares / min", "Extranonce2 bytes", "Payout address"):
        check("visible label: " + label, label in html)
    for ident in ("sv2SpmInput", "sv2XnInput", "sv2AddrInput"):
        check(ident + " has a <label for=>", 'for="' + ident + '"' in html)
    check("shares/min label explains vardiff", "Vardiff tunes each miner" in html)
    check("extranonce2 label explains the tradeoff",
          "more nonce room" in html and "scriptSig" in html)
    check("worker rows show accepted AND rejected",
          "typeof w.accepted" in html and "typeof w.rejected" in html)


def test_sv2_log_download():
    """The log download exists to be pasted into Discord for support, so the
    default MUST be redacted: pool_sv2.log carries the payout address, worker
    identities and miner IPs."""
    check("log endpoint exists", "app.get('/api/sv2/log'" in SRC)
    check("redaction helper exists", "function sv2Redact(" in SRC)
    i = SRC.index("app.get('/api/sv2/log'")
    blk = SRC[i:i + 1600]
    check("redacted is the DEFAULT (raw is opt-in)",
          "String(req.query.raw) === '1'" in blk and "if (!raw) text = sv2Redact(text)" in blk)
    check("tail is bounded", "Math.min(Math.max(" in blk)
    check("read size is capped, not just line count", "4 * 1024 * 1024" in blk)
    check("served as a download", "Content-Disposition" in blk
          and "attachment; filename=" in blk)
    check("filename marks whether it is raw", "'-RAW' : '-redacted'" in blk)
    check("header warns what a raw log contains", "contains your payout address" in blk)
    r = SRC[SRC.index("function sv2Redact("):SRC.index("app.get('/api/sv2/log'")]
    check("redacts the configured payout address", "[payout-address]" in r)
    check("redacts any BCH address", "[bch-address]" in r)
    check("redacts miner IPs", "'[ip]'" in r)
    check("keeps loopback/bind addresses (needed for debugging)",
          "127.0.0.1" in r and "0.0.0.0" in r)
    check("redacts worker identities", "[worker]" in r)
    html = open(os.path.join(ROOT, "sslabs-solostrike-cash", "dashboard",
                             "public", "index.html")).read()
    check("UI has a download button", 'id="sv2LogDl"' in html)
    check("download button says it is safe to share", "safe to paste" in html)
    check("raw link is present but de-emphasised", 'id="sv2LogRaw"' in html
          and "Only share privately" in html)



def _extract_fn(src, header):
    i = src.index(header)
    j = src.index("{", i)
    depth, k = 0, j
    while k < len(src):
        if src[k] == "{": depth += 1
        elif src[k] == "}":
            depth -= 1
            if depth == 0: return src[i:k + 1]
        k += 1
    raise AssertionError("unbalanced braces for " + header)


def test_sv2_found_blocks_create_entries():
    """Chris's 959807: the bridge recorded BLOCK ACCEPTED in sv2_blocks.jsonl,
    but the dashboard only used that file to ANNOTATE blocks the chain scan had
    already found -- so when the scan missed, Blocks Found stayed at 2 and the
    fleet round-reset never fired. The jsonl is written at the moment the node
    accepts the block; it must CREATE entries."""
    check("upsert function exists", "function mergeSv2FoundBlocks(" in SRC)
    check("old annotate-only loop is gone",
          "if (b && !b.worker) b.worker = 'SV2';" not in SRC)
    fn = _extract_fn(SRC, "function mergeSv2FoundBlocks(")
    check("upsert creates entries (push)", "blockState.blocks.push({" in fn)
    check("created entries are marked as bridge-sourced", "source: 'sv2-bridge'" in fn)
    check("accepted/duplicate map to confirmed",
          "rec.result === 'accepted' || rec.result === 'duplicate'" in fn)
    check("dedupes by hash OR height",
          "x.hash === rec.hash" in fn and "x.height === rec.height" in fn)
    check("persists when anything was added", "if (added) saveBlocks();" in fn)
    i = SRC.index("async function scanBlocks()")
    scan = SRC[i:i + 4000]
    check("scan runs the upsert before healFromBlockFiles",
          0 < scan.find("mergeSv2FoundBlocks();") < scan.find("healFromBlockFiles();"))
    check("status merge upserts and refreshes the visible list",
          "if (mergeSv2FoundBlocks()) {" in SRC and
          "out.blockList = [...blockState.blocks]" in SRC)

    # functional: run the real function under node with stubs (CI only)
    import shutil, subprocess, tempfile
    if not shutil.which("node"):
        print("SKIP  upsert behaviour (node unavailable on this host)")
        return
    js = """
let saved = 0;
const saveBlocks = () => { saved++; };
const blockState = { blocks: [{ height: 100, hash: 'aa', time: 1, worker: null }] };
let jsonl = [];
const sv2Blocks = () => jsonl;
%s
// 1) rec matching an existing chain-scan entry: annotate only
jsonl = [{ height: 100, hash: 'aa', time: 1, result: 'accepted' }];
let n1 = mergeSv2FoundBlocks();
// 2) brand-new accepted rec: must CREATE
jsonl = [{ height: 959807, hash: 'ae8f398', time: 1784183321, result: 'accepted' }];
let n2 = mergeSv2FoundBlocks();
// 3) idempotent on re-run
let n3 = mergeSv2FoundBlocks();
const nb = blockState.blocks.find(b => b.height === 959807);
console.log(JSON.stringify({ n1, n2, n3, len: blockState.blocks.length, saved,
  annotated: blockState.blocks[0].worker, state: nb && nb.state,
  worker: nb && nb.worker, src: nb && nb.source }));
""" % _extract_fn(SRC, "function mergeSv2FoundBlocks(")
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(js); pth = f.name
    r = subprocess.run(["node", pth], capture_output=True, text=True)
    import json as _json
    try: d = _json.loads(r.stdout.strip().split("\n")[-1])
    except Exception:
        check("upsert functional run", False, r.stdout + r.stderr); return
    check("existing entry annotated, not duplicated", d["n1"] == 0 and d["annotated"] == "SV2")
    check("new accepted rec creates exactly one entry", d["n2"] == 1 and d["len"] == 2)
    check("created entry: confirmed / worker SV2 / bridge-sourced",
          d["state"] == "confirmed" and d["worker"] == "SV2" and d["src"] == "sv2-bridge")
    check("idempotent on re-run", d["n3"] == 0)
    check("saveBlocks called only when something was added", d["saved"] == 1)


def test_addr_matching_normalized_by_node():
    """BCHN reports vout addresses in cashaddr; a legacy-stored payout (a real
    one in the field: 1QJr...) could never string-match, so the chain scan
    silently missed paid blocks. The node normalizes via validateaddress."""
    check("addrKeysFor exists", "async function addrKeysFor(" in SRC)
    fn = _extract_fn(SRC, "async function addrKeysFor(")
    check("asks the node to normalize", "'validateaddress'" in fn)
    check("keeps the raw key too (node not ready is survivable)",
          "keys.add(k)" in fn and "node not ready" in fn)
    check("coinbasePaysUs matches against the key set", "mine.has(addrKey(a))" in SRC)
    check("scan unions both payout addresses into one key set",
          "for (const k of await addrKeysFor(readSv2Address())) mineKeys.add(k);" in SRC)
    check("single-string matching is gone", "addrKey(a) === mine" not in SRC)


if __name__ == "__main__":
    print("unified worker schema regression tests:")
    test_both_protocols_emit_one_schema()
    test_accepted_present_for_sv2()
    test_sv1_rejects_are_honest()
    test_trend_means_the_same_thing()
    test_named_windows_exist()
    test_sv2_restart_persistence()
    test_reset_clears_counters()
    test_block_resets_best_fleet_wide()
    test_fleet_aggregation_sums_unified_fields()
    test_no_temporal_dead_zone()
    test_extranonce2_setting()
    test_ui_is_labelled()
    test_sv2_log_download()
    test_sv2_found_blocks_create_entries()
    test_addr_matching_normalized_by_node()
    if FAILURES:
        print(f"\n{len(FAILURES)} FAILURE(S): {FAILURES}")
        sys.exit(1)
    print("\nALL UNIFIED SCHEMA TESTS PASSED")
