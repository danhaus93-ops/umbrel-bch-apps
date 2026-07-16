#!/usr/bin/env node
'use strict';
/* test_peer_disconnect.js — a disconnected peer must STAY disconnected.
 *
 * The bug this pins: the onion pin issues `addnode <onion> add`, and `add` is a
 * standing instruction — bitcoind maintains and RETRIES that peer forever. So
 * disconnectnode on a pinned peer just loses a race with bitcoind's own redial:
 * the peer is back within seconds and the button looks broken. Removing the
 * addnode entry after the disconnect is no good either; the redial happens in
 * between. Order is the fix, so order is what gets tested.
 *
 * These assertions are made against the SOURCE, because the behaviour lives in
 * the sequencing of RPC calls and there is no node here to talk to.
 *
 * CI only (node).
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard', 'server.js'), 'utf8');
let failed = 0;
const check = (name, cond) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) failed++;
};

const endpoint = SRC.slice(
  SRC.indexOf("app.post('/api/peers/disconnect'"),
  SRC.indexOf('app.get(\'/healthz\''));
check('the disconnect endpoint exists', endpoint.length > 0);

// ---- the ordering that makes it work ---------------------------------------
const iRemove = endpoint.indexOf("'remove'");
const iDrop = endpoint.indexOf("disconnectnode");
check('disconnect removes the standing addnode entry', iRemove > -1);
check('it unpins BEFORE disconnecting (else bitcoind redials first)',
  iRemove > -1 && iDrop > -1 && iRemove < iDrop);
check('it checks getaddednodeinfo rather than guessing what is pinned',
  endpoint.includes('getaddednodeinfo'));
check('it disconnects by node id, not by address',
  /disconnectnode',\s*\['',\s*hit\.id\]/.test(endpoint));

// ---- durability -------------------------------------------------------------
check('the decision is persisted, not held in memory',
  endpoint.includes('dropsWrite') && SRC.includes('ONION_DROP_FILE'));
check('the drop file lives beside the node conf (survives a container restart)',
  /ONION_DROP_FILE = path\.join\(path\.dirname\(NODE_CONF\)/.test(SRC));

// ---- the pin must not undo it ----------------------------------------------
const reconcile = SRC.slice(SRC.indexOf('async function onionReconcile'), SRC.indexOf('setInterval(() => { onionReconcile'));
check('onionReconcile reads the drop list', reconcile.includes('dropsRead'));
check('onionReconcile skips a peer the user dropped', /if \(drops\.has\(o\.address\)\) continue;/.test(reconcile));

// ---- and Connect must undo the drop, or the peer can never come back -------
const onionPost = SRC.slice(SRC.indexOf("app.post('/api/onion'"), SRC.indexOf("app.post('/api/tor'"));
check('an explicit Connect clears the drop', onionPost.includes('drops.delete(b.connect)'));
check('Connect uses onetry (a one-shot dial, not a standing pin)', onionPost.includes("'onetry'"));

// ---- the pin toggle must not resurrect dropped peers either -----------------
check('turning the pin back on still respects drops (reconcile is the only adder)',
  (SRC.match(/rpc\('addnode',\s*\[o\.address/g) || []).length === 1);

// ---- the UI needs to be able to say so -------------------------------------
check('/api/onion reports which peers are dropped', SRC.includes('dropped: drops.has(o.address)'));

// ---- host parsing: an onion addr has a port, the drop key must not ---------
check('addresses are reduced to a host before being stored', endpoint.includes('hostOfAddr(addr)'));
check('hostOfAddr handles bracketed IPv6', /if \(s\.startsWith\('\['\)\)/.test(SRC));

console.log();
if (failed) { console.log('FAILED: ' + failed); process.exit(1); }
console.log('all peer-disconnect checks passed');
