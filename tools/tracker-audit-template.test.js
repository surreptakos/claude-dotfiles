#!/usr/bin/env node
/**
 * node --test tools/tracker-audit-template.test.js
 *
 * The project-harness skill installs `templates/tracker-audit.js` into every harnessed repo. It
 * used to be a second, hand-maintained copy of `tools/tracker-audit.js`, nothing compared the two,
 * and it silently fell two fixes behind (issue 336): the citation narrowing that stops
 * `owner/other-repo#157` and the hex colour `#9a690f` reading as this repo's #157 and #9, and the
 * `duplicate-title?` advisory. The template is now GENERATED from the repo copy, and these tests
 * are the tripwire — a fix to `tools/tracker-audit.js` that is not regenerated fails here rather
 * than shipping a stale audit to eight repos.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');

const path = require('node:path');

const { renderTemplate, SOURCE, TARGET, OUTPUTS } = require('./build-harness-tracker-audit.js');
const repoCopy = require('./tracker-audit.js');
const template = require('../aac-skills/project-harness/templates/tracker-audit.js');

test('the template is the generated copy of tools/tracker-audit.js, byte for byte', () => {
  assert.strictEqual(
    fs.readFileSync(TARGET, 'utf8'),
    renderTemplate(fs.readFileSync(SOURCE, 'utf8')),
    'template is stale — run: node tools/build-harness-tracker-audit.js'
  );
});

test('the template carries the citedIssueNumbers citation narrowing', () => {
  const body = [
    'Ported from surreptakos/aac-contract-builder#157 and blocked by #42.',
    'The swatch is #9a690f, not a ticket.',
  ].join('\n');
  const cited = template.citedIssueNumbers(body);
  assert.deepStrictEqual([...cited.keys()], [42]);
  assert.deepStrictEqual([...cited.keys()], [...repoCopy.citedIssueNumbers(body).keys()]);
});

test('the template carries the duplicate-title? advisory', () => {
  assert.match(fs.readFileSync(TARGET, 'utf8'), /'duplicate-title\?'/);
  const open = [
    { number: 285, title: "tracker-audit's comments fetch still swallows a short page" },
    { number: 281, title: "The tracker-audit's comments fetch swallows a short page again" },
  ];
  const found = template.duplicateTitleFindings(open);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].issue.number, 285);
  assert.strictEqual(found[0].duplicateOf.number, 281);
  assert.deepStrictEqual(found, repoCopy.duplicateTitleFindings(open));
});


// The job half (issue 675). Shipping the auditor without the workflow that runs it left every other
// harnessed repo reading `no .github/workflows/tracker-audit.yml` at both ends of every session.
const TEMPLATES = path.join(__dirname, '..', 'aac-skills', 'project-harness', 'templates');
const WORKFLOW_TEMPLATE = path.join(TEMPLATES, 'tracker-audit.yml');
const WORKFLOW_HERE = path.join(__dirname, '..', '.github', 'workflows', 'tracker-audit.yml');

test('every generated tracker-audit template matches its source', () => {
  for (const out of OUTPUTS) {
    assert.strictEqual(
      fs.readFileSync(out.target, 'utf8'),
      out.render(fs.readFileSync(out.source, 'utf8')),
      out.name + ' template is stale — run: node tools/build-harness-tracker-audit.js'
    );
  }
});

test('the workflow template carries the contract this repo\'s workflow does', () => {
  const template = fs.readFileSync(WORKFLOW_TEMPLATE, 'utf8');
  const here = fs.readFileSync(WORKFLOW_HERE, 'utf8');
  // Anchored on the line start, because every one of these strings also appears in the file's
  // header prose: a substring check passes on a workflow that only TALKS about the key it lost.
  for (const [what, pattern] of [
    ['the runner step', /\n\s+run: node tools\/tracker-audit-job\.js\n/],
    ['the runner unit tests', /\n\s+run: node --test tools\/tracker-audit-job\.test\.js\n/],
    ['the issue triggers', /\n\s+types: \[opened, closed, reopened, edited, labeled, unlabeled, milestoned, demilestoned\]\n/],
    ['the job token', /\n\s+GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}\n/],
    ['the full checkout', /\n\s+fetch-depth: 0\n/],
    ['pull-requests: read', /\n\s{2}pull-requests: read\n/],
  ]) {
    assert.match(here, pattern, 'this repo\'s workflow no longer carries ' + what);
    assert.match(template, pattern, 'the template no longer carries ' + what);
  }
  // The branch is the installer's one substitution (step 8b), and the installed job test fails
  // while the placeholder survives.
  assert.match(template, /branches: \[DEFAULT_BRANCH\]/);
  // The proof job is this repo's one-time acceptance evidence for issue 473; a harnessed repo has
  // neither the script nor the PAT, so a copied-in proof job would be a permanently red check.
  assert.doesNotMatch(template, /inputs\.proof|tracker-audit-proof/);
});
