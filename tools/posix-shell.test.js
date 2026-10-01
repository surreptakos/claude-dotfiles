#!/usr/bin/env node
/**
 * node --test tools/posix-shell.test.js
 *
 * PR 1097: seven test files spawned bare `bash` or `sh`. From Windows PowerShell neither is on
 * PATH, so spawnSync returned status null and 25 tests failed with "hook exited null", which
 * made the ticket-fleet deliverer refuse a green branch. Every shell spawn in a test now goes
 * through tools/posix-shell.js. This file fails when a test spawns a bare shell again.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { shell } = require('./posix-shell.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const BARE_SHELL = /\b(?:spawnSync|spawn|execFileSync|execFile)\(\s*['"](?:ba)?sh['"]/;

function testFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(full));
    else if (/\.test\.[cm]?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('no test spawns a bare bash or sh; each goes through tools/posix-shell.js', () => {
  const offenders = [];
  for (const dir of ['tests', 'tools', 'aac-skills']) {
    for (const file of testFiles(path.join(REPO_ROOT, dir))) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (BARE_SHELL.test(line)) offenders.push(`${path.relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(offenders, [], 'use shell(name).run(...) from tools/posix-shell.js instead:\n' + offenders.join('\n'));
});

test('a missing shell is a named skip, never a null exit status', () => {
  const none = shell('no-such-shell-for-posix-shell-test');
  assert.equal(none.path, null);
  assert.match(none.skip, /^no no-such-shell-for-posix-shell-test: not on PATH/);
});

// A child that exits without reading its stdin (a hook's local-session early exit) used to race
// spawnSync's piped `input` write, which failed with EPIPE (Linux) or EOF (Windows) after the
// child already ran; CI saw it as an intermittent "did not start: spawnSync bash EPIPE" in
// tools/caveman-bootstrap-hook.test.js (issue 1143). 1 MiB outgrows any pipe buffer, so the child
// wins that race every time. `input` is a file now: no write, so no error to classify.
test('a child that ignores its stdin returns its exit status with no pipe error', { skip: shell('bash').skip }, () => {
  const r = shell('bash').run(['-c', 'exit 3'], { input: 'x'.repeat(1 << 20), encoding: 'utf8' });
  assert.equal(r.error, undefined);
  assert.equal(r.status, 3);
});

test('a child that reads its stdin gets every byte of `input`', { skip: shell('bash').skip }, () => {
  const input = 'café '.repeat(1 << 17);
  const r = shell('bash').run(['-c', 'cat'], { input, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, input);
});
