'use strict';
/**
 * node --test tests/pre-commit-git-scrub.test.js
 *
 * Issue 406. Git invokes a pre-commit hook with GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE /
 * GIT_PREFIX / GIT_COMMON_DIR exported, and a child `git` honours those over its own cwd — so a
 * test that runs `git init` or `git config` in a temp directory acts on the real repository. On
 * 2026-09-16 that left aac-routines' main checkout with `core.bare = true` in `.git/config`.
 * The hook strips the variables before the test command; these tests fail if an edit drops that.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'agents', 'skills', 'project-harness', 'templates', 'pre-commit');
// This repo's own .githooks/pre-commit retired with the freshness loop (issue 213); the
// harness template is the hook this repo still ships to everywhere else.
const HOOKS = [TEMPLATE];
const SCRUBBED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR'];

test('every pre-commit hook unsets git\'s hook environment before it runs the test command', () => {
  for (const hook of HOOKS) {
    const lines = fs.readFileSync(hook, 'utf8').split('\n');
    const unset = lines.findIndex((l) => /^unset\s+GIT_/.test(l));
    assert.notEqual(unset, -1, `${hook} has no "unset GIT_..." line`);
    for (const name of SCRUBBED) {
      assert.match(lines[unset], new RegExp(`\\b${name}\\b`), `${hook} must unset ${name}`);
    }
    const run = lines.findIndex((l) => l.trim() !== '' && !l.startsWith('#') && !/^unset\b/.test(l)
      && !/^echo\b/.test(l) && !l.startsWith('#!'));
    assert.ok(run > unset, `${hook} must scrub before it runs anything`);
  }
});

test('the scrub really clears the variables for the test command the template runs', (t) => {
  try {
    execFileSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' });
  } catch {
    return t.skip('no POSIX sh on this platform');
  }
  const probe = 'printf "%s\\n" ' + SCRUBBED.map((n) => `"${n}=[\${${n}-}]"`).join(' ');
  const src = fs.readFileSync(TEMPLATE, 'utf8');
  assert.match(src, /^TEST_COMMAND \|\| \{$/m, 'template no longer runs a bare TEST_COMMAND line');
  const hook = src
    .replace(/^echo "pre-commit: TEST_COMMAND"$/m, 'echo "pre-commit: probe"')
    .replace(/^TEST_COMMAND \|\| \{$/m, `${probe} || {`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-git-scrub-'));
  try {
    const file = path.join(dir, 'pre-commit');
    fs.writeFileSync(file, hook);
    const env = Object.assign({}, process.env);
    for (const name of SCRUBBED) env[name] = `/leaked/${name}`;
    const out = execFileSync('sh', [file], { cwd: dir, env, encoding: 'utf8' });
    for (const name of SCRUBBED) {
      assert.match(out, new RegExp(`^${name}=\\[\\]$`, 'm'),
        `${name} reached the test command as ${env[name]}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
