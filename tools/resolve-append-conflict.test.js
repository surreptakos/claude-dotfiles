#!/usr/bin/env node
/**
 * node --test tools/resolve-append-conflict.test.js
 *
 * Issue 908. The classifier on its own: an append-append hunk resolves as ours + theirs, a hunk
 * that changes a base line does not. Then a real `git merge` of two branches: both appending
 * tests at the end of one file resolves (run 6ab733a4's 840 and 812), both editing the same base
 * line (its 813) stays conflicted and the CLI exits non-zero, which the deliver stage reads.
 */
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const CLI = path.join(__dirname, 'resolve-append-conflict.js');
const { classifyHunk, resolveAppendConflicts } = require('./resolve-append-conflict.js');

test('classifyHunk: both sides only add lines - resolvable, ours then theirs', () => {
  const empty = classifyHunk({ ours: ['test(a)'], base: [], theirs: ['test(b)'] });
  assert.equal(empty.resolvable, true);
  assert.deepEqual(empty.lines, ['test(a)', 'test(b)']);
  const anchored = classifyHunk({ ours: ['})', '', 'test(a)'], base: ['})'], theirs: ['})', '', 'test(b)'] });
  assert.equal(anchored.resolvable, true);
  assert.deepEqual(anchored.lines, ['})', '', 'test(a)', 'test(b)']);
});

test('classifyHunk: a side that changes or removes a base line - not resolvable', () => {
  assert.equal(classifyHunk({ ours: ['x = 2'], base: ['x = 1'], theirs: ['x = 3'] }).resolvable, false);
  assert.equal(classifyHunk({ ours: ['x = 1', 'y'], base: ['x = 1'], theirs: [] }).resolvable, false);
  assert.equal(classifyHunk({ ours: ['a'], base: null, theirs: ['b'] }).resolvable, false,
    'without a base section nothing proves the sides only added');
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function conflictedRepo(ourText, theirText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'append-conflict-908-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  const file = path.join(dir, 'x.test.js');
  fs.writeFileSync(file, "test('base', () => {\n  ok(1)\n})\n");
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'other');
  fs.writeFileSync(file, theirText);
  git(dir, 'commit', '-qam', 'theirs');
  git(dir, 'checkout', '-q', 'main');
  fs.writeFileSync(file, ourText);
  git(dir, 'commit', '-qam', 'ours');
  assert.notEqual(spawnSync('git', ['merge', '--no-edit', 'other'], { cwd: dir }).status, 0, 'fixture must conflict');
  git(dir, 'checkout', '--conflict=diff3', '--', 'x.test.js');
  return { dir, file };
}

test('CLI on a real merge: both sides appended tests at one spot - resolved, both kept', () => {
  const base = "test('base', () => {\n  ok(1)\n})\n";
  const { dir, file } = conflictedRepo(base + "\ntest('a', () => {\n  ok(2)\n})\n", base + "\ntest('b', () => {\n  ok(3)\n})\n");
  const r = spawnSync(process.execPath, [CLI, file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /^(<<<<<<<|\|\|\|\|\|\|\||=======|>>>>>>>)/m);
  assert.match(text, /test\('base'[\s\S]*test\('a'[\s\S]*ok\(2\)[\s\S]*test\('b'[\s\S]*ok\(3\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI on a real merge: both sides edited the same base line (813's shape) - refused, file untouched", () => {
  const { dir, file } = conflictedRepo("test('base', () => {\n  ok(10)\n})\n", "test('base', () => {\n  ok(20)\n})\n");
  const before = fs.readFileSync(file, 'utf8');
  const r = spawnSync(process.execPath, [CLI, file], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not an append-append conflict/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(resolveAppendConflicts(before).resolved, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
