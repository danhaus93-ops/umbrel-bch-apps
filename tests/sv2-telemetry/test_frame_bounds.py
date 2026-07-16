#!/usr/bin/env python3
"""test_frame_bounds.py — the SV2 header declares msg_length as a U24, so six
bytes of attacker input can claim 16,777,215 bytes of payload. A reader that
trusts it sizes its next read from that number.

This is the bug that crash-looped mkpool on 2026-07-15: a header claiming
200,000 bytes was crammed into a fixed 16 KB buffer, corrupting memory. Our
bridge is Python, so it cannot be made to corrupt memory — but it CAN be made
to buffer 16 MiB per connection off six bytes, and nothing in TDP needs a
frame that large except transaction data.

Run:  python3 tests/sv2-telemetry/test_frame_bounds.py
"""
import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "sv2", "bridge"))
import sv2_framing as sv2

FAILED = []


def check(name, cond):
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond:
        FAILED.append(name)


def hdr(mtype, length, ext=0):
    return struct.pack("<H", ext) + struct.pack("<B", mtype) + struct.pack("<I", length)[:3]


class Feeder:
    """Stands in for the socket. Records how many bytes the reader ASKS for —
    that is the whole point: we must never be asked for the declared size."""

    def __init__(self, data):
        self.data, self.o, self.asked = data, 0, []

    def __call__(self, n):
        self.asked.append(n)
        d = self.data[self.o:self.o + n]
        if len(d) != n:
            raise ValueError("short read")
        self.o += n
        return d


# --- 1. the attack: a small message type declaring a huge payload ------------
# mkpool's exact shape — a tiny message claiming a payload it will never send.
def test_refuses_oversized_declaration():
    f = Feeder(hdr(sv2.MSG_SUBMIT_SOLUTION, 200_000))
    try:
        sv2.read_frame(f)
        check("SubmitSolution declaring 200,000 bytes is refused", False)
    except ValueError as e:
        check("SubmitSolution declaring 200,000 bytes is refused", "exceeds limit" in str(e))
    # The critical assertion: we refused BEFORE asking for the payload.
    check("no payload read was attempted (only the 6-byte header)", f.asked == [6])


def test_refuses_u24_ceiling():
    f = Feeder(hdr(sv2.MSG_SETUP_CONNECTION, 0xffffff))
    try:
        sv2.read_frame(f)
        check("SetupConnection declaring the full U24 ceiling is refused", False)
    except ValueError:
        check("SetupConnection declaring the full U24 ceiling is refused", True)
    check("never asked to buffer 16 MiB", max(f.asked) <= 6)


# --- 2. every small message type is capped -----------------------------------
# THE ONE THAT MATTERS MOST. A bound that is too tight is worse than no bound:
# it throws away real work. SubmitSolution carries the coinbase tx as B0_64K,
# so a genuine found block can declare ~65.5 KB. An earlier draft capped every
# "small" message at 8192 and would have refused it. Assert each limit clears
# that message's own spec maximum.
SPEC_MAX = {
    "SetupConnection":           (0x00, 1 + 2 + 2 + 4 + (1 + 255) * 5 + 2),
    "SetupConnectionSuccess":    (0x01, 2 + 4),
    "SetupConnectionError":      (0x02, 4 + 1 + 255),
    "CoinbaseOutputConstraints": (0x70, 4 + 2),
    "NewTemplate":               (0x71, 8 + 1 + 4 + 4 + (1 + 255) + 4 + 8 + 4
                                        + (2 + 65535) + 4 + (1 + 255 * 32)),
    "SetNewPrevHash":            (0x72, 8 + 32 + 4 + 4 + 32),
    "RequestTxData":             (0x73, 8),
    "RequestTxDataError":        (0x75, 8 + 1 + 255),
    "SubmitSolution":            (0x76, 8 + 4 + 4 + 4 + (2 + 65535)),
}


def test_limits_clear_spec_maximum():
    bad = []
    for name, (mtype, spec_max) in SPEC_MAX.items():
        if sv2.frame_limit(mtype) < spec_max:
            bad.append("%s: limit %d < spec max %d" % (name, sv2.frame_limit(mtype), spec_max))
    check("no limit is tighter than its own spec maximum", not bad)
    for b in bad:
        print("        " + b)


