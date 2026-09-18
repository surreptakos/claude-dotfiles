#!/usr/bin/env node
/**
 * Generate `agents/skills/project-harness/templates/tracker-audit.js` from this repo's own
 * `tools/tracker-audit.js`.
 *
 *   node tools/build-harness-tracker-audit.js            # write the template
 *   node tools/build-harness-tracker-audit.js --check    # exit 1 if it is stale
 *
 * WHAT INVOKES IT (issue 487): nothing writes for you - you run it after editing the source. What
 * runs `--check` is `.github/workflows/generated-code.yml`, on every push and pull request (the
 * commit-time half was `.githooks/pre-commit`, retired with the freshness loop in issue 213).
 * Second net: `tools/tracker-audit-template.test.js` fails in any run of the repo test command.
 *
 * Why generate rather than maintain a second copy: the template WAS a hand-maintained copy and it
 * drifted twice unnoticed (issue 336). It never carried the 2026-09-14 citation narrowing, so every
 * harnessed repo kept reading `surreptakos/aac-contract-builder#157` as its own #157 and a hex
 * colour `#9a690f` as #9; and the `duplicate-title?` advisory from issue 319 landed only here. A
 * copy nobody diffs is a copy that is wrong, so the copy is now derived and
 * `tools/tracker-audit-template.test.js` fails the moment the two disagree.
 *
 * The transform is deliberately one banner and nothing else. An allowlist of "deliberate"
 * differences is the thing that made the drift unreadable in the first place — an agent could not
 * tell a ported divergence from a forgotten one. Byte-identity minus a header is a question with
 * one answer.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, 'tracker-audit.js');
const TARGET = path.join(__dirname, '..', 'agents', 'skills', 'project-harness',
                         'templates', 'tracker-audit.js');

/** Inserted directly under the shebang. It has to be true in BOTH places it is read: in this repo
 *  the file is generated, and in a harnessed repo (where it lands as that repo's
 *  `tools/tracker-audit.js`) it is a copy that the next harness upgrade overwrites. */
const BANNER = [
  '// GENERATED — do not hand-edit. Built from the claude-dotfiles repo\'s own tools/tracker-audit.js',
  '// by tools/build-harness-tracker-audit.js (claude-dotfiles issue 336). Edit that file and re-run',
  '// the generator; tools/tracker-audit-template.test.js fails while this copy is stale.',
  '//',
  '// In a harnessed repo this file IS tools/tracker-audit.js, and the next harness re-copy',
  '// overwrites it — send a fix upstream to claude-dotfiles rather than editing it in place.',
].join('\n');

/** Pure: source text in, template text out. Exported so the test can render without writing. */
function renderTemplate(source) {
  const text = String(source);
  const nl = text.indexOf('\n');
  if (nl === -1 || !text.startsWith('#!')) {
    throw new Error('tools/tracker-audit.js no longer starts with a shebang line');
  }
  return text.slice(0, nl + 1) + BANNER + '\n' + text.slice(nl + 1);
}

if (require.main !== module) {
  module.exports = { renderTemplate, BANNER, SOURCE, TARGET };
  return;
}

const wanted = renderTemplate(fs.readFileSync(SOURCE, 'utf8'));
const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;

if (process.argv.includes('--check')) {
  if (current === wanted) {
    console.log('project-harness tracker-audit.js template is up to date.');
    process.exit(0);
  }
  console.error('project-harness tracker-audit.js template is STALE relative to tools/tracker-audit.js.');
  console.error('Regenerate: node tools/build-harness-tracker-audit.js');
  process.exit(1);
}

if (current === wanted) {
  console.log('project-harness tracker-audit.js template already up to date.');
  process.exit(0);
}
fs.writeFileSync(TARGET, wanted);
console.log('Wrote ' + path.relative(path.join(__dirname, '..'), TARGET).replace(/\\/g, '/'));
