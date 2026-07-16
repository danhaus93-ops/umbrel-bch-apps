#!/usr/bin/env node
/* build-geo.js — runs at DOCKER BUILD TIME only. Never at runtime.
 *
 * Turns the DB-IP IP-to-Country Lite CSVs into a sorted binary the dashboard
 * can binary-search, plus a country -> centroid table. The point is that the
 * node NEVER makes a network call to locate a peer: shipping the peer list to
 * ip-api.com would hand a passive observer your whole topology, which is
 * absurd next to the Tor work.
 *
 * Data: DB-IP IP-to-Country Lite, CC BY 4.0 (https://db-ip.com).
 * Attribution is required and is rendered in the dashboard UI.
 *
 * Format (little-endian):
 *   magic   "LSGEO1\0\0"                 8
 *   u32 v4Count, u32 v6Count, u16 ccCount
 *   cc table  ccCount * 2 bytes          ASCII alpha-2
 *   v4 recs   v4Count * 6                u32 start, u16 ccIdx
 *   v6 recs   v6Count * 18               u64 hi, u64 lo, u16 ccIdx
 *
 * Only range STARTS are stored. The dataset is sorted with zero overlaps, so
 * a range ends where the next begins — except for the handful of real gaps,
 * where an explicit UNKNOWN marker is inserted. Without those markers an IP in
 * a gap would inherit the previous range's country: a peer placed in a country
 * it isn't in, which is worse than unplaced.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const topojson = require('topojson-client');
const countries = require('i18n-iso-countries');

const BASE = 'https://raw.githubusercontent.com/sapics/ip-location-db/main/dbip-country';
const OUT = process.argv[2] || path.join(__dirname, 'geo.bin');
const UNKNOWN = 0xffff;

function once(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) return resolve(once(res.headers.location));
      if (res.statusCode !== 200) return reject(new Error(url + ' -> HTTP ' + res.statusCode));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.setTimeout(120000, () => req.destroy(new Error('timeout after 120s: ' + url)));
    req.on('error', reject);
  });
}

// The image build's only network dependency, so a blip here fails the whole
// build. Retry with backoff rather than losing a release to one bad fetch.
async function get(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await once(url); } catch (e) {
      last = e;
      if (i < tries - 1) {
        const wait = 2000 * Math.pow(2, i);
        console.error(`  fetch failed (${e.message}); retrying in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw last;
}

const v4ToInt = (s) => s.split('.').reduce((a, o) => (a * 256 + Number(o)) >>> 0, 0);

function v6ToBig(s) {
  let [head, tail] = s.split('::');
  let h = head ? head.split(':') : [];
  let t = tail !== undefined ? (tail ? tail.split(':') : []) : null;
  let parts;
  if (t === null) parts = h;
  else parts = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  // an embedded IPv4 tail (::ffff:1.2.3.4) shows up in these files
  if (parts.length && parts[parts.length - 1].includes('.')) {
    const o = parts.pop().split('.').map(Number);
    parts.push(((o[0] << 8) | o[1]).toString(16), ((o[2] << 8) | o[3]).toString(16));
  }
  let n = 0n;
  for (const p of parts) n = (n << 16n) | BigInt(parseInt(p || '0', 16));
  return n;
}

function parse(csv, toNum) {
  const out = [];
  for (const line of csv.split('\n')) {
    if (!line) continue;
    const i = line.indexOf(','), j = line.indexOf(',', i + 1);
    if (i < 0 || j < 0) continue;
    out.push([toNum(line.slice(0, i)), toNum(line.slice(i + 1, j)), line.slice(j + 1).trim()]);
  }
  return out;
}

// Insert explicit UNKNOWN markers wherever the dataset skips address space, so
// a gap can never inherit the previous range's country.
function withGaps(rows, one) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    out.push([rows[i][0], rows[i][2]]);
    const nextStart = i + 1 < rows.length ? rows[i + 1][0] : null;
    const impliedNext = rows[i][1] + one;
    if (nextStart === null || impliedNext !== nextStart) out.push([impliedNext, null]);
  }
  return out;
}

// Country -> centroid. Primary source is a purpose-built centroid dataset
// (MIT). Fallback is the largest polygon's centroid from world-atlas, for the
// few codes the primary misses.
//
// Computing centroids from polygons alone is not good enough on its own: the
// planar formula put Russia at longitude 202.79 (it straddles the antimeridian
// and the ring wraps past 180), and Singapore has no polygon at all at 110m
// resolution -- and SG is a major VPS location for BCH peers. Both would have
// shipped as silently wrong or silently unplaced.
const CENTROID_CSV =
  'https://raw.githubusercontent.com/gavinr/world-countries-centroids/master/dist/countries.csv';

function polygonCentroids() {
  const world = require('world-atlas/countries-110m.json');
  const feats = topojson.feature(world, world.objects.countries).features;
  const table = {};
  for (const f of feats) {
    const a2 = countries.numericToAlpha2(String(f.id).padStart(3, '0'));
    if (!a2) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = null, bestArea = -1;
    for (const p of polys) {
      const ring = p[0];
      let a = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      }
      a = Math.abs(a / 2);
      if (a > bestArea) { bestArea = a; best = ring; }
    }
    if (!best) continue;
    // Average on the unit sphere, so an antimeridian crossing cannot produce a
    // longitude outside [-180, 180].
    let x = 0, y = 0, z = 0;
    for (const [lon, lat] of best) {
      const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
      x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
    }
    const n = best.length;
    x /= n; y /= n; z /= n;
    const hyp = Math.sqrt(x * x + y * y);
    if (hyp === 0 && z === 0) continue;
    table[a2] = [
      Number((Math.atan2(z, hyp) * 180 / Math.PI).toFixed(2)),
      Number((Math.atan2(y, x) * 180 / Math.PI).toFixed(2)),
    ];
  }
  return table;
}

async function centroids() {
  const csv = await get(CENTROID_CSV);
  const lines = csv.trim().split('\n');
  const head = lines[0].trim().split(',');
  const iLon = head.indexOf('longitude'), iLat = head.indexOf('latitude'), iIso = head.indexOf('ISO');
  if (iLon < 0 || iLat < 0 || iIso < 0) throw new Error('centroid CSV header changed');
  const table = {};
  for (const line of lines.slice(1)) {
    const f = line.trim().split(',');
    const iso = f[iIso], lat = Number(f[iLat]), lon = Number(f[iLon]);
    if (!iso || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;   // refuse nonsense
    table[iso] = [Number(lat.toFixed(2)), Number(lon.toFixed(2))];
  }
  // Neither source covers these, and together they are 0.68% of IPv4 space --
  // Hong Kong alone is a common VPS location, so leaving them unplaced would
  // put real peers in the "unplaced" bucket for no good reason. Hand-entered
  // from the standard centroid of each territory.
  const MANUAL = { HK: [22.35, 114.13], MO: [22.17, 113.55], XK: [42.60, 20.90], AX: [60.18, 19.95] };
  for (const [k, v] of Object.entries(MANUAL)) if (!table[k]) table[k] = v;

  const fallback = polygonCentroids();
  let filled = 0;
  for (const [k, v] of Object.entries(fallback)) if (!table[k]) { table[k] = v; filled++; }
  console.log(`  centroids    : ${Object.keys(table).length} (${filled} from polygon fallback)`);
  for (const [k, [la, lo]] of Object.entries(table)) {
    if (Math.abs(la) > 90 || Math.abs(lo) > 180) throw new Error(`centroid out of range: ${k}`);
    if (la === 0 && lo === 0) throw new Error(`${k} centroid is Null Island — refusing`);
  }
  return table;
}

(async () => {
  process.stdout.write('fetching DB-IP country CSVs… ');
  const [c4, c6] = await Promise.all([get(`${BASE}/dbip-country-ipv4.csv`), get(`${BASE}/dbip-country-ipv6.csv`)]);
  console.log('ok');

  const r4 = parse(c4, v4ToInt);
  const r6 = parse(c6, v6ToBig);
  if (!r4.length || !r6.length) throw new Error('empty dataset — refusing to build');

  for (let i = 1; i < r4.length; i++) if (r4[i][0] < r4[i - 1][0]) throw new Error('ipv4 not sorted');
  for (let i = 1; i < r6.length; i++) if (r6[i][0] < r6[i - 1][0]) throw new Error('ipv6 not sorted');

  const g4 = withGaps(r4, 1);
  const g6 = withGaps(r6, 1n);

  const ccs = [...new Set([...r4, ...r6].map((r) => r[2]))].sort();
  const ccIdx = new Map(ccs.map((c, i) => [c, i]));

  const head = Buffer.alloc(8 + 4 + 4 + 2);
  head.write('LSGEO1\0\0', 0, 'ascii');
  head.writeUInt32LE(g4.length, 8);
  head.writeUInt32LE(g6.length, 12);
  head.writeUInt16LE(ccs.length, 16);

  const ccBuf = Buffer.alloc(ccs.length * 2);
  ccs.forEach((c, i) => ccBuf.write(c.padEnd(2).slice(0, 2), i * 2, 'ascii'));

  const b4 = Buffer.alloc(g4.length * 6);
  g4.forEach(([start, cc], i) => {
    b4.writeUInt32LE(start >>> 0, i * 6);
    b4.writeUInt16LE(cc === null ? UNKNOWN : ccIdx.get(cc), i * 6 + 4);
  });

  const b6 = Buffer.alloc(g6.length * 18);
  g6.forEach(([start, cc], i) => {
    b6.writeBigUInt64LE((start >> 64n) & 0xffffffffffffffffn, i * 18);
    b6.writeBigUInt64LE(start & 0xffffffffffffffffn, i * 18 + 8);
    b6.writeUInt16LE(cc === null ? UNKNOWN : ccIdx.get(cc), i * 18 + 16);
  });

  fs.writeFileSync(OUT, Buffer.concat([head, ccBuf, b4, b6]));

  const cen = await centroids();
  const placed = ccs.filter((c) => cen[c]).length;
  fs.writeFileSync(path.join(path.dirname(OUT), 'centroids.json'), JSON.stringify(cen));

  console.log(`  ipv4 records : ${g4.length.toLocaleString()} (incl. ${g4.length - r4.length} gap markers)`);
  console.log(`  ipv6 records : ${g6.length.toLocaleString()} (incl. ${g6.length - r6.length} gap markers)`);
  console.log(`  countries    : ${ccs.length}, of which ${placed} have a centroid`);
  console.log(`  geo.bin      : ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);
})().catch((e) => { console.error('build-geo FAILED:', e.message); process.exit(1); });
