#!/usr/bin/env node
'use strict';
/* test_globe_frame.js — drives the globe's render loop with a peer that is
 * GUARANTEED visible.
 *
 * Why this exists: globe.js shipped without ctrl() and qpt(). frame() called
 * ctrl() on the first visible peer, threw, and never reached the
 * requestAnimationFrame at the bottom -- so the globe drew exactly one frame
 * and froze, with no dots, arcs or packets. The donut still worked, because
 * that is a different code path.
 *
 * The previous harness reported "executes clean" because its stub geometry left
 * every peer behind the limb: `vis` was empty, so the ctrl() line never ran. A
 * test that never reaches the call site proves nothing. This one asserts the
 * arc path executes AND that the loop re-arms.
 *
 * CI only (node).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GLOBE = path.join(__dirname, '..', '..', 'dashboard', 'public', 'globe.js');
let failed = 0;
const eval1 = (expr) => { try { return vm.runInContext(expr, sandbox); } catch { return undefined; } };
const check = (name, cond) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) failed++;
};

// ---- minimal DOM ------------------------------------------------------------
let arcCalls = 0, quadCalls = 0, dotCalls = 0;
const ctx2d = new Proxy({}, {
  get: (t, k) => {
    if (k === 'canvas') return { width: 600, height: 600 };
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'quadraticCurveTo') return () => { quadCalls++; };
    if (k === 'arc') return () => { dotCalls++; };
    if (k === 'stroke') return () => { arcCalls++; };
    return () => {};
  },
  set: () => true,
});
const mkEl = (id) => ({
  id, style: {}, children: [], dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  _t: '', get textContent() { return this._t; },
  set textContent(v) { this._t = v; if (v === '') this.children = []; },
  innerHTML: '',
  getContext: (k) => (k === 'webgl' || k === 'experimental-webgl') ? null : ctx2d,
  // a real, non-zero box: the whole point is that peers land ON SCREEN
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }),
  appendChild(c) { this.children.push(c); return c; },
  querySelector: () => mkEl('q'),
  setAttribute() {}, removeAttribute() {}, remove() {},
  addEventListener() {}, width: 600, height: 600, disabled: false,
});
const reg = {};
const rafQ = [];
const sandbox = {
  console: { log() {}, error() {}, warn() {} },
  document: {
    getElementById: (id) => (reg[id] = reg[id] || mkEl(id)),
    createElement: (t) => mkEl(t),
    querySelector: () => mkEl('q'), querySelectorAll: () => [],
    addEventListener() {},
  },
  atob: (b) => Buffer.from(b, 'base64').toString('binary'),
  Uint8Array, Uint8ClampedArray, Uint16Array, Float32Array, Math, Date, Array,
  Object, JSON, Number, String, Boolean, Set, Map, Error, BigInt, Infinity, isNaN,
  matchMedia: () => ({ matches: false }),   // reduced-motion OFF: rotation must advance
  devicePixelRatio: 1,
  ResizeObserver: class { observe() {} },
  requestAnimationFrame: (fn) => { rafQ.push(fn); return rafQ.length; },
  setTimeout: (fn) => 0, setInterval: () => 0, clearInterval() {},
  performance: { now: () => Date.now() },
};
sandbox.globalThis = sandbox; sandbox.self = sandbox; sandbox.window = sandbox;

const errors = [];
try {
  vm.createContext(sandbox);
  new vm.Script(fs.readFileSync(GLOBE, 'utf8'), { filename: 'globe.js' }).runInContext(sandbox);
} catch (e) {
  errors.push('load: ' + e.message);
}
check('globe.js loads without throwing', errors.length === 0);
if (errors.length) { console.log('        ' + errors[0]); process.exit(1); }

// ---- every helper frame() needs must actually exist -------------------------
for (const fn of ['ctrl', 'qpt', 'project', 'mk', 'syncPeers', 'recount', 'paint', 'setSync', 'renderBlocks']) {
  check(`${fn}() is defined`, eval1(`typeof ${fn}`) === 'function');
}

// ---- feed peers spread around the sphere so some MUST be front-facing -------
const peers = [];
for (let lon = -180; lon < 180; lon += 30) {
  peers.push({ addr: `10.0.0.${peers.length + 1}:8333`, inbound: peers.length % 2 === 0,
    tor: false, ping: 50, age: 1000, country: 'US', lat: 20, lon });
}
peers.push({ addr: 'zz.onion:8333', inbound: false, tor: true, ping: 600, age: 500,
  country: null, lat: null, lon: null });
sandbox.__peers = peers;
vm.runInContext('syncPeers(__peers)', sandbox);
check('syncPeers accepts the poll payload', eval1('total') === peers.length);

// ---- drive the loop ---------------------------------------------------------
const before = { arcCalls, quadCalls, dotCalls };
let ticks = 0;
const rot0 = eval1('rotY');
const t0 = Date.now();
for (let i = 0; i < 30 && rafQ.length; i++) {
  const fn = rafQ.shift();
  try { fn(t0 + 16 + i * 16); ticks++; } catch (e) { errors.push('frame ' + i + ': ' + e.message); break; }
}
check('frame() survived 30 ticks', errors.length === 0 && ticks === 30);
if (errors.length) console.log('        ' + errors[0]);

// THE assertion the old harness never reached.
check('the arc path actually executed (quadraticCurveTo called)', quadCalls > before.quadCalls);
check('peer dots were drawn (arc called)', dotCalls > before.dotCalls);
check('strokes were issued', arcCalls > before.arcCalls);

// ---- the loop must keep re-arming; a throw would leave the queue empty ------
check('requestAnimationFrame re-armed (loop is alive)', rafQ.length > 0);

// ---- and it must actually rotate -------------------------------------------
const rot1 = eval1('rotY');
check('rotY advanced (globe is turning)', typeof rot1 === 'number' && rot1 !== rot0);

console.log();
if (failed) { console.log('FAILED: ' + failed); process.exit(1); }
console.log('all globe frame checks passed  (' + quadCalls + ' arcs, ' + dotCalls + ' dots over ' + ticks + ' frames)');
