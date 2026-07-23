#!/usr/bin/env python3
"""Onion seed-floor + pin-rotation regression tests (BCHN dashboard).

Field incident 2026-07-22: getnodeaddresses hides addresses addrman marks
terrible after repeated failures. A night of pin retries against dead onion
services hid 21 of 23 known onions -- including kister, the one proven-live
peer -- leaving the user only dead targets to tap. Manual addnode to kister
connected in <90s. The seeds must be a floor the decay cannot touch, and the
pin must rotate off dead services instead of hammering them forever."""
import os, re, sys, json, shutil, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, "..", "..", "dashboard", "server.js")).read()
FAILURES = []

def check(name, cond, detail=""):
    print(("PASS  " if cond else "FAIL  ") + name + ((": " + str(detail)) if detail and not cond else ""))
    if not cond: FAILURES.append(name)

def _extract_fn(src, header):
    i = src.index(header); j = src.index("{", i); depth, k = 0, j
    while k < len(src):
        if src[k] == "{": depth += 1
        elif src[k] == "}":
            depth -= 1
            if depth == 0: return src[i:k + 1]
        k += 1

def test_seed_floor():
    check("all 7 BCHN fixed seeds baked", SRC.count(".onion',") == 7 and "kisternet5tgeekw" in SRC)
    check("seeds merged into onionKnown (decay-immune)",
          "for (const addr of ONION_SEEDS)" in SRC and "seed: true" in SRC)
    check("seeds sort FIRST (they lead the pin's candidates)",
          "(b.seed ? 1 : 0) - (a.seed ? 1 : 0)" in SRC)
    if not shutil.which("node"):
        print("SKIP  seed-floor functional (node unavailable)"); return
    fn = _extract_fn(SRC, "async function onionKnown()")
    seeds = re.search(r"const ONION_SEEDS = \[.*?\];", SRC, re.S).group(0)
    js = """
// addrman decayed to TWO survivors -- the field incident
const rpc = async () => ([{address:'deadbeef1%s.onion',port:8333,time:111},
                          {address:'deadbeef2%s.onion',port:8333,time:222}]);
%s
%s
onionKnown().then(l => console.log(JSON.stringify({
  n: l.length, first: l[0].address.slice(0,10),
  seedsFirst: l.slice(0,7).every(x => x.seed === true),
  kister: l.some(x => x.address.startsWith('kisternet')),
})));
""" % ("a"*47, "b"*47, seeds, fn)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(js); pth = f.name
    r = subprocess.run(["node", pth], capture_output=True, text=True)
    try: d = json.loads(r.stdout.strip().split("\n")[-1])
    except Exception: check("seed-floor functional run", False, (r.stdout + r.stderr)[:200]); return
    check("decayed-to-2 addrman still yields 2 + 7 seeds", d["n"] == 9)
    check("the seven seeds lead the list", d["seedsFirst"])
    check("kister can never be hidden again", d["kister"])

def test_pin_rotation():
    check("pin tracks first-pinned time", "onionPinAt.set(o.address, nowMs)" in SRC)
    check("dead pins retired after 20 min", "nowMs - at > 20 * 60 * 1000" in SRC and "'remove']" in SRC)
    check("retired pins cool down 60 min",
          "onionCooldown.set(addr, nowMs + 60 * 60 * 1000)" in SRC)
    check("cooldown respected when choosing candidates",
          "(onionCooldown.get(o.address) || 0) > nowMs" in SRC)
    check("landed pins keep a running clock (die later -> rotate out; nmfretz #5914)",
          "if (live.has(addr)) { onionPinAt.set(addr, nowMs); continue; }" in SRC)
    check("budget counts the UNION of live and pinned (no double count; nmfretz #5914)",
          "new Set([...live, ...onionAdded]).size >= ONION_PIN_MAX" in SRC)
    check("pinned-but-untracked addresses get re-armed",
          "if (!onionPinAt.has(addr) && !live.has(addr)) onionPinAt.set(addr, nowMs);" in SRC)
    check("known list deduped by address (count == rows)",
          "const byAddr = new Map();" in SRC and "if (!prev || a.time > prev.time)" in SRC)
    check("candidate loop walks the FULL known list (not a decayed slice)",
          "for (const o of known) {" in SRC and "known.slice(0, ONION_PIN_MAX * 3)" not in SRC)

if __name__ == "__main__":
    print("onion seed-floor + rotation tests:")
    test_seed_floor()
    test_pin_rotation()
    if FAILURES:
        print("\n%d FAILURE(S): %s" % (len(FAILURES), FAILURES)); sys.exit(1)
    print("\nALL ONION TESTS PASSED")
