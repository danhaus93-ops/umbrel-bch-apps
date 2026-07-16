'use strict';

const express = require('express');
const fs = require('fs');
const net = require('net');
const path = require('path');

// Country lookup for the peer globe. The table is baked into the image at
// build time (dashboard/geo/build-geo.js); nothing here touches the network.
// Sending the peer list to a hosted geo API would hand a passive observer the
// node's whole topology on every refresh.
const geo = require('./geo/geo.js');
const GEO_OK = geo.load(path.join(__dirname, 'geo'));

const app = express();
app.use(express.json());
const PORT = Number(process.env.PORT || 3000);

// --- Bitcoin Cash Node RPC (internal network only) ---
const RPC_HOST = process.env.RPC_HOST || 'bitcoind';
const RPC_PORT = process.env.RPC_PORT || '8332';
const RPC_USER = process.env.RPC_USER || 'bchn';
const RPC_PASS = process.env.RPC_PASS || 'bchn';

// --- Fulcrum (Electrum server) ---
const FULCRUM_HOST = process.env.FULCRUM_HOST || '';      // empty = Fulcrum is its own app now
const FULCRUM_ENABLED = !!FULCRUM_HOST;
const FULCRUM_STATS_PORT = process.env.FULCRUM_STATS_PORT || '8081';
const FULCRUM_TCP_PORT = process.env.FULCRUM_TCP_PORT || '50021';
const FULCRUM_SSL_PORT = process.env.FULCRUM_SSL_PORT || '50022';

// Host people type into their wallet. Umbrel injects DEVICE_DOMAIN_NAME.
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'umbrel.local';
const APP_VERSION = process.env.APP_VERSION || 'dev';

const RPC_URL = `http://${RPC_HOST}:${RPC_PORT}/`;
const RPC_AUTH = 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64');

async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: RPC_AUTH },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'dash', method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`RPC ${method} HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

// TCP reachability probe (used to confirm the Electrum ports are listening).
function tcpProbe(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(Number(port), host);
  });
}

async function fulcrumStats() {
  try {
    const res = await fetch(`http://${FULCRUM_HOST}:${FULCRUM_STATS_PORT}/stats`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Pull a height out of Fulcrum's stats blob without assuming an exact schema.
function fulcrumHeight(stats) {
  if (!stats) return null;
  const ctrl = stats.Controller || stats.controller || {};
  const cands = [ctrl['Chain height'], ctrl.Height, ctrl.height, stats.Height];
  for (const c of cands) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}


