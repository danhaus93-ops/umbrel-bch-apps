'use strict';
/*
 * SoloStrike Cash — dashboard API
 * Reads asicseer-pool (ckpool-lineage) stats from its logdir and queries the
 * backing BCHN node over JSON-RPC. Serves a single /api/status payload to the UI.
 * Degrades gracefully: if the pool hasn't started or the node is unreachable,
 * it returns whatever it can with poolUp/nodeUp flags so the UI stays honest.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

const POOL_LOGDIR  = process.env.POOL_LOGDIR  || '/pool/logs';
const STRATUM_HOST = process.env.STRATUM_HOST || 'umbrel.local';
const STRATUM_PORT = process.env.STRATUM_PORT || '3335';
const VERSION      = process.env.APP_VERSION  || 'v1.0.0';

const POOL_DIR  = path.dirname(POOL_LOGDIR);            // /pool
const ADDR_FILE = path.join(POOL_DIR, 'config', 'bch_address');

function readAddress() {
  try { return fs.readFileSync(ADDR_FILE, 'utf8').trim(); } catch (_) { return ''; }
}
function validAddress(a) {
  if (!a || typeof a !== 'string') return false;
  a = a.trim();
  if (a.length > 110) return false;
  if (/^(bitcoincash:|bchtest:|bchreg:)?[qp][0-9a-z]{38,}$/i.test(a)) return true; // cashaddr
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) return true;                    // legacy
  return false;
}
function writeAddress(a) {
  fs.mkdirSync(path.dirname(ADDR_FILE), { recursive: true });
  fs.writeFileSync(ADDR_FILE, a.trim());
}

const RPC_HOST = process.env.RPC_HOST || 'sslabs-bitcoin-cash-node_bitcoind_1';
const RPC_PORT = process.env.RPC_PORT || '8332';
const RPC_USER = process.env.RPC_USER || 'bchn';
const RPC_PASS = process.env.RPC_PASS || 'bchn_local_rpc_pw_2f9c';

// ---- helpers -------------------------------------------------------------
const SUFFIX = { E:1e18, P:1e15, T:1e12, G:1e9, M:1e6, K:1e3 };
const UNIT   = { E:'EH/s', P:'PH/s', T:'TH/s', G:'GH/s', M:'MH/s', K:'KH/s', '':'H/s' };

function hashToHs(str) {
  const m = String(str || '0').trim().match(/^([0-9.]+)\s*([KMGTPE]?)/i);
  if (!m) return 0;
  const mult = { '': 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 }[m[2].toUpperCase()] || 1;
  return parseFloat(m[1]) * mult;
}
// ckpool reports hashrate as strings like "92.4T". Split into display + numeric.
function parseHash(s) {
  if (s == null) return { val: '0', unit: 'H/s', n: 0 };
  const m = String(s).trim().match(/^([\d.]+)\s*([EPTGMK]?)/i);
  if (!m) return { val: '0', unit: 'H/s', n: 0 };
  const suf = (m[2] || '').toUpperCase();
  return { val: m[1], unit: UNIT[suf] || 'H/s', n: parseFloat(m[1]) * (SUFFIX[suf] || 1) };
}

// pool.status is several JSON objects, one per line — merge them all.
function readPoolStatus() {
  const f = path.join(POOL_LOGDIR, 'pool', 'pool.status');
  const raw = fs.readFileSync(f, 'utf8');
  const merged = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { Object.assign(merged, JSON.parse(t)); } catch (_) {}
  }
  return merged;
}

// per-user files live in logdir/users/<address>; each lists its workers.
// ---- per-worker reset masking (fallback when share logging is off) ----
const BASELINE_FILE = path.join(POOL_DIR, 'config', 'best_baselines.json');
function readBaselines() { try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) || {}; } catch (_) { return {}; } }
function writeBaselines(b) { try { fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true }); fs.writeFileSync(BASELINE_FILE, JSON.stringify(b)); } catch (_) {} }
// ---- SHARELOG_REBUILD: live per-worker best-since-reset from asicseer's -L sharelog ----
const LOGSHARES_FLAG = path.join(POOL_DIR, 'config', 'logshares');
const RESET_STATE_FILE = path.join(POOL_DIR, 'config', 'best_resets.json');
const shareBest = {};      // worker -> best sdiff since its reset (in-memory)
const SHAREBEST_FILE = path.join(POOL_DIR, 'config', 'best_values.json');
function writeShareBest() { try { fs.mkdirSync(path.dirname(SHAREBEST_FILE), { recursive: true }); fs.writeFileSync(SHAREBEST_FILE, JSON.stringify(shareBest)); } catch (_) {} }
try { Object.assign(shareBest, JSON.parse(fs.readFileSync(SHAREBEST_FILE, 'utf8')) || {}); } catch (_) {}
const fileSeen = {};       // sharelog path -> last size consumed (skip unchanged)
function logSharesOn() { try { return fs.existsSync(LOGSHARES_FLAG); } catch (_) { return false; } }
function setLogShares(on) { try { fs.mkdirSync(path.dirname(LOGSHARES_FLAG), { recursive: true }); if (on) fs.writeFileSync(LOGSHARES_FLAG, '1'); else fs.rmSync(LOGSHARES_FLAG, { force: true }); } catch (_) {} }
function readResetState() { try { return JSON.parse(fs.readFileSync(RESET_STATE_FILE, 'utf8')) || {}; } catch (_) { return {}; } }
function writeResetState(s) { try { fs.mkdirSync(path.dirname(RESET_STATE_FILE), { recursive: true }); fs.writeFileSync(RESET_STATE_FILE, JSON.stringify(s)); } catch (_) {} }
function shortName(wn) { wn = String(wn || ''); const p = wn.split('.'); return p.slice(1).join('.') || wn; }
function findSharelogs() {
  const out = []; const seen = new Set();
  const walk = (d, depth) => {
    if (depth > 4) return;
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp, depth + 1);
      else if (e.name.endsWith('.sharelog') && !seen.has(fp)) {
        seen.add(fp);
        let st; try { st = fs.statSync(fp); } catch (_) { continue; }
        out.push({ path: fp, mtime: Math.floor(st.mtimeMs / 1000), size: st.size });
      }
    }
  };
  walk(POOL_LOGDIR, 0);
  return out;
}
function shareTs(j) { return parseInt(String(j.createdate || '').split(',')[0], 10) || 0; }
function tailSharelogs() {
  if (!logSharesOn()) return;
  const rs = readResetState(); const keys = Object.keys(rs);
  if (!keys.length) return;
  const minReset = Math.min.apply(null, keys.map(k => Number(rs[k]) || Infinity));
  for (const f of findSharelogs()) {
    if (f.mtime < minReset - 5) continue;
    if (fileSeen[f.path] === f.size) continue;
    fileSeen[f.path] = f.size;
    let raw; try { raw = fs.readFileSync(f.path, 'utf8'); } catch (_) { continue; }
    for (const line of raw.split('\n')) {
      const t = line.trim(); if (!t) continue;
      let j; try { j = JSON.parse(t); } catch (_) { continue; }
      if (j.result !== true) continue;
      const sn = shortName(j.workername); const at = rs[sn]; if (at == null) continue;
      const ts = shareTs(j); if (ts && ts < at) continue;
      const sd = Number(j.sdiff) || 0; if (sd > (shareBest[sn] || 0)) { shareBest[sn] = sd; writeShareBest(); }
    }
  }
}
function pruneSharelogs() {
  if (!logSharesOn()) return;
  const rs = readResetState(); const keys = Object.keys(rs);
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 120;  // consumed files; running max is persisted in best_values.json
  for (const f of findSharelogs()) {
    if (f.mtime < cutoff) { try { fs.rmSync(f.path, { force: true }); delete fileSeen[f.path]; } catch (_) {} }
  }
}
function purgeAllSharelogs() { for (const f of findSharelogs()) { try { fs.rmSync(f.path, { force: true }); } catch (_) {} } for (const k of Object.keys(fileSeen)) delete fileSeen[k]; }
setInterval(tailSharelogs, 3000);
setInterval(pruneSharelogs, 120000);
function readWorkers() {
  const out = [];
  const dir = path.join(POOL_LOGDIR, 'users');
  let files = [];
  try { files = fs.readdirSync(dir); } catch (_) { return out; }
  for (const name of files) {
    let u;
    try { u = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (_) { continue; }
    const ws = Array.isArray(u.worker) ? u.worker : [];
    for (const w of ws) {
      const wn = (w.workername || name).split('.').slice(1).join('.') || (w.workername || name);
      out.push({
        name: wn,
        hashrate: (() => { const h = parseHash(w.hashrate5m || w.hashrate1m); return h.val + ' ' + h.unit; })(),
        trend: [w.hashrate1m, w.hashrate5m, w.hashrate1hr, w.hashrate1d, w.hashrate7d].map(hashToHs),
        idle: (Math.floor(Date.now() / 1000) - (Number(w.lastshare) || 0)) > 300,
        best: Number(w.bestshare) || 0,
        last: Number(w.lastshare) || 0,
      });
    }
  }
  out.sort((a, b) => b.best - a.best);
  // Inactive miners fall off the roster after ~1h of no shares. asicseer-pool keeps
  // a per-user file around indefinitely, so without this a powered-off ASIC lingers
  // forever. Override with WORKER_TTL_SEC if you want a different window.
  const WORKER_TTL = Number(process.env.WORKER_TTL_SEC || 3600);
  const nowS = Math.floor(Date.now() / 1000);
  let live = out.filter(w => (w.last || 0) > 0 && (nowS - w.last) <= WORKER_TTL);
  // hidden workers: stay hidden unless they show fresh activity
  let result = live;
  try {
    const hf = path.join(POOL_DIR, 'config', 'hidden.json');
    let hidden = {};
    try { hidden = JSON.parse(fs.readFileSync(hf, 'utf8')); } catch (_) {}
    let changed = false;
    const vis = live.filter(w => {
      const t = hidden[w.name];
      if (!t) return true;
      if ((w.last || 0) > t) { delete hidden[w.name]; changed = true; return true; }
      return false;
    });
    if (changed) { try { fs.writeFileSync(hf, JSON.stringify(hidden)); } catch (_) {} }
    result = vis;
  } catch (_) { result = live; }

  // Per-worker session uptime. asicseer-pool doesn't expose a connect time, so we
  // track first-seen ourselves: record when a worker shows up, and drop the record
  // when it falls off the roster — so a reconnect starts a fresh session.
  try {
    const sf = path.join(POOL_DIR, 'config', 'sessions.json');
    try { fs.mkdirSync(path.dirname(sf), { recursive: true }); } catch (_) {}
    let sessions = {};
    try { sessions = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch (_) {}
    const next = {};
    for (const w of result) {
      const started = sessions[w.name] || nowS;
      next[w.name] = started;
      w.uptime = nowS - started;        // seconds connected this session
    }
    try { fs.writeFileSync(sf, JSON.stringify(next)); } catch (_) {}
  } catch (_) {}
  const _bl = readBaselines();
  const _rs = readResetState();
  const _ls = logSharesOn();
  for (const w of result) {
    w.rawBest = w.best;
    if (_ls && _rs[w.name] != null) w.best = Number(shareBest[w.name]) || 0;
    else if (w.best <= (Number(_bl[w.name]) || 0)) w.best = 0;
  }
  result.sort((a, b) => b.best - a.best);
  return result;
}

// count solved blocks if asicseer-pool logged any (logdir/pool/blocks.log)
function countBlocks() {
  try {
    const f = path.join(POOL_LOGDIR, 'pool', 'blocks.log');
    return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).length;
  } catch (_) { return 0; }
}

// Pull the real block-solving share diff out of the asicseer-pool log, e.g.
//   "Solved block 954947 ..."  near  "... solve ... diff 1972695353385 !"
// Returns 0 if no readable log / no match (caller falls back to the block's net diff).
// asicseer writes a JSON file per solved block at logdir/pool/blocks/<height>.<state>
// with "solution_difficulty" = the winning share's diff. That's the real best diff
// submitted (asicseer's console log isn't written to a findable file, only stdout).
function solveDiffFromBlocks(height) {
  for (const ext of ['confirmed', 'unconfirmed', 'orphaned']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(POOL_LOGDIR, 'pool', 'blocks', height + '.' + ext), 'utf8'));
      const sd = Number(j.solution_difficulty);
      if (sd > 0) return Math.round(sd);
    } catch (_) {}
  }
  return 0;
}
function solveDiffFromLog(height) {
  const files = [
    path.join(POOL_LOGDIR, 'pool.log'),
    path.join(POOL_LOGDIR, 'pool', 'pool.log'),
    path.join(POOL_DIR, 'pool.log'),
  ];
  for (const f of files) {
    let lines;
    try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch (_) { continue; }
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('Solved block ' + height) === -1) continue;
      for (let j = Math.max(0, i - 5); j <= Math.min(lines.length - 1, i + 3); j++) {
        const m = lines[j].match(/diff\s+([0-9]+(?:\.[0-9]+)?)/i);
        if (m) return Math.round(parseFloat(m[1]));
      }
    }
  }
  return 0;
}

// minimal JSON-RPC call to BCHN
function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '1.0', id: 'ssc', method, params });
    const req = http.request({
      host: RPC_HOST, port: RPC_PORT, method: 'POST', path: '/',
      auth: `${RPC_USER}:${RPC_PASS}`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 4000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { const j = JSON.parse(d); j.error ? reject(j.error) : resolve(j.result); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('rpc timeout')));
    req.write(body); req.end();
  });
}


// ---- found-block scanner ---------------------------------------------------
// Engine-agnostic: watches the chain itself for blocks whose coinbase pays the
// configured payout address. Persists to /pool/config/blocks.json.
const BLOCKS_FILE = path.join(POOL_DIR, 'config', 'blocks.json');
let blockState = { lastScanned: 0, blocks: [] };
let lastAcceptedTotal = 0;
try { blockState = JSON.parse(fs.readFileSync(BLOCKS_FILE, 'utf8')); } catch (_) {}
let lastBestSeen = 0;

function saveBlocks() {
  try {
    fs.mkdirSync(path.dirname(BLOCKS_FILE), { recursive: true });
    fs.writeFileSync(BLOCKS_FILE, JSON.stringify(blockState));
  } catch (_) {}
}
function addrKey(a) { return String(a || '').toLowerCase().replace(/^(bitcoincash|bchtest|bchreg):/, ''); }

async function coinbasePaysUs(hash, mine) {
  const blk = await rpc('getblock', [hash, 1]);
  const cbTxid = blk.tx && blk.tx[0];
  if (!cbTxid) return null;
  const tx = await rpc('getrawtransaction', [cbTxid, true, hash]);
  for (const v of (tx.vout || [])) {
    const spk = v.scriptPubKey || {};
    const addrs = spk.addresses || (spk.address ? [spk.address] : []);
    if (addrs.some(a => addrKey(a) === mine)) return { time: blk.time, height: blk.height, netdiff: Number(blk.difficulty) || 0 };
  }
  return null;
}

let scanning = false;
async function scanBlocks() {
  if (scanning) return;
  scanning = true;
  try {
    const mine = addrKey(readAddress());
    if (!mine) return;
    const tip = await rpc('getblockcount', []);
    if (!blockState.lastScanned) blockState.lastScanned = Math.max(0, tip - 200); // first-run backfill
    let h = blockState.lastScanned + 1;
    let budget = 50;                                   // be gentle per pass
    while (h <= tip && budget-- > 0) {
      const hash = await rpc('getblockhash', [h]);
      const hit = await coinbasePaysUs(hash, mine);
      if (hit && !blockState.blocks.some(b => b.hash === hash)) {
        const solveDiff = solveDiffFromBlocks(h) || solveDiffFromLog(h);
        const bestAtHit = solveDiff || hit.netdiff || lastBestSeen;
        blockState.blocks.push({ height: h, hash, time: hit.time, best: bestAtHit, solveDiff: solveDiff || null, netdiff: hit.netdiff || null, healed: true });
        blockState.acceptedAtLastBlock = lastAcceptedTotal || 0;
        console.log(`[SoloStrike Cash] BLOCK FOUND at height ${h} (${hash})`);
      }
      blockState.lastScanned = h; h++;
    }
    // Heal older entries stamped with the rolling best (e.g. 148G) instead of the
    // real solving diff. Prefer the pool log; fall back to the block's net diff.
    for (const b of blockState.blocks) {
      if (b.solveDiff || b.recheck) continue;
      const sd = solveDiffFromBlocks(b.height) || solveDiffFromLog(b.height);
      let val = sd;
      if (!val && b.hash) {
        try { const blk = await rpc('getblock', [b.hash, 1]); val = Number(blk.difficulty) || 0; } catch (_) {}
      }
      if (val && val > (b.best || 0)) b.best = val;
      if (sd) b.solveDiff = sd;
      b.recheck = true;
    }
    saveBlocks();
  } catch (_) { /* node not ready — retry next pass */ }
  finally { scanning = false; }
}
setInterval(scanBlocks, 60 * 1000);
setTimeout(scanBlocks, 8 * 1000);
// ---- api -----------------------------------------------------------------
app.get('/api/status', async (_req, res) => {
  const out = {
    poolUp: false, nodeUp: false,
    hashrate: { val: '0', unit: 'H/s' }, workers: 0, users: 0,
    accepted: 0, rejected: 0, bestShare: 0, blocks: 0,
    netDiff: 0, height: 0, chain: 'main',
    stratum: `stratum+tcp://${STRATUM_HOST}:${STRATUM_PORT}`,
    workerList: [], version: VERSION, address: readAddress(),
    blockList: [...blockState.blocks].sort((a, b) => b.height - a.height).slice(0, 25),
    diff: (() => { try {
      const [mi, st, mx] = fs.readFileSync(path.join(POOL_DIR, 'config', 'diff'), 'utf8').trim().split(/\s+/).map(Number);
      return { min: mi || 1, start: st || 42, max: mx || 0 };
    } catch (_) { return { min: 1, start: 42, max: 0 }; } })(),
  };

  try {
    const p = readPoolStatus();
    out.poolUp   = true;
    out.users    = Number(p.Users) || 0;
    out.workers  = Number(p.Workers) || 0;
    out.accepted = Number(p.accepted) || 0;
    out.rejected = Number(p.rejected) || 0;
    out.bestShare = Number(p.bestshare) || 0;
    lastBestSeen = out.bestShare;
    const h = parseHash(p.hashrate5m || p.hashrate1m);
    out.hashrate = { val: h.val, unit: h.unit };
    lastAcceptedTotal = out.accepted;
    // asicseer-pool zeroes 'accepted' (accounted_diff_shares) on every block solve
    // via reset_bestshares(), so pool.status 'accepted' is already the current
    // round's share total. Subtracting a stale acceptedAtLastBlock baseline pinned
    // effort at 0% after a solve until 'accepted' re-climbed past it. Mirror the
    // pool's own effort calc (accounted_diff_shares / network_diff) and use it directly.
    out.roundShares = out.accepted;
    const hs = hashToHs(p.hashrate5m || p.hashrate1m);
    out.poolHs = hs;
    out.workerList = readWorkers();
    out.logShares = logSharesOn();
    out.blocks = Math.max(blockState.blocks.length, countBlocks());
  } catch (_) { /* pool not started yet */ }

  try {
    const info = await rpc('getblockchaininfo');
    out.nodeUp  = true;
    out.height  = info.blocks;
    out.chain   = info.chain;
    out.netDiff = Number(info.difficulty) || 0;
  } catch (_) { /* node unreachable */ }

  res.json(out);
});


