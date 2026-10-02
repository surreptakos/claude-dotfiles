#!/usr/bin/env node
/**
 * node --test tools/auto-add-template.test.js
 *
 * The project-harness auto-add workflow template (issue 1333, PRD issue 1309 decision 2) puts every
 * new issue and PR of a NEW repo on its Projects board. YAML is the one thing nothing here can run,
 * so these tests pin it by text, the way tools/tracker-audit-template.test.js pins its workflow.
 * Patterns are anchored on a line start: the header prose names the same keys, and a substring
 * check passes on a workflow that only TALKS about the key it lost.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const TEMPLATE = path.join(__dirname, '..', 'aac-skills', 'project-harness', 'templates',
  'auto-add-to-project.yml');
const text = fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n');

/** The `- name:` step blocks of the one job, keyed by name. */
function steps() {
  const out = {};
  for (const block of text.split(/\n(?=\s+- name: )/).slice(1)) {
    out[/- name: (.*)/.exec(block)[1].trim()] = block;
  }
  return out;
}

test('the template pins the action version, the secret name and the board-URL placeholder', () => {
  for (const [what, pattern] of [
    ['the pinned action', /\n\s+uses: actions\/add-to-project@v2\.0\.0\n/],
    ['the secret as the action token', /\n\s+github-token: \$\{\{ secrets\.PROJECT_AUTOMATION_TOKEN \}\}\n/],
    ['the board-URL placeholder', /\n\s+project-url: PROJECT_URL\n/],
    ['the issue trigger', /\n {2}issues:\n {4}types: \[opened\]\n/],
    ['the pull request trigger', /\n {2}pull_request:\n {4}types: \[opened\]\n/],
  ]) {
    assert.match(text, pattern, 'the template no longer carries ' + what);
  }
});

test('an empty secret logs a notice and the job succeeds instead of failing', () => {
  assert.match(text, /\n\s+PROJECT_AUTOMATION_TOKEN: \$\{\{ secrets\.PROJECT_AUTOMATION_TOKEN \}\}\n/,
    'the job env must carry the secret so a step `if:` can test it');
  const all = steps();
  const skip = Object.values(all).find((b) => /\n\s+if: env\.PROJECT_AUTOMATION_TOKEN == ''\n/.test(b));
  const add = Object.values(all).find((b) => /uses: actions\/add-to-project@/.test(b));
  assert.ok(skip, 'no step runs when the secret is empty');
  assert.match(skip, /\n\s+run: echo "::notice::[^"\n]*PROJECT_AUTOMATION_TOKEN is empty[^"\n]*"$/,
    'the empty-secret step must log a ::notice::');
  assert.doesNotMatch(skip, /exit [1-9]|::error::/, 'the empty-secret step must exit green');
  assert.match(add, /\n\s+if: env\.PROJECT_AUTOMATION_TOKEN != ''\n/,
    'the action must be skipped when the secret is empty, or it fails every issue event');
  assert.strictEqual(Object.keys(all).length, 2, 'a step outside the two-way branch: re-check the empty-secret path');
});