def test_a_real_found_block_is_never_refused():
    """The failure this guards: a 65 KB coinbase in SubmitSolution refused by
    our own bounds check = a mined block thrown away."""
    coinbase = b"\x01" * 60000
    body = (struct.pack("<Q", 1) + struct.pack("<I", 2) + struct.pack("<I", 3)
            + struct.pack("<I", 4) + struct.pack("<H", len(coinbase)) + coinbase)
    f = Feeder(hdr(sv2.MSG_SUBMIT_SOLUTION, len(body)) + body)
    try:
        _, m, p = sv2.read_frame(f)
        parsed = sv2.parse_submit_solution(p)
        check("SubmitSolution carrying a 60 KB coinbase is accepted",
              len(parsed["coinbase_tx"]) == 60000)
    except ValueError as e:
        check("SubmitSolution carrying a 60 KB coinbase is accepted", False)
        print("        refused: %s" % e)


def test_unknown_type_capped():
    f = Feeder(hdr(0xEE, sv2.UNKNOWN_FRAME_MAX + 1))
    try:
        sv2.read_frame(f)
        check("unknown msg_type is capped", False)
    except ValueError:
        check("unknown msg_type is capped", True)


# --- 3. legitimate traffic still passes --------------------------------------
# A bound that breaks real mining is worse than no bound. RequestTxDataSuccess
# carries a whole block's transactions; BCH's cap is 32 MB, so it keeps the
# U24 ceiling rather than a tighter one.
def test_tx_data_success_still_allowed():
    body = b"\x00" * 100_000
    f = Feeder(hdr(sv2.MSG_REQUEST_TX_DATA_SUCCESS, len(body)) + body)
    ext, mtype, payload = sv2.read_frame(f)
    check("RequestTxDataSuccess with a 100 KB block of txs still reads", len(payload) == 100_000)


def test_normal_frames_roundtrip():
    raw = sv2.build_setup_connection(host="127.0.0.1", port=8336)
    f = Feeder(raw)
    ext, mtype, payload = sv2.read_frame(f)
    ok = mtype == sv2.MSG_SETUP_CONNECTION
    sc = sv2.parse_setup_connection(payload)
    check("real SetupConnection round-trips unchanged",
          ok and sc["protocol"] == sv2.PROTOCOL_TEMPLATE_DISTRIBUTION)

    sol = sv2.build_submit_solution(1, 2, 3, 4, b"\xaa" * 200)
    f2 = Feeder(sol)
    _, m2, p2 = sv2.read_frame(f2)
    check("real SubmitSolution round-trips unchanged",
          m2 == sv2.MSG_SUBMIT_SOLUTION and sv2.parse_submit_solution(p2)["header_nonce"] == 4)


def test_boundary_exact():
    body = b"\x00" * sv2.frame_limit(sv2.MSG_SUBMIT_SOLUTION)
    f = Feeder(hdr(sv2.MSG_SUBMIT_SOLUTION, len(body)) + body)
    try:
        sv2.read_frame(f)
        check("a frame exactly at the limit is accepted (off-by-one)", True)
    except ValueError:
        check("a frame exactly at the limit is accepted (off-by-one)", False)


# --- 4. the live bridge reader carries the same bound ------------------------
# sv2_framing.read_frame is the library. The bridge has its OWN copy of this
# logic in _read_frame — the one an attacker actually reaches. A fix to only
# one of them is not a fix.
def test_bridge_reader_is_bounded():
    src = open(os.path.join(os.path.dirname(__file__), "..", "..",
                            "sv2", "bridge", "bchn_sv2_bridge.py")).read()
    body = src.split("async def _read_frame", 1)[1].split("async def", 1)[0]
    check("_read_frame calls check_frame_len", "check_frame_len" in body)
    check("_read_frame bounds BEFORE readexactly(length)",
          body.index("check_frame_len") < body.index("readexactly(length)"))
    check("ZMTP reader bounds its U64 length", "ZMTP_MAX_FRAME" in src)
    check("concurrent clients are capped", "MAX_CLIENTS" in src)


if __name__ == "__main__":
    print("SV2 frame bounds — trusted length prefix (mkpool class)")
    test_refuses_oversized_declaration()
    test_refuses_u24_ceiling()
    test_limits_clear_spec_maximum()
    test_a_real_found_block_is_never_refused()
    test_unknown_type_capped()
    test_tx_data_success_still_allowed()
    test_normal_frames_roundtrip()
    test_boundary_exact()
    test_bridge_reader_is_bounded()
    print()
    if FAILED:
        print("FAILED: %d" % len(FAILED))
        sys.exit(1)
    print("all frame-bounds checks passed")