// ---- extras: peers, recent blocks (cached), uptime, network hashrate ----
const blockMetaCache = new Map(); // height -> {height,time,size,txs,tag}
async function minerTag(blockhash, txid) {
  try {
    const tx = await rpc('getrawtransaction', [txid, true, blockhash]);
    const hex = (tx.vin && tx.vin[0] && tx.vin[0].coinbase) || '';
    const ascii = Buffer.from(hex, 'hex').toString('latin1').replace(/[^\x20-\x7E]+/g, ' ').trim();
    const m = ascii.match(/\/([^\/]{2,40})\//);
    return (m ? m[1] : ascii.slice(0, 24)).trim() || 'unknown';
  } catch (_) { return 'unknown'; }
}
async function recentBlocks(tip, n) {
  const out = [];
  for (let h = tip; h > tip - n && h > 0; h--) {
    if (!blockMetaCache.has(h)) {
      try {
        const hash = await rpc('getblockhash', [h]);
        const b = await rpc('getblock', [hash, 1]);
        const tag = await minerTag(hash, b.tx[0]);
        blockMetaCache.set(h, { height: h, time: b.time, size: b.size, txs: b.tx.length, tag });
        if (blockMetaCache.size > 40) blockMetaCache.delete(Math.min(...blockMetaCache.keys()));
      } catch (_) { break; }
    }
    out.push(blockMetaCache.get(h));
  }
  return out;
}

// ---- Tor mode (off | onion | full) -----------------------------------------
const NODE_CONF = '/nodedata/bitcoin.conf';
const dnsp = require('dns').promises;
// bitcoind's -torcontrol cannot resolve hostnames — we resolve the sidecar IP and write numbers
async function torSidecarIp() {
  if (process.env.TOR_IP) return process.env.TOR_IP;
  try { return (await dnsp.lookup('tor', { family: 4 })).address; } catch (_) { return null; }
}
function torBlock(mode, ip) {
  if (mode === 'off' || !ip) return '# tor disabled\n';
  const key = mode === 'full' ? 'proxy' : 'onion';
  return `${key}=${ip}:9050\nlistenonion=1\ntorcontrol=${ip}:9051\ntorpassword=solostrike_tor_ctrl_7f2c\n`;
}
function readExternalIp() {
  try {
    const m = fs.readFileSync(NODE_CONF, 'utf8').match(/^externalip=([0-9.]+):/m);
    return m ? m[1] : null;
  } catch (_) { return null; }
}
// peers report the address they see us as — majority vote, no external services
async function detectPublicIp() {
  try {
    const peers = await rpc('getpeerinfo');
    const votes = {};
    for (const p of peers || []) {
      if (p.inbound) continue;
      const m = String(p.addrlocal || '').match(/^([0-9]{1,3}(?:\.[0-9]{1,3}){3}):/);
      if (!m) continue;
      const ip = m[1];
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)/.test(ip)) continue;
      votes[ip] = (votes[ip] || 0) + 1;
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 2 ? best[0] : null;
  } catch (_) { return null; }
}
let ipChangedAt = 0;
setInterval(async () => {
  try {
    const detected = await detectPublicIp();
    if (!detected) return;
    const stored = readExternalIp();
    if (detected !== stored) {
      await writeTorMode(readTorMode()); // rewrites conf with current mode + fresh externalip
      ipChangedAt = Date.now();
      console.log(`[bchn-dashboard] public IP ${stored || 'unset'} -> ${detected}; conf updated (applies on next node restart)`);
    }
  } catch (_) {}
}, 5 * 60 * 1000);
// Tor SOCKS5 health probe. `full` mode points bitcoind's -proxy at this port
// for EVERY outbound connection, so if Tor is not actually answering, the node
// silently stops seeing blocks: no peers, no error, tip frozen. That cost a
// real user ~16h of mining on 2026-07-15 (Tor 0.4.7.8 was EOL and stuck at 30%
// bootstrap). Never write `proxy=` without proving the proxy works first.
// Stale-tip tracking. A node can look perfectly healthy -- peers connected,
// RPC answering, no errors -- while its tip has not moved for hours. On
// 2026-07-15 a node sat 87 blocks behind for 15.7h with 5 peers and nothing
// surfaced it. BCH targets ~10 min/block, so 60 min of no movement is a
// genuine signal, not noise.
const STALE_TIP_MS = 60 * 60 * 1000;
let tipHeight = null;
let tipSeenAt = 0;
function noteTip(blocks) {
  if (typeof blocks !== 'number') return;
  if (blocks !== tipHeight) { tipHeight = blocks; tipSeenAt = Date.now(); }
  else if (!tipSeenAt) { tipSeenAt = Date.now(); }
}
function tipStalenessMs() {
  return tipSeenAt ? Date.now() - tipSeenAt : 0;
}

function torSocksOk(ip, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (_) {}
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.on('timeout', () => finish(false));
    sock.on('error', () => finish(false));
    sock.connect(9050, ip, () => {
      // SOCKS5 greeting: ver 5, 1 method, no-auth. A live Tor replies 0x05 0x00.
      sock.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    sock.on('data', (d) => finish(d.length >= 2 && d[0] === 0x05 && d[1] !== 0xff));
  });
}

