'use strict';
/* geo.js — country lookup for peer addresses. Runs entirely on this node.
 *
 * There is deliberately NO network call here. Sending the peer list to
 * ip-api.com or ipinfo.io would hand a passive observer the node's whole
 * topology on every dashboard refresh. Country granularity is plenty for a
 * globe, and it costs one binary search over a file baked into the image.
 *
 * Data: DB-IP IP-to-Country Lite, CC BY 4.0 — https://db-ip.com
 * Centroids: gavinr/world-countries-centroids (MIT) + world-atlas fallback.
 *
 * Rules that matter more than the lookup itself:
 *   - .onion has no location, by design. Never guessed, never dropped.
 *   - An address we cannot resolve returns null, never (0, 0). A peer at
 *     Null Island is the tell that a lookup silently failed.
 */
const fs = require('fs');
const path = require('path');

const UNKNOWN = 0xffff;
const MAGIC = 'LSGEO1\0\0';

let DB = null;      // { buf, v4Off, v4Count, v6Off, v6Count, ccs }
let CENTROIDS = {};
let loadError = null;

function load(dir) {
  const binPath = path.join(dir, 'geo.bin');
  const cenPath = path.join(dir, 'centroids.json');
  try {
    const buf = fs.readFileSync(binPath);
    if (buf.slice(0, 8).toString('ascii') !== MAGIC) throw new Error('bad magic in geo.bin');
    const v4Count = buf.readUInt32LE(8);
    const v6Count = buf.readUInt32LE(12);
    const ccCount = buf.readUInt16LE(16);
    const ccOff = 18;
    const ccs = [];
    for (let i = 0; i < ccCount; i++) ccs.push(buf.slice(ccOff + i * 2, ccOff + i * 2 + 2).toString('ascii').trim());
    const v4Off = ccOff + ccCount * 2;
    const v6Off = v4Off + v4Count * 6;
    const want = v6Off + v6Count * 18;
    if (buf.length !== want) throw new Error(`geo.bin truncated: ${buf.length} != ${want}`);
    DB = { buf, v4Off, v4Count, v6Off, v6Count, ccs };
    CENTROIDS = JSON.parse(fs.readFileSync(cenPath, 'utf8'));
    return true;
  } catch (e) {
    // Not fatal. A dashboard without a globe is a working dashboard; a
    // dashboard that won't boot is not.
    loadError = e.message;
    DB = null;
    return false;
  }
}

function parseV4(s) {
  const p = s.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const o of p) {
    const v = Number(o);
    if (!Number.isInteger(v) || v < 0 || v > 255 || o === '') return null;
    n = (n * 256 + v) >>> 0;
  }
  return n >>> 0;
}

function parseV6(s) {
  if (!s.includes(':')) return null;
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  const dbl = s.indexOf('::');
  let head, tail;
  if (dbl >= 0) {
    head = s.slice(0, dbl) ? s.slice(0, dbl).split(':') : [];
    tail = s.slice(dbl + 2) ? s.slice(dbl + 2).split(':') : [];
  } else {
    head = s.split(':');
    tail = [];
  }
  const all = [...head, ...tail];
  if (all.length && all[all.length - 1].includes('.')) {
    const v4 = parseV4(all.pop());
    if (v4 === null) return null;
    const t = dbl >= 0 && tail.length ? tail : head;
    (dbl >= 0 && tail.length ? tail : head).push(
      ((v4 >>> 16) & 0xffff).toString(16), (v4 & 0xffff).toString(16));
  }
  let groups;
  if (dbl >= 0) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

// Last record whose start <= key. Records are sorted with explicit UNKNOWN
// markers at every gap, so "the range that started most recently" is the
// answer — no end field needed, and a gap can never inherit a neighbour.
function searchV4(ip) {
  const { buf, v4Off, v4Count } = DB;
  let lo = 0, hi = v4Count - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (buf.readUInt32LE(v4Off + mid * 6) <= ip) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (found < 0) return null;
  const idx = buf.readUInt16LE(v4Off + found * 6 + 4);
  return idx === UNKNOWN ? null : DB.ccs[idx];
}

function searchV6(ip) {
  const { buf, v6Off, v6Count } = DB;
  let lo = 0, hi = v6Count - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const o = v6Off + mid * 18;
    const start = (buf.readBigUInt64LE(o) << 64n) | buf.readBigUInt64LE(o + 8);
    if (start <= ip) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (found < 0) return null;
  const idx = buf.readUInt16LE(v6Off + found * 18 + 16);
  return idx === UNKNOWN ? null : DB.ccs[idx];
}

// getpeerinfo gives "1.2.3.4:8333" or "[2a01:...]:8333" or "abc.onion:8333"
function hostOf(addr) {
  if (!addr) return null;
  if (addr.startsWith('[')) {
    const e = addr.indexOf(']');
    return e > 0 ? addr.slice(1, e) : null;
  }
  const c = addr.lastIndexOf(':');
  // bare IPv6 with no brackets and no port
  if (c > 0 && addr.indexOf(':') !== c) return addr;
  return c > 0 ? addr.slice(0, c) : addr;
}

function lookup(addr) {
  const miss = { country: null, lat: null, lon: null };
  if (!DB || !addr) return miss;
  const host = hostOf(addr);
  if (!host || /\.onion$/i.test(host)) return miss;   // onion has no location, by design
  let cc = null;
  const v4 = parseV4(host);
  if (v4 !== null) cc = searchV4(v4);
  else {
    const v6 = parseV6(host);
    if (v6 !== null) cc = searchV6(v6);
  }
  if (!cc) return miss;
  const c = CENTROIDS[cc];
  if (!c) return { country: cc, lat: null, lon: null };   // known country, no centroid
  return { country: cc, lat: c[0], lon: c[1] };
}

module.exports = { load, lookup, ready: () => Boolean(DB), error: () => loadError, hostOf, parseV4, parseV6 };
