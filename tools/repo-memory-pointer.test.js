#!/usr/bin/env node
/**
 * node --test tools/repo-memory-pointer.test.js
 *
 * The live-tree half of issue 210: the PC's per-project memory directory for THIS repo is emptied
 * to a pointer file, so the committed notes under docs/agents/memory/ are the only copy.
 *   - a directory full of notes is archived first, then replaced by the pointer
 *   - a second run changes nothing (both sync modes call this on every sync)
 *   - another project's memory is never touched
 *   - --dry-run reports without writing
 *   - sync.ps1 calls it in both modes and lib/manifest.ps1 stops mirroring the slug
 *
 * The last test stands in for a restore-test check: this container has no PowerShell (the harness
 * refuses to launch pwsh), so the wiring is pinned as text here rather than executed.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const CLI = path.join(__dirname, 'repo-memory-pointer.js');
const REPO = path.join(__dirname, '..');
const { run, POINTER_TEXT } = require('./repo-memory-pointer.js');

const DOTFILES_SLUG = 'C--Users-Dan-Claude-Projects-Meta-claude-dotfiles';
const OTHER_SLUG = 'C--Users-Dan-Claude-Projects-Meta-task-management';

function fakeHome(notes) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-memory-pointer-'));
  for (const slug of [DOTFILES_SLUG, OTHER_SLUG]) {
    const dir = path.join(home, '.claude', 'projects', slug, 'memory');
    fs.mkdirSync(dir, { recursive: true });
    for (const note of notes) fs.writeFileSync(path.join(dir, note), `body of ${note}\n`);
  }
  return home;
}

function memoryDir(home, slug) {
  return path.join(home, '.claude', 'projects', slug, 'memory');
}

test('the notes are archived, then the directory holds only the pointer', () => {
  const home = fakeHome(['MEMORY.md', 'a-note.md', 'another-note.md']);
  const backup = path.join(home, 'backup');
  const lines = run({ home, homeExplicit: true, backup, dryRun: false });
  assert.equal(lines.length, 2, lines.join(' | '));
  assert.match(lines[0], /archived 3 note\(s\)/);

  const dir = memoryDir(home, DOTFILES_SLUG);
  assert.deepEqual(fs.readdirSync(dir), ['MEMORY.md']);
  const pointer = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8');
  assert.equal(pointer, POINTER_TEXT);
  assert.match(pointer, /docs\/agents\/memory\//);
  // Nothing is lost: every removed note is readable in the archive.
  assert.deepEqual(fs.readdirSync(path.join(backup, DOTFILES_SLUG)).sort(),
    ['MEMORY.md', 'a-note.md', 'another-note.md']);
});

test('a second run is a no-op, and another project keeps its memory', () => {
  const home = fakeHome(['MEMORY.md', 'a-note.md']);
  run({ home, homeExplicit: true, backup: path.join(home, 'b1'), dryRun: false });
  const after = fs.readFileSync(path.join(memoryDir(home, DOTFILES_SLUG), 'MEMORY.md'), 'utf8');

  const second = run({ home, homeExplicit: true, backup: path.join(home, 'b2'), dryRun: false });
  assert.deepEqual(second, [], 'an already-pointed directory must report nothing');
  assert.equal(fs.existsSync(path.join(home, 'b2')), false, 'no second archive');
  assert.equal(fs.readFileSync(path.join(memoryDir(home, DOTFILES_SLUG), 'MEMORY.md'), 'utf8'), after);

  assert.deepEqual(fs.readdirSync(memoryDir(home, OTHER_SLUG)).sort(), ['MEMORY.md', 'a-note.md'],
    'only the claude-dotfiles slug is repo-owned');
});

test('--dry-run reports and writes nothing, and the CLI exits 0', () => {
  const home = fakeHome(['MEMORY.md', 'a-note.md']);
  const cli = spawnSync(process.execPath, [CLI, '--home', home, '--dry-run'], { encoding: 'utf8' });
  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /repo-memory: would archive 2 note\(s\)/);
  assert.match(cli.stdout, /repo-memory: would point /);
  assert.deepEqual(fs.readdirSync(memoryDir(home, DOTFILES_SLUG)).sort(), ['MEMORY.md', 'a-note.md']);
});

test('a home with no projects directory is not an error', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-memory-empty-'));
  assert.deepEqual(run({ home, homeExplicit: true, backup: null, dryRun: false }), []);
});

test('both sync modes call the pointer, and the slug is no longer mirrored', () => {
  const sync = fs.readFileSync(path.join(REPO, 'sync.ps1'), 'utf8');
  const manifest = fs.readFileSync(path.join(REPO, 'lib', 'manifest.ps1'), 'utf8');
  assert.match(sync, /function Invoke-RepoMemoryPointer/);
  assert.match(sync, /tools\\repo-memory-pointer\.js/);
  // Once in push (no backup dir of its own) and once in pull (into the pull's backup).
  assert.equal((sync.match(/^\s*Invoke-RepoMemoryPointer(\s|$)/gm) || []).length, 2,
    'push and pull must each call it');
  assert.match(sync, /Invoke-RepoMemoryPointer -BackupRoot \$backup/);
  assert.match(manifest, /\$script:RepoOwnedMemorySuffix = '-claude-dotfiles'/);
  assert.match(manifest, /-and -not \(Test-RepoOwnedMemory -Slug \$_\.Name\)/);
  // CRLF is load-bearing for these two files (CLAUDE.md, issue 87 neighbourhood).
  for (const rel of ['sync.ps1', path.join('lib', 'manifest.ps1')]) {
    const raw = fs.readFileSync(path.join(REPO, rel));
    assert.ok(!/[^\r]\n/.test(raw.toString('latin1')), `${rel} must stay CRLF throughout`);
  }
});
