#!/usr/bin/env node
/**
 * node --test tools/resolve-stamp-conflict.test.js
 *
 * Issue 318. The resolver has exactly two jobs and each gets a pass case and a fail case:
 * a conflict hunk whose every line is one of the four stamp keys resolves to the default
 * branch's side, and any other hunk survives verbatim while the process exits non-zero.
 * The CLI path is exercised as well as the pure function, because the fleet's deliver stage
 * reads the exit code, not a return value.
 */
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const CLI = path.join(__dirname, 'resolve-stamp-conflict.js');
const { isStampOnly, resolveStampConflicts, STAMP_KEYS } = require('./resolve-stamp-conflict.js');

const STAMP_CONFLICT = [
  '---',
  'name: ticket-fleet',
  'metadata:',
  '<<<<<<< HEAD',
  '  modified: "2026-09-16T04:00:00Z"',
  '  previous-modified: "2026-09-15T22:39:49Z"',
  '  revision: "9"',
  '  content-sha: "aaaaaaaaaaaa"',
  '=======',
  '  modified: "2026-09-16T06:11:02Z"',
  '  previous-modified: "2026-09-16T01:00:00Z"',
  '  revision: "11"',
  '  content-sha: "bbbbbbbbbbbb"',
  '>>>>>>> origin/master',
  '---',
  '',
  '# ticket-fleet',
  '',
].join('\n');

const BODY_CONFLICT = [
  '# ticket-fleet',
  '',
  '<<<<<<< HEAD',
  'The deliver stage pushes the verified branch.',
  '=======',
  'The deliver stage merges the default branch first.',
  '>>>>>>> origin/master',
  '',
].join('\n');

function runCli(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [CLI].concat(args), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: String(err.stdout || ''), stderr: String(err.stderr || '') };
  }
}

function scratch(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-conflict-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return { dir, file };
}

test('the four stamp keys are the ones skill-stamps.py writes', () => {
  assert.deepEqual(STAMP_KEYS, ['modified', 'previous-modified', 'revision', 'content-sha']);
  assert.equal(isStampOnly(['  revision: "3"', '  content-sha: "abc"']), true);
  assert.equal(isStampOnly(['  description: x']), false);
  assert.equal(isStampOnly([]), false, 'an empty side is a deletion, not a stamp rotation');
});

test('a hunk of nothing but stamp keys resolves to the default branch side', () => {
  const r = resolveStampConflicts(STAMP_CONFLICT, 'theirs');
  assert.equal(r.resolved, 1);
  assert.deepEqual(r.unresolved, []);
  assert.ok(!/<<<<<<<|=======|>>>>>>>/.test(r.text), 'no conflict markers may survive');
  assert.match(r.text, /revision: "11"/, "theirs is origin/master's side");
  assert.ok(!r.text.includes('revision: "9"'), "the branch's stamp values are dropped");
  assert.match(r.text, /name: ticket-fleet/, 'surrounding lines are untouched');
});

test('--side ours keeps the branch stamps instead', () => {
  const r = resolveStampConflicts(STAMP_CONFLICT, 'ours');
  assert.equal(r.resolved, 1);
  assert.match(r.text, /revision: "9"/);
});

test('a hunk with any non-stamp line is left byte-for-byte untouched', () => {
  const r = resolveStampConflicts(BODY_CONFLICT, 'theirs');
  assert.equal(r.resolved, 0);
  assert.deepEqual(r.unresolved, [{ line: 3 }]);
  assert.equal(r.text, BODY_CONFLICT, 'a non-stamp hunk must survive verbatim, markers included');
});

test('a file with both hunk classes resolves the stamp one and keeps the other', () => {
  const mixed = STAMP_CONFLICT + BODY_CONFLICT;
  const r = resolveStampConflicts(mixed, 'theirs');
  assert.equal(r.resolved, 1);
  assert.equal(r.unresolved.length, 1);
  assert.match(r.text, /revision: "11"/);
  assert.ok(r.text.includes('The deliver stage merges the default branch first.'));
  assert.ok(r.text.includes('<<<<<<< HEAD'), 'the real merge is still flagged for a human');
});

test('CLI exits 0 and rewrites the file when every hunk is stamp-only', () => {
  const { dir, file } = scratch('SKILL.md', STAMP_CONFLICT);
  const res = runCli([file], dir);
  assert.equal(res.code, 0, res.stderr);
  const after = fs.readFileSync(file, 'utf8');
  assert.ok(!/<<<<<<</.test(after));
  assert.match(after, /revision: "11"/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits non-zero and changes nothing when a hunk sits outside the stamp block', () => {
  const { dir, file } = scratch('SKILL.md', BODY_CONFLICT);
  const res = runCli([file], dir);
  assert.equal(res.code, 1, 'a conflict outside the stamp block must be a non-zero exit');
  assert.match(res.stderr, /outside the stamp block/);
  assert.equal(fs.readFileSync(file, 'utf8'), BODY_CONFLICT);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits 0 on a file with no conflict markers and 2 on a bad invocation', () => {
  const { dir, file } = scratch('SKILL.md', 'metadata:\n  revision: "4"\n');
  assert.equal(runCli([file], dir).code, 0);
  assert.equal(runCli([], dir).code, 2, 'no files named is a usage error');
  assert.equal(runCli([file, '--side', 'sideways'], dir).code, 2, 'an unknown --side is a usage error');
  fs.rmSync(dir, { recursive: true, force: true });
});
