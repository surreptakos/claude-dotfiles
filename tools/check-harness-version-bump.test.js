#!/usr/bin/env node
/**
 * node --test tools/check-harness-version-bump.test.js
 *
 * Issue 933: PR 914 changed a harness template and left the version at 33, so no install read as
 * behind. These tests drive the gate against a scratch git repo, and pin its CI caller.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(__dirname, 'check-harness-version-bump.js');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'generated-code.yml');
const T = 'aac-skills/project-harness/templates/';

// A test run from a git hook inherits GIT_DIR and friends; the scratch repo must not.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bump-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, env: ENV, stdio: 'pipe' });
  g('init', '-q');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const commit = () => { g('add', '-A'); g('commit', '-q', '-m', 'x'); return g('rev-parse', 'HEAD').toString().trim(); };
  write(T + 'harness-version.md', '# Harness version\n\n    harness-version: 33\n');
  write(T + 'tracker-audit.js', 'one\n');
  write('README.md', 'r\n');
  return { dir, write, commit, base: commit() };
}

function run(dir, base) {
  return spawnSync(process.execPath, [SCRIPT, '--base', base], { cwd: dir, env: ENV, encoding: 'utf8' });
}

test('a template change without a version bump fails and names the template', () => {
  const r = repo();
  try {
    r.write(T + 'tracker-audit.js', 'two\n');
    r.commit();
    const out = run(r.dir, r.base);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /templates\/tracker-audit\.js/);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('a template change that bumps the version passes', () => {
  const r = repo();
  try {
    r.write(T + 'tracker-audit.js', 'two\n');
    r.write(T + 'harness-version.md', '# Harness version\n\n    harness-version: 34\n');
    r.commit();
    const out = run(r.dir, r.base);
    assert.equal(out.status, 0, out.stdout + out.stderr);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('a change outside the templates needs no bump', () => {
  const r = repo();
  try {
    r.write('README.md', 'changed\n');
    r.commit();
    const out = run(r.dir, r.base);
    assert.equal(out.status, 0, out.stdout + out.stderr);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('.github/workflows/generated-code.yml runs the gate with full history', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(workflow, /node tools\/check-harness-version-bump\.js/);
  assert.match(workflow, /fetch-depth: 0/, 'a shallow checkout has no merge-base to diff against');
});
