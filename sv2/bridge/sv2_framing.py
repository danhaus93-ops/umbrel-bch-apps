#!/usr/bin/env python3
"""sv2_framing.py — Stratum V2 binary framing + Template Distribution Protocol
messages. Stdlib only. Plaintext framing (SRI pool roles accept unencrypted
TDP when no tp_authority_public_key is configured, the standard setup for a
localhost/LAN template provider).

Wire format (SV2 spec):
  frame = extension_type:U16LE  msg_type:U8  msg_length:U24LE  payload
Field types: U8..U64 little-endian, U256 = 32 raw bytes (internal byte order),
B0_255 = len:U8 + bytes, B0_64K = len:U16LE + bytes, B0_16M = len:U24LE + bytes,
STR0_255 = len:U8 + utf8, SEQ0_255[U256] = count:U8 + N*32 bytes, BOOL = U8.

NOTE: message type numbers and field layouts follow the SV2 spec as of the
2025-era revisions; re-verify against the exact SRI release you pair with
(the CoinbaseOutputDataSize -> CoinbaseOutputConstraints rename is handled).
"""
import struct

# --- template distribution message types ---
MSG_SETUP_CONNECTION          = 0x00
MSG_SETUP_CONNECTION_SUCCESS  = 0x01
MSG_SETUP_CONNECTION_ERROR    = 0x02
MSG_COINBASE_OUTPUT_CONSTRAINTS = 0x70   # née CoinbaseOutputDataSize
MSG_NEW_TEMPLATE              = 0x71
MSG_SET_NEW_PREV_HASH         = 0x72
MSG_REQUEST_TX_DATA           = 0x73
MSG_REQUEST_TX_DATA_SUCCESS   = 0x74
MSG_REQUEST_TX_DATA_ERROR     = 0x75
MSG_SUBMIT_SOLUTION           = 0x76

PROTOCOL_TEMPLATE_DISTRIBUTION = 2
SV2_VERSION = 2

class Writer:
    def __init__(self): self.b = bytearray()
    def u8(self, v):  self.b += struct.pack("<B", v); return self
    def u16(self, v): self.b += struct.pack("<H", v); return self
    def u24(self, v): self.b += struct.pack("<I", v)[:3]; return self
    def u32(self, v): self.b += struct.pack("<I", v); return self
    def u64(self, v): self.b += struct.pack("<Q", v); return self
    def boolean(self, v): return self.u8(1 if v else 0)
    def u256(self, raw32):
        assert len(raw32) == 32; self.b += raw32; return self
    def b0_255(self, d):
        assert len(d) <= 0xff; self.u8(len(d)); self.b += d; return self
    def b0_64k(self, d):
        assert len(d) <= 0xffff; self.u16(len(d)); self.b += d; return self
    def b0_16m(self, d):
        assert len(d) <= 0xffffff; self.u24(len(d)); self.b += d; return self
    def str0_255(self, s): return self.b0_255(s.encode())
    def seq0_255_u256(self, items):
        assert len(items) <= 0xff; self.u8(len(items))
        for i in items: self.u256(i)
        return self
    def seq0_64k_b016m(self, items):
        assert len(items) <= 0xffff; self.u16(len(items))
        for i in items: self.b0_16m(i)
        return self

class Reader:
    def __init__(self, b): self.b = b; self.o = 0
    def take(self, n):
        d = self.b[self.o:self.o+n]
        if len(d) != n: raise ValueError("short read")
        self.o += n; return d
    def u8(self):  return self.take(1)[0]
    def u16(self): return struct.unpack("<H", self.take(2))[0]
    def u24(self): return struct.unpack("<I", self.take(3) + b"\x00")[0]
    def u32(self): return struct.unpack("<I", self.take(4))[0]
    def u64(self): return struct.unpack("<Q", self.take(8))[0]
    def boolean(self): return self.u8() != 0
    def u256(self): return self.take(32)
    def b0_255(self): return self.take(self.u8())
    def b0_64k(self): return self.take(self.u16())
    def b0_16m(self): return self.take(self.u24())
    def str0_255(self): return self.b0_255().decode()
    def seq0_255_u256(self): return [self.u256() for _ in range(self.u8())]
    def seq0_64k_b016m(self): return [self.b0_16m() for _ in range(self.u16())]
    def remaining(self): return len(self.b) - self.o

def frame(msg_type: int, payload: bytes, extension_type: int = 0) -> bytes:
    assert len(payload) <= 0xffffff
    return (struct.pack("<H", extension_type) + struct.pack("<B", msg_type)
            + struct.pack("<I", len(payload))[:3] + payload)

def read_frame(sock_read):
    """sock_read(n) must return exactly n bytes or raise."""
    hdr = sock_read(6)
    ext, mtype = struct.unpack("<H", hdr[0:2])[0], hdr[2]
    length = struct.unpack("<I", hdr[3:6] + b"\x00")[0]
    return ext, mtype, sock_read(length) if length else b""

