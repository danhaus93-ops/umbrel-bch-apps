#!/usr/bin/env python3
"""Regression tests for payout address -> scriptPubKey conversion.

THE BUG: cashaddr_decode ignored the version byte's size bits and returned
out[1:21] unconditionally. A P2SH32 address (valid on BCH since May 2023)
passed the checksum, had its 32-byte hash TRUNCATED to 20 bytes, and the pool
built a syntactically valid coinbase paying an UNSPENDABLE script. The block
would be found and the whole reward burned, silently.

Vectors are the CashAddr specification's own, embedded so the suite stays
hermetic (no network in CI or on the Umbrel host):
  bitcoincashorg/bitcoincash.org spec/cashaddr.md
Python 3 stdlib only.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "sv2", "pool", "sv2-helpers"))
SERVER = os.path.join(ROOT, "sslabs-solostrike-cash", "dashboard", "server.js")

import addr_to_script as a2s  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}"
          f"{': ' + str(detail) if detail and not cond else ''}")
    if not cond:
        FAILURES.append(name)


# (payload_size_bytes, type, cashaddr, payload_hex) -- spec "Larger Test Vectors"
SPEC_VECTORS = [
    (20, 0, "bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2",
     "F5BF48B397DAE70BE82B3CCA4793F8EB2B6CDAC9"),
    (20, 1, "bchtest:pr6m7j9njldwwzlg9v7v53unlr4jkmx6eyvwc0uz5t",
     "F5BF48B397DAE70BE82B3CCA4793F8EB2B6CDAC9"),
    (24, 0, "bitcoincash:q9adhakpwzztepkpwp5z0dq62m6u5v5xtyj7j3h2ws4mr9g0",
     "7ADBF6C17084BC86C1706827B41A56F5CA32865925E946EA"),
    (24, 1, "bchtest:p9adhakpwzztepkpwp5z0dq62m6u5v5xtyj7j3h2u94tsynr",
     "7ADBF6C17084BC86C1706827B41A56F5CA32865925E946EA"),
    (28, 0, "bitcoincash:qgagf7w02x4wnz3mkwnchut2vxphjzccwxgjvvjmlsxqwkcw59jxxuz",
     "3A84F9CF51AAE98A3BB3A78BF16A6183790B18719126325BFC0C075B"),
    (32, 0, "bitcoincash:qvch8mmxy0rtfrlarg7ucrxxfzds5pamg73h7370aa87d80gyhqxq5nlegake",
     "3173EF6623C6B48FFD1A3DCC0CC6489B0A07BB47A37F47CFEF4FE69DE825C060"),
    (32, 1, "bchtest:pvch8mmxy0rtfrlarg7ucrxxfzds5pamg73h7370aa87d80gyhqxq7fqng6m6",
     "3173EF6623C6B48FFD1A3DCC0CC6489B0A07BB47A37F47CFEF4FE69DE825C060"),
    (40, 0, "bitcoincash:qnq8zwpj8cq05n7pytfmskuk9r4gzzel8qtsvwz79zdskftrzxtar994cgutavfklv39gr3uvz",
     "C07138323E00FA4FC122D3B85B9628EA810B3F381706385E289B0B25631197D194B5C238BEB136FB"),
    (64, 1, "bchtest:plg0x333p4238k0qrc5ej7rzfw5g8e4a4r6vvzyrcy8j3s5k0en7calvclhw46hudk5flttj6ydvj"
            "c0pv3nchp52amk97tqa5zygg96mc773cwez",
     "D0F346310D5513D9E01E299978624BA883E6BDA8F4C60883C10F28C2967E67EC"
     "77ECC7EEEAEAFC6DA89FAD72D11AC961E164678B868AEEEC5F2C1DA08884175B"),
]

# spec legacy <-> cashaddr equivalence table
LEGACY_PAIRS = [
    ("1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu",
     "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a"),
    ("1KXrWXciRDZUpQwQmuM1DbwsKDLYAYsVLR",
     "bitcoincash:qr95sy3j9xwd2ap32xkykttr4cvcu7as4y0qverfuy"),
    ("16w1D5WRVKJuZUsSRzdLp9w3YGcgoxDXb",
     "bitcoincash:qqq3728yw0y47sqn6l2na30mcw6zm78dzqre909m2r"),
    ("3CWFddi6m4ndiGyKqzYvsFYagqDLPVMTzC",
     "bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq"),
    ("3LDsS579y7sruadqu11beEJoTjdFiFCdX4",
     "bitcoincash:pr95sy3j9xwd2ap32xkykttr4cvcu7as4yc93ky28e"),
]


def test_decode_matches_spec():
    for size, typ, addr, payload in SPEC_VECTORS:
        label = f"{size}B type{typ}"
        try:
            got_typ, got_hash = a2s.cashaddr_decode(addr)
        except Exception as e:
            check(f"decode {label}", False, e)
            continue
        check(f"decode {label}: type", got_typ == typ, f"{got_typ} != {typ}")
        check(f"decode {label}: full {size}-byte payload (not truncated)",
              got_hash.hex().upper() == payload,
              f"got {got_hash.hex().upper()}")


def test_script_only_for_20_byte_hashes():
    for size, typ, addr, payload in SPEC_VECTORS:
        label = f"{size}B type{typ}"
        if size == 20 and typ == 0:
            check(f"script {label}: P2PKH",
                  a2s.to_script(addr) == "76a914" + payload.lower() + "88ac")
        elif size == 20 and typ == 1:
            check(f"script {label}: P2SH",
                  a2s.to_script(addr) == "a914" + payload.lower() + "87")
        else:
            # THE MONEY TEST: anything with a non-20-byte hash must REFUSE,
            # never emit a script built from a truncated hash.
            try:
                out = a2s.to_script(addr)
                check(f"script {label}: refused (never truncates)", False,
                      f"EMITTED {out}")
            except ValueError as e:
                truncated = payload.lower()[:40]
                check(f"script {label}: refused (never truncates)",
                      truncated not in str(e).lower(), e)


def test_p2sh32_would_have_burned():
    """Explicitly pin the exact address class that burned a reward."""
    p2sh32 = ("bchtest:pvch8mmxy0rtfrlarg7ucrxxfzds5pamg73h7370aa87d80gyhqxq"
              "7fqng6m6")
    typ, h = a2s.cashaddr_decode(p2sh32)
    check("P2SH32: decodes as type 1 with a full 32-byte hash",
          typ == 1 and len(h) == 32, f"type={typ} len={len(h)}")
    try:
        out = a2s.to_script(p2sh32)
        check("P2SH32: refused rather than paid to a truncated script", False,
              f"EMITTED {out}")
    except ValueError as e:
        check("P2SH32: refused rather than paid to a truncated script", True)
        check("P2SH32: error names the address type", "P2SH32" in str(e), e)


def test_legacy_and_cashaddr_agree():
    for legacy, cash in LEGACY_PAIRS:
        s1, s2 = a2s.to_script(legacy), a2s.to_script(cash)
        check(f"legacy/cashaddr agree: {legacy[:8]}...", s1 == s2,
              f"{s1} != {s2}")
        kind = "76a914" if legacy[0] == "1" else "a914"
        check(f"legacy {legacy[:8]}... -> {kind}", s1.startswith(kind), s1)


def test_rejects_malformed():
    bad = [
        ("bad checksum", "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6b"),
        ("bad char", "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6!"),
        ("empty", ""),
        ("garbage", "not-an-address"),
        ("legacy bad checksum", "1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggv"),
    ]
    for label, addr in bad:
        try:
            out = a2s.to_script(addr)
            check(f"reject {label}", False, f"EMITTED {out}")
        except Exception:
            check(f"reject {label}", True)


def test_dashboard_validator_parity():
    """The dashboard must not accept an address the pool will reject: doing so
    used to hand the entrypoint a bad address and crash-loop the container."""
    src = open(SERVER).read()
    m = re.search(r"validAddress\(a\)\s*\{.*?\n\}", src, re.S)
    if not m:
        check("found validAddress in server.js", False)
        return
    rx = re.search(r"/\^(\(bitcoincash:[^/]*?)\$/i", m.group(0))
    if not rx:
        check("found cashaddr regex in validAddress", False)
        return
    js = re.compile("^" + rx.group(1) + "$", re.I)
    for size, typ, addr, _ in SPEC_VECTORS:
        if not addr.startswith(("bitcoincash:", "bchtest:", "bchreg:")):
            continue
        accepted = bool(js.match(addr))
        if size == 20:
            check(f"dashboard accepts {size}B type{typ}", accepted, addr)
        else:
            check(f"dashboard rejects {size}B type{typ} (pool can't pay it)",
                  not accepted, addr)
    for legacy, cash in LEGACY_PAIRS:
        check(f"dashboard accepts cashaddr {cash[12:20]}...",
              bool(js.match(cash)), cash)


if __name__ == "__main__":
    print("payout address -> script regression tests:")
    test_decode_matches_spec()
    test_script_only_for_20_byte_hashes()
    test_p2sh32_would_have_burned()
    test_legacy_and_cashaddr_agree()
    test_rejects_malformed()
    test_dashboard_validator_parity()
    if FAILURES:
        print(f"\n{len(FAILURES)} FAILURE(S): {FAILURES}")
        sys.exit(1)
    print("\nALL ADDRESS TESTS PASSED")
