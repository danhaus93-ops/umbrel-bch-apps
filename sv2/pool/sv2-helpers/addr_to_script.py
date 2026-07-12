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
    typ = (out[0] >> 3) & 0x1f
    return typ, bytes(out[1:21])

def to_script(addr):
    try:
        ver, h160 = b58check_decode(addr)
        if ver == 0x00: return "76a914" + h160.hex() + "88ac"
        if ver == 0x05: return "a914" + h160.hex() + "87"
    except Exception:
        pass
    typ, h160 = cashaddr_decode(addr)
    if typ == 0: return "76a914" + h160.hex() + "88ac"
    if typ == 1: return "a914" + h160.hex() + "87"
    raise ValueError("unsupported address type")

if __name__ == "__main__":
    if len(sys.argv) != 2: sys.exit(1)
    try:
        print(to_script(sys.argv[1]))
    except Exception as e:
        sys.stderr.write(f"error: {e}\n"); sys.exit(1)
