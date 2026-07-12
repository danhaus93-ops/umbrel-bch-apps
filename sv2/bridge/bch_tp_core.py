#!/usr/bin/env python3
"""
bch_tp_core.py — consensus-critical core for a BCHN SV2 Template Provider bridge.
Prototype + self-tests. No network. Python 3 stdlib only.

Covers the four functions where a bug means a LOST BLOCK:
  1. GBT -> NewTemplate field mapping (incl. coinbase prefix/suffix split)
  2. Coinbase reconstruction with miner extranonce
  3. Merkle root from txids (Bitcoin/BCH double-SHA256 tree, odd-dup rule)
  4. Header serialization + PoW check (endianness golden-tested vs genesis)
"""
import hashlib, json, struct

def dsha(b: bytes) -> bytes:
    return hashlib.sha256(hashlib.sha256(b).digest()).digest()

def h2b_le(hexstr: str) -> bytes:
    """RPC hex (big-endian display) -> internal little-endian bytes."""
    return bytes.fromhex(hexstr)[::-1]

def b2h_be(b: bytes) -> str:
    return b[::-1].hex()

def varint(n: int) -> bytes:
    if n < 0xfd: return struct.pack("<B", n)
    if n <= 0xffff: return b"\xfd" + struct.pack("<H", n)
    if n <= 0xffffffff: return b"\xfe" + struct.pack("<I", n)
    return b"\xff" + struct.pack("<Q", n)

def push_data(b: bytes) -> bytes:
    n = len(b)
    if n < 0x4c: return bytes([n]) + b
    if n < 0x100: return b"\x4c" + bytes([n]) + b
    raise ValueError("script push too large for this context")

# ---------------------------------------------------------------- coinbase --
def bip34_height_push(height: int) -> bytes:
    """Minimal-encoding serialized CScriptNum push of the block height (BIP34,
    consensus-required on BCH exactly as on BTC)."""
    if height == 0: return b"\x00"
    r = b""
    v = height
    while v:
        r += bytes([v & 0xff]); v >>= 8
    if r[-1] & 0x80: r += b"\x00"
    return bytes([len(r)]) + r

def build_coinbase_parts(height: int, script_sig_tag: bytes,
                         extranonce_len: int, outputs: bytes,
                         locktime: int = 0):
    """Build coinbase tx split into (prefix, suffix) around the miner's
    extranonce, matching SV2 NewTemplate semantics:
      coinbase_tx = prefix || extranonce(extranonce_len bytes) || suffix
    BCH: no segwit, so this is a plain pre-segwit tx. version=2, one input.
    'outputs' is the already-serialized output section INCLUDING its count
    varint (payout + any node-required outputs lifted verbatim from GBT)."""
    scriptsig_head = bip34_height_push(height) + push_data(script_sig_tag)
    scriptsig_len = len(scriptsig_head) + extranonce_len
    if scriptsig_len > 100:
        raise ValueError("coinbase scriptSig exceeds 100-byte consensus limit")
    prefix = (
        struct.pack("<i", 2)                    # tx version
        + varint(1)                             # input count
        + b"\x00" * 32                          # prevout hash (null)
        + b"\xff\xff\xff\xff"                   # prevout index
        + varint(scriptsig_len)
        + scriptsig_head
    )
    suffix = (
        b"\xff\xff\xff\xff"                     # sequence
        + outputs
        + struct.pack("<I", locktime)
    )
    return prefix, suffix

def assemble_coinbase(prefix: bytes, extranonce: bytes, suffix: bytes) -> bytes:
    return prefix + extranonce + suffix

# ------------------------------------------------------------------ merkle --
def merkle_root(txid_le_list):
    """txids as internal little-endian bytes; standard odd-duplication tree."""
    layer = list(txid_le_list)
    if not layer: raise ValueError("empty tx list")
    while len(layer) > 1:
        if len(layer) & 1: layer.append(layer[-1])
        layer = [dsha(layer[i] + layer[i+1]) for i in range(0, len(layer), 2)]
    return layer[0]

def merkle_path_for_coinbase(txid_le_list):
    """The SV2 merkle_path for extended jobs: sibling hashes needed to fold the
    coinbase txid up to the root (coinbase is index 0 in every layer)."""
    path, layer = [], list(txid_le_list)
    while len(layer) > 1:
        if len(layer) & 1: layer.append(layer[-1])
        path.append(layer[1])
        layer = [dsha(layer[i] + layer[i+1]) for i in range(0, len(layer), 2)]
    return path

def fold_coinbase_with_path(cb_txid_le: bytes, path):
    h = cb_txid_le
    for sib in path:
        h = dsha(h + sib)
    return h

# ------------------------------------------------------------------ header --
def serialize_header(version: int, prev_hash_rpc: str, merkle_le: bytes,
                     ntime: int, nbits: int, nonce: int) -> bytes:
    return (struct.pack("<i", version)
            + h2b_le(prev_hash_rpc)
            + merkle_le
            + struct.pack("<I", ntime)
            + struct.pack("<I", nbits)
            + struct.pack("<I", nonce))

