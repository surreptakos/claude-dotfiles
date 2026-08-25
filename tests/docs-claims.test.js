#!/usr/bin/env node
/**
 * Docs claims-audit tripwire: every fact pinned in docs/claims.json must still be true.
 *
 * Thin wrapper over the shared engine at ~/.claude/skills/consistency-audit/claims-audit.js —
 * the installed copy the sync pipeline lands on every machine (this repo also carries its mirror
 * at claude/skills/consistency-audit/claims-audit.js, and tests/claims-audit.test.js is that
 * ENGINE's own unit suite; this file is different — it audits THIS repo's docs). The engine runs
 * from repo root, reads docs/claims.json, and exits 0 clean / 1 findings (one tab-separated line
 * each: "<claimId>\t<doc>:<line>\t<message>") / 2 config error.
 *
 * Wired into .claude/session.json's test command, so the tripwire fires on every full test run.
 */

'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(os.homedir(), '.claude', 'skills', 'consistency-audit', 'claims-audit.js');

test('docs/claims.json verifies clean', () => {
  assert.ok(
    fs.existsSync(ENGINE),
    'claims-audit engine missing — run the dotfiles sync (sync.ps1 -Mode pull in claude-dotfiles); expected at ' + ENGINE
  );
  try {
    const out = execFileSync(process.execPath, [ENGINE], { cwd: ROOT, encoding: 'utf8' });
    assert.match(out, /verified clean/);
  } catch (err) {
    assert.fail(
      'docs/claims.json audit failed (engine exit ' + err.status + '):\n' +
      String(err.stdout || '') + String(err.stderr || '')
    );
  }
});
