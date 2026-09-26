#!/usr/bin/env node
// node --test tests/code-review-rules.test.js - the code-review skill's per-path rule resolver
// (issue 625): deterministic mapping from changed files to standards, and an optional rule file.
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ENGINE = path.join(__dirname, '..', 'aac-skills', 'code-review', 'resolve-rules.js');
const { resolveRules } = require(ENGINE);

const CONFIG = {
  ignore: ['dist/**'],
  rules: [
    { paths: ['src/**/*.ts'], exclude: ['**/*.test.ts'], standards: ['docs/ts.md'], rules: ['No default exports.'] },
    { paths: ['**/*.ts'], standards: ['docs/ts.md', 'docs/all.md'] },
  ],
};

test('each changed file takes every matching rule, minus excludes and ignores', () => {
  const r = resolveRules(CONFIG, ['src/a/b.ts', 'src/a/b.test.ts', 'dist/x.ts', 'README.md', 'top.ts']);
  assert.deepEqual(r.files, [
    { path: 'src/a/b.ts', standards: ['docs/ts.md', 'docs/all.md'], rules: ['No default exports.'] },
    { path: 'src/a/b.test.ts', standards: ['docs/ts.md', 'docs/all.md'], rules: [] },
    { path: 'top.ts', standards: ['docs/ts.md', 'docs/all.md'], rules: [] },
  ]);
  assert.deepEqual(r.unmatched, ['README.md']);
  assert.deepEqual(r.ignored, ['dist/x.ts']);
});

test('no rule file leaves every file unmatched', () => {
  assert.deepEqual(resolveRules(null, ['a.js']), { files: [], unmatched: ['a.js'], ignored: [], missingStandards: [] });
});

test('a malformed rule file throws instead of resolving', () => {
  assert.throws(() => resolveRules({ rules: [{ paths: 'src/*' }] }, ['src/a']), /paths/);
});

test('CLI resolves a git diff against the repo rule file and flags missing standards', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-rules-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'ts.md'), 'x');
  git('add', '.');
  git('commit', '-qm', 'base');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'x');
  fs.mkdirSync(path.join(root, '.code-review'));
  fs.writeFileSync(path.join(root, '.code-review', 'rules.json'), JSON.stringify(CONFIG));
  git('add', '.');
  git('commit', '-qm', 'change');

  const ok = spawnSync(process.execPath, [ENGINE, 'HEAD~1'], { cwd: root, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const out = JSON.parse(ok.stdout);
  assert.equal(out.ruleFile, '.code-review/rules.json');
  assert.deepEqual(out.files.map((f) => f.path), ['src/a.ts']);
  assert.deepEqual(out.unmatched, ['.code-review/rules.json']);
  assert.deepEqual(out.missingStandards, ['docs/all.md']);

  fs.writeFileSync(path.join(root, '.code-review', 'rules.json'), '{ not json');
  const bad = spawnSync(process.execPath, [ENGINE, '--files', 'src/a.ts'], { cwd: root, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  fs.rmSync(root, { recursive: true, force: true });
});
