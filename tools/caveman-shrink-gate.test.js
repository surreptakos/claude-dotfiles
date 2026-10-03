#!/usr/bin/env node
/**
 * node --test tools/caveman-shrink-gate.test.js
 *
 * Issue 1363: caveman's shrink hook rewrote a worker's `git fetch origin` to
 * `caveman shrink -- git fetch origin`, and the worktree-isolation guard refused it ("runs caveman
 * with a git command among its operands"). .claude/hooks/caveman-shrink-gate.js sits in front of the
 * caveman hook. Pinned here, against a stub caveman hook that logs every call and answers with a
 * rewrite:
 *
 *   - in a linked worktree, `git fetch origin` reaches the guard as typed (no rewrite, caveman never
 *     called), and so does a git command aimed at another tree - the gate grants nothing, so the
 *     guard still judges, and refuses, the write outside the worktree;
 *   - every other command, and git outside a linked worktree, still goes to caveman unchanged;
 *   - --install gates caveman's bare entry and stays at one entry after `caveman enable` re-adds it.
 */
'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const GATE = path.resolve(__dirname, '..', '.claude', 'hooks', 'caveman-shrink-gate.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-shrink-gate-'));
  const main = path.join(root, 'repo');
  const worktree = path.join(main, '.claude', 'worktrees', 'w0');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${main}/.git/worktrees/w0\n`);
  const log = path.join(root, 'caveman.log');
  const stub = path.join(root, 'caveman-stub.js');
  fs.writeFileSync(stub, [
    "const fs = require('fs');",
    'const evt = JSON.parse(fs.readFileSync(0, "utf8"));',
    `fs.appendFileSync(${JSON.stringify(log)}, evt.tool_input.command + '\\n');`,
    'process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse",',
    '  permissionDecision: "allow", updatedInput: { command: "caveman shrink -- " + evt.tool_input.command } } }));',
  ].join('\n'));
  return { main, worktree, log, stub };
}

function hook(f, command, cwd) {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd });
  const r = spawnSync(process.execPath, [GATE, process.execPath, f.stub, 'shrink-hook'], { input, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const calls = fs.existsSync(f.log) ? fs.readFileSync(f.log, 'utf8') : '';
  return { stdout: r.stdout, calls };
}

test('in a linked worktree git runs as typed: fetch passes the guard, a write outside the tree is still the guard\'s to refuse', () => {
  const f = fixture();
  const fetch = hook(f, 'git fetch origin', path.join(f.worktree, 'src'));
  assert.equal(fetch.stdout, '', 'no rewrite: the guard sees the plain `git fetch origin` it accepts');
  const outside = hook(f, `git -C ${f.main} checkout -b stray`, f.worktree);
  assert.equal(outside.stdout, '', 'no rewrite and no permissionDecision: the guard still judges, and refuses, the write');
  assert.equal(outside.calls, '', 'caveman never saw either git command');
});

test('every other command, and git outside a linked worktree, still goes to the caveman hook unchanged', () => {
  const f = fixture();
  const ls = hook(f, 'ls -la', f.worktree);
  assert.match(ls.stdout, /"command":"caveman shrink -- ls -la"/);
  const log = hook(f, 'git log --oneline -60', f.main);
  assert.match(log.stdout, /"command":"caveman shrink -- git log --oneline -60"/);
  assert.equal(log.calls, 'ls -la\ngit log --oneline -60\n');
});

test('--install gates caveman\'s bare entry and holds one entry after `caveman enable` re-adds it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-shrink-gate-install-'));
  const settings = path.join(dir, 'settings.json');
  const bare = { hooks: [{ type: 'command', command: "'/root/.local/bin/caveman' shrink-hook", timeout: 30 }] };
  const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node /x/governance.js' }] };
  const write = (pre) => fs.writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: pre } }));
  const install = () => spawnSync(process.execPath, [GATE, '--install', settings, '/root/.claude/hooks/caveman-shrink-gate.js'], { encoding: 'utf8' });
  write([other, bare]);
  assert.equal(install().status, 0);
  const once = JSON.parse(fs.readFileSync(settings, 'utf8')).hooks.PreToolUse;
  const gated = 'node "/root/.claude/hooks/caveman-shrink-gate.js" \'/root/.local/bin/caveman\' shrink-hook';
  assert.deepEqual(once.map((g) => g.hooks[0].command), ['node /x/governance.js', gated]);
  write([...once, JSON.parse(JSON.stringify(bare))]);
  assert.equal(install().status, 0);
  const twice = JSON.parse(fs.readFileSync(settings, 'utf8')).hooks.PreToolUse;
  assert.deepEqual(twice, once);
});