function readTorMode() {
  try {
    const c = fs.readFileSync(NODE_CONF, 'utf8');
    if (/^proxy=/m.test(c)) return 'full';
    if (/^onion=/m.test(c)) return 'onion';
    return 'off';
  } catch (_) { return 'off'; }
}
async function writeTorMode(mode) {
  const ip = mode === 'off' ? null : await torSidecarIp();
  if (mode !== 'off' && !ip) throw new Error('tor sidecar not resolvable');
  // Refuse `full` unless Tor is genuinely reachable: in this mode a dead proxy
  // isolates the node completely instead of merely losing onion peers.
  if (mode === 'full' && !(await torSocksOk(ip))) {
    throw new Error('Tor is not answering on ' + ip + ':9050 — routing all '
      + 'traffic through it would cut your node off from the network '
      + 'entirely. Check the Tor logs, then try again.');
  }
  const ext = (await detectPublicIp()) || readExternalIp();
  const body = '# Managed by the Bitcoin Cash Node dashboard (Tor settings)\n'
    + torBlock(mode, ip)
    + (ext ? `externalip=${ext}:8335\n` : '');
  fs.writeFileSync(NODE_CONF, body);
}
// seed default (onion add-on) on first run so Tor works out of the box
(async () => { try { if (!fs.existsSync(NODE_CONF)) await writeTorMode('onion'); } catch (_) {} })();

// ---- Onion peers ---------------------------------------------------------
// Measured 2026-07-15: getnodeaddresses returned 23 .onion out of 33,048
// (0.07%). bitcoind draws outbound peers from that pool, so across 8 slots the
// expected onion count is ~0.006 -- statistically never. "0 via Tor" is
// arithmetic, not a fault, and waiting does not fix it.
//
// OPT-IN and default OFF, on purpose. A background control that silently dials
// peers is the same failure class as the Tor-only toggle that silently cut this
// node off from the network for 15.7h. If it is doing something, it says so.
//
// `addnode ... add` (not onetry) makes bitcoind maintain and retry the peer.
// addnode peers do NOT consume the 8 outbound slots, so clearnet peers are
// never evicted: these are purely additive block sources, which is mildly good
// for a mining node. No bitcoin.conf edit, so no bitcoind restart; re-applied
// on dashboard boot, which is what makes it survive restarts.
const ONION_PIN_FILE = path.join(path.dirname(NODE_CONF), 'onion_pin');
const ONION_PIN_MAX = 4;
function onionPinOn() {
  try { return fs.readFileSync(ONION_PIN_FILE, 'utf8').trim() === '1'; }
  catch (_) { return false; }
}
function onionPinSet(on) {
  try { fs.writeFileSync(ONION_PIN_FILE, on ? '1' : '0'); } catch (_) {}
}
async function onionKnown() {
  const all = await rpc('getnodeaddresses', [0]).catch(() => []);
  return (all || [])
    .filter((a) => /\.onion$/i.test(a.address || ''))
    .map((a) => ({ address: a.address, port: a.port || 8333, time: a.time || 0 }))
    .sort((a, b) => b.time - a.time);
}
// Reconcile desired vs actual. Never re-add a peer that is already connected,
// and never retry a dead hidden service in a tight loop: bitcoind's own retry
// under `add` is the backoff, so we only ever add each address once per boot.
const onionAdded = new Set();