def target_from_nbits(nbits: int) -> int:
    exp, mant = nbits >> 24, nbits & 0x7fffff
    return mant << (8 * (exp - 3)) if exp > 3 else mant >> (8 * (3 - exp))

def pow_ok(header80: bytes, nbits: int) -> bool:
    return int.from_bytes(dsha(header80), "little") <= target_from_nbits(nbits)

# ---------------------------------------------- GBT -> NewTemplate mapping --
def gbt_to_new_template(gbt: dict, extranonce_len: int = 8) -> dict:
    """Map BCHN getblocktemplate -> SV2 NewTemplate, SPEC SEMANTICS:
    - coinbase_prefix = start of the *scriptSig* (BIP34 height push), <= 8 bytes.
      The POOL builds the full coinbase and adds payout outputs itself.
    - coinbase_tx_outputs: EMPTY on BCH (no witness commitment to mandate).
    - value_remaining = full coinbasevalue (client spends it in its outputs).
    BCH deltas: no witness commitment allowed; txids verbatim; CTOR order kept.
    """
    assert "default_witness_commitment" not in gbt, \
        "witness commitment present: this is not a BCH template"
    prefix = bip34_height_push(gbt["height"])
    assert len(prefix) <= 8, "coinbase_prefix exceeds spec 8-byte guidance"
    txids_le = [h2b_le(tx["txid"]) for tx in gbt["transactions"]]
    return {
        "template_id": None,
        "future_template": False,
        "version": gbt["version"],
        "coinbase_tx_version": 2,
        "coinbase_prefix": prefix,
        "coinbase_tx_input_sequence": 0xffffffff,
        "coinbase_tx_value_remaining": gbt["coinbasevalue"],
        "coinbase_tx_outputs_count": 0,
        "coinbase_tx_outputs": b"",
        "coinbase_tx_locktime": 0,
        "merkle_path": merkle_path_for_coinbase([b"\x00"*32] + txids_le)
                       if txids_le else [],
        "prev_hash": gbt["previousblockhash"],
        "header_timestamp": gbt["curtime"],
        "nbits": int(gbt["bits"], 16),
        "_tx_hex": [tx["data"] for tx in gbt["transactions"]],
        "_txids_le": txids_le,
    }

def strip_segwit_coinbase(cb: bytes) -> bytes:
    if cb[4:6] != b"\x00\x01":
        return cb
    version = cb[0:4]; rest = cb[6:]; o = 0
    o += 1; o += 32 + 4
    sslen = rest[o]; o += 1; o += sslen; o += 4
    vout = rest[o]; o += 1
    for _ in range(vout):
        o += 8; spk = rest[o]; o += 1; o += spk
    return version + rest[0:o] + rest[-4:]

def reconstruct_block_from_coinbase(tmpl: dict, coinbase_tx: bytes,
                                    version: int, ntime: int,
                                    nonce: int) -> bytes:
    """SubmitSolution hot path, SPEC SEMANTICS: the wire carries the FULL
    client-built coinbase. Validate its scriptSig begins with our prefix,
    then merkle + header + PoW gate + body."""
    coinbase_tx = strip_segwit_coinbase(coinbase_tx)
    off = 4 + 1 + 32 + 4                     # version, incount, prevout
    sslen = coinbase_tx[off]; off += 1
    assert sslen <= 100, "coinbase scriptSig exceeds 100 bytes"
    # scriptSig begins with the BIP34 height push: length byte + prefix bytes
    pre = tmpl["coinbase_prefix"]
    assert coinbase_tx[off:off+len(pre)] == pre, \
        "coinbase scriptSig does not begin with template prefix"
    cb_txid_le = dsha(coinbase_tx)
    root = merkle_root([cb_txid_le] + tmpl["_txids_le"])
    hdr = serialize_header(version, tmpl["prev_hash"], root,
                           ntime, tmpl["nbits"], nonce)
    if not pow_ok(hdr, tmpl["nbits"]):
        raise ValueError("solution does not meet target: refusing to submit")
    body = varint(1 + len(tmpl["_tx_hex"])) + coinbase_tx + b"".join(
        bytes.fromhex(t) for t in tmpl["_tx_hex"])
    return hdr + body

# ------------------------------------------------------------------- tests --
def test_genesis_golden():
    """Serialize the genesis header from raw fields; hash must equal the known
    genesis hash. Proves field order, widths, and endianness are consensus-
    exact (BTC and BCH share this block)."""
    merkle = h2b_le("4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b")
    hdr = serialize_header(
        1, "0" * 64, merkle, 1231006505, 0x1d00ffff, 2083236893)
    assert len(hdr) == 80
    got = b2h_be(dsha(hdr))
    want = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"
    assert got == want, f"genesis mismatch: {got}"
    assert pow_ok(hdr, 0x1d00ffff)
    print("  ok: genesis header golden test (serialization + endianness + PoW)")

def test_merkle_single():
    t = dsha(b"only")
    assert merkle_root([t]) == t
    assert merkle_path_for_coinbase([t]) == []
    print("  ok: single-tx merkle (root == txid, empty path)")

