#!/usr/bin/env node
/**
 * Docs claims-audit tripwire: every fact pinned in docs/claims.json must still be true.
 *
 * Thin wrapper over the shared engine. It checks two paths, in order: ~/.claude/skills/
 * consistency-audit/claims-audit.js (present in a cloud container; a desktop no longer gets it
 * since issue 734) and this repo's own copy at aac-skills/consistency-audit/claims-audit.js, which
 * is always there. It does not look in the plugin cache: that lookup is the consumer recipe in
 * aac-skills/consistency-audit/claims-tripwire.md, and tests/claims-tripwire-recipe.test.js runs
 * it. tests/claims-audit.test.js is the ENGINE's own unit suite; this file is different — it
 * audits THIS repo's docs. The engine runs
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
// Prefer the skills copy under ~/.claude (a container has it); fall back to this repo's own copy
// so a fresh clone, a desktop or a CI runner with no ~/.claude/skills still audits. Only a checkout
// with NEITHER file fails.
const HOME_ENGINE = path.join(os.homedir(), '.claude', 'skills', 'consistency-audit', 'claims-audit.js');
const MIRROR_ENGINE = path.join(ROOT, 'aac-skills', 'consistency-audit', 'claims-audit.js');
const ENGINE = fs.existsSync(HOME_ENGINE) ? HOME_ENGINE : MIRROR_ENGINE;

test('docs/claims.json verifies clean', () => {
  assert.ok(
    fs.existsSync(ENGINE),
    'claims-audit engine missing — tried ' + HOME_ENGINE + ' and ' + MIRROR_ENGINE + '; restore the checkout\'s aac-skills/consistency-audit/claims-audit.js'
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