// Peers the user dropped by hand. This has to be DURABLE and it has to be
// consulted by the pin, because `addnode ... add` is a standing instruction:
// bitcoind maintains and retries that peer forever. disconnectnode alone just
// loses a race with bitcoind's own redial -- the connection comes straight
// back and the button looks broken. An in-memory set would also forget every
// dashboard restart, and the peer would silently return.
// bitcoind has no indefinite ban, and setban's default expires in 24h -- which
// would silently undo an explicit decision. 10 years is "until you say
// otherwise" in practice, and Allow/Connect removes it.
const PEER_BLOCK_SECONDS = 10 * 365 * 24 * 3600;
const ONION_DROP_FILE = path.join(path.dirname(NODE_CONF), 'peer_drops');
function dropsRead() {
  try { return new Set(JSON.parse(fs.readFileSync(ONION_DROP_FILE, 'utf8'))); }
  catch (_) { return new Set(); }
}
let dropsWriteError = null;
function dropsWrite(set) {
  try {
    fs.writeFileSync(ONION_DROP_FILE, JSON.stringify([...set]));
    dropsWriteError = null;
    return true;
  } catch (e) {
    // NOT swallowed. If this fails, every block silently evaporates on the next
    // read and the Blocked list stays empty -- which looks exactly like "the
    // button does nothing". `catch (_) {}` here is what made four fixes
    // untestable from the outside.
    dropsWriteError = String(e.message || e);
    return false;
  }
}
const hostOfAddr = (a) => {
  const s = String(a || '');
  if (s.startsWith('[')) { const e = s.indexOf(']'); return e > 0 ? s.slice(1, e) : s; }
  const c = s.lastIndexOf(':');
  if (c > 0 && s.indexOf(':') !== c) return s;       // bare IPv6
  return c > 0 ? s.slice(0, c) : s;
};
async function onionReconcile() {
  if (!onionPinOn()) return;
  try {
    const peers = await rpc('getpeerinfo').catch(() => []);
    const live = new Set((peers || [])
      .filter((p) => /\.onion/.test(p.addr || ''))
      .map((p) => (p.addr || '').split(':')[0]));
    if (live.size >= ONION_PIN_MAX) return;
    const known = await onionKnown();
    const drops = dropsRead();
    for (const o of known.slice(0, ONION_PIN_MAX * 3)) {
      if (live.size + onionAdded.size >= ONION_PIN_MAX) break;
      if (live.has(o.address) || onionAdded.has(o.address)) continue;
      // The pin is a convenience; an explicit disconnect is an instruction.
      // The instruction wins until the user connects again.
      if (drops.has(o.address)) continue;
      onionAdded.add(o.address);
      await rpc('addnode', [o.address + ':' + o.port, 'add']).catch(() => {});
    }
  } catch (_) {}
}
// Enforce blocks. A ban should make this redundant, but "should" is what the
// last two attempts ran on: I asserted setban would hold and shipped twice
// without a way to notice it hadn't. This closes the loop from our side, so the
// block holds whatever bitcoind does with the ban. Cheap: one getpeerinfo, and
// it does nothing at all when nothing is blocked.
async function enforceDrops() {
  const drops = dropsRead();
  if (!drops.size) return;
  try {
    const peers = await rpc('getpeerinfo').catch(() => []);
    for (const p of peers || []) {
      if (drops.has(hostOfAddr(p.addr))) {
        await rpc('disconnectnode', ['', p.id]).catch(() => {});
      }
    }
  } catch (_) {}
}
setInterval(() => { enforceDrops().catch(() => {}); }, 10 * 1000);

setInterval(() => { onionReconcile().catch(() => {}); }, 5 * 60 * 1000);
setTimeout(() => { onionReconcile().catch(() => {}); }, 15000);