# ---------------------------- message builders/parsers ----------------------
def build_setup_connection(host="", port=0, vendor="LoneStrikeLabs",
                           hw="", fw="bchn-sv2-bridge/0.1", device_id=""):
    w = Writer()
    w.u8(PROTOCOL_TEMPLATE_DISTRIBUTION).u16(SV2_VERSION).u16(SV2_VERSION)
    w.u32(0).str0_255(host).u16(port).str0_255(vendor)
    w.str0_255(hw).str0_255(fw).str0_255(device_id)
    return frame(MSG_SETUP_CONNECTION, bytes(w.b))

def parse_setup_connection(p):
    r = Reader(p)
    return {"protocol": r.u8(), "min_version": r.u16(), "max_version": r.u16(),
            "flags": r.u32(), "endpoint_host": r.str0_255(),
            "endpoint_port": r.u16(), "vendor": r.str0_255(),
            "hardware_version": r.str0_255(), "firmware": r.str0_255(),
            "device_id": r.str0_255()}

def build_setup_success(used_version=SV2_VERSION, flags=0):
    return frame(MSG_SETUP_CONNECTION_SUCCESS,
                 bytes(Writer().u16(used_version).u32(flags).b))

def parse_setup_success(p):
    r = Reader(p); return {"used_version": r.u16(), "flags": r.u32()}

def parse_coinbase_output_constraints(p):
    """Accepts both the old 4-byte CoinbaseOutputDataSize and the newer
    6-byte CoinbaseOutputConstraints (adds max_additional_sigops U16)."""
    r = Reader(p)
    out = {"coinbase_output_max_additional_size": r.u32()}
    out["coinbase_output_max_additional_sigops"] = r.u16() if r.remaining() >= 2 else 0
    return out

def build_coinbase_output_constraints(max_size, max_sigops=None):
    w = Writer().u32(max_size)
    if max_sigops is not None: w.u16(max_sigops)
    return frame(MSG_COINBASE_OUTPUT_CONSTRAINTS, bytes(w.b))

def build_new_template(t):
    w = Writer()
    w.u64(t["template_id"]).boolean(t["future_template"]).u32(t["version"])
    w.u32(t["coinbase_tx_version"]).b0_255(t["coinbase_prefix"])
    w.u32(t["coinbase_tx_input_sequence"])
    w.u64(t["coinbase_tx_value_remaining"])
    w.u32(t["coinbase_tx_outputs_count"]).b0_64k(t["coinbase_tx_outputs"])
    w.u32(t["coinbase_tx_locktime"]).seq0_255_u256(t["merkle_path"])
    return frame(MSG_NEW_TEMPLATE, bytes(w.b))

def parse_new_template(p):
    r = Reader(p)
    return {"template_id": r.u64(), "future_template": r.boolean(),
            "version": r.u32(), "coinbase_tx_version": r.u32(),
            "coinbase_prefix": r.b0_255(),
            "coinbase_tx_input_sequence": r.u32(),
            "coinbase_tx_value_remaining": r.u64(),
            "coinbase_tx_outputs_count": r.u32(),
            "coinbase_tx_outputs": r.b0_64k(),
            "coinbase_tx_locktime": r.u32(),
            "merkle_path": r.seq0_255_u256()}

def build_set_new_prev_hash(template_id, prev_hash_le32, header_ts, nbits, target_le32):
    w = Writer().u64(template_id).u256(prev_hash_le32).u32(header_ts)
    w.u32(nbits).u256(target_le32)
    return frame(MSG_SET_NEW_PREV_HASH, bytes(w.b))

def parse_set_new_prev_hash(p):
    r = Reader(p)
    return {"template_id": r.u64(), "prev_hash": r.u256(),
            "header_timestamp": r.u32(), "nbits": r.u32(),
            "target": r.u256()}

def build_request_tx_data(template_id):
    return frame(MSG_REQUEST_TX_DATA, bytes(Writer().u64(template_id).b))

def parse_request_tx_data(p):
    return {"template_id": Reader(p).u64()}

def build_request_tx_data_success(template_id, excess_data, tx_list):
    w = Writer().u64(template_id).b0_64k(excess_data).seq0_64k_b016m(tx_list)
    return frame(MSG_REQUEST_TX_DATA_SUCCESS, bytes(w.b))

def parse_request_tx_data_success(p):
    r = Reader(p)
    return {"template_id": r.u64(), "excess_data": r.b0_64k(),
            "transaction_list": r.seq0_64k_b016m()}

def build_submit_solution(template_id, version, header_ts, nonce, coinbase_tx):
    w = Writer().u64(template_id).u32(version).u32(header_ts).u32(nonce)
    w.b0_64k(coinbase_tx)
    return frame(MSG_SUBMIT_SOLUTION, bytes(w.b))

def parse_submit_solution(p):
    r = Reader(p)
    return {"template_id": r.u64(), "version": r.u32(),
            "header_timestamp": r.u32(), "header_nonce": r.u32(),
            "coinbase_tx": r.b0_64k()}
