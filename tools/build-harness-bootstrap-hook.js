#!/usr/bin/env node
/**
 * Generate `agents/skills/project-harness/templates/session-start.sh` from this repo's own
 * `.claude/hooks/session-start.sh` — the cloud bootstrap hook the harness delivers to every
 * AAC repo (harness v26, issue 218).
 *
 *   node tools/build-harness-bootstrap-hook.js            # write the template
 *   node tools/build-harness-bootstrap-hook.js --check    # exit 1 if it is stale
 *
 * Same reasoning as `tools/build-harness-tracker-audit.js` (issue 336): a second hand-maintained
 * copy of a file this repo already runs is a copy nobody diffs, and a copy nobody diffs is
 * eventually wrong. The delivered body must be the body that has been exercised here.
 *
 * The transform is the IDENTITY — not even a banner. The hook is copied into the target repo as
 * that repo's `.claude/hooks/session-start.sh`, so any difference between template and source
 * would make `add-cloud-plugin.js` rewrite claude-dotfiles' own hook on every run, and
 * "running the skill again changes nothing" is an acceptance criterion of issue 218. The
 * don't-hand-edit notice therefore lives in the hook's own header, where it is true in both
 * places the file exists.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', '.claude', 'hooks', 'session-start.sh');
const TARGET = path.join(__dirname, '..', 'agents', 'skills', 'project-harness',
                         'templates', 'session-start.sh');

/** Pure: source text in, template text out. Exported so the test can render without writing. */
function renderTemplate(source) {
  const text = String(source);
  if (!text.startsWith('#!')) {
    throw new Error('.claude/hooks/session-start.sh no longer starts with a shebang line');
  }
  if (!text.includes('CANONICAL COPY.')) {
    throw new Error('.claude/hooks/session-start.sh lost its CANONICAL COPY header note');
  }
  return text;
}

if (require.main !== module) {
  module.exports = { renderTemplate, SOURCE, TARGET };
  return;
}

const wanted = renderTemplate(fs.readFileSync(SOURCE, 'utf8'));
const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;

if (process.argv.includes('--check')) {
  if (current === wanted) {
    console.log('project-harness session-start.sh template is up to date.');
    process.exit(0);
  }
  console.error('project-harness session-start.sh template is STALE relative to .claude/hooks/session-start.sh.');
  console.error('Regenerate: node tools/build-harness-bootstrap-hook.js');
  process.exit(1);
}

if (current === wanted) {
  console.log('project-harness session-start.sh template already up to date.');
  process.exit(0);
}
fs.writeFileSync(TARGET, wanted);
fs.chmodSync(TARGET, 0o755);
console.log('Wrote ' + path.relative(path.join(__dirname, '..'), TARGET).replace(/\\/g, '/'));