app.get('/api/onion', async (_req, res) => {
  try {
    const [known, peers] = await Promise.all([
      onionKnown(), rpc('getpeerinfo').catch(() => []),
    ]);
    const live = new Set((peers || [])
      .filter((p) => /\.onion/.test(p.addr || ''))
      .map((p) => (p.addr || '').split(':')[0]));
    const now = Math.floor(Date.now() / 1000);
    const drops = dropsRead();
    res.json({
      pin: onionPinOn(),
      max: ONION_PIN_MAX,
      connected: live.size,
      known: known.length,
      peers: known.slice(0, 40).map((o) => ({
        address: o.address, port: o.port,
        connected: live.has(o.address),
        dropped: drops.has(o.address),
        seenAgo: o.time ? now - o.time : null,
      })),
    });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/onion', async (req, res) => {
  const b = req.body || {};
  try {
    if (typeof b.pin === 'boolean') {
      onionPinSet(b.pin);
      if (b.pin) { onionAdded.clear(); await onionReconcile(); }
      return res.json({ ok: true, pin: b.pin });
    }
    if (typeof b.connect === 'string' && /^[a-z2-7]{56}\.onion$/i.test(b.connect)) {
      // An explicit Connect undoes an explicit Disconnect -- otherwise the
      // peer could never come back and the button would silently do nothing.
      // The ban must be lifted BEFORE dialling: onetry goes through
      // OpenNetworkConnection, and while a ban does not block the addnode path,
      // leaving it in place would let the automatic path drop it again later.
      const drops = dropsRead();
      if (drops.delete(b.connect)) dropsWrite(drops);
      await rpc('setban', [b.connect, 'remove']).catch(() => {});
      const r = await rpc('addnode', [b.connect + ':' + (Number(b.port) || 8333), 'onetry']);
      return res.json({ ok: true, result: r === null ? 'requested' : r });
    }
    res.status(400).json({ ok: false, error: 'expected {pin:boolean} or {connect:"<x>.onion"}' });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

app.post('/api/tor', async (req, res) => {
  const mode = ((req.body && req.body.mode) || '').toString();
  if (!['off', 'onion', 'full'].includes(mode)) return res.status(400).json({ ok: false, error: 'bad mode' });
  try { await writeTorMode(mode); } catch (e) { return res.status(500).json({ ok: false, error: 'conf write failed: ' + e.message }); }
  try { await rpc('stop'); } catch (_) { /* node restarting */ }
  res.json({ ok: true, mode, note: 'node restarting' });
});

app.get('/api/status', async (_req, res) => {
  const out = {
    ready: false,
    mode: 'full',
    node: { online: false, version: null, subversion: null },
    chain: null,
    network: null,
    mempool: null,
    nettotals: null,
    fulcrum_enabled: FULCRUM_ENABLED,
    fulcrum: { reachable_ssl: false, reachable_tcp: false, height: null, stats: false },
    connect: {
      electrum_ssl: `${PUBLIC_HOST}:${FULCRUM_SSL_PORT}:s`,
      electrum_tcp: `${PUBLIC_HOST}:${FULCRUM_TCP_PORT}:t`,
      electrum_host: PUBLIC_HOST,
      electrum_ssl_port: FULCRUM_SSL_PORT,
      electrum_tcp_port: FULCRUM_TCP_PORT,
      rpc: `${RPC_HOST}:${RPC_PORT}`,
      rpc_user: RPC_USER,
      rpc_pass: RPC_PASS,
    },
    stage: 'starting',
    dash_version: APP_VERSION,
  };

  try {
    const [chain, netinfo, mempool] = await Promise.all([
      rpc('getblockchaininfo'),
      rpc('getnetworkinfo'),
      rpc('getmempoolinfo'),
    ]);
    out.node.online = true;
    out.node.version = netinfo.version;
    out.node.subversion = netinfo.subversion;
    out.node.protocol = netinfo.protocolversion ?? null;
    out.node.torMode = readTorMode();
    out.node.externalip = readExternalIp();
    out.node.ipPending = ipChangedAt > 0 && (Date.now() - ipChangedAt) < 6 * 3600 * 1000;
    out.node.onion = (netinfo.localaddresses || [])
      .map(a => a.address).find(a => /\.onion$/.test(a || '')) || null;
    noteTip(chain.blocks);
    const staleMs = tipStalenessMs();
    // headers === blocks while the tip is frozen means we are not even HEARING
    // about new blocks (a merely-slow node has headers running ahead), which
    // usually means no usable outbound peers.
    out.node.tipStaleMinutes = Math.floor(staleMs / 60000);
    out.node.tipStale = staleMs > STALE_TIP_MS && !chain.initialblockdownload;
    out.node.tipStaleReason = out.node.tipStale
      ? (chain.headers <= chain.blocks
          ? 'No new blocks are reaching this node — it is not hearing about them. '
            + 'Check peers and Tor mode.'
          : 'Node is behind and still catching up.')
      : null;
    out.chain = {
      chain: chain.chain,
      blocks: chain.blocks,
      headers: chain.headers,
      verificationprogress: chain.verificationprogress,
      initialblockdownload: chain.initialblockdownload,
      size_on_disk: chain.size_on_disk,
      bestblockhash: chain.bestblockhash,
      difficulty: chain.difficulty,
      mediantime: chain.mediantime ?? null,
      pruned: Boolean(chain.pruned),
      pruneheight: chain.pruneheight ?? null,
      prune_target_size: chain.prune_target_size ?? null,
      automatic_pruning: chain.automatic_pruning ?? null,
    };
    out.warnings = (chain.warnings || netinfo.warnings || '').toString().trim() || null;
    out.mode = chain.pruned ? 'pruned' : 'full';
    out.network = {
      connections: netinfo.connections,
      connections_in: netinfo.connections_in,
      connections_out: netinfo.connections_out,
      networkactive: netinfo.networkactive,
      relayfee: netinfo.relayfee ?? null,
    };
    out.mempool = {
      size: mempool.size,
      bytes: mempool.bytes,
      usage: mempool.usage ?? null,
      maxmempool: mempool.maxmempool ?? null,
    };
    out.ready = true;
    out.stage = chain.initialblockdownload ? 'syncing' : 'synced';

    try {
      out.nettotals = await rpc('getnettotals');
    } catch { /* non-fatal */ }
    try {
      const [peers, up, nh, cts, zmq, banned] = await Promise.all([
        rpc('getpeerinfo'), rpc('uptime'), rpc('getnetworkhashps'),
        // Cheap. Deliberately NOT calling gettxoutsetinfo/verifychain (full chainstate scans).
        rpc('getchaintxstats').catch(() => null),
        rpc('getzmqnotifications').catch(() => null),
        rpc('listbanned').catch(() => null),
      ]);
      out.uptime = up;
      out.nethashps = nh;
      out.txstats = cts ? { count: cts.txcount ?? null, rate: cts.txrate ?? null, window: cts.window_block_count ?? null } : null;
      out.zmq = Array.isArray(zmq) ? zmq.map(z => ({ type: z.type, address: z.address })) : null;
      out.banned_count = Array.isArray(banned) ? banned.length : null;
      out.onion_known = (await onionKnown().catch(() => [])).length;
      out.onion_pin = onionPinOn();
      out.geo_ready = GEO_OK;
      out.blocked = [...dropsRead()];
      out.peers_list = (peers || []).slice(0, 40).map(p => {
        // Resolved HERE, on the node. The browser only ever receives a country
        // code and a centroid — never an address it didn't already have.
        // .onion returns nulls by design; an unresolved address returns nulls
        // too, never (0, 0). A peer at Null Island means a lookup failed quietly.
        const g = geo.lookup(p.addr);
        return {
          addr: p.addr,
          inbound: Boolean(p.inbound),
          tor: /\.onion/.test(p.addr || ''),
          ping: p.pingtime != null ? Math.round(p.pingtime * 1000) : null,
          age: p.conntime ? Math.floor(Date.now() / 1000) - p.conntime : null,
          sub: (p.subver || '').replace(/\//g, ''),
          country: g.country,
          lat: g.lat,
          lon: g.lon,
        };
      });
      out.recent_blocks = await recentBlocks(chain.blocks, 8);
    } catch { /* non-fatal extras */ }
  } catch (err) {
    out.stage = 'starting';
    out.error = String(err.message || err);
  }

  // Fulcrum is a separate app now — only probe it if FULCRUM_HOST is configured.
  if (FULCRUM_ENABLED) {
    const [stats, sslUp, tcpUp] = await Promise.all([
      fulcrumStats(),
      tcpProbe(FULCRUM_HOST, FULCRUM_SSL_PORT),
      tcpProbe(FULCRUM_HOST, FULCRUM_TCP_PORT),
    ]);
    out.fulcrum.reachable_ssl = sslUp;
    out.fulcrum.reachable_tcp = tcpUp;
    out.fulcrum.stats = Boolean(stats);
    out.fulcrum.height = fulcrumHeight(stats);
  }

  res.set('Cache-Control', 'no-store');
  res.json(out);
});

// Block one peer. This DOES ban, and the UI must say so: a control that
// quietly does more than it claims is the same failure class as a toggle that
// silently isolates the node.
//
// The earlier version here was disconnectnode alone, on the reasoning that a
// one-shot drop is the lighter, more honest action. It was neither -- it was a
// button that did nothing, because bitcoind refills the outbound slot within
// ~500ms. "Lighter" is not a virtue if the control does not work.
app.post('/api/peers/disconnect', async (req, res) => {
  const addr = String((req.body && req.body.addr) || '').trim();
  if (!addr || addr.length > 128) {
    return res.status(400).json({ ok: false, error: 'addr required' });
  }
  // Only disconnect something we are actually connected to. Passing an
  // arbitrary caller-supplied string through to the node is not something a
  // dashboard should do, and it makes the error honest when the peer has
  // already gone away on its own.
  try {
    const peers = await rpc('getpeerinfo');
    const hit = (peers || []).find(p => p.addr === addr);
    if (!hit) {
      return res.status(404).json({ ok: false, error: 'not connected to that peer' });
    }
    const host = hostOfAddr(addr);

    // disconnectnode is ONE-SHOT. bitcoind's own words: "Immediately
    // disconnects from the specified peer node." It makes no promise that the
    // peer stays gone, and it does not:
    //
    //   ThreadOpenConnections() loops every 500ms and, whenever nOutbound drops
    //   below nMaxOutbound, opens a replacement from addrman. A peer we just
    //   dropped is a fresh `tried` entry, so it is a prime candidate -- which
    //   is why it reappears within seconds.
    //
    // Two different code paths dial a peer, and each ignores a different guard:
    //
    //   automatic  OpenNetworkConnection(pszDest = nullptr)
    //              -> checks IsBanned/IsDiscouraged. Stopped ONLY by a ban.
    //   addnode    OpenNetworkConnection(pszDest = "host:port")
    //              -> `if (!pszDest)` means the ban check is SKIPPED entirely.
    //                 Stopped ONLY by removing the addnode entry.
    //
    // So keeping a peer away needs BOTH. A ban alone leaves the pin dialling;
    // removing the pin alone leaves the automatic path dialling. That is why
    // the previous fix did not work.
    let unpinned = false, banned = false, note = null;

    // 1. withdraw the standing addnode request. The ban CANNOT stop this path
    //    (OpenNetworkConnection skips the ban check when pszDest is non-null),
    //    so this has to happen regardless of what the ban does.
    try {
      const added = await rpc('getaddednodeinfo').catch(() => []);
      if ((added || []).some((a) => hostOfAddr(a.addednode) === host)) {
        await rpc('addnode', [addr, 'remove']).catch(() => {});
        unpinned = true;
      }
    } catch (_) { /* non-fatal */ }

    // 2. DROP THE CONNECTION FIRST, unconditionally.
    //    29.1.23 banned first and returned early if the ban threw. setban raises
    //    RPC_CLIENT_NODE_ALREADY_ADDED ("already banned") for a peer that is
    //    already on the list -- so tapping Disconnect a second time bailed out
    //    BEFORE disconnectnode and left the peer connected. The button became a
    //    no-op, which is exactly what was still being seen. The drop is the part
    //    the user asked for; it must never be gated on a bonus step succeeding.
    await rpc('disconnectnode', ['', hit.id]).catch(() => {});

    // 3. remember it. Consulted by the pin reconcile AND by the watchdog below.
    const drops = dropsRead();
    drops.add(host);
    const persisted = dropsWrite(drops);
    if (!persisted) note = 'block not saved: ' + dropsWriteError;
    onionAdded.delete(host);

    // 4. ban, so bitcoind's automatic outbound path skips it and we don't rely
    //    on the watchdog. Best-effort and REPORTED: "already banned" is a
    //    success for our purposes, not a failure.
    try {
      await rpc('setban', [host, 'add', PEER_BLOCK_SECONDS, false]);
      banned = true;
    } catch (e) {
      const msg = String(e.message || e);
      if (/already banned/i.test(msg)) { banned = true; }
      else { note = 'not banned (' + msg + '); the watchdog will keep dropping it'; }
    }
    return res.json({ ok: true, addr, unpinned, banned, note, persisted, dropFile: ONION_DROP_FILE });
  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err.message || err) });
  }
});

// Un-block a peer. Without this, Disconnect on a clearnet peer would be a
// one-way door: it has no entry in the onion directory, so there would be no
// way to ever let it back in. A control that cannot be undone is a trap.
app.post('/api/peers/allow', async (req, res) => {
  const addr = String((req.body && req.body.addr) || '').trim();
  if (!addr || addr.length > 128) return res.status(400).json({ ok: false, error: 'addr required' });
  const host = hostOfAddr(addr);
  try {
    await rpc('setban', [host, 'remove']).catch(() => {});   // already-unbanned is fine
    const drops = dropsRead();
    drops.delete(host);
    dropsWrite(drops);
    return res.json({ ok: true, addr: host });
  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err.message || err) });
  }
});

