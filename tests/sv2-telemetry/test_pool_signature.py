#!/usr/bin/env python3
"""Regression tests for the SV2 coinbase miner tag (block attribution).

Block 959667 (2026-07-15) was mined by LoneStrike SV2 but shown as "Unknown"
by BCH Explorer: pool-config shipped `pool_signature = ""`, and SRI renders
the tag as /<pool_signature>/<miner_tag>/ -- which with an empty signature is
the literal "///" seen in the coinbase.

These tests execute the SHIPPED shell derivation (extracted verbatim between
the sig-derive markers in the sv2 pool entrypoint) and assert:
  1. the default tag matches the tag BCH Explorer looks up in pools-v2.json
  2. the wrapped tag can never exceed SRI's 61-byte limit -- exceeding it
     returns CoinbaseTxPrefixError and stops ALL mining
  3. hostile/malformed input cannot break the sed render or the TOML string
Python 3 stdlib only.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ENTRYPOINT = os.path.join(ROOT, "sv2", "pool", "sv2-helpers", "entrypoint.sh")
TEMPLATE = os.path.join(ROOT, "sv2", "pool", "sv2-helpers",
                        "pool-config.template.toml")
POOLS = os.path.join(ROOT, "pools-v2.json")

# SRI: sv2/channels-sv2/src/server/jobs/factory.rs op_pushbytes_pool_miner_tag
# 100B scriptSig - 5 (BIP34) - 1 (OP_PUSHBYTES) - 33 (extranonce push) = 61
SRI_MAX_TAG = 61

FAILURES = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}"
          f"{': ' + str(detail) if detail and not cond else ''}")
    if not cond:
        FAILURES.append(name)


def derive_sig(env_value=None):
    """Run the entrypoint's real signature-derivation block under /bin/sh."""
    src = open(ENTRYPOINT).read()
    m = re.search(r"# --- sig-derive-start.*?---\n(.*?)# --- sig-derive-end ---",
                  src, re.S)
    if not m:
        raise SystemExit("sig-derive markers missing from entrypoint.sh")
    script = m.group(1) + '\nprintf "%s" "$SIG"\n'
    env = dict(os.environ)
    env.pop("POOL_SIGNATURE", None)
    if env_value is not None:
        env["POOL_SIGNATURE"] = env_value
    return subprocess.run(["/bin/sh", "-c", script], capture_output=True,
                          text=True, env=env).stdout


def sri_tag(sig, miner_tag=""):
    """Mirror SRI's wrapping exactly: '/' + pool + '/' + miner + '/'."""
    return "/" + sig + "/" + miner_tag + "/"


def explorer_tags():
    for entry in json.load(open(POOLS)):
        if entry.get("name") == "LoneStrike Cash":
            return entry.get("tags", [])
    return []


def test_template_not_hardcoded_empty():
    s = open(TEMPLATE).read()
    check("template uses __POOL_SIGNATURE__ placeholder",
          "__POOL_SIGNATURE__" in s)
    check("template no longer ships an empty signature",
          'pool_signature = ""' not in s)


def test_default_matches_explorer():
    sig = derive_sig()
    tag = sri_tag(sig)
    tags = explorer_tags()
    check("pools-v2.json still has a LoneStrike Cash entry", bool(tags), tags)
    check("default signature is non-empty (not the '///' bug)", sig != "", sig)
    check(f"default coinbase tag {tag!r} contains an explorer tag",
          any(t in tag for t in tags), f"tag={tag} explorer={tags}")


def test_length_cap_never_breaks_mining():
    for value, label in [("A" * 200, "200 chars"),
                         ("LoneStrike " * 30, "repeated words")]:
        sig = derive_sig(value)
        tag = sri_tag(sig, miner_tag="worker.001")
        check(f"oversized signature ({label}) capped under SRI limit",
              len(tag.encode()) <= SRI_MAX_TAG,
              f"len={len(tag.encode())} tag={tag!r}")


def test_sanitisation():
    # sed render safety: '|' is the sed delimiter, '"' would break the TOML
    # string, '/' would nest inside SRI's own delimiters.
    sig = derive_sig('Evil|Pool"/x\\`$(whoami)')
    for bad in ("|", '"', "/", "\\", "`", "$", "(", ")"):
        check(f"sanitised signature drops {bad!r}", bad not in sig, sig)
    check("sanitised signature keeps safe text",
          "Evil" in sig and "Pool" in sig, sig)
    # empty-after-sanitise must fall back to the default, never ""
    sig2 = derive_sig("///")
    check("all-illegal signature falls back to default (never empty)",
          sig2 == "LoneStrike Cash", repr(sig2))
    sig3 = derive_sig("")
    check("empty POOL_SIGNATURE falls back to default", sig3 == "LoneStrike Cash",
          repr(sig3))


def test_custom_signature_allowed():
    sig = derive_sig("Christhealien Farm")
    check("custom signature passes through",
          sig == "Christhealien Farm", repr(sig))
    check("custom signature stays under SRI limit",
          len(sri_tag(sig).encode()) <= SRI_MAX_TAG)


if __name__ == "__main__":
    print("SV2 coinbase miner tag regression tests:")
    test_template_not_hardcoded_empty()
    test_default_matches_explorer()
    test_length_cap_never_breaks_mining()
    test_sanitisation()
    test_custom_signature_allowed()
    if FAILURES:
        print(f"\n{len(FAILURES)} FAILURE(S): {FAILURES}")
        sys.exit(1)
    print("\nALL POOL SIGNATURE TESTS PASSED")