// ---- surgical per-worker best reset (runs while entrypoint holds pool stopped) ----
function zeroBestIn(obj) {
  for (const k of Object.keys(obj)) {
    if (/^best/i.test(k) && (typeof obj[k] === 'number' || /^[0-9.eE+-]+$/.test(String(obj[k])))) obj[k] = 0;
  }
}
function surgicalReset(scope) {
  const usersDir = path.join(POOL_DIR, 'logs', 'users');
  let files = [];
  try { files = fs.readdirSync(usersDir); } catch (_) { return; }
  for (const fn of files) {
    const fp = path.join(usersDir, fn);
    try {
      const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
      let touched = false;
      const stack = [j];
      while (stack.length) {
        const o = stack.pop();
        if (Array.isArray(o)) { o.forEach(x => x && typeof x === 'object' && stack.push(x)); continue; }
        if (o && typeof o === 'object') {
          if (o.workername === scope) { zeroBestIn(o); touched = true; }
          else Object.values(o).forEach(v => v && typeof v === 'object' && stack.push(v));
        }
      }
      if (touched) {
        // user-level best = max of remaining workers
        const workers = Array.isArray(j.worker) ? j.worker : [];
        const maxBest = (key) => workers.reduce((m, w) => Math.max(m, Number(w[key]) || 0), 0);
        if ('bestshare' in j) j.bestshare = maxBest('bestshare');
        if ('bestever' in j) j.bestever = maxBest('bestever');
        fs.writeFileSync(fp, JSON.stringify(j));
        console.log(`[SoloStrike Cash] surgical best reset: ${scope} in ${fn}`);
      }
    } catch (_) { /* not JSON or unreadable — skip */ }
  }
}
setInterval(() => {
  try {
    const stopMark = path.join(POOL_DIR, 'config', 'pool_stopped');
    const doneMark = path.join(POOL_DIR, 'config', 'edit_done');
    if (!fs.existsSync(stopMark) || fs.existsSync(doneMark)) return;
    let scope = '';
    try { scope = fs.readFileSync(path.join(POOL_DIR, 'config', 'reset_request'), 'utf8').trim(); } catch (_) {}
    if (scope && scope !== 'all') surgicalReset(scope);
    fs.writeFileSync(doneMark, '1');
  } catch (_) {}
}, 1500);

