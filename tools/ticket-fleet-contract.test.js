#!/usr/bin/env node
/**
 * node --test tools/ticket-fleet-contract.test.js
 *
 * Covers issue 333: forked `.claude/workflows/ticket-fleet.js` copies and the
 * runbooks that launch them went stale silently whenever the plugin's arg list
 * moved. The contract is versioned now, so a launch at the wrong version fails
 * naming both sides and the ripple list - and the ripple list itself is pinned
 * here against the SKILL.md that documents it and the script that enforces it.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const FLEET_SCRIPT = path.join(REPO_ROOT, 'aac-skills', 'ticket-fleet', 'ticket-fleet.js');
const FLEET_SKILL = path.join(REPO_ROOT, 'aac-skills', 'ticket-fleet', 'SKILL.md');
const contract = require('./ticket-fleet-contract.js');
const { CONTRACT_VERSION, FORKS, RUNBOOKS, checkLaunchArgs, contractVersionOf, auditForkFiles } = contract;

const GOOD = { contractVersion: CONTRACT_VERSION, runId: 'r1', invocationId: 'i1' };

test('a launch at the current contract is accepted', () => {
  assert.deepEqual(checkLaunchArgs(GOOD), { ok: true });
  assert.deepEqual(checkLaunchArgs(Object.assign({}, GOOD, { contractVersion: String(CONTRACT_VERSION) })), { ok: true },
    'a contractVersion passed as a string must still match');
});

test('a launcher that passes no contractVersion is told it is at an older contract', () => {
  const r = checkLaunchArgs({ runId: 'r1', invocationId: 'i1' });
  assert.equal(r.ok, false);
  assert.match(r.error, /contract mismatch/, 'the failure must read as a contract mismatch, not a missing argument');
  assert.match(r.error, new RegExp(`contract v${CONTRACT_VERSION}`));
  assert.match(r.error, /older contract/);
});

test('a launcher declaring another version is told both versions', () => {
  const r = checkLaunchArgs(Object.assign({}, GOOD, { contractVersion: 1 }));
  assert.equal(r.ok, false);
  assert.match(r.error, new RegExp(`implements contract v${CONTRACT_VERSION}`));
  assert.match(r.error, /declared contractVersion 1/);
});

test('a missing required arg fails naming the contract, not the argument alone', () => {
  const r = checkLaunchArgs({ contractVersion: CONTRACT_VERSION, runId: 'r1' });
  assert.equal(r.ok, false);
  assert.match(r.error, /contract mismatch/);
  assert.match(r.error, /args\.invocationId/);
  for (const fork of FORKS) {
    assert.ok(r.error.includes(fork.repo), `the failure must name the fork holder ${fork.repo} so the ripple is visible at launch`);
  }
});

test('invocationId equal to runId is refused', () => {
  const r = checkLaunchArgs({ contractVersion: CONTRACT_VERSION, runId: 'same', invocationId: 'same' });
  assert.equal(r.ok, false);
  assert.match(r.error, /must differ from args\.runId/);
});

test('contractVersionOf reads the marker, and an unmarked fork reads as pre-contract', () => {
  assert.equal(contractVersionOf('// [FLEET-CONTRACT-VERSION 7]\nconst x = 1'), 7);
  assert.equal(contractVersionOf("export const meta = {}\nif (!cfg.runId) throw new Error('args.runId is required')"), null);
  const audit = auditForkFiles([FLEET_SCRIPT]);
  assert.deepEqual(audit, [{ path: FLEET_SCRIPT, version: CONTRACT_VERSION, stale: false }],
    'the plugin-served script must audit as current against its own contract');
});

test('the plugin-served script enforces the same contract this module describes', () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.equal(contractVersionOf(src), CONTRACT_VERSION,
    'the [FLEET-CONTRACT-VERSION N] marker in the script must match CONTRACT_VERSION here');
  assert.match(src, new RegExp(`const CONTRACT_VERSION = ${CONTRACT_VERSION}\\b`));
  assert.match(src, /throw contractError\(/, 'every required-arg failure must go through contractError');
  assert.ok(!/throw new Error\('args\./.test(src), 'no bare "args.X is required" throw may survive');
  assert.match(src, /invocationId === runId/, 'the script must refuse invocationId equal to runId');
  assert.match(src, /open-pr-scan@\$\{invocationId\}/, 'invocationId must key the open-PR scan (issue 430)');
  assert.match(src, /required: \['candidateNumbers', 'tickets'/, 'SCOUT must require candidateNumbers');
  assert.match(src, /'kindReason', 'discoveryTriage', 'handoffPending'\]/, 'SCOUT tickets must require discoveryTriage and handoffPending');
});

test('the SKILL.md ripple table names every fork holder, runbook and the current version', () => {
  const skill = fs.readFileSync(FLEET_SKILL, 'utf8');
  assert.match(skill, new RegExp(`contract v${CONTRACT_VERSION}\\b`),
    'SKILL.md must state the contract version a caller has to declare');
  for (const fork of FORKS) {
    assert.ok(skill.includes(fork.repo) && skill.includes(fork.path),
      `SKILL.md must list the fork at ${fork.repo} ${fork.path} as a ripple target`);
  }
  for (const doc of RUNBOOKS) {
    const file = doc.split(' ').pop();
    assert.ok(skill.includes(file), `SKILL.md must list ${file} as a ripple target`);
  }
});
