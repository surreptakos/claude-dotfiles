#!/usr/bin/env node
/**
 * node --test tools/stopslop.test.js
 *
 * Issue 887: the stopslop-write PostToolUse hook reported ~86 ERROR findings on every edit to
 * `docs/standards/AAC-WR-001.md` - all of them the standard's own quoted or bolded example
 * phrases (Appendix G/H's bulleted register, the "Avoid: ..." lines under each numbered rule,
 * and Rule 167's vocabulary list written out as a sentence), never original AAC prose. Rule 153
 * says this part of the standard "does not reach ... quotations"; `stopslop.py` did not honor
 * that for a controlled copy quoting its own prohibited phrases.
 *
 * Two behaviors pinned by driving the real hook end to end (spawn `stopslop-write.py` with the
 * same stdin JSON shape Claude Code's PostToolUse event sends), the same style as
 * ask-matt-gate-adhd.test.js:
 *
 *   1. An edit to `docs/standards/AAC-WR-001.md` reports 0 findings (exit 0).
 *   2. An edit to an ordinary markdown file that contains "Here's the thing" in plain prose
 *      still reports the finding (exit 2, with the finding on stderr).
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(REPO_ROOT, 'profile', 'claude', 'hooks', 'stopslop-write.py');
const STANDARD = path.join(REPO_ROOT, 'docs', 'standards', 'AAC-WR-001.md');

/** Run the write hook as Claude Code's PostToolUse event would, cwd at the repo root so a
 * relative file_path resolves the same way the hook resolves it in a real session. */
function runHook(filePath) {
  const payload = JSON.stringify({ tool_input: { file_path: filePath } });
  return spawnSync('python3', [HOOK], {
    input: payload,
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
}

test('AAC-WR-001.md: the controlled copy quoting its own prohibited phrases reports 0 findings', () => {
  assert.ok(fs.existsSync(STANDARD), `expected ${STANDARD} to exist`);
  const res = runHook(STANDARD);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}\nstderr: ${res.stderr}`);
  assert.equal(res.stderr.trim(), '');
});

test('an ordinary markdown file using the same phrase in plain prose still reports the finding', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stopslop-write-'));
  const file = path.join(dir, 'notes.md');
  fs.writeFileSync(
    file,
    "# Notes\n\nHere's the thing, the deploy broke because of a stale cache.\n",
    'utf-8',
  );
  const res = runHook(file);
  assert.equal(res.status, 2, `expected exit 2 (blocked), got ${res.status}\nstderr: ${res.stderr}`);
  assert.match(res.stderr, /\[G1\]/);
  assert.match(res.stderr, /Here's the thing/);
  fs.rmSync(dir, { recursive: true, force: true });
});