app.post('/api/worker/hide', (req, res) => {
  const name = ((req.body && req.body.name) || '').toString().slice(0, 120);
  if (!name) return res.status(400).json({ ok: false });
  const hf = path.join(POOL_DIR, 'config', 'hidden.json');
  let hidden = {};
  try { hidden = JSON.parse(fs.readFileSync(hf, 'utf8')); } catch (_) {}
  hidden[name] = Math.floor(Date.now() / 1000);
  try {
    fs.mkdirSync(path.dirname(hf), { recursive: true });
    fs.writeFileSync(hf, JSON.stringify(hidden));
  } catch (e) { return res.status(500).json({ ok: false }); }
  res.json({ ok: true, name });
});

app.post('/api/diff', (req, res) => {
  const b = req.body || {};
  const min = Math.max(1, parseInt(b.min, 10) || 1);
  const start = Math.max(min, parseInt(b.start, 10) || 42);
  let max = parseInt(b.max, 10) || 0;
  if (max && max < start) max = 0;
  try {
    fs.mkdirSync(path.join(POOL_DIR, 'config'), { recursive: true });
    fs.writeFileSync(path.join(POOL_DIR, 'config', 'diff'), `${min} ${start} ${max}`);
  } catch (e) { return res.status(500).json({ ok: false }); }
  res.json({ ok: true, min, start, max });
});

