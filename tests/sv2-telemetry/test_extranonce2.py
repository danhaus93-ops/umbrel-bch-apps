#!/usr/bin/env python3
"""Regression tests for the tunable extranonce2 pool patch (Part B).

SRI hardcodes the miner-rollable extranonce space:
    const CLIENT_SEARCH_SPACE_BYTES: u8 = 16;
patches/0002 turns it into a function reading SV2_EXTRANONCE2_BYTES, which the
entrypoint exports from the file the dashboard writes.

There is no Rust toolchain locally and CI takes ~2h, so these tests guard
everything checkable without a compiler: patch integrity, every call site
rewritten, no stale references, the Dockerfile guard, the entrypoint clamp,
and that the patch still applies to the pinned upstream. Compile correctness
is proven only by the CI build.
"""
import os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PATCHES = os.path.join(ROOT, "sv2", "pool", "patches")
P1 = os.path.join(PATCHES, "0001-vardiff-zero-floor.patch")
P2 = os.path.join(PATCHES, "0002-tunable-extranonce2.patch")
DOCKERFILE = os.path.join(ROOT, "sv2", "pool", "Dockerfile")
ENTRY = os.path.join(ROOT, "sv2", "pool", "sv2-helpers", "entrypoint.sh")
PIN = "26e4bbaa790d0bd58bd8b69696f4aaa44de44a9a"
FAILURES = []


