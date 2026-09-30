#!/usr/bin/env node
/**
 * node --test tools/orchestrator-tree-guard.test.js
 *
 * The orchestrator tree guard (ported by issue 1020). The fleet-side wiring, driven end to end
 * against this tool, is in tools/ticket-fleet-branch.test.js; this file pins the tool's own rules:
 *   - a staged edit to a tracked file is reported, then restored from HEAD with the tree's copy
 *     kept in the quarantine
 *   - restore refuses a path that was dirty before the run (the operator's)
 *   - check with no baseline is exit 2, never a pass
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const { run } = require('./orchestrator-tree-guard.js');

function sink() {
  const out = { text: '', write(s) { out.text += s; return true; } };
  return out;
}
function guard(...argv) {
  const stdout = sink(), stderr = sink();
  const code = run(argv, { stdout, stderr });
  return { code, json: stdout.text ? JSON.parse(stdout.text) : null, stderr: stderr.text };
}

function scratchRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-guard-1020-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  git('init', '-q');
  git('config', 'core.autocrlf', 'false'); // a Windows desktop's global autocrlf would rewrite the checkout
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'original\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'n\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return { dir, git, state: path.join(dir, '.git', 'tg', 'state.json') };
}

test('a staged edit to a tracked file is reported, then restored from HEAD with the copy quarantined', (t) => {
  const { dir, git, state } = scratchRepo(t);
  assert.equal(guard('baseline', '--cwd', dir, '--state', state).code, 0);

  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'from agent/issue-9-attempt1\n');
  git('add', 'CLAUDE.md');
  const check = guard('check', '--cwd', dir, '--state', state, '--label', 'verify-attempt1', '--ticket', '9');
  assert.equal(check.code, 1);
  assert.deepEqual(check.json.newEntries.map((e) => `${e.status} ${e.path}`), ['M  CLAUDE.md']);

  const restore = guard('restore', '--cwd', dir, '--state', state, '--path', 'CLAUDE.md');
  assert.equal(restore.code, 0, restore.stderr);
  assert.equal(restore.json.restored[0].action, 'checkout-head');
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'original\n');
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(fs.readFileSync(restore.json.restored[0].quarantined, 'utf8'), 'from agent/issue-9-attempt1\n');
  assert.ok(!restore.json.quarantineDir.includes('\\'), 'paths printed for a bash command use forward slashes');
});

test('restore refuses a path that was dirty before the run started', (t) => {
  const { dir, state } = scratchRepo(t);
  fs.writeFileSync(path.join(dir, 'notes.md'), 'operator edit\n');
  assert.equal(guard('baseline', '--cwd', dir, '--state', state).code, 0);
  const restore = guard('restore', '--cwd', dir, '--state', state, '--path', 'notes.md');
  assert.equal(restore.code, 2);
  assert.match(restore.stderr, /operator's/);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'), 'operator edit\n');
});

test('check with no baseline is could-not-audit (exit 2), never a pass', (t) => {
  const { dir, state } = scratchRepo(t);
  const check = guard('check', '--cwd', dir, '--state', state, '--label', 'x', '--ticket', '1');
  assert.equal(check.code, 2);
  assert.match(check.stderr, /no run baseline/);
});

// Issue 1041: the desktop scheduled task runs the fleet from `.claude/worktrees/<name>`, where `.git`
// is a FILE; the fleet's default `--state-dir .git/orchestrator-tree-guard` hit ENOTDIR on mkdir and
// the wave aborted before Scout. The relative `.git/...` now names the worktree's real git dir.
test('baseline with the default .git/ state dir succeeds in a linked worktree: state under the real git dir, git status clean', (t) => {
  const { dir, git } = scratchRepo(t);
  const wt = path.join(dir, '.claude', 'worktrees', 'wave');
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '.claude/worktrees/\n'); // as a real repo ignores them
  git('worktree', 'add', '-q', '-b', 'wave', wt);
  assert.ok(fs.statSync(path.join(wt, '.git')).isFile(), 'fixture: a linked worktree\'s .git is a file');
  const realGitDir = spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt, encoding: 'utf8' }).stdout.trim();

  const base = guard('baseline', '--cwd', wt, '--state-dir', '.git/orchestrator-tree-guard');
  assert.equal(base.code, 0, base.stderr);
  assert.equal(path.resolve(path.dirname(base.json.statePath)), path.resolve(realGitDir, 'orchestrator-tree-guard'));
  assert.ok(fs.existsSync(base.json.statePath));
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' });
  assert.equal(status.stdout, '', 'the baseline must never show in the worktree\'s git status');
  assert.equal(git('status', '--porcelain'), '', 'nor in the main checkout\'s');

  // The printed statePath drives the checks that follow, as the fleet hands it back.
  assert.equal(guard('check', '--cwd', wt, '--state', base.json.statePath, '--label', 'x', '--ticket', '1').code, 0);
});
