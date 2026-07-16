#!/usr/bin/env node
'use strict';
/* test_sv2_saved_vs_active.js
 *
 * A setting you can save but not read back is a trap. The pool reads
 * extranonce2_bytes ONCE, at container start; the file is what you SAVED. Until
 * the pool restarts the two can disagree indefinitely, and the UI said so only
 * in a title= tooltip -- which cannot render on a phone, the only device this is
 * used from.
 *
 * A tester lost a day to exactly this: he saved 5, the pool kept enforcing 4
 * from its previous boot, and his translator's request for 5 was refused. The
 * pool was right. The UI simply never told him what it was running, and the
 * field's placeholder said "16" the whole time.
 *
 * CI only (node).
 */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', '..', 'sslabs-solostrike-cash', 'dashboard');
const SRV = fs.readFileSync(path.join(D, 'server.js'), 'utf8');
const UI = fs.readFileSync(path.join(D, 'public', 'index.html'), 'utf8');

let failed = 0;
const check = (name, cond) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) failed++;
};

// ---- the regexes must survive a REAL log line -------------------------------
// Verbatim from a tester's pool. Note target: U256(...) closes a paren before
// extranonce_size ever appears, which is why [^)]* silently matched nothing.
const REAL_GRANT = 'sslabs-solostrike-cash_sv2-pool_1 | 2026-07-16T04:18:41.762392Z  INFO '
  + 'pool_sv2::channel_manager::mining_message_handler: Sending OpenExtendedMiningChannel.Success '
  + '(downstream_id: 23): OpenExtendedMiningChannelSuccess(request_id: 54, channel_id: 55, '
  + 'target: U256(00000000000024075f3b878d9d681479af35f075ad296c41ea304653cd1be734), '
  + 'extranonce_size: 4, extranonce_prefix: B032(0100003c), group_channel_id: 1)';
const REAL_REQUEST = 'Received OpenExtendedMiningChannel: OpenExtendedMiningChannel(request_id: 1, '
  + 'user_identity: 1QC.miner1, nominal_hash_rate: 200000000000000, '
  + 'max_target: U256(00000000000024075f3b878d9d681479af35f075ad296c41ea304653cd1be734), '
  + 'min_extranonce_size: 5)';
const REAL_BOOT = '[entrypoint] extranonce2 bytes: 16 (client rollable search space)';

const grantSrc = (SRV.match(/const SV2_RE_XN_GRANT = (\/.*\/);/) || [])[1];
const bootSrc = (SRV.match(/const SV2_RE_XN_BOOT\s+= (\/.*\/);/) || [])[1];
check('the granted-size regex exists', Boolean(grantSrc));
check('the boot-banner regex exists', Boolean(bootSrc));

if (grantSrc && bootSrc) {
  const G = eval(grantSrc), B = eval(bootSrc);
  check('parses the granted size from a REAL pool line', (G.exec(REAL_GRANT) || [])[1] === '4');
  check('does NOT read the REQUEST as the active value', G.exec(REAL_REQUEST) === null);
  check('parses the boot banner as a fallback', (B.exec(REAL_BOOT) || [])[1] === '16');
}

// ---- the server must report BOTH --------------------------------------------
check('the active value is tracked in state', /activeXn:\s*0/.test(SRV));
check('/api/sv2 returns the saved value', /savedXn: readSv2Xn\(\)/.test(SRV));
check('/api/sv2 returns the active value', /activeXn: sv2State\.activeXn \|\| null/.test(SRV));
check('active is null, never a guess, when nothing has been observed',
  /sv2State\.activeXn \|\| null/.test(SRV));

// ---- and the UI must SHOW it -------------------------------------------------
check('the field renders the saved value', /xnEl\.value=d\.savedXn/.test(UI));
check('the field no longer hints a fake 16', !/<input[^>]*placeholder="16"/.test(UI));
check('typing is not overwritten by the poll', /document\.activeElement!==xnEl/.test(UI));
check('a mismatch is shown on screen', /id="sv2Pending"/.test(UI) && /pb\.textContent/.test(UI));
check('the mismatch names both numbers', /saved '\+d\.savedXn\+', pool is running '\+d\.activeXn/.test(UI));
check('it says what the mismatch will DO', /will be refused/.test(UI));
check('shares-per-minute mismatch is shown too', /Shares\/min: saved /.test(UI));
// This is the fourth time a tooltip has hidden load-bearing text in one night.
check('"requires a pool restart" is no longer tooltip-only', !/Requires a pool restart\./.test(UI));
check('the spm restart note is out of the tooltip too',
  !/restart app to apply saved value/.test(UI));

console.log();
if (failed) { console.log('FAILED: ' + failed); process.exit(1); }
console.log('all sv2 saved-vs-active checks passed');
