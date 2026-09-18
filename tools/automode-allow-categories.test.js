#!/usr/bin/env node
/**
 * node --test tools/automode-allow-categories.test.js
 *
 * Issue 543. The `autoMode.allow` ruling is prose a classifier reads, and every sentence in it was
 * bought with a refused action: the 2026-09-15 text sanctioned an *unattended* session and named
 * seven categories, and an attended cloud session was still refused five times, twice more inside
 * its fleet deliver agents. This suite keeps what those refusals added — the scope that covers an
 * attended session, the names of every category observed, and the three readings the refusals
 * turned on — in BOTH copies of the rule, and keeps the two copies identical.
 *
 * The copies are `.claude/settings.json` (this repo) and the harness template
 * `agents/skills/project-harness/templates/claude-settings.json` (every harnessed repo, via step
 * 16). There is no third: `templates/add-cloud-plugin.js` reads the template rather than repeating
 * it, and this suite pins that too — a re-introduced literal is a copy nobody diffs.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const REPO_SETTINGS = path.join(ROOT, '.claude', 'settings.json');
const TEMPLATE = path.join(ROOT, 'agents', 'skills', 'project-harness', 'templates',
                           'claude-settings.json');
const INSTALLER = path.join(ROOT, 'agents', 'skills', 'project-harness', 'templates',
                            'add-cloud-plugin.js');

const ruling = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).autoMode.allow[0];

/** Every category name a cloud session on this repo has been refused under (issue 543's table). */
const CATEGORIES = [
  'Self-Modification', 'Data Exfiltration', 'Exfil Scouting', 'External System Writes',
  'Destructive Operations', 'Irreversible Deletion', 'Irreversible Operations',
  'Merge Without Review', 'Modify Shared Resources', 'Interfere With Workloads',
  'Instruction Poisoning', 'Create Unsafe Agents', 'Auto-Mode Bypass', 'Security Weaken',
  'Credential Handling',
];

test('.claude/settings.json carries the issue 543 rule at all', () => {
  assert.match(ruling(REPO_SETTINGS), /issue 543/,
    'this repo is still running the superseded 245 text. Land it with one command — ' +
    '`node agents/skills/project-harness/templates/add-cloud-plugin.js .` — which prepends the ' +
    'template rule and keeps the CRLF blob (issue 87). The session that drafted the text could ' +
    'not: every write to this path was refused [Instruction Poisoning] / [Self-Modification], ' +
    'logged in docs/cloud-permission-posture-2026-09-17.md.');
});

for (const file of [REPO_SETTINGS, TEMPLATE]) {
  const where = path.relative(ROOT, file);

  test(`${where}: the rule covers an attended session, not only an unattended one`, () => {
    const text = ruling(file);
    assert.match(text, /ATTENDED OR UNATTENDED/,
      'the 245 text sanctioned "an unattended cloud session"; an attended one read as outside it');
    assert.match(text, /Attendance is not a condition to check/);
    assert.match(text, /fleet worker, sub-agent or child session/,
      'the fleet deliver agents were refused too — the rule has to name what a session spawns');
  });

  test(`${where}: every classifier category seen since the 245 ruling is named`, () => {
    const text = ruling(file);
    for (const category of CATEGORIES) {
      assert.ok(text.includes(category), `${where} no longer names ${category}`);
    }
    assert.match(text, /any successor category/,
      'the catch-all stays, but it demonstrably did not reach the eight names above');
  });

  test(`${where}: MCP calls, message text and a read-only neighbour are settled explicitly`, () => {
    const text = ruling(file);
    assert.match(text, /mcp__github__\*/);
    assert.match(text, /mcp__Claude_Code_Remote__\*/);
    assert.match(text, /TEXT of a scheduling or hand-off message/,
      'a send_later whose message said to land what is green was refused as a merge');
    assert.match(text, /is a read, not a merge/,
      'a read-only gh api query sharing a turn with a merge was refused as one');
  });
}

test('the repo rule and the harness template carry the same text', () => {
  assert.equal(ruling(REPO_SETTINGS), ruling(TEMPLATE),
    'a harnessed repo must receive the rule this repo runs under, to the byte');
});

test('the installer reads the rule from the template instead of repeating it', () => {
  const src = fs.readFileSync(INSTALLER, 'utf8');
  assert.match(src, /AUTOMODE_ALLOW_RULING\s*=\s*\n?\s*JSON\.parse\(fs\.readFileSync\(path\.join\(__dirname, 'claude-settings\.json'\)/);
  assert.ok(!/const AUTOMODE_ALLOW_RULING = 'Ruling \(Dan/.test(src),
    'a second hand-maintained copy of the rule is a copy nobody diffs (issue 336)');
});

test('.claude/settings.json is still a CRLF blob (issue 87)', () => {
  const bytes = fs.readFileSync(REPO_SETTINGS);
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      assert.equal(bytes[i - 1], 0x0d,
        `bare LF at byte ${i}: a Windows text-mode writer would rewrite the file and reopen the ` +
        'phantom " M" the -text pin exists to stop');
    }
  }
});
