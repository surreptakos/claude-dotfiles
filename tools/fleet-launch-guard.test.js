// fleet-launch-guard: a ticket-fleet Workflow launch from the wrong folder is refused before any agent runs.
// Each case is one of the real incidents named in the guard's header, rebuilt with temp git repos.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GUARD = path.join(__dirname, 'plugin-hook-guards', 'fleet-launch-guard.js');

function makeRepo(parent, name) {
  const dir = path.join(parent, name);
  fs.mkdirSync(path.join(dir, '.claude', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sub', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'workflows', 'ticket-fleet.js'), '// fleet\n');
  execFileSync('git', ['init', '-q', dir]);
  return fs.realpathSync(dir);
}

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-guard-')));
const cockpit = makeRepo(home, 'cockpit');
const dotfiles = makeRepo(home, 'dotfiles');
const cockpitScript = path.join(cockpit, '.claude', 'workflows', 'ticket-fleet.js');

function run(cwd, toolInput) {
  const r = spawnSync('node', [GUARD], { input: JSON.stringify({ cwd, tool_name: 'Workflow', tool_input: toolInput }), encoding: 'utf8' });
  assert.equal(r.status, 0, 'the hook itself never fails the call: ' + r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

test('allows a launch from the top of the repo that holds the fleet script', () => {
  assert.equal(run(cockpit, { scriptPath: cockpitScript, args: {} }), null);
  assert.equal(run(cockpit, { scriptPath: '.claude/workflows/ticket-fleet.js' }), null, 'relative path from the repo root');
});

test('2026-09-28 incident: session in a folder that is not a git repo is refused, and names the cd', () => {
  const out = run(home, { scriptPath: cockpitScript });
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /not inside a git repository/);
  assert.ok(out.permissionDecisionReason.includes('cd ' + cockpit), out.permissionDecisionReason);
});

test('2026-09-25 incident: session in a subfolder of another repo is refused', () => {
  const out = run(path.join(dotfiles, 'sub', 'deeper'), { scriptPath: cockpitScript });
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /subfolder/);
});

test('session at the top of a different repo than the fleet script is refused', () => {
  const out = run(dotfiles, { scriptPath: cockpitScript });
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /belongs to/);
  assert.ok(out.permissionDecisionReason.includes('cd ' + cockpit));
});

test('a named launch still gets the git-root rules; a script outside any repo skips the repo match', () => {
  assert.equal(run(home, { name: 'ticket-fleet' }).permissionDecision, 'deny');
  const cache = path.join(home, 'plugin-cache', 'ticket-fleet.js');
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, '');
  assert.equal(run(cockpit, { scriptPath: cache }), null);
});

test('other workflows and unparseable input are left alone', () => {
  assert.equal(run(home, { scriptPath: path.join(home, 'other-workflow.js') }), null);
  const r = spawnSync('node', [GUARD], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
