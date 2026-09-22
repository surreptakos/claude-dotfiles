#!/usr/bin/env node
/**
 * Generate `aac-skills/project-harness/templates/tracker-audit.js` from this repo's own
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
const TEMPLATES = path.join(__dirname, '..', 'aac-skills', 'project-harness', 'templates');
const TARGET = path.join(TEMPLATES, 'tracker-audit.js');

// The job half (claude-dotfiles issue 675). `templates/tracker-audit.js` shipped the auditor to
// every harnessed repo while the job that RUNS it stayed here, so `session-check` read "no run for
// this head" in repos that had the audit all along - the only `!!` left in two cut-over sessions
// (aac-sales-cockpit#645, zoho-source-of-truth#134). The runner and its test are generated the same
// way as the auditor, for the same reason: a hand-copied second copy is a copy nobody diffs.
const JOB_SOURCE = path.join(__dirname, 'tracker-audit-job.js');
const JOB_TARGET = path.join(TEMPLATES, 'tracker-audit-job.js');
const JOB_TEST_SOURCE = path.join(__dirname, 'tracker-audit-job.test.js');
const JOB_TEST_TARGET = path.join(TEMPLATES, 'tracker-audit-job.test.js');

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

/** The runner's banner. Same contract as BANNER: true in this repo, where the template is
 *  generated, and true in a harnessed repo, where the file lands as tools/tracker-audit-job.js. */
const JOB_BANNER = [
  '// GENERATED - do not hand-edit. Built from the claude-dotfiles repo\'s own',
  '// tools/tracker-audit-job.js by tools/build-harness-tracker-audit.js (claude-dotfiles issue',
  '// 675). Edit that file and re-run the generator.',
  '//',
  '// In a harnessed repo this file IS tools/tracker-audit-job.js, and the next harness re-copy',
  '// overwrites it - send a fix upstream to claude-dotfiles rather than editing it in place.',
].join('\n');

/** Pure: insert `banner` under the file's shebang. */
function withBanner(source, banner, what) {
  const text = String(source);
  const nl = text.indexOf('\n');
  if (nl === -1 || !text.startsWith('#!')) {
    throw new Error(what + ' no longer starts with a shebang line');
  }
  return text.slice(0, nl + 1) + banner + '\n' + text.slice(nl + 1);
}

/** The workflow assertion in the repo's own job test names THIS repo's default branch. A harnessed
 *  repo's may be `main`, and the template lands with a `DEFAULT_BRANCH` placeholder until the
 *  installer substitutes it, so the templated test asserts a branch is named rather than which -
 *  and fails while the placeholder is still there, which is the substitution step 8b can forget. */
const BRANCH_ASSERTION_SOURCE = "  assert.match(yaml, /push:\\s*\\n\\s*branches: \\[master\\]/);";
const BRANCH_ASSERTION_TEMPLATE = [
  '  // The default branch, substituted by project-harness step 8b. `DEFAULT_BRANCH` still in the',
  '  // file means the push trigger never fires and nothing else says so.',
  '  assert.match(yaml, /push:\\s*\\n(?:\\s*#[^\\n]*\\n)*\\s*branches: \\[(?<branch>[\\w.\\/-]+)\\]/);',
  '  assert.doesNotMatch(yaml, /branches: \\[DEFAULT_BRANCH\\]/);',
].join('\n');

/** Pure: the repo's job test in, the templated job test out. */
function renderJobTest(source) {
  const text = String(source);
  if (!text.includes(BRANCH_ASSERTION_SOURCE)) {
    throw new Error('tools/tracker-audit-job.test.js no longer pins the push branch the way the '
      + 'template transform expects - update BRANCH_ASSERTION_SOURCE in this generator');
  }
  return withBanner(text.replace(BRANCH_ASSERTION_SOURCE, BRANCH_ASSERTION_TEMPLATE),
                    JOB_BANNER, 'tools/tracker-audit-job.test.js');
}

/** Every generated template, in one list, so --check and the write path cannot cover different
 *  sets - the drift this generator exists to stop. */
const OUTPUTS = [
  { name: 'tracker-audit.js', source: SOURCE, target: TARGET, render: renderTemplate },
  {
    name: 'tracker-audit-job.js',
    source: JOB_SOURCE,
    target: JOB_TARGET,
    render: (text) => withBanner(text, JOB_BANNER, 'tools/tracker-audit-job.js'),
  },
  { name: 'tracker-audit-job.test.js', source: JOB_TEST_SOURCE, target: JOB_TEST_TARGET, render: renderJobTest },
];

if (require.main !== module) {
  module.exports = {
    renderTemplate, renderJobTest, withBanner, BANNER, JOB_BANNER, SOURCE, TARGET, OUTPUTS,
    JOB_SOURCE, JOB_TARGET, JOB_TEST_SOURCE, JOB_TEST_TARGET,
  };
  return;
}

const rel = (p) => path.relative(path.join(__dirname, '..'), p).replace(/\\/g, '/');
const stale = [];
const wrote = [];

for (const out of OUTPUTS) {
  const wanted = out.render(fs.readFileSync(out.source, 'utf8'));
  const current = fs.existsSync(out.target) ? fs.readFileSync(out.target, 'utf8') : null;
  if (current === wanted) continue;
  if (process.argv.includes('--check')) { stale.push(out); continue; }
  fs.writeFileSync(out.target, wanted);
  wrote.push(out);
}

if (process.argv.includes('--check')) {
  if (!stale.length) {
    console.log('project-harness tracker-audit templates are up to date.');
    process.exit(0);
  }
  for (const out of stale) {
    console.error('project-harness ' + out.name + ' template is STALE relative to ' + rel(out.source) + '.');
  }
  console.error('Regenerate: node tools/build-harness-tracker-audit.js');
  process.exit(1);
}

if (!wrote.length) {
  console.log('project-harness tracker-audit templates already up to date.');
  process.exit(0);
}
for (const out of wrote) console.log('Wrote ' + rel(out.target));
