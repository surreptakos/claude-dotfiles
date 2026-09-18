'use strict';
/**
 * node --test tests/git-env-scrub-names.test.js
 *
 * Issue 433. The names of the git hook environment variables a child must not inherit are
 * hand-copied into eight places — the harness's pre-commit template, one PowerShell module, two
 * tracker-audit copies, two Python helpers and two PowerShell suites. `git -C <path>` does not override any of
 * them, so a list that is one name short lets that one name redirect a child's git calls at the
 * repo the parent named: the 2026-09-16 aac-routines incident, where a suite's own `git init` in a
 * temp directory reconfigured the real checkout.
 *
 * Issue 406 added GIT_PREFIX to the pre-commit hooks only, because its acceptance criteria named
 * those files; the rest stopped at five names for a month with nothing to say so. This test is
 * the answer to "which copies carry which names": all of them carry all six, and a drop from any
 * one fails here. There is no shared list to import — every copy runs BEFORE the thing that could
 * hold one (the hooks are the first lines git runs; the PowerShell suites scrub at file scope
 * before they dot-source lib/manifest.ps1, which is where Clear-GitEnv lives), so the duplication
 * is deliberate and this file is what keeps the copies in step.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

/** Every GIT_* variable git exports into a hook, in the order the hooks unset them. */
const NAMES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR',
               'GIT_OBJECT_DIRECTORY'];

/** file → the regex that isolates that file's scrub list. A list that moves must move this with
 *  it: a regex that stops matching fails the test rather than passing vacuously. */
const LISTS = [
  ['agents/skills/project-harness/templates/pre-commit', /^unset\s+GIT_[^\n]*/m],
  ['lib/manifest.ps1', /^\$script:GitEnvNames = @\([^)]*\)/m],
  ['tools/tracker-audit.js', /for \(const k of \[[\s\S]*?\]\)/],
  ['agents/skills/project-harness/templates/tracker-audit.js', /for \(const k of \[[\s\S]*?\]\)/],
  ['tools/skill-stamps.py', /if k not in \{[\s\S]*?\}/],
  ['tools/skill-stamps.test.py', /for k in \([\s\S]*?\):/],
  ['tests/restore-test.ps1', /foreach \(\$name in 'GIT_DIR'[^)]*\)/],
  ['tests/git-env-leak.tests.ps1', /foreach \(\$name in 'GIT_DIR'[^)]*\)/],
];

test('every hook-environment scrub in the repo names all six GIT_* variables', () => {
  for (const [rel, pattern] of LISTS) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const found = src.match(pattern);
    assert.ok(found, `${rel}: no scrub list matched ${pattern} — did the list move?`);
    for (const name of NAMES) {
      assert.match(found[0], new RegExp(`\\b${name}\\b`),
        `${rel} scrubs ${NAMES.filter((n) => found[0].includes(n)).length} of ${NAMES.length} ` +
        `names — ${name} is missing, and a leaked ${name} redirects this file's git calls`);
    }
  }
});
