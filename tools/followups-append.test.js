#!/usr/bin/env node
/**
 * node --test tools/followups-append.test.js
 *
 * Covers issue 882: the ticket-fleet Report phase's discoveries writer overwrote FOLLOW-UPS.md
 * with only the new run's section, deleting seven earlier runs. `appendFollowupsSection` replaces
 * the freeform "append to this file yourself" instruction with a pure function that can only ever
 * concatenate onto the end of the existing text, so its output starts with its input by
 * construction - the pure-function form of "produces a git diff --numstat with 0 deletions".
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'followups-append.js');
const { buildHeading, appendFollowupsSection, main } = require('./followups-append.js');

test('buildHeading shapes the run heading', () => {
  assert.equal(buildHeading('6ab72ca0', '2026-09-26'), '## Run 2026-09-26 (ticket-fleet 6ab72ca0)');
});

test('appendFollowupsSection on an empty/missing file returns just the new section', () => {
  for (const empty of ['', null, undefined]) {
    const { text, heading } = appendFollowupsSection(empty, 'r1', ['first finding'], '2026-01-01');
    assert.equal(heading, '## Run 2026-01-01 (ticket-fleet r1)');
    assert.equal(text, '## Run 2026-01-01 (ticket-fleet r1)\n\n- first finding\n');
  }
});

test('appending run B never loses run A - two runs back to back on a fixture', () => {
  const runA = appendFollowupsSection('', 'runA', ['A finding one', 'A finding two'], '2026-01-01');
  const afterA = runA.text;

  const runB = appendFollowupsSection(afterA, 'runB', ['B finding one'], '2026-01-02');
  const afterB = runB.text;

  // Run A's section is still present, byte for byte, after run B's append.
  assert.ok(afterB.startsWith(afterA), "run B's append must not touch a single byte of run A's section");
  assert.match(afterB, /## Run 2026-01-01 \(ticket-fleet runA\)/);
  assert.match(afterB, /- A finding one/);
  assert.match(afterB, /- A finding two/);
  assert.match(afterB, /## Run 2026-01-02 \(ticket-fleet runB\)/);
  assert.match(afterB, /- B finding one/);
});

test('the append produces 0 deletions - output always starts with input (pure-function equivalent of git diff --numstat)', () => {
  const fixtures = [
    '',
    'existing content with no trailing newline',
    'existing content with one trailing newline\n',
    'existing content with a blank line already at the end\n\n',
    '# FOLLOW-UPS\n\n## Run 2025-01-01 (ticket-fleet abc)\n\n- an old bullet\n',
  ];
  for (const before of fixtures) {
    const { text } = appendFollowupsSection(before, 'r', ['new bullet'], '2026-01-01');
    assert.ok(text.startsWith(before), `output must start with input for fixture ${JSON.stringify(before)}`);
    assert.ok(text.length > before.length, 'the append must actually add bytes');
  }
});

test('rejects an empty discoveries list and a non-string/blank entry', () => {
  assert.throws(() => appendFollowupsSection('', 'r', [], '2026-01-01'), /non-empty array/);
  assert.throws(() => appendFollowupsSection('', 'r', ['ok', '   '], '2026-01-01'), /non-empty string/);
  assert.throws(() => appendFollowupsSection('', 'r', ['ok', 5], '2026-01-01'), /non-empty string/);
});

test('CLI main(): appends to a fixture file across two invocations without losing the first run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'followups-append-test-'));
  const followupsFile = path.join(dir, 'FOLLOW-UPS.md');
  const bulletsA = path.join(dir, 'bullets-a.json');
  const bulletsB = path.join(dir, 'bullets-b.json');
  fs.writeFileSync(bulletsA, JSON.stringify(['run A bullet one', 'run A bullet two']));
  fs.writeFileSync(bulletsB, JSON.stringify(['run B bullet one']));

  const exitA = main([followupsFile, 'runA', bulletsA, '--date', '2026-01-01']);
  assert.equal(exitA, 0);
  const afterA = fs.readFileSync(followupsFile, 'utf8');
  assert.match(afterA, /## Run 2026-01-01 \(ticket-fleet runA\)/);
  assert.match(afterA, /- run A bullet one/);

  const exitB = main([followupsFile, 'runB', bulletsB, '--date', '2026-01-02']);
  assert.equal(exitB, 0);
  const afterB = fs.readFileSync(followupsFile, 'utf8');
  assert.ok(afterB.startsWith(afterA), "run B's CLI append must not touch run A's committed section");
  assert.match(afterB, /## Run 2026-01-02 \(ticket-fleet runB\)/);
  assert.match(afterB, /- run B bullet one/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI main(): a git diff over the appended file shows 0 deletions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'followups-append-git-test-'));
  const followupsFile = path.join(dir, 'FOLLOW-UPS.md');
  fs.writeFileSync(followupsFile, '## Run 2025-01-01 (ticket-fleet old)\n\n- an old bullet\n');

  const init = spawnSync('git', ['init', '-q'], { cwd: dir });
  assert.equal(init.status, 0);
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'test']);
  spawnSync('git', ['-C', dir, 'add', '-A']);
  spawnSync('git', ['-C', dir, 'commit', '-q', '-m', 'seed']);

  const bullets = path.join(dir, 'bullets.json');
  fs.writeFileSync(bullets, JSON.stringify(['a new finding']));
  const exit = main([followupsFile, 'newRun', bullets, '--date', '2026-01-02']);
  assert.equal(exit, 0);

  const diff = spawnSync('git', ['-C', dir, 'diff', '--numstat', '--', 'FOLLOW-UPS.md'], { encoding: 'utf8' });
  assert.equal(diff.status, 0);
  // numstat is "<added>\t<deleted>\t<path>"; the deleted column must be 0.
  const [, deleted] = diff.stdout.trim().split(/\s+/);
  assert.equal(deleted, '0', `expected 0 deletions, got numstat line: ${diff.stdout.trim()}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('main() rejects missing arguments with exit 2', () => {
  assert.equal(main([]), 2);
  assert.equal(main(['/tmp/x'] ), 2);
});