app.post('/api/reset', (req, res) => {
  const scope = ((req.body && req.body.scope) || 'all').toString().slice(0, 120);
  if (!/^[A-Za-z0-9:._\-]+$|^all$/.test(scope)) return res.status(400).json({ ok: false, error: 'bad scope' });
  try {
    if (scope === 'all') {
      try { writeBaselines({}); } catch (_) {}
      try { writeResetState({}); } catch (_) {}
      for (const k of Object.keys(shareBest)) delete shareBest[k]; writeShareBest();
      fs.mkdirSync(path.join(POOL_DIR, 'config'), { recursive: true });
      fs.writeFileSync(path.join(POOL_DIR, 'config', 'reset_request'), scope);
    } else if (logSharesOn()) {
      const rs = readResetState(); rs[scope] = Math.floor(Date.now() / 1000); writeResetState(rs);
      shareBest[scope] = 0; writeShareBest();
    } else {
      const b = readBaselines();
      const w = readWorkers().find(x => x.name === scope);
      b[scope] = w ? (Number(w.rawBest) || 0) : (Number(b[scope]) || 0);
      writeBaselines(b);
    }
  } catch (e) { return res.status(500).json({ ok: false, error: 'could not reset' }); }
  res.json({ ok: true, scope });
});

app.post('/api/address', (req, res) => {
  const a = (req.body && req.body.address || '').trim();
  if (!validAddress(a)) return res.status(400).json({ ok: false, error: 'invalid BCH address' });
  try { writeAddress(a); } catch (e) { return res.status(500).json({ ok: false, error: 'could not save' }); }
  res.json({ ok: true, address: a });
});