// Diagnostics. This exists because I shipped four fixes for the same bug
// without any way to see which assumption was wrong. Everything here is
// measured on the spot, not inferred.
app.get('/api/peers/diag', async (_req, res) => {
  const out = { version: APP_VERSION, dropFile: ONION_DROP_FILE };

  // can we actually write there? try it, don't assume.
  try {
    const probe = ONION_DROP_FILE + '.probe';
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    out.dropFileWritable = true;
  } catch (e) {
    out.dropFileWritable = false;
    out.dropFileError = String(e.message || e);
  }
  out.dropFileExists = fs.existsSync(ONION_DROP_FILE);
  try { out.dropFileRaw = fs.readFileSync(ONION_DROP_FILE, 'utf8').slice(0, 500); }
  catch (e) { out.dropFileRaw = null; }
  out.drops = [...dropsRead()];
  out.lastWriteError = dropsWriteError;

  // what the node itself thinks
  try {
    const b = await rpc('listbanned');
    out.listbanned = b;
    out.bannedCount = (b || []).length;
  } catch (e) { out.listbannedError = String(e.message || e); }
  try {
    out.addednodes = (await rpc('getaddednodeinfo') || []).map((a) => a.addednode);
  } catch (e) { out.addednodesError = String(e.message || e); }
  try {
    const peers = await rpc('getpeerinfo');
    out.peers = (peers || []).map((p) => ({ id: p.id, addr: p.addr, inbound: p.inbound, age: p.conntime }));
    out.peerCount = out.peers.length;
  } catch (e) { out.peersError = String(e.message || e); }

  res.json(out);
});

// Ban one address directly, so the ban itself can be tested apart from the rest
// of the flow. Reports the raw RPC error instead of hiding it behind a 502.
app.post('/api/peers/testban', async (req, res) => {
  const host = hostOfAddr(String((req.body && req.body.addr) || '').trim());
  if (!host) return res.status(400).json({ ok: false, error: 'addr required' });
  const out = { host };
  try { out.setban = await rpc('setban', [host, 'add', PEER_BLOCK_SECONDS, false]) ?? 'ok'; }
  catch (e) { out.setbanError = String(e.message || e); }
  try { out.isBannedNow = ((await rpc('listbanned')) || []).some((b) => String(b.address).startsWith(host)); }
  catch (e) { out.listbannedError = String(e.message || e); }
  res.json(out);
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders: (res, fp) => { if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`bchn-dashboard listening on :${PORT} -> node ${RPC_HOST}:${RPC_PORT}, fulcrum ${FULCRUM_HOST}`);
});
