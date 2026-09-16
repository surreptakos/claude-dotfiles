#!/usr/bin/env node
/**
 * node --test tools/repo-memory-load.test.js
 *
 * The SessionStart loader for this repo's committed memory notes (issue 210), and the one
 * invariant the notes themselves have to keep:
 *   - the real index injects as pointers, under the 2KB budget, with the hook line of every note
 *   - index and notes do not drift (a note with no line, a line with no note), and the two
 *     live-tree notes stay deleted
 *   - a note committed without its index line still reaches the next session
 *   - an over-budget index truncates and says so, instead of silently dropping notes
 *   - a repo with no index gets nothing, and the hook still exits 0
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const CLI = path.join(__dirname, 'repo-memory-load.js');
const REPO = path.join(__dirname, '..');
const MEMORY_DIR = path.join(REPO, 'docs', 'agents', 'memory');
const { contextFor } = require('./repo-memory-load.js');

function noteFiles(dir) {
  return fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'MEMORY.md').sort();
}

function indexNames(dir) {
  return fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).split(':')[0].trim())
    .sort();
}

function fakeRepo(lines, notes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-memory-'));
  const dir = path.join(root, 'docs', 'agents', 'memory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), `# memory\n\nprose\n\n${lines.join('\n')}\n`);
  for (const note of notes || []) fs.writeFileSync(path.join(dir, `${note}.md`), 'body\n');
  return root;
}

test('the real index injects every note as a pointer line, under the 2KB budget', () => {
  const context = contextFor(MEMORY_DIR);
  assert.ok(context, 'the repo index must produce a context block');
  assert.ok(Buffer.byteLength(context) <= 2048,
    `injected memory is ${Buffer.byteLength(context)} bytes, over the 2048 budget - shorten hooks`);
  const lines = context.split('\n');
  assert.match(lines[0], /memory — \d+ committed notes, bodies in docs\/agents\/memory\/<name>\.md/);
  assert.ok(!/\(\+\d+ more/.test(context), 'the real index must fit without truncation');
  for (const name of indexNames(MEMORY_DIR)) {
    assert.ok(lines.some((line) => line.startsWith(`- ${name}: `)), `${name} has no hook line`);
  }
  // Pointers, not content: no line carries a paragraph of a note body.
  for (const line of lines.slice(1)) assert.ok(line.length <= 90, `index line too long: ${line}`);
});

test('the index and the note files do not drift, and the live-tree notes stay deleted', () => {
  const files = noteFiles(MEMORY_DIR).map((n) => n.slice(0, -3));
  assert.deepEqual(indexNames(MEMORY_DIR), files,
    'every note needs an index line and every index line needs a note file');
  for (const gone of ['concurrent-sessions-share-one-sync-push',
    'fleet-implementers-edit-the-live-tree']) {
    assert.ok(!files.includes(gone), `${gone} was dropped, not migrated (issue 210)`);
  }
  // No surviving note may still [[link]] to one of the dropped notes. (Links to notes in another
  // project's memory are a different thing and are left alone.)
  for (const file of noteFiles(MEMORY_DIR)) {
    const body = fs.readFileSync(path.join(MEMORY_DIR, file), 'utf8');
    assert.ok(!/\[\[(concurrent-sessions-share-one-sync-push|fleet-implementers-edit-the-live-tree)\]\]/
      .test(body), `${file} still links to a dropped live-tree note`);
  }
});

test('a note committed without its index line still reaches the next session', () => {
  const root = fakeRepo(['- alpha: first'], ['alpha', 'beta-added-in-a-cloud-session']);
  const context = contextFor(path.join(root, 'docs'));
  assert.match(context, /- alpha: first/);
  assert.match(context, /- not in the index yet: beta-added-in-a-cloud-session/);
});

test('an over-budget index truncates and counts what it dropped', () => {
  const lines = [];
  for (let i = 0; i < 80; i += 1) lines.push(`- note-number-${i}: a hook line that costs bytes`);
  const root = fakeRepo(lines, []);
  const context = contextFor(path.join(root, 'docs', 'agents', 'memory'));
  assert.ok(Buffer.byteLength(context) <= 2048);
  assert.match(context, /- \(\+\d+ more — read docs\/agents\/memory\/MEMORY\.md\)/);
});

test('a repo with no index gets nothing and the hook exits 0', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-memory-none-'));
  assert.equal(contextFor(root), null);
  const run = spawnSync(process.execPath, [CLI], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: root }),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), '');
});

test('the hook emits SessionStart additionalContext for this repo', () => {
  const run = spawnSync(process.execPath, [CLI], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: MEMORY_DIR }),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(parsed.hookSpecificOutput.additionalContext, /- state-a-standing-rule-once: /);
});
