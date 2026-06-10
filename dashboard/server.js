'use strict';

const express = require('express');
const net = require('net');
const path = require('path');

const app = express();
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
    },
    stage: 'starting',
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
    out.chain = {
      chain: chain.chain,
      blocks: chain.blocks,
      headers: chain.headers,
      verificationprogress: chain.verificationprogress,
      initialblockdownload: chain.initialblockdownload,
      size_on_disk: chain.size_on_disk,
      bestblockhash: chain.bestblockhash,
      difficulty: chain.difficulty,
      pruned: Boolean(chain.pruned),
      pruneheight: chain.pruneheight ?? null,
      prune_target_size: chain.prune_target_size ?? null,
      automatic_pruning: chain.automatic_pruning ?? null,
    };
    out.mode = chain.pruned ? 'pruned' : 'full';
    out.network = {
      connections: netinfo.connections,
      connections_in: netinfo.connections_in,
      connections_out: netinfo.connections_out,
    };
    out.mempool = { size: mempool.size, bytes: mempool.bytes };
    out.ready = true;
    out.stage = chain.initialblockdownload ? 'syncing' : 'synced';

    try {
      out.nettotals = await rpc('getnettotals');
    } catch { /* non-fatal */ }
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

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`bchn-dashboard listening on :${PORT} -> node ${RPC_HOST}:${RPC_PORT}, fulcrum ${FULCRUM_HOST}`);
});
