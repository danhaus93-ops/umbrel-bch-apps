'use strict';
/*
 * LoneStrike Cash — dashboard API
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

const SV2_DIR       = process.env.SV2_DIR || '/sv2';
const SV2_ADDR_FILE = path.join(SV2_DIR, 'payout_address');
const SV2_PUB_FILE  = path.join(SV2_DIR, 'keys', 'authority.pub');
const SV2_LOG_FILE  = path.join(SV2_DIR, 'pool_sv2.log');
const SV2_BLOCKS_FILE = path.join(SV2_DIR, 'sv2_blocks.jsonl');
const SV2_RESETS_FILE = path.join(SV2_DIR, 'sv2_resets.json');
const SV2_SPM_FILE    = path.join(SV2_DIR, 'shares_per_minute');
const SV2_MON_URL = process.env.SV2_MON_URL || 'http://sslabs-solostrike-cash_sv2-pool_1:9090';
// SRI monitoring API poller: authoritative names/counts/rejects/best/declared.
// The log-parsed estimator stays authoritative for delivered hashrate + trend
// (the API cannot rate floor channels that declare nominal_hash_rate 0).
const sv2Api = { at: 0, channels: {} };
async function sv2ApiPoll() {
  if (Date.now() - sv2Api.at < 5000) return;
  sv2Api.at = Date.now();
  try {
    let items = [];
    for (let off = 0; off < 1000; off += 100) {
      const pg = await (await fetch(SV2_MON_URL + '/api/v1/clients?limit=100&offset=' + off, { signal: AbortSignal.timeout(1500) })).json();
      items = items.concat(pg.items || []);
      if (!pg.items || pg.items.length < 100) break;
    }
    const cl = { items };
    const next = {};
    for (const c of (cl.items || [])) {
      try {
        const ch = await (await fetch(SV2_MON_URL + '/api/v1/clients/' + c.client_id + '/channels?limit=50', { signal: AbortSignal.timeout(1500) })).json();
        for (const e of (ch.extended_channels || []).concat(ch.standard_channels || [])) {
          next[c.client_id + ':' + e.channel_id] = {
            identity: e.user_identity || '', nominal: Number(e.nominal_hashrate) || 0,
            accepted: Number(e.shares_accepted) || 0, rejected: Number(e.shares_rejected) || 0,
            reasons: e.shares_rejected_by_reason || {},
            best: Number(e.best_diff) || 0, blocks: Number(e.blocks_found) || 0,
            targetHex: e.target_hex || '', spm: Number(e.expected_shares_per_minute) || 0,
          };
        }
      } catch (_) {}
    }
    if (Object.keys(next).length) sv2Api.channels = next;
  } catch (_) { /* API unavailable: log-parsed telemetry carries on alone */ }
}
setInterval(() => { sv2ApiPoll().catch(() => {}); }, 10000);
const SV2_BEST_FILE   = path.join(SV2_DIR, 'sv2_best.json');
let sv2Resets = {};  // worker name (or __all__) -> reset ts (sec)
let sv2BestP  = {};  // worker name -> { best, ts }  (persisted across restarts)
try { sv2Resets = JSON.parse(fs.readFileSync(SV2_RESETS_FILE, 'utf8')) || {}; } catch (_) {}
try { sv2BestP  = JSON.parse(fs.readFileSync(SV2_BEST_FILE,   'utf8')) || {}; } catch (_) {}
function sv2SaveResets() { try { fs.writeFileSync(SV2_RESETS_FILE, JSON.stringify(sv2Resets)); } catch (_) {} }
function sv2SaveBest()   { try { fs.writeFileSync(SV2_BEST_FILE,   JSON.stringify(sv2BestP));  } catch (_) {} }
function sv2ResetTs(name) { return Math.max(Number(sv2Resets[name]) || 0, Number(sv2Resets.__all__) || 0); }
function sv2ApplyReset(scope) {
  const now = Math.floor(Date.now() / 1000);
  if (scope === 'all') { sv2Resets.__all__ = now; } else { sv2Resets[scope] = now; }
  for (const ch of Object.values(sv2State.channels)) {
    if (scope === 'all' || ch.name === scope) ch.best = 0;
  }
  for (const n of Object.keys(sv2BestP)) {
    if (scope === 'all' || n === scope) delete sv2BestP[n];
  }
  sv2SaveResets(); sv2SaveBest();
}
function readSv2Address() {
  try { return fs.readFileSync(SV2_ADDR_FILE, 'utf8').trim(); } catch (_) { return ''; }
}

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

