#!/usr/bin/env node
// Extracts the shipped SV2 telemetry engine from server.js and runs it
// against synthetic logs replaying production failure modes.
const fs = require('fs'); const path = require('path');
const SERVER = process.argv[2] || path.join(__dirname, '../../sslabs-solostrike-cash/dashboard/server.js');
const FIX = process.argv[3] || path.join(__dirname, 'fixtures');
const src = fs.readFileSync(SERVER, 'utf8');
const start = src.indexOf('const SV2_RESETS_FILE');
const end = src.indexOf('// pool.status is several JSON objects');
if (start < 0 || end < 0) { console.error('engine markers not found'); process.exit(2); }
let core = src.slice(start, end)
  .split('\n').filter((l) => !l.trim().startsWith('setInterval(')).join('\n'); // no timers in tests
let failures = 0;
function scenario(name, logfile, fakeNowIso, truthHs, lo, hi) {
  const dir = fs.mkdtempSync('/tmp/sv2t-');
  fs.copyFileSync(path.join(FIX, logfile), path.join(dir, 'pool_sv2.log'));
  fs.writeFileSync(path.join(dir, 'payout_address'), 'x');
  fs.writeFileSync(path.join(dir, 'sv2_blocks.jsonl'), '');
  const pooldir = fs.mkdtempSync('/tmp/sv2p-');
  fs.mkdirSync(path.join(pooldir, 'config'), { recursive: true });
  const sandbox = `
    const fs = require('fs'); const path = require('path');
    const SV2_DIR = ${JSON.stringify(dir)}; const POOL_DIR = ${JSON.stringify(pooldir)};
    const SV2_ADDR_FILE = path.join(SV2_DIR, 'payout_address');
    const SV2_LOG_FILE  = path.join(SV2_DIR, 'pool_sv2.log');
    const SV2_BLOCKS_FILE = path.join(SV2_DIR, 'sv2_blocks.jsonl');
    ${core}
    Date.now = () => Date.parse(${JSON.stringify(fakeNowIso)});
    const s = sv2Stats();
    console.log(JSON.stringify({ hs: s.hs }));
  `;
  const tmp = path.join(dir, 'run.js');
  fs.writeFileSync(tmp, sandbox);
  const out = require('child_process').execSync(`node ${tmp}`, { encoding: 'utf8' });
  const hs = JSON.parse(out.trim().split('\n').pop()).hs;
  const ratio = hs / truthHs;
  const ok = ratio > lo && ratio < hi;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ratio ${ratio.toFixed(3)} (engine ${(hs/1e12).toFixed(2)} TH/s vs truth ${(truthHs/1e12).toFixed(2)})`);
  if (!ok) failures++;
}
scenario('threshold shift + batch acks', 'threshold_shift.log', '2026-01-01T00:04:00Z', 44.12e12, 0.85, 1.15);
scenario('mid-bucket sequence reset',    'seq_reset.log',       '2026-01-01T00:05:00Z', 34.0*256*2**32, 0.85, 1.15);
scenario('junk shares on floor channel', 'junk_floor.log',      '2026-01-01T00:05:00Z', 2.0*280*2**32,  0.70, 1.35);
process.exit(failures ? 1 : 0);
