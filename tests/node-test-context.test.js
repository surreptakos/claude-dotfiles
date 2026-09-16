'use strict';
/**
 * node --test tests/node-test-context.test.js
 *
 * Issue 395. `node --test` exports NODE_TEST_CONTEXT into every process it spawns, and a nested
 * `node --test` that inherits it exits 0 even when a test throws — so any spawn site that runs a
 * repo's test suite from inside a node test reports green whatever the suite did. Every such site
 * here deletes the variable from the child environment; these tests hold that in place.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const CHECKER = path.join(ROOT, 'agents', 'skills', 'session-check', 'check.js');
const FAILING_SUITE = "require('node:test')('boom', () => { throw new Error('boom'); });\n";

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'node-test-context-')); }

/** Spawn and read the exit code and output whether or not the child failed. */
function spawnReading(argv, opts) {
  try {
    return { code: 0, out: execFileSync(argv[0], argv.slice(1), Object.assign({ encoding: 'utf8' }, opts)) };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : null,
      out: String(e.stdout || '') + String(e.stderr || ''),
    };
  }
}

test('a failing nested `node --test` propagates exit 1 once NODE_TEST_CONTEXT is scrubbed', () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'boom.test.js'), FAILING_SUITE);
    const env = Object.assign({}, process.env);
    delete env.NODE_TEST_CONTEXT;
    const r = spawnReading([process.execPath, '--test', 'boom.test.js'], { cwd: dir, env });
    assert.equal(r.code, 1, 'a throwing suite must exit 1 with the variable deleted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('session-check reports a failing suite even when it is spawned from inside a node test', () => {
  const repo = tempDir();
  try {
    fs.mkdirSync(path.join(repo, '.git'));
    fs.mkdirSync(path.join(repo, '.claude'));
    fs.writeFileSync(path.join(repo, '.claude', 'session.json'),
      JSON.stringify({ test: `"${process.execPath}" --test boom.test.js` }));
    fs.writeFileSync(path.join(repo, 'boom.test.js'), FAILING_SUITE);
    const env = Object.assign({}, process.env, { NODE_TEST_CONTEXT: 'child-v8' });
    const r = spawnReading([process.execPath, CHECKER], { cwd: repo, env });
    assert.match(r.out, /tests FAIL/, 'check.js must see the nested suite fail, not inherit a green exit 0');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('every swept spawn site strips NODE_TEST_CONTEXT from the child environment', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const rel of ['agents/skills/session-check/check.js',
                     'scripts/build-dashboard.js',
                     'agents/skills/project-harness/templates/build-dashboard.js']) {
    assert.match(read(rel), /delete\s+\w+\.NODE_TEST_CONTEXT/, rel);
    assert.match(read(rel), /env:\s*CHILD_ENV/, `${rel} must pass the scrubbed env to its children`);
  }
  for (const rel of ['.githooks/pre-commit',
                     'agents/skills/project-harness/templates/pre-commit']) {
    assert.match(read(rel), /^unset NODE_TEST_CONTEXT$/m, rel);
  }
});
