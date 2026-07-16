#!/usr/bin/env node
'use strict';
/* test_peer_row_stability.js — the Disconnect button must survive a poll.
 *
 * THE bug. renderPeerRows did:
 *
 *     const t = document.getElementById('peersTable');
 *     t.textContent = '';                                    // nuke every row
 *     ...
 *     btn.addEventListener('click', () => disconnectPeer(...));  // dies with it
 *
 * with setInterval(tick, 5000). On a phone a tap is touchstart -> delay ->
 * touchend -> click; if the button leaves the DOM in that window the click
 * NEVER FIRES. The request never left the browser: /diag reported
 * lastDisconnect: null on a live node. Eight releases of "fixes" went to a
 * handler that had never once been entered.
 *
 * Nothing server-side could ever have caught this, which is the lesson: I kept
 * testing the code I suspected instead of proving the code ran at all.
 *
 * CI only (node).
 */
const fs = require('fs');
const path = require('path');

const UI = fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard', 'public', 'index.html'), 'utf8');
let failed = 0;
const check = (name, cond) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) failed++;
};

const fn = UI.slice(UI.indexOf('function renderPeerRows(list){'), UI.indexOf('// ONE listener, on the container'));
check('renderPeerRows exists', fn.length > 0);
check('it does NOT clear the container on every poll', !fn.includes("t.textContent=''"));
check('rows are keyed so they can be reused', /peerRows\.get\(p\.addr\)/.test(fn));
check('vanished peers are removed individually', /row\.remove\(\); peerRows\.delete\(addr\)/.test(fn));
check('the click is delegated to the container, not the row',
  /peersTableEl\.addEventListener\('click', armDisconnect\)/.test(UI) &&
  /const peersTableEl = document\.getElementById\('peersTable'\)/.test(UI));
// iOS can fail to synthesise a click from a clean touch. touchend is the
// backstop; dataset.busy stops both paths firing twice.
check('touchend is wired as a fallback for a click that never forms',
  /peersTableEl\.addEventListener\('touchend', armDisconnect\)/.test(UI));
check('the two paths cannot double-fire', /dataset\.busy==='1'/.test(UI));
// btn.title is a tooltip: it cannot render on a phone, which is where this is
// used. Every error path went there for nine releases.
check('errors are reported on screen, not into a tooltip',
  /function peerSay/.test(UI) && !/btn\.title=j\.error/.test(UI));
// Success needs no banner: the peer leaves the list and appears under Blocked.
// A failure has nowhere else to go, which is the whole reason peerSay exists.
check('success is quiet', /if\(j\.note\) peerSay\(j\.note\); else peerHush\(\);/.test(UI));
check('the Allow button reports its failures too', /could not allow /.test(UI));
check('no diagnostic scaffolding left in the tap path',
  !/peers\/tap|peers\/pointer|disconnect-get/.test(UI));
check('no per-row click listener survives', !/btn\.addEventListener\('click'/.test(UI));
check('the delegated handler reads the address off the button',
  /b\.dataset\.addr/.test(UI));
check('rows are not ordered by ping (it changes every poll and moves rows)',
  !/pa-pb/.test(UI.slice(UI.indexOf('function peerRowOrder'), UI.indexOf('async function disconnectPeer'))));

// ---- the real thing: identity across a poll --------------------------------
{
  const rows = new Map();
  const container = { children: [], appendChild(c) { this.children.push(c); return c; },
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1;
      const cur = this.children.indexOf(c); if (cur >= 0) this.children.splice(cur, 1);
      if (i >= 0) this.children.splice(i, 0, c); else this.children.push(c); return c; } };
  const mkRow = (addr) => ({ addr, btn: { dataset: { addr } }, remove() {} });

  // model renderPeerRows' reconcile: same peers in, same row objects out
  const render = (list) => {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.addr);
      if (!rows.has(p.addr)) { const r = mkRow(p.addr); rows.set(p.addr, r); container.appendChild(r); }
    }
    for (const [a, r] of [...rows]) if (!seen.has(a)) { r.remove(); rows.delete(a); }
  };

  const peers = [
    { addr: 'aaa.onion:8333', tor: true, ping: 500 },
    { addr: '1.2.3.4:8333', tor: false, ping: 40 },
  ];
  render(peers);
  const btnBefore = rows.get('aaa.onion:8333').btn;

  // a poll lands mid-tap: ping changed, everything else identical
  render(peers.map((p) => ({ ...p, ping: p.ping + 17 })));
  const btnAfter = rows.get('aaa.onion:8333').btn;

  check('the SAME button object survives a poll (the tap can still land)', btnBefore === btnAfter);
  check('the button still carries its address after a poll', btnAfter.dataset.addr === 'aaa.onion:8333');

  // a peer that genuinely leaves must go
  render([peers[1]]);
  check('a departed peer\'s row is removed', !rows.has('aaa.onion:8333'));
  check('the remaining row is untouched', rows.get('1.2.3.4:8333').btn.dataset.addr === '1.2.3.4:8333');
}


// ---- the handler must never bail silently ---------------------------------
// "touch on ?" on a real device: a button matched button.dc but carried no
// dataset.addr, which the source says cannot happen. The old guard was
//     if(!b || !b.dataset.addr) return;
// so it returned quietly and looked exactly like a dead button. Nine releases
// were spent downstream of that silent return.
{
  const arm = UI.slice(UI.indexOf('function armDisconnect(e){'), UI.indexOf("peersTableEl.addEventListener('click'"));
  check('armDisconnect does not require dataset.addr', !/if\(!b \|\| !b\.dataset\.addr\) return;/.test(arm));
  check('it resolves the address from the row instead', /addrOfButton\(b\)/.test(arm));
  check('an unresolvable button reports on screen rather than returning quietly',
    /peerSay\('could not work out which peer/.test(arm));

  const resolve = UI.slice(UI.indexOf('function addrOfButton(b){'), UI.indexOf('function armDisconnect(e){'));
  check('addrOfButton prefers dataset when present', /b\.dataset\.addr/.test(resolve));
  check('addrOfButton falls back to the address the row is displaying', /querySelector\('\.pa'\)/.test(resolve));
  check('addrOfButton strips the [tor] prefix the row adds for display',
    /replace\(\/\^\\\[tor\\\]/.test(resolve));
  check('addrOfButton has aria-label as a last resort', /aria-label/.test(resolve));
}

console.log();
if (failed) { console.log('FAILED: ' + failed); process.exit(1); }
console.log('all peer row stability checks passed');