def check(name, cond, detail=""):
    print(("PASS  " if cond else "FAIL  ") + name +
          ((": " + str(detail)) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def test_patch_is_wellformed():
    """The hand-written first draft had miscounted hunk headers and git
    rejected it as 'corrupt patch'. Check the arithmetic."""
    body = open(P2).read().split("\n")
    idx = [i for i, l in enumerate(body) if l.startswith("@@")]
    check("patch has hunks", len(idx) >= 3, len(idx))
    for n, i in enumerate(idx):
        m = re.match(r"^@@ -(\d+),(\d+) \+(\d+),(\d+) @@", body[i])
        if not m:
            continue
        end = idx[n + 1] if n + 1 < len(idx) else len(body)
        seg = [l for l in body[i + 1:end]
               if not l.startswith(("diff ", "index ", "--- ", "+++ "))]
        got_old = sum(1 for l in seg if l[:1] in (" ", "-"))
        got_new = sum(1 for l in seg if l[:1] in (" ", "+"))
        check("hunk %d old count matches header" % (n + 1),
              got_old == int(m.group(2)), "%s vs %s" % (m.group(2), got_old))
        check("hunk %d new count matches header" % (n + 1),
              got_new == int(m.group(4)), "%s vs %s" % (m.group(4), got_new))


def test_every_callsite_rewritten():
    src = open(P2).read()
    rm = "\n".join(l for l in src.split("\n") if l.startswith("-") and not l.startswith("---"))
    ad = "\n".join(l for l in src.split("\n") if l.startswith("+") and not l.startswith("+++"))
    check("removes the hardcoded constant",
          "const CLIENT_SEARCH_SPACE_BYTES: u8 = 16;" in rm)
    check("removes the const FULL_EXTRANONCE_SIZE", "pub const FULL_EXTRANONCE_SIZE" in rm)
    check("rewrites ExtranonceAllocator call site",
          "FULL_EXTRANONCE_SIZE, POOL_MAX_CHANNELS" in rm and "full_extranonce_size()" in ad)
    check("rewrites GroupChannel call site",
          "FULL_EXTRANONCE_SIZE as usize" in rm and "full_extranonce_size() as usize" in ad)
    check("rewrites the channel advertisement",
          "CLIENT_SEARCH_SPACE_BYTES as u16" in rm and "client_search_space_bytes() as u16" in ad)
    check("fixes the import",
          "CLIENT_SEARCH_SPACE_BYTES}" in rm and "client_search_space_bytes," in ad)


def test_bounds_and_default():
    src = open(P2).read()
    check("default is upstream's 16 (unset == no behaviour change)",
          "CLIENT_SEARCH_SPACE_DEFAULT: u8 = 16" in src)
    check("reads SV2_EXTRANONCE2_BYTES", "SV2_EXTRANONCE2_BYTES" in src)
    check("clamps 4..=32 in Rust", "(4..=32).contains(n)" in src)
    check("bad values fall back to the default",
          "unwrap_or(CLIENT_SEARCH_SPACE_DEFAULT)" in src)
    check("documents the scriptSig budget", "scriptSig" in src)


def test_dockerfile_guards():
    d = open(DOCKERFILE).read()
    check("Dockerfile applies 0002", "0002-tunable-extranonce2.patch" in d)
    check("0001 applied before 0002",
          d.index("0001-vardiff-zero-floor") < d.index("0002-tunable-extranonce2"))
    check("build verifies the patch landed", 'grep -q "fn client_search_space_bytes"' in d)
    check("build fails if a stale const survives",
          '! grep -rq "CLIENT_SEARCH_SPACE_BYTES" pool-apps/pool/src/' in d)


def test_entrypoint_clamp():
    src = open(ENTRY).read()
    check("entrypoint exports the env var the patch reads",
          'export SV2_EXTRANONCE2_BYTES="$XN"' in src)
    check("entrypoint logs the effective value", "extranonce2 bytes:" in src)
    m = re.search(r"XN=16\n(.*?)export SV2_EXTRANONCE2_BYTES", src, re.S)
    if not m:
        check("clamp block extractable", False)
        return
    for value, expect in [("16", "16"), ("4", "4"), ("32", "32"), ("8", "8"),
                          ("33", "16"), ("3", "16"), ("0", "16"),
                          ("abc", "16"), (None, "16")]:
        with tempfile.TemporaryDirectory() as dd:
            if value is not None:
                open(os.path.join(dd, "extranonce2_bytes"), "w").write(value)
            script = 'DATA="%s"\nXN=16\n%s\nprintf "%%s" "$XN"\n' % (dd, m.group(1))
            r = subprocess.run(["/bin/sh", "-c", script], capture_output=True, text=True)
            got = (r.stdout or "").strip().split("\n")[-1]
            check("clamp: %r -> %s" % (value, expect), got == expect, "got %r" % got)


def test_patch_applies_to_pinned_source():
    d = "/tmp/_p2check"
    subprocess.run(["rm", "-rf", d], capture_output=True)
    r = subprocess.run(["git", "clone", "-q", "--depth", "1",
                        "https://github.com/stratum-mining/sv2-apps.git", d],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("SKIP  apply check (no network)")
        return
    subprocess.run(["git", "fetch", "-q", "--depth", "1", "origin", PIN], cwd=d,
                   capture_output=True)
    subprocess.run(["git", "checkout", "-q", PIN], cwd=d, capture_output=True)
    r1 = subprocess.run(["git", "apply", P1], cwd=d, capture_output=True, text=True)
    check("0001 applies to pinned source", r1.returncode == 0, r1.stderr[:120])
    r2 = subprocess.run(["git", "apply", "--check", P2], cwd=d,
                        capture_output=True, text=True)
    check("0002 applies on top of 0001 (as the Dockerfile does)",
          r2.returncode == 0, r2.stderr[:120])
    subprocess.run(["rm", "-rf", d], capture_output=True)


if __name__ == "__main__":
    print("tunable extranonce2 (pool patch) regression tests:")
    test_patch_is_wellformed()
    test_every_callsite_rewritten()
    test_bounds_and_default()
    test_dockerfile_guards()
    test_entrypoint_clamp()
    test_patch_applies_to_pinned_source()
    if FAILURES:
        print("\n%d FAILURE(S): %s" % (len(FAILURES), FAILURES))
        sys.exit(1)
    print("\nALL EXTRANONCE2 PATCH TESTS PASSED")