def test_merkle_path_equivalence():
    for n in (2, 3, 4, 5, 7, 12):
        txids = [dsha(bytes([i])) for i in range(n)]
        root = merkle_root(txids)
        path = merkle_path_for_coinbase(txids)
        assert fold_coinbase_with_path(txids[0], path) == root, f"n={n}"
    print("  ok: merkle_path folding == full tree for 2,3,4,5,7,12 txs (odd-dup rule)")

def test_bip34_encoding():
    assert bip34_height_push(1) == b"\x01\x01"
    assert bip34_height_push(127) == b"\x01\x7f"
    assert bip34_height_push(128) == b"\x02\x80\x00"   # sign-bit padding
    assert bip34_height_push(858000) == b"\x03" + (858000).to_bytes(3, "little")
    print("  ok: BIP34 height push minimal encoding incl. sign-bit edge")

def test_coinbase_roundtrip_and_scriptsig_limit():
    outs = varint(1) + struct.pack("<q", 312500000) + varint(4) + b"\x51\x51\x51\x51"
    pre, suf = build_coinbase_parts(858000, b"/LoneStrike/", 8, outs)
    en = bytes(range(8))
    cb = assemble_coinbase(pre, en, suf)
    # parse back: scriptSig length must cover head+extranonce exactly
    off = 4 + 1 + 32 + 4
    sslen = cb[off]; off += 1
    assert cb[off:off+sslen].endswith(en)
    try:
        build_coinbase_parts(1, b"x" * 95, 8, outs)
        raise AssertionError("scriptSig >100B not rejected")
    except ValueError:
        pass
    print("  ok: coinbase prefix/extranonce/suffix round-trip + 100B scriptSig guard")

def test_gbt_mapping_and_reconstruction():
    fake_tx1 = "01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0451515151ffffffff0100f2052a01000000045151515100000000"
    txid1 = b2h_be(dsha(bytes.fromhex(fake_tx1)))
    gbt = {"version": 0x20000000, "height": 858001,
           "previousblockhash": "00" * 32,
           "curtime": 1752170000, "bits": "207fffff",
           "coinbasevalue": 312501000,
           "transactions": [{"txid": txid1, "data": fake_tx1}]}
    t = gbt_to_new_template(gbt)
    assert t["coinbase_tx_outputs"] == b"" and t["coinbase_tx_outputs_count"] == 0
    assert len(t["coinbase_prefix"]) <= 8
    # POOL-SIDE coinbase build (what SRI does): prefix + own extranonce bytes
    # in scriptSig, own payout outputs, template outputs appended (empty)
    en = bytes(range(8))
    ssig = bytes([len(t["coinbase_prefix"])]) + t["coinbase_prefix"] + en
    outs = varint(1) + struct.pack("<q", t["coinbase_tx_value_remaining"]) \
           + varint(1) + b"\x51"
    cb = (struct.pack("<i", t["coinbase_tx_version"]) + varint(1)
          + b"\x00"*32 + b"\xff"*4 + varint(len(ssig)) + ssig
          + struct.pack("<I", t["coinbase_tx_input_sequence"])
          + outs + t["coinbase_tx_outputs"]
          + struct.pack("<I", t["coinbase_tx_locktime"]))
    blk = None
    for nonce in range(200000):
        try:
            blk = reconstruct_block_from_coinbase(
                t, cb, gbt["version"], gbt["curtime"], nonce)
            break
        except ValueError:
            continue
    assert blk is not None, "no nonce met regtest target"
    hdr = blk[:80]
    assert pow_ok(hdr, t["nbits"])
    cb_end = blk.find(bytes.fromhex(fake_tx1), 81)
    cb_rt = blk[81:cb_end]
    assert cb_rt == cb, "coinbase not carried verbatim"
    assert merkle_root([dsha(cb), h2b_le(txid1)]) == hdr[36:68]
    # prefix guard: coinbase whose scriptSig lacks the height push is refused
    _pfx = bytes([len(t["coinbase_prefix"])]) + t["coinbase_prefix"]
    bad = cb.replace(_pfx, bytes([len(t["coinbase_prefix"])]) + b"\x00"*len(t["coinbase_prefix"]), 1)
    try:
        reconstruct_block_from_coinbase(t, bad, gbt["version"],
                                        gbt["curtime"], 0)
        raise SystemExit("prefix guard did not fire")
    except AssertionError:
        pass
    # witness guard
    try:
        gbt_to_new_template({**gbt, "default_witness_commitment": "6a24aa21"})
        raise SystemExit("witness guard did not fire")
    except AssertionError:
        pass
    print("  ok: SPEC-SEMANTICS: pool-built coinbase -> mined -> reconstructed, "
          "verbatim carry, prefix guard, witness guard")

if __name__ == "__main__":
    print("bch_tp_core self-tests:")
    test_genesis_golden()
    test_merkle_single()
    test_merkle_path_equivalence()
    test_bip34_encoding()
    test_coinbase_roundtrip_and_scriptsig_limit()
    test_gbt_mapping_and_reconstruction()
    print("ALL TESTS PASSED")
