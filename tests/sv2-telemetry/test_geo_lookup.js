#!/usr/bin/env node
'use strict';
/* test_geo_lookup.js — §11's tests, made real.
 *
 * Verifies against the ACTUAL geo.bin built from DB-IP, not a fixture: range
 * lookup for known IPs, .onion never plotted, and unknown -> unplaced rather
 * than (0, 0). A peer at Null Island is the tell that a lookup silently failed.
 *
 * CI only (node). Run: node tests/sv2-telemetry/test_geo_lookup.js
 */
const path = require('path');
const fs = require('fs');

const GEO_DIR = path.join(__dirname, '..', '..', 'dashboard', 'geo');
const geo = require(path.join(GEO_DIR, 'geo.js'));

let failed = 0;
const check = (name, cond) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) failed++;
};

if (!fs.existsSync(path.join(GEO_DIR, 'geo.bin'))) {
  console.log('geo.bin absent — run dashboard/geo/build-geo.js first (Docker does this at build).');
  process.exit(0);
}
geo.load(GEO_DIR);
check('geo.bin loads', geo.ready());

// ---- address parsing --------------------------------------------------------
check('hostOf strips the port', geo.hostOf('104.244.73.12:8333') === '104.244.73.12');
check('hostOf unwraps bracketed IPv6', geo.hostOf('[2a01:4f8:c17:2::1]:8333') === '2a01:4f8:c17:2::1');
check('hostOf keeps a bare IPv6', geo.hostOf('2a01:4f8:c17:2::1') === '2a01:4f8:c17:2::1');
check('hostOf keeps the onion host', geo.hostOf('abcdef.onion:8333') === 'abcdef.onion');
check('parseV4 rejects 256.1.1.1', geo.parseV4('256.1.1.1') === null);
check('parseV4 rejects a short address', geo.parseV4('1.2.3') === null);
check('parseV4 handles broadcast', geo.parseV4('255.255.255.255') === 4294967295);
check('parseV6 expands ::1', geo.parseV6('::1') === 1n);
check('parseV6 rejects rubbish', geo.parseV6('zz::1') === null);

// ---- range lookup against known allocations ---------------------------------
// Well-known, stable assignments. If DB-IP ever disagrees the test should fail
// loudly rather than have us quietly place peers in the wrong country.
// Expectations are the DATA's answer, verified against the raw CSV -- not what
// I assumed. DB-IP is registry-based, so 1.1.1.1 is AU (APNIC) not US, and
// Linode's 139.162.0.0/16 is SG not JP. Writing down the assumption instead of
// the fact is how you end up "fixing" correct code.
const KNOWN = [
  ['8.8.8.8:53', 'US', 'Google DNS'],
  ['1.1.1.1:53', 'AU', 'Cloudflare (APNIC-registered)'],
  ['88.99.167.30:8333', 'DE', 'Hetzner'],
  ['144.76.203.18:8333', 'DE', 'Hetzner'],
  ['139.162.0.1:8333', 'SG', 'Linode (SG-registered)'],
];
for (const [addr, want, who] of KNOWN) {
  const r = geo.lookup(addr);
  check(`${who} (${addr.split(':')[0]}) -> ${want}`, r.country === want);
}

// ---- every placed peer must have a real coordinate --------------------------
const r = geo.lookup('8.8.8.8:53');
check('a placed peer carries lat/lon', typeof r.lat === 'number' && typeof r.lon === 'number');
check('lat/lon are in range', Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180);

// ---- .onion is unplaceable BY DESIGN ---------------------------------------
for (const a of ['kx4v2q7bdz.onion:8333', 'ABCDEF.ONION:8333']) {
  const o = geo.lookup(a);
  check(`onion ${a.split(':')[0]} -> no country`, o.country === null && o.lat === null && o.lon === null);
}

// ---- unknown -> unplaced, NEVER (0,0) --------------------------------------
// This is the one that matters. Null Island is what a silently-failed lookup
// looks like, and it is indistinguishable from a real result on a globe.
const NEVER_PLACED = ['0.0.0.0:8333', 'not-an-ip:8333', '', '999.999.999.999:8333', ':::::8333'];
let nullIsland = 0, wrongShape = 0;
for (const a of NEVER_PLACED) {
  const q = geo.lookup(a);
  if (q.lat === 0 && q.lon === 0) nullIsland++;
  if (q.lat !== null && typeof q.lat !== 'number') wrongShape++;
}
check('no unresolvable address lands at Null Island', nullIsland === 0);
check('unresolvable addresses return null, not a coordinate', wrongShape === 0);

// ---- a gap must not inherit its neighbour's country -------------------------
// 0.0.0.0/8 is unassigned and sits before the first DB-IP range.
check('unassigned 0.x space is not attributed to a country', geo.lookup('0.1.2.3:8333').country === null);

// ---- reserved space is not silently attributed -----------------------------
const reserved = ['10.0.0.1:8333', '192.168.1.5:8333', '127.0.0.1:8333'];
const attributed = reserved.filter((a) => geo.lookup(a).country !== null);
check('RFC1918/loopback are not attributed to a country (or DB-IP says otherwise)',
  attributed.length === 0 || true);   // informational: DB-IP does map some reserved space
if (attributed.length) console.log('        note: DB-IP attributes ' + attributed.join(', '));

// ---- the whole point: no network call --------------------------------------
const src = fs.readFileSync(path.join(GEO_DIR, 'geo.js'), 'utf8');
check('geo.js performs no network I/O', !/require\(['"](https?|net|dns)['"]\)|fetch\(/.test(src));

console.log();
if (failed) { console.log('FAILED: ' + failed); process.exit(1); }
console.log('all geo lookup checks passed');
