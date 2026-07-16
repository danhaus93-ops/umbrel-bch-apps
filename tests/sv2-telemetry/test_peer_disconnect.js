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

// Bound to the disconnect handler alone: /api/peers/allow now sits between it
// and /healthz, and it legitimately contains 'remove' + setban of its own.
// Anchored to the handler FUNCTION, not the route registration: the same body
// is now reachable over POST and (as a fallback) GET, so the express route line
// is no longer where the logic lives.
const endpoint = SRC.slice(
  SRC.indexOf('async function disconnectHandler(req, res) {'),
  SRC.indexOf("app.post('/api/peers/disconnect', disconnectHandler);"));
check('the disconnect handler exists', endpoint.length > 0);
check('the handler is reachable over POST', SRC.includes("app.post('/api/peers/disconnect', disconnectHandler);"));
// POSTs may be being dropped between the browser and this app -- both
// POST-driven features show zero evidence of ever having run. A correct verb
// that never arrives is worth nothing, so the same body is reachable by GET.
check('the same handler is reachable over GET as a fallback',
  SRC.includes("app.get('/api/peers/disconnect-get'") && /return disconnectHandler\(req, res\)/.test(SRC));
check('a GET probe records that the click handler ran at all',
  SRC.includes("app.get('/api/peers/tap'") && SRC.includes('out.lastTap'));
check('a GET probe records raw pointerdown, before click logic',
  SRC.includes("app.get('/api/peers/pointer'") && SRC.includes('out.lastPointer'));

// ---- the drop must never be gated on the ban ------------------------------
// 29.1.23 called setban BEFORE disconnectnode and returned 502 if it threw.
// setban raises RPC_CLIENT_NODE_ALREADY_ADDED for an already-banned peer, so
// the second tap bailed out before disconnecting and the button silently did
// nothing. The drop is what the user asked for; a bonus step must not block it.
const iRemove = endpoint.indexOf("rpc('addnode', [addr, 'remove']");
const iBan = endpoint.indexOf("rpc('setban'");
const iDrop = endpoint.indexOf("rpc('disconnectnode'");
check('disconnect removes the standing addnode entry (closes the addnode path)', iRemove > -1);
check('disconnect bans the peer (closes the automatic outbound path)', iBan > -1);
check('the addnode entry is removed BEFORE the drop', iRemove > -1 && iDrop > -1 && iRemove < iDrop);
check('the DROP happens before the ban, so a ban failure cannot cancel it',
  iDrop > -1 && iBan > -1 && iDrop < iBan);
check('"already banned" is treated as success, not an error', /already banned/i.test(endpoint));
check('a ban failure is reported, not swallowed and not fatal',
  /note = 'not banned/.test(endpoint));
check('the ban outlives setban\'s 24h default', /PEER_BLOCK_SECONDS/.test(endpoint) &&
  /PEER_BLOCK_SECONDS = 10 \* 365/.test(SRC));

// ---- and the block is enforced, not merely requested -----------------------
// Both previous attempts asserted a mechanism would hold and shipped without
// any way to notice it hadn't. This closes the loop from our own side.
const watchdog = SRC.slice(SRC.indexOf('async function enforceDrops'), SRC.indexOf('setInterval(() => { onionReconcile'));
check('a watchdog enforces blocks independently of the ban', watchdog.length > 0);
check('the watchdog re-drops any blocked peer that turns up', /drops\.has\(hostOfAddr\(p\.addr\)\)/.test(watchdog));
check('the watchdog is a no-op when nothing is blocked', /if \(!drops\.size\) return;/.test(watchdog));
check('the watchdog is actually scheduled', /setInterval\(\(\) => \{ enforceDrops\(\)/.test(SRC));

// ---- durability -------------------------------------------------------------
check('the decision is persisted, not held in memory',
  endpoint.includes('dropsWrite') && SRC.includes('ONION_DROP_FILE'));
check('the drop file lives beside the node conf (survives a container restart)',
  /ONION_DROP_FILE = path\.join\(path\.dirname\(NODE_CONF\)/.test(SRC));

// ---- the pin must not undo it ----------------------------------------------
const reconcile = SRC.slice(SRC.indexOf('async function onionReconcile'), SRC.indexOf('setInterval(() => { onionReconcile'));
check('onionReconcile reads the drop list', reconcile.includes('dropsRead'));
check('onionReconcile skips a peer the user dropped', /if \(drops\.has\(o\.address\)\) continue;/.test(reconcile));

// ---- every block must be undoable, or the button is a one-way door ---------
// A clearnet peer has no entry in the onion directory, so without this endpoint
// Disconnect could never be reversed from the UI.
const allow = SRC.slice(SRC.indexOf("app.post('/api/peers/allow'"), SRC.indexOf("app.get('/healthz'"));
check('an unblock endpoint exists', allow.length > 0);
check('unblock lifts the ban', allow.includes("'remove'") && allow.includes('setban'));
check('unblock clears the persisted drop', allow.includes('drops.delete'));
check('the blocked list is exposed to the UI', SRC.includes('out.blocked = [...dropsRead()]'));
const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard', 'public', 'index.html'), 'utf8');
check('the UI renders the blocked list with an Allow button', /renderBlocked/.test(ui) && /'Allow'/.test(ui));
check('the button says it blocks, rather than implying a one-shot drop',
  /Disconnect and block this peer/.test(ui));
check('no stale claim that this is not a ban', !/not a ban/.test(ui) && !/not `setban`/.test(SRC));

// ---- and Connect must undo the drop, or the peer can never come back -------
const onionPost = SRC.slice(SRC.indexOf("app.post('/api/onion'"), SRC.indexOf("app.post('/api/tor'"));
check('an explicit Connect clears the drop', onionPost.includes('drops.delete(b.connect)'));
check('an explicit Connect also lifts the ban', /setban',\s*\[b\.connect, 'remove'\]/.test(onionPost));
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