app.get('/api/logshares', (_req, res) => res.json({ ok: true, on: logSharesOn() }));
app.post('/api/logshares', (req, res) => {
  const on = !!(req.body && req.body.on);
  setLogShares(on);
  if (!on) { try { writeResetState({}); } catch (_) {} for (const k of Object.keys(shareBest)) delete shareBest[k]; writeShareBest(); try { purgeAllSharelogs(); } catch (_) {} }
  res.json({ ok: true, on });
});
const ELEC_FILE = path.join(POOL_DIR, 'config', 'electricity.json');
function readElectricity() { try { return JSON.parse(fs.readFileSync(ELEC_FILE, 'utf8')) || {}; } catch (_) { return {}; } }
function writeElectricity(e) { try { fs.mkdirSync(path.dirname(ELEC_FILE), { recursive: true }); fs.writeFileSync(ELEC_FILE, JSON.stringify(e)); } catch (_) {} }
app.get('/api/electricity', (_req, res) => res.json({ ok: true, ...readElectricity() }));
app.post('/api/electricity', (req, res) => {
  const e = readElectricity(); const b = req.body || {};
  if (b.rate  != null) e.rate  = Math.max(0, Number(b.rate)  || 0);
  if (b.watts != null) e.watts = Math.max(0, Number(b.watts) || 0);
  writeElectricity(e); res.json({ ok: true, ...e });
});
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`SoloStrike Cash dashboard on :${PORT}`));
