#!/usr/bin/env node
/**
 * Generate the pure-helper block inside `aac-skills/ticket-fleet/ticket-fleet.js` from this
 * repo's own `tools/ticket-fleet-branch.js`.
 *
 *   node tools/build-fleet-inline.js            # write the block into the fleet script
 *   node tools/build-fleet-inline.js --check    # exit 1 if that block is stale
 *
 * Why generate rather than keep a second copy: the Workflow runtime cannot `require()`, so every
 * pure helper the fleet script needs existed twice - once in the script, once in
 * tools/ticket-fleet-branch.js where it can be unit-tested - and each new behavior added another
 * marker pair plus another hand-kept twin (issue 440). The tests did pin the copies against each
 * other, so drift was caught rather than shipped; what grew was the number of copies an editor
 * had to remember. Now the script carries ONE generated region and the module is the only place
 * the functions are written.
 *
 * The transform is the region plus one banner and nothing else - the same rule as
 * tools/build-harness-tracker-audit.js (issue 336). An allowlist of "deliberate" differences is
 * what made the earlier drift unreadable: an agent could not tell a ported divergence from a
 * forgotten one. Byte-identity minus a header is a question with one answer.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, 'ticket-fleet-branch.js');
const TARGET = path.join(__dirname, '..', 'aac-skills', 'ticket-fleet', 'ticket-fleet.js');

/** The region of the source module that travels, and the region of the script it lands in. */
const SOURCE_START = '// [FLEET-INLINE-START]';
const SOURCE_END = '// [FLEET-INLINE-END]';
const TARGET_START = '// [FLEET-GENERATED-START]';
const TARGET_END = '// [FLEET-GENERATED-END]';

/** Sits directly under the FLEET-GENERATED-START marker, inside the fleet script. */
const BANNER = [
  '// GENERATED - do not hand-edit. Built from tools/ticket-fleet-branch.js (the region between its',
  '// FLEET-INLINE markers) by tools/build-fleet-inline.js (claude-dotfiles issue 440). The Workflow',
  '// runtime cannot require(), so these pure helpers have to live in the script text; they are no',
  '// longer a hand-kept copy. Edit tools/ticket-fleet-branch.js and re-run the generator;',
  '// tools/fleet-inline-template.test.js fails while this block is stale.',
].join('\n');

/** Pure: the module text in, the text between its FLEET-INLINE markers out. */
function extractRegion(source) {
  const text = String(source);
  const s = text.indexOf(SOURCE_START);
  const e = text.indexOf(SOURCE_END);
  if (s < 0 || e < 0 || e <= s) {
    throw new Error('tools/ticket-fleet-branch.js: FLEET-INLINE markers not found or out of order');
  }
  return text.slice(s + SOURCE_START.length, e);
}

/** Pure: the module text in, the exact bytes the script must hold between its markers out. */
function renderBlock(source) {
  return '\n' + BANNER + '\n' + extractRegion(source).trim() + '\n';
}

/** Pure: script text + module text in, script text with a fresh generated block out. */
function renderScript(script, source) {
  const text = String(script);
  const s = text.indexOf(TARGET_START);
  const e = text.indexOf(TARGET_END);
  if (s < 0 || e < 0 || e <= s) {
    throw new Error('fleet script: FLEET-GENERATED markers not found or out of order');
  }
  return text.slice(0, s + TARGET_START.length) + renderBlock(source) + text.slice(e);
}

if (require.main !== module) {
  module.exports = {
    extractRegion, renderBlock, renderScript,
    BANNER, SOURCE, TARGET, SOURCE_START, SOURCE_END, TARGET_START, TARGET_END,
  };
  return;
}

const source = fs.readFileSync(SOURCE, 'utf8');
const current = fs.readFileSync(TARGET, 'utf8');
const wanted = renderScript(current, source);

if (process.argv.includes('--check')) {
  if (current === wanted) {
    console.log('fleet script generated block is up to date.');
    process.exit(0);
  }
  console.error('fleet script generated block is STALE relative to tools/ticket-fleet-branch.js.');
  console.error('Regenerate: node tools/build-fleet-inline.js');
  process.exit(1);
}

if (current === wanted) {
  console.log('fleet script generated block already up to date.');
  process.exit(0);
}
fs.writeFileSync(TARGET, wanted);
console.log('Wrote ' + path.relative(path.join(__dirname, '..'), TARGET).replace(/\\/g, '/'));
