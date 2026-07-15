#!/usr/bin/env python3
"""addr-to-script — BCH address (legacy Base58 OR CashAddr) -> raw P2PKH/P2SH
scriptPubKey hex, for the pool's raw(<script>) descriptor."""
import sys, hashlib

def b58check_decode(s):
    alpha = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    n = 0
    for c in s:
        if c not in alpha: raise ValueError("bad base58 char")
        n = n * 58 + alpha.index(c)
    raw = n.to_bytes(25, 'big')
    if hashlib.sha256(hashlib.sha256(raw[:21]).digest()).digest()[:4] != raw[21:]:
        raise ValueError("bad checksum")
    return raw[0], raw[1:21]

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
# spec: version byte size bits -> hash length in bytes
CASHADDR_HASH_SIZE = {0: 20, 1: 24, 2: 28, 3: 32,
                      4: 40, 5: 48, 6: 56, 7: 64}
def cashaddr_polymod(values):
    gen = [0x98f2bc8e61,0x79b76d99e2,0xf33e5fb3c4,0xae2eabe2a8,0x1e4f43e470]
    chk = 1
    for v in values:
        top = chk >> 35
        chk = ((chk & 0x07ffffffff) << 5) ^ v
        for i in range(5):
            if (top >> i) & 1: chk ^= gen[i]
    return chk ^ 1

def cashaddr_decode(addr):
    if ':' in addr:
        prefix, payload = addr.split(':', 1)
    else:
        prefix, payload = 'bitcoincash', addr
    data = [CHARSET.find(c) for c in payload.lower()]
    if -1 in data: raise ValueError("bad cashaddr char")
    prefix_data = [ord(c) & 0x1f for c in prefix] + [0]
    if cashaddr_polymod(prefix_data + data) != 0:
        raise ValueError("bad cashaddr checksum")
    payload_data = data[:-8]
    acc = 0; bits = 0; out = bytearray()
    for v in payload_data:
        acc = (acc << 5) | v; bits += 5
        if bits >= 8:
            bits -= 8; out.append((acc >> bits) & 0xff)
    # leftover bits must be zero padding (spec: <5 bits, all zero)
    if bits >= 5 or (acc & ((1 << bits) - 1)) != 0:
        raise ValueError("bad cashaddr padding")
    if not out:
        raise ValueError("empty cashaddr payload")
    version = out[0]
    if version & 0x80:
        raise ValueError("cashaddr version byte reserved bit is set")
    # spec: 1 reserved bit | 4 type bits | 3 size bits
    typ = (version >> 3) & 0x0f
    declared = CASHADDR_HASH_SIZE[version & 0x07]
    h = bytes(out[1:])
    # THE BUG THIS REPLACES: the old code returned out[1:21] unconditionally,
    # so a 32-byte (P2SH32) hash was silently TRUNCATED to 20 bytes and the
    # pool built a valid-looking coinbase paying an unspendable script --
    # the block would be found and the reward burned.
    if len(h) != declared:
        raise ValueError(f"cashaddr hash is {len(h)}B but the version byte "
                         f"declares {declared}B")
    return typ, h

def to_script(addr):
    addr = addr.strip()
    try:
        ver, h160 = b58check_decode(addr)
    except Exception:
        pass                      # not base58; fall through to cashaddr
    else:
        if ver == 0x00: return "76a914" + h160.hex() + "88ac"
        if ver == 0x05: return "a914" + h160.hex() + "87"
        raise ValueError(f"unsupported legacy address version 0x{ver:02x}")
    typ, h = cashaddr_decode(addr)
    if typ == 0:
        if len(h) != 20:
            raise ValueError(f"P2PKH needs a 20-byte hash, got {len(h)}B")
        return "76a914" + h.hex() + "88ac"
    if typ == 1:
        if len(h) == 20:
            return "a914" + h.hex() + "87"
        if len(h) == 32:
            # P2SH32 (OP_HASH256 form) is deliberately NOT emitted here: we
            # will not guess a payout script we cannot verify against a
            # reference. Refusing costs nothing; guessing wrong burns a block.
            raise ValueError("P2SH32 payout addresses are not supported yet; "
                             "use a standard P2PKH address")
        raise ValueError(f"P2SH needs a 20-byte hash, got {len(h)}B")
    raise ValueError(f"unsupported cashaddr type {typ}")

if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit(1)
    try:
        print(to_script(sys.argv[1]))
    except Exception as e:
        sys.stderr.write(f"error: {e}\n"); sys.exit(1)