function fmtHs(hs) {
  hs = Number(hs) || 0;
  const steps = [[1e18,'EH/s'],[1e15,'PH/s'],[1e12,'TH/s'],[1e9,'GH/s'],[1e6,'MH/s'],[1e3,'KH/s']];
  for (const [m, u] of steps) if (hs >= m) return { val: (hs / m).toFixed(2), unit: u, n: hs };
  return { val: hs.toFixed(0), unit: 'H/s', n: hs };
}

// ---- SV2 telemetry: parse pool_sv2's own log from the shared volume -------
// Every accepted share logs share_hash (-> difficulty) and share_work
// (difficulty units credited). Hashrate = sum(share_work in window) * 2^32 / secs.
const SV2_D1 = 0xffffn << 208n;                    // difficulty-1 target
const sv2State = {
  offset: 0, pendingId: '', pendingAge: 99, roundWork: 0, lastBlockCount: -1,
  roundDiff: 0, allDiff: 0,          // difficulty-weighted share accounting
  channels: {},                                    // cid -> stats
  shares: [],                                      // [ts_ms, work, cid] rolling window
};
const SV2_RE_SHARE = /valid share \| downstream_id: (\d+), channel_id: (\d+), sequence_number: (\d+), share_hash: ([0-9a-fA-F]{64}), share_work: ([0-9.eE+-]+)/;
const SV2_RE_TS    = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/;
const SV2_RE_IDENT = /Open(?:Standard|Extended)MiningChannel\b[^\n]*?user_identity[^"\x27]*["\x27]?([^"\x27,\s)]+)/;
const SV2_RE_OPENOK = /Open(?:Standard|Extended)MiningChannelSuccess[^\n]*?channel_id[=:\s]+(\d+)/;
const SV2_RE_BAD   = /(?:invalid share|SubmitSharesError)[^\n]*?channel_id[=:\s]+(\d+)/;

function sv2Chan(cid) {
  return sv2State.channels[cid] || (sv2State.channels[cid] = {
    name: 'sv2-' + String(cid).replace(':', '.'), accepted: 0, rejected: 0, best: 0,
    maxSeq: -1, last: 0, firstSeen: Math.floor(Date.now() / 1000),
  });
}
function sv2Ingest() {
  let st; try { st = fs.statSync(SV2_LOG_FILE); } catch (_) { return; }
  // Rotate in place BEFORE the pool container's own 16MB rotator would fire:
  // writeFileSync truncates the SAME inode, so the pool's tee (O_APPEND)
  // keeps writing. A rename-based rotate detaches the writer into an
  // unlinked inode and blinds telemetry (learned the hard way).
  if (st.size > 12 * 1024 * 1024) {
    try {
      const keep = 6 * 1024 * 1024;
      const fd = fs.openSync(SV2_LOG_FILE, 'r');
      const buf = Buffer.alloc(keep);
      fs.readSync(fd, buf, 0, keep, st.size - keep);
      fs.closeSync(fd);
      const nl = buf.indexOf(10) + 1;                 // start at a line boundary
      fs.writeFileSync(SV2_LOG_FILE, buf.slice(nl));  // truncate same inode
      st = fs.statSync(SV2_LOG_FILE);
      sv2State.offset = 0;                            // rescan; seq dedupe absorbs
    } catch (_) {}
  }
  if (st.size < sv2State.offset) sv2State.offset = 0;          // rotated
  if (st.size === sv2State.offset) return;
  let start = sv2State.offset;
  if (st.size - start > 4 * 1024 * 1024) start = st.size - 4 * 1024 * 1024;
  let fd, chunk;
  try {
    fd = fs.openSync(SV2_LOG_FILE, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    chunk = buf.toString('utf8');
  } catch (_) { return; } finally { try { if (fd !== undefined) fs.closeSync(fd); } catch (_) {} }
  sv2State.offset = st.size;
  const nowS = Math.floor(Date.now() / 1000);
  for (const line of chunk.split('\n')) {
    if (/Open(?:Standard|Extended)MiningChannel\b/.test(line) && line.includes('user_identity')) {
      let ident = '';
      const plain = line.match(/user_identity[=:\s]+([^\s,"\x27)]+)/);
      if (plain) ident = plain[1];
      const q = !ident && line.match(/user_identity[^"\x27]*["\x27]([^"\x27]+)["\x27]/);
      if (q) ident = q[1];
      if (!ident) {
        const ba = line.match(/user_identity[^\[]*\[([0-9,\s]+)\]/);
        if (ba) {
          try {
            ident = String.fromCharCode(...ba[1].split(',').map(x => parseInt(x, 10)));
          } catch (_) { ident = ''; }
        }
      }
      if (!ident) { const pm = line.match(SV2_RE_IDENT); if (pm) ident = pm[1]; }
      ident = String(ident || '').trim().slice(0, 64);
      // accept only plausible worker/address names; junk keeps the sv2-chN default
      sv2State.pendingAge = 0;
      if (/^[A-Za-z0-9:._\-]{4,64}$/.test(ident)) {
        // pool convention: payout-address.workername -> show the worker part
        const dot = ident.lastIndexOf('.');
        sv2State.pendingId = (dot > 0 && dot < ident.length - 1) ? ident.slice(dot + 1) : ident;
      }
    }
    const okm = line.match(/downstream_id[=:\s]+(\d+)[^\n]*?Open(?:Standard|Extended)MiningChannelSuccess[^\n]*?channel_id[=:\s]+(\d+)/) ||
                line.match(SV2_RE_OPENOK);
    if (okm && sv2State.pendingId && sv2State.pendingAge <= 3) {
      const key = okm[2] !== undefined ? okm[1] + ':' + okm[2] : okm[1];
      sv2Chan(key).name = sv2State.pendingId; sv2State.pendingId = '';
    }
    sv2State.pendingAge++;
    if (/invalid share|SubmitSharesError/.test(line)) {
      const dm = line.match(/downstream_id[=:\s]+(\d+)/);
      const cm = line.match(/channel_id[=:\s]+(\d+)/);
      if (dm && cm) {
        const ch2 = sv2Chan(dm[1] + ':' + cm[1]);
        ch2.rejected++;
        const rm = line.match(/error_code[=:\s]+([a-zA-Z-]+)/);
        ch2.lastReject = (rm ? rm[1] : 'invalid') + ' @ ' + line.slice(0, 19);
      }
    }
    const m = line.match(SV2_RE_SHARE);
    if (!m) continue;
    const cid = m[1] + ':' + m[2], seq = Number(m[3]);
    const ch = sv2Chan(cid);
    if (seq <= ch.maxSeq) continue;                            // replay dedupe
    ch.maxSeq = seq;
    const work = parseFloat(m[5]) || 0;
    let diff = 0;
    try { diff = Number(SV2_D1 * 1000000n / BigInt('0x' + m[4])) / 1e6; } catch (_) {}
    const tm = line.match(SV2_RE_TS);
    const tsMs = tm ? Date.parse(tm[1]) : Date.now();
    ch.accepted++;
    if (tsMs / 1000 > sv2ResetTs(ch.name) && diff > ch.best) {
      ch.best = diff;
      const p = sv2BestP[ch.name];
      if (!p || diff > p.best) { sv2BestP[ch.name] = { best: diff, ts: Math.floor(tsMs / 1000) }; sv2SaveBest(); }
    }
    ch.last = Math.max(ch.last, Math.floor(tsMs / 1000));
    sv2State.roundWork += work;
    sv2State.shares.push([tsMs, work, cid, diff, seq]);
  }
  const cut = Date.now() - 600 * 1000;
  while (sv2State.shares.length && sv2State.shares[0][0] < cut) sv2State.shares.shift();
  void nowS;
}
setInterval(() => { try { sv2Ingest(); } catch (_) {} }, 10000);

function sv2Blocks() {
  let raw; try { raw = fs.readFileSync(SV2_BLOCKS_FILE, 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try { const j = JSON.parse(l); if (j && j.height) out.push(j); } catch (_) {}
  }
  return out;
}
function sv2Stats() {
  sv2Ingest();
  const nowS = Math.floor(Date.now() / 1000);
  const winMs = 300 * 1000, cutoff = Date.now() - winMs;
  const TTL = Number(process.env.WORKER_TTL_SEC || 3600);
  const perChan = {};
  for (const [ts, w, cid, diff, seq] of sv2State.shares) {
    if (ts < cutoff) continue;
    const pc = perChan[cid] || (perChan[cid] = {
      work: 0, n: 0, diffs: [], minSeq: Infinity, maxSeq: -1, firstTs: ts, lastTs: ts,
    });
    pc.work += w; pc.n++;
    if (diff > 0) pc.diffs.push(diff);
    if (seq >= 0) {
      if (seq < pc.minSeq) pc.minSeq = seq;
      if (seq > pc.maxSeq) pc.maxSeq = seq;
    }
    if (ts < pc.firstTs) pc.firstTs = ts;
    if (ts > pc.lastTs) pc.lastTs = ts;
  }
  const chanBuckets = (cid) => {
    // five 1-minute buckets ending now; per-bucket median handles the
    // submitter's threshold shifting mid-window (mixed populations would
    // bias a single global median)
    const nowMs = Date.now();
    const B = 5, W = 60 * 1000;
    const bk = Array.from({ length: B }, () => ({ n: 0, work: 0, diffs: [], minSeq: Infinity, maxSeq: -1 }));
    for (const [ts, w, c, diff, seq] of sv2State.shares) {
      if (c !== cid) continue;
      const idx = Math.floor((nowMs - ts) / W);
      if (idx < 0 || idx >= B) continue;
      const b = bk[B - 1 - idx];
      b.n++; b.work += w;
      if (diff > 0) b.diffs.push(diff);
      if (seq >= 0) { if (seq < b.minSeq) b.minSeq = seq; if (seq > b.maxSeq) b.maxSeq = seq; }
    }
    return bk.map((b) => {
      if (b.work / b.n >= 1) {
        // vardiff-credited: exact at any sample size (a single diff-500K
        // share is known work) - rental fleets fan out across many
        // sparse channels and zeroing them hid hundreds of TH
        const nS = (b.maxSeq >= b.minSeq) ? (b.maxSeq - b.minSeq + 1) : b.n;
        const nA = Math.max(b.n, Math.min(nS, Math.ceil(b.n * 1.25)));
        return b.work * (nA / b.n) * 4294967296 / 60;
      }
      if (b.n < 5) return 0;   // sparse guard: statistical path only
      const nSeq = (b.maxSeq >= b.minSeq) ? (b.maxSeq - b.minSeq + 1) : b.n;
      const n = Math.max(b.n, Math.min(nSeq, Math.ceil(b.n * 1.25)));
      // every 10th share is batch-acked without a valid-share line: the
      // sequence span recovers its COUNT, this ratio recovers its CREDIT
      const workAdj = b.work * (n / b.n);
      const workHs = workAdj * 4294967296 / 60;
      if (b.work / b.n >= 1) return workHs;   // vardiff live: credited work is authoritative
      let hashHs = 0;
      if (b.diffs.length >= 8) {
        // floor-target rescue only: hashes are uniform below the
        // submitter's own threshold. Estimate it from the 85th-percentile
        // hash: junk-immune like a median, half the variance.
        const d = b.diffs.sort((a, b2) => a - b2);
        const tDiff = d[Math.floor(d.length * 0.15)] * 0.85;
        hashHs = n * tDiff * 4294967296 / 60;
      }
      return Math.max(workHs, hashHs);
    });
  };
  const chanHs = (buckets) => {
    const completed = buckets.slice(0, -1).filter((v) => v > 0);
    if (completed.length) return completed.reduce((a, v) => a + v, 0) / completed.length;
    const live = buckets.filter((v) => v > 0);           // warmup: newest is all we have
    if (!live.length) return 0;
    return live.reduce((a, v) => a + v, 0) / live.length;
  };
  let hidden = {};
  try { hidden = JSON.parse(fs.readFileSync(path.join(POOL_DIR, 'config', 'hidden.json'), 'utf8')) || {}; } catch (_) {}
  const winDiffs = {};
  for (const [ts, w, c, diff] of sv2State.shares) {
    if (ts < cutoff || !(diff > 0)) continue;
    (winDiffs[c] || (winDiffs[c] = [])).push(diff);
  }
  const workerList = [];
  let best = 0, accepted = 0, rejected = 0, totHs = 0;
  for (const [cid, ch] of Object.entries(sv2State.channels)) {
    const pBest = (sv2BestP[ch.name] && sv2BestP[ch.name].ts > sv2ResetTs(ch.name)) ? sv2BestP[ch.name].best : 0;
    if (pBest > ch.best) ch.best = pBest;
    best = Math.max(best, ch.best);
    // rental/proxy churn: a connection that died before ever earning a
    // real name (API identity) is disposable - retire it in 5 minutes.
    // Named miners keep the full TTL so a real rig going offline stays
    // visible for an hour.
    const isFallbackName = /^sv2-\d+\.\d+$/.test(ch.name);
    const ttlEff = isFallbackName ? Math.min(TTL, 300) : TTL;
    if (!ch.last || nowS - ch.last > ttlEff) continue;
    const ht = Number(hidden[ch.name]) || 0;
    if (ht && ch.last <= ht) continue;
    // a reconnected miner opens a new channel: retire the stale twin
    let fresher = false;
    for (const [ocid, och] of Object.entries(sv2State.channels)) {
      if (ocid !== cid && och.name === ch.name && (och.last > ch.last ||
          (och.last === ch.last && och.firstSeen > ch.firstSeen))) { fresher = true; break; }
    }
    if (fresher) continue;
    accepted += ch.accepted; rejected += ch.rejected;
    const buckets = chanBuckets(cid);
    const api = sv2Api.channels[cid];
    if (api) {
      if (api.identity) {
        const dot = api.identity.lastIndexOf('.');
        ch.name = (dot > 0 && dot < api.identity.length - 1) ? api.identity.slice(dot + 1) : api.identity;
      }
      if (api.accepted > ch.accepted) ch.accepted = api.accepted;
      if (api.rejected > ch.rejected) ch.rejected = api.rejected;
      if (api.best > ch.best && api.best > sv2ResetTs(ch.name) * 0) {
        if (ch.last * 1000 > sv2ResetTs(ch.name) * 1000) ch.best = Math.max(ch.best, api.best);
      }
    }
    const cHs = chanHs(buckets);
    totHs += cHs;
    // credit newly seen shares at estimated target diff (SV1 semantics)
    const wd = winDiffs[cid];
    if (wd && wd.length >= 8) {
      const sorted = wd.slice().sort((a, b) => a - b);
      const tDiff = sorted[Math.floor(sorted.length * 0.15)] * 0.85;
      const delta = ch.accepted - (ch.accounted || 0);
      if (delta > 0 && tDiff > 0) {
        ch.accounted = ch.accepted;
        sv2State.roundDiff += delta * tDiff;
        sv2State.allDiff += delta * tDiff;
      }
    }
    const hr = fmtHs(cHs);
    workerList.push({
      name: ch.name, proto: 'SV2',
      declared: api ? api.nominal : null,
      rejected: ch.rejected,
      rejectReasons: api ? api.reasons : null,
      hashrate: hr.val + ' ' + hr.unit,
      trend: buckets,
      idle: nowS - ch.last > 300,
      best: ch.best, last: ch.last,
      uptime: nowS - ch.firstSeen,
    });
  }
  return {
    enabled: !!readSv2Address(), workers: workerList.length,
    hs: totHs, accepted, rejected, best,
    roundWork: sv2State.roundWork, workerList,
  };
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
  let dirty = false;
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
      const sd = Number(j.sdiff) || 0; if (sd > (shareBest[sn] || 0)) { shareBest[sn] = sd; dirty = true; }
    }
  }
  if (dirty) writeShareBest();
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
    const nextStr = JSON.stringify(next);
    try { if (nextStr !== JSON.stringify(sessions)) fs.writeFileSync(sf, nextStr); } catch (_) {}
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


// ---- winning-worker lookup (best-effort) -----------------------------------
function solveWorkerFromBlocks(height) {
  for (const ext of ['confirmed', 'unconfirmed', 'orphaned']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(POOL_LOGDIR, 'pool', 'blocks', height + '.' + ext), 'utf8'));
      const w = j.solvedby || j.workername || j.worker || j.username;
      if (w) return shortName(String(w));
    } catch (_) {}
  }
  return null;
}
function solveWorkerFromLog(height) {
  const files = [path.join(POOL_LOGDIR, 'pool.log'), path.join(POOL_LOGDIR, 'pool', 'pool.log'), path.join(POOL_DIR, 'pool.log')];
  const re = new RegExp('Solved block ' + height + ' by (\\S+)');
  for (const f of files) {
    let lines; try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch (_) { continue; }
    for (let i = lines.length - 1; i >= 0; i--) { const m = lines[i].match(re); if (m) return shortName(m[1]); }
  }
  return null;
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
// Surface blocks straight from asicseer's own solve files
// (logdir/pool/blocks/<height>.<state>). These are written ONLY when THIS pool
// solves a block, so they are authoritative even when the block paid an address
// other than the one currently configured (a different HD address, or a miner's
// username such as NiceHash). Without this, such a block is invisible because the
// chain scanner only matches the configured payout address.
function healFromBlockFiles() {
  const dir = path.join(POOL_LOGDIR, 'pool', 'blocks');
  let files = [];
  try { files = fs.readdirSync(dir); } catch (_) { return; }
  for (const f of files) {
    const m = f.match(/^(\d+)\.(confirmed|unconfirmed|orphaned)$/);
    if (!m) continue;
    const h = Number(m[1]);
    if (!Number.isFinite(h)) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    const sd = Number(j.solution_difficulty) || null;
    const worker = j.solvedby ? shortName(String(j.solvedby)) : null;
    const existing = blockState.blocks.find((b) => b.height === h);
    if (existing) {
      if (!existing.worker && worker) existing.worker = worker;
      if (!existing.solveDiff && sd) existing.solveDiff = sd;
      if (sd && sd > (existing.best || 0)) existing.best = sd;
      if (!existing.hash && j.hash) existing.hash = j.hash;
      existing.state = m[2];
      continue;
    }
    blockState.blocks.push({
      height: h,
      hash: j.hash || null,
      time: Number(j.time) || Math.floor(Date.now() / 1000),
      best: sd || 0,
      solveDiff: sd,
      netdiff: Number(j.network_difficulty) || null,
      worker,
      state: m[2],
      healed: true,
    });
    console.log(`[LoneStrike Cash] BLOCK from pool file: height ${h} (${m[2]})${worker ? ' by ' + worker : ''}`);
  }
}

async function scanBlocks() {
  if (scanning) return;
  scanning = true;
  try {
    const mine = addrKey(readAddress());
    const sv2Mine = addrKey(readSv2Address());
    if (!mine && !sv2Mine) return;
    const tip = await rpc('getblockcount', []);
    if (!blockState.lastScanned) blockState.lastScanned = Math.max(0, tip - 200); // first-run backfill
    let h = blockState.lastScanned + 1;
    let budget = 50;                                   // be gentle per pass
    while (h <= tip && budget-- > 0) {
      const hash = await rpc('getblockhash', [h]);
      const hit = (mine && await coinbasePaysUs(hash, mine)) ||
                  (sv2Mine && sv2Mine !== mine && await coinbasePaysUs(hash, sv2Mine));
      if (hit && !blockState.blocks.some(b => b.hash === hash)) {
        const solveDiff = solveDiffFromBlocks(h) || solveDiffFromLog(h);
        const bestAtHit = solveDiff || hit.netdiff || lastBestSeen;
        blockState.blocks.push({ height: h, hash, time: hit.time, best: bestAtHit, solveDiff: solveDiff || null, netdiff: hit.netdiff || null, worker: solveWorkerFromBlocks(h) || solveWorkerFromLog(h) || null, healed: true });
        blockState.acceptedAtLastBlock = lastAcceptedTotal || 0;
        console.log(`[LoneStrike Cash] BLOCK FOUND at height ${h} (${hash})`);
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
    for (const b of blockState.blocks) {
      if (b.worker) continue;
      const w = solveWorkerFromBlocks(b.height) || solveWorkerFromLog(b.height);
      if (w) b.worker = w;
    }
    healFromBlockFiles();
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
    blockList: [...blockState.blocks].sort((a, b) => b.height - a.height).slice(0, 200),
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
    const s2 = sv2Stats();
    const s2blocks = sv2Blocks();
    for (const rec of s2blocks) {
      const b = blockState.blocks.find((x) => x.height === rec.height || (rec.hash && x.hash === rec.hash));
      if (b && !b.worker) b.worker = 'SV2';
    }
    out.sv2 = {
      enabled: s2.enabled, workers: s2.workers,
      hashrate: (() => { const h = fmtHs(s2.hs); return h.val + ' ' + h.unit; })(),
      accepted: s2.accepted, rejected: s2.rejected, best: s2.best,
    };
    if (s2.enabled || s2.workers) {
      out.poolUp = out.poolUp || s2.workers > 0;
      out.workers += s2.workers;
      if (s2.workers) out.users += 1;
      out.accepted += Math.round(sv2State.allDiff); out.rejected += s2.rejected;
      out.bestShare = Math.max(out.bestShare, s2.best);
      out.poolHs = (out.poolHs || 0) + s2.hs;
      const th = fmtHs(out.poolHs);
      out.hashrate = { val: th.val, unit: th.unit };
      if (out.blockList.length !== sv2State.lastBlockCount) {
        if (sv2State.lastBlockCount >= 0) { sv2State.roundWork = 0; sv2State.roundDiff = 0; }
        sv2State.lastBlockCount = out.blockList.length;
      }
      out.roundShares = (out.roundShares || 0) + Math.max(sv2State.roundWork, sv2State.roundDiff);
      // aggregate: rental/proxy fleets fan one identity across many channels;
    // collapse same-name SV2 rows into a single row (sum hs+shares, max best,
    // freshest last, count connections) so 132 Braiins channels read as one
    const merged = {};
    const passthrough = [];
    for (const w of s2.workerList) {
      if (w.proto !== 'SV2') { passthrough.push(w); continue; }
      const k = w.name;
      if (!merged[k]) { merged[k] = Object.assign({}, w, { conns: 1, _hs: hashToHs(w.hashrate) || 0 }); }
      else {
        const m = merged[k];
        m.conns++;
        m._hs += hashToHs(w.hashrate) || 0;
        m.best = Math.max(m.best || 0, w.best || 0);
        m.last = Math.max(m.last || 0, w.last || 0);
        m.rejected = (m.rejected || 0) + (w.rejected || 0);
        m.uptime = Math.max(m.uptime || 0, w.uptime || 0);
        m.idle = m.idle && w.idle;
        if (w.declared === 0) m.declared = 0;
      }
    }
    const aggregated = Object.values(merged).map((m) => {
      if (m.conns > 1) { const h = fmtHs(m._hs); m.hashrate = h.val + ' ' + h.unit; m.trend = [m._hs,m._hs,m._hs,m._hs,m._hs]; }
      return m;
    });
    out.workerList = out.workerList.concat(passthrough, aggregated).sort((a, b) => (b.best || 0) - (a.best || 0));
    }
  } catch (_) { /* sv2 telemetry unavailable */ }

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
        console.log(`[LoneStrike Cash] surgical best reset: ${scope} in ${fn}`);
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
    const sv2Names = new Set(Object.values(sv2State.channels).map((c) => c.name));
    if (scope === 'all' || sv2Names.has(scope)) sv2ApplyReset(scope);
    if (sv2Names.has(scope) && scope !== 'all') return res.json({ ok: true, scope, sv2: true });
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
app.get('/api/sv2', (req, res) => {
  let pub = '';  try { pub  = fs.readFileSync(SV2_PUB_FILE,  'utf8').trim(); } catch (_) {}
  let addr = ''; try { addr = fs.readFileSync(SV2_ADDR_FILE, 'utf8').trim(); } catch (_) {}
  let savedSpm = 6;
  try { const v = parseFloat(fs.readFileSync(SV2_SPM_FILE, 'utf8')); if (v > 0) savedSpm = v; } catch (_) {}
  let activeSpm = 0;
  for (const c of Object.values(sv2Api.channels)) { if (c.spm > 0) { activeSpm = c.spm; break; } }
  const out = { ok: true, enabled: !!addr, address: addr, authorityPub: pub,
                savedSpm, activeSpm,
                endpoint: STRATUM_HOST + ':33333' };
  if (req.query && req.query.debug) {
    try {
      sv2Ingest();
      out.debug = {};
      const nowMs = Date.now(), B = 5, W = 60 * 1000;
      for (const [cid, ch] of Object.entries(sv2State.channels)) {
        const bk = Array.from({ length: B }, () => ({ n: 0, work: 0, minSeq: Infinity, maxSeq: -1, diffs: [] }));
        for (const [ts, w, c, diff, seq] of sv2State.shares) {
          if (c !== cid) continue;
          const idx = Math.floor((nowMs - ts) / W);
          if (idx < 0 || idx >= B) continue;
          const b = bk[B - 1 - idx];
          b.n++; b.work += w;
          if (diff > 0) b.diffs.push(diff);
          if (seq >= 0) { if (seq < b.minSeq) b.minSeq = seq; if (seq > b.maxSeq) b.maxSeq = seq; }
        }
        out.debug[cid] = { name: ch.name, rejected: ch.rejected, lastReject: ch.lastReject || null, buckets: bk.map((b) => {
          const d = b.diffs.slice().sort((x, y) => x - y);
          return { n: b.n, span: b.maxSeq >= b.minSeq ? b.maxSeq - b.minSeq + 1 : 0,
                   workPerShare: b.n ? +(b.work / b.n).toExponential(2) : 0,
                   tDiffQ: d.length >= 8 ? Math.round(d[Math.floor(d.length * 0.15)] * 0.85) : 0 };
        }) };
      }
    } catch (e) { out.debugError = String(e); }
  }
  res.json(out);
});
app.post('/api/sv2', (req, res) => {
  const a = (req.body && req.body.address || '').trim();
  if (a === '') {
    try { fs.unlinkSync(SV2_ADDR_FILE); } catch (_) {}
    return res.json({ ok: true, enabled: false, address: '' });
  }
  if (!validAddress(a)) return res.status(400).json({ ok: false, error: 'invalid BCH address' });
  try { fs.mkdirSync(SV2_DIR, { recursive: true }); fs.writeFileSync(SV2_ADDR_FILE, a); }
  catch (e) { return res.status(500).json({ ok: false, error: 'could not save' }); }
  const spm = Number(req.body && req.body.sharesPerMinute);
  if (spm && spm >= 0.5 && spm <= 600) {
    try { fs.writeFileSync(SV2_SPM_FILE, String(spm)); } catch (_) {}
  }
  res.json({ ok: true, enabled: true, address: a });
});

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Umbrel home-screen widget: glanceable solo-mining stats (fetched by umbreld)
app.get('/api/widget/stats', (_req, res) => {
  const fmtDiff = (n) => {
    n = Number(n) || 0;
    const u = [[1e18,'E'],[1e15,'P'],[1e12,'T'],[1e9,'G'],[1e6,'M'],[1e3,'K']];
    for (const [v,sfx] of u) if (n >= v) return (n/v).toFixed((n/v) >= 100 ? 0 : 1) + sfx;
    return String(Math.round(n));
  };
  let hashVal = '0', hashUnit = 'H/s', miners = 0, best = 0, blocks = 0;
  try {
    const p = readPoolStatus();
    let hs = hashToHs(p.hashrate5m || p.hashrate1m) || 0;
    best = Number(p.bestshare) || 0;
    miners = readWorkers().filter(w => !w.idle).length;
    blocks = Math.max(blockState.blocks.length, countBlocks());
    try {
      const s2 = sv2Stats();
      hs += s2.hs || 0;
      miners += s2.workers || 0;
      best = Math.max(best, s2.best || 0);
    } catch (_) { /* sv2 telemetry unavailable */ }
    const h = fmtHs(hs); hashVal = h.val; hashUnit = h.unit;
  } catch (_) { /* pool not up yet */ }
  res.json({
    type: 'four-stats',
    refresh: '10s',
    items: [
      { title: 'Pool hashrate', text: hashVal, subtext: hashUnit },
      { title: 'Miners', text: String(miners), subtext: 'online' },
      { title: 'Best share', text: fmtDiff(best), subtext: 'best diff' },
      { title: 'Blocks', text: String(blocks), subtext: 'found' },
    ],
  });
});

app.listen(PORT, () => console.log(`LoneStrike Cash dashboard on :${PORT}`));
