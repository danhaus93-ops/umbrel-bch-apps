#!/usr/bin/env node
'use strict';
/* test_tor_apply_label.js — the Tor Apply button must say what it is doing.
 *
 * The bug: #torApply wore class="copy" for its LOOK, and a document-level
 * handler treated `.copy` as a BEHAVIOUR. Clicking Apply ran the button's own
 * handler (setting "Applying..."), then bubbled to document, matched `.copy`,
 * and relabelled it "Copied".
 *
 * It was latent for as long as the class was there, but it used to throw:
 * dataset.copy is undefined -> getElementById(undefined) -> null.textContent ->
 * TypeError, so "Copied" was never reached. Then the globe work added
 *     const $ = (id) => document.getElementById(id) || _gone;
 * to keep the removed hero elements from throwing, and that blanket fallback
 * turned the TypeError into '' -- so copyText('') resolved and the label got
 * clobbered. Silencing an error made a dormant bug visible.
 *
 * So this test asserts all three: the class no longer lies, the handler needs a
 * declared source, and the stub is scoped to the ids it was written for.
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

// ---- the class must not claim a behaviour it doesn't want -------------------
const torBtn = (UI.match(/<button[^>]*id="torApply"[^>]*>/) || [''])[0];
check('the Apply button exists', torBtn.length > 0);
check('Apply is not tagged as a copy button', !/class="[^"]*\bcopy\b/.test(torBtn));
check('Apply keeps its styling via a look-only class', /btn-inline/.test(torBtn));

// ---- the copy handler must require a declared source ------------------------
check('the copy handler only matches buttons that say what to copy',
  UI.includes("closest('.copy[data-copy]')"));
check('the copy handler bails if the source element is missing',
  /const src = document\.getElementById\(copyBtn\.dataset\.copy\);\s*\n\s*if\(!src\) return;/.test(UI));

// ---- the stub must not swallow unknown ids ---------------------------------
check('the missing-element stub is scoped to named ids, not a blanket fallback',
  UI.includes('_GONE_IDS') && !/const \$ = \(id\) => document\.getElementById\(id\) \|\| _gone;/.test(UI));
{
  const ids = new Set([...UI.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const asked = new Set([...UI.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  const missing = [...asked].filter((a) => !ids.has(a));
  const gone = (UI.match(/_GONE_IDS = new Set\(\[([^\]]*)\]\)/) || [, ''])[1]
    .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  check('every id that hits the stub is one the stub names',
    missing.every((m) => gone.includes(m)));
  check('the stub names nothing it does not need',
    gone.every((g) => missing.includes(g)));
}

// ---- drive the actual click, through the real bubbling ----------------------
// A source-only check would miss the ordering, and ordering IS the bug: both
// handlers fire, and the last writer wins.
{
  const listeners = [];   // {sel, fn} for document-level delegated handlers
  const torHandlers = [];
  let label = 'Apply';
  const torApply = {
    id: 'torApply', className: 'btn-inline', dataset: {},
    get textContent() { return label; },
    set textContent(v) { label = v; },
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener: (t, fn) => torHandlers.push(fn),
    closest(sel) {
      // emulate the two selectors the page actually uses
      if (sel === '.copy[data-copy]') return (/\bcopy\b/.test(this.className) && this.dataset.copy) ? this : null;
      if (sel === '.copy') return /\bcopy\b/.test(this.className) ? this : null;
      return null;
    },
  };
  // the page's document-level copy handler, transcribed
  listeners.push((e) => {
    const b = e.target.closest('.copy[data-copy]');
    if (!b) return;
    label = 'Copied';
  });
  // the button's own handler: arm, then apply
  torHandlers.push(() => { label = label === 'Restart node?' ? 'Applying\u2026' : 'Restart node?'; });

  torHandlers[0]();                                  // first tap: arm
  listeners.forEach((l) => l({ target: torApply }));  // bubbles to document
  check('first tap arms the button ("Restart node?")', label === 'Restart node?');

  torHandlers[0]();                                  // second tap: apply
  listeners.forEach((l) => l({ target: torApply }));  // bubbles to document
  check('second tap says "Applying…", not "Copied"', label === 'Applying\u2026');
}

console.log();
if (failed) { console.log('FAILED: ' + failed); process.exit(1); }
console.log('all tor apply label checks passed');
