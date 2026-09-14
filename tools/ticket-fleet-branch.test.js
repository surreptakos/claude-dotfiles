#!/usr/bin/env node
/**
 * node --test tools/ticket-fleet-branch.test.js
 *
 * Covers issue 29: ticket-fleet scout template must handle concurrent
 * attempts. The workflow's branch-naming logic is factored into
 * `tools/ticket-fleet-branch.js`; this suite exercises it directly and also
 * asserts that both workflow files (the live one at .claude/workflows and the
 * project-harness template) reference the runId + workerIndex pattern, so the
 * two copies cannot drift silently.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const { generateRunId, buildBranchName, workerSuffix } = require('./ticket-fleet-branch.js');

test('generateRunId returns non-empty strings', () => {
  const id = generateRunId();
  assert.equal(typeof id, 'string');
  assert.ok(id.length >= 4, `runId too short: ${id}`);
});

test('two consecutive generateRunId calls return distinct ids', () => {
  const ids = new Set();
  for (let i = 0; i < 32; i++) { ids.add(generateRunId()); }
  assert.equal(ids.size, 32, 'runIds collided within 32 draws');
});

test('workerSuffix embeds runId and workerIndex', () => {
  assert.equal(workerSuffix('abc', 0), 'wf_abc-w0');
  assert.equal(workerSuffix('abc', 3), 'wf_abc-w3');
});

test('buildBranchName includes ticket, attempt, runId and workerIndex', () => {
  const branch = buildBranchName(29, 'abc123', 2, 1);
  assert.equal(branch, 'agent/issue-29-attempt1-wf_abc123-w2');
  assert.match(branch, /^agent\/issue-29-/);
  assert.match(branch, /attempt1/);
  assert.match(branch, /wf_abc123/);
  assert.match(branch, /w2$/);
});

test('two concurrent scouts against the same ticket produce distinct branch names', () => {
  // Simulates two ticket-fleet runs both picking up issue 29 at the same time.
  // Each run mints its own runId; the workerIndex is 0 on both because the
  // ticket is the first in each wave. Attempt is 1 (fresh attempt on both).
  const runIdA = generateRunId();
  const runIdB = generateRunId();
  assert.notEqual(runIdA, runIdB, 'runIds must differ for two concurrent runs');
  const branchA = buildBranchName(29, runIdA, 0, 1);
  const branchB = buildBranchName(29, runIdB, 0, 1);
  assert.notEqual(branchA, branchB, 'concurrent scouts against same ticket must yield distinct branches');
});

test('two workers within the same run against the same ticket produce distinct branches', () => {
  // Belt-and-braces: even if a caller ever put the same ticket into a wave
  // twice, workerIndex still separates the branches.
  const runId = 'sharedrun';
  const branchA = buildBranchName(29, runId, 0, 1);
  const branchB = buildBranchName(29, runId, 1, 1);
  assert.notEqual(branchA, branchB, 'same-run duplicate tickets must still get distinct branches');
});

test('retries within one worker produce distinct branches', () => {
  const runId = 'sameworker';
  const attempt1 = buildBranchName(29, runId, 0, 1);
  const attempt2 = buildBranchName(29, runId, 0, 2);
  assert.notEqual(attempt1, attempt2, 'retries must get distinct branches so verify sees a fresh commit');
});

test('missing arguments throw rather than silently colliding', () => {
  assert.throws(() => buildBranchName(null, 'r', 0, 1), /ticketNumber/);
  assert.throws(() => buildBranchName(29, '', 0, 1), /runId/);
  assert.throws(() => buildBranchName(29, 'r', null, 1), /workerIndex/);
  assert.throws(() => buildBranchName(29, 'r', 0, null), /attempt/);
});

// ---- Workflow-file drift guards ----
// The workflow environment cannot reliably `require` from tools/, so the same
// naming shape is inlined in both workflow files. These tests fail if the
// inline logic no longer matches this module's contract.

const WORKFLOW_FILES = [
  path.join(REPO_ROOT, '.claude', 'workflows', 'ticket-fleet.js'),
  path.join(REPO_ROOT, 'agents', 'skills', 'project-harness', 'templates', 'ticket-fleet.js'),
];

for (const file of WORKFLOW_FILES) {
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  test(`workflow file ${rel} declares a runId`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /const runId\s*=/, 'workflow must mint a runId per invocation');
  });

  test(`workflow file ${rel} embeds runId+workerIndex in the branch name`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /wf_\$\{runId\}/, 'branch name must embed the runId');
    assert.match(src, /w\$\{workerIndex\}/, 'branch name must embed the workerIndex');
    // Retries within a worker must still be distinct.
    assert.match(src, /attempt\$\{attempt\}/, 'branch name must embed the attempt counter');
  });

  test(`workflow file ${rel} documents concurrent-attempt handling`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /concurrent/i, 'workflow must document the concurrent-run guard');
  });
}

// ---- Live-tree hard-rail sentence (issue 149) ----
// The implementer prompt in .claude/workflows/ticket-fleet.js and its lockstep
// copy in orchestrator/ticket-fleet-cloud.js must both carry the same sentence
// naming ~/.claude, ~/.codex, ~/.agents and any path outside the worktree as
// read-only. A drift here reopens the failure documented in issue 149
// (fleet run wf_911fa64d-102: implementers wrote to the live tree, breaking
// concurrent workers and reaching master without a PR via dotfiles-freshness
// auto-push).

const HARD_RAIL_PAIR = [
  path.join(REPO_ROOT, '.claude', 'workflows', 'ticket-fleet.js'),
  path.join(REPO_ROOT, 'orchestrator', 'ticket-fleet-cloud.js'),
];

const HARD_RAIL_SENTENCE =
  'Live-tree hard rail: ~/.claude, ~/.codex, ~/.agents and any path outside this worktree are ' +
  'read-only production paths — never write to them, never leave .bak files there; a change that ' +
  'would need a live-tree edit to land is committed to the branch only and named as a discovery.';

for (const file of HARD_RAIL_PAIR) {
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  test(`implementer prompt in ${rel} carries the live-tree hard-rail sentence`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(
      src.includes(HARD_RAIL_SENTENCE),
      `${rel} is missing the live-tree hard-rail sentence — it must match the string in this test verbatim`
    );
  });

  test(`verifier prompt in ${rel} instructs the live-tree hard-rail check`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(
      src,
      /Live-tree hard rail: the implementer must not have written to ~\/\.claude, ~\/\.codex, ~\/\.agents/,
      `${rel} verifier prompt must instruct a check for files under the live-tree roots modified after the attempt's first commit`
    );
    assert.match(
      src,
      /-newermt/,
      `${rel} verifier prompt must instruct a find -newermt against the attempt's first-commit time`
    );
  });
}

test('the two implementer prompts do not drift on the live-tree sentence', () => {
  const sentences = HARD_RAIL_PAIR.map(f => {
    const src = fs.readFileSync(f, 'utf8');
    return src.includes(HARD_RAIL_SENTENCE);
  });
  assert.ok(sentences.every(Boolean),
    'both fleet scripts must carry the identical live-tree hard-rail sentence; edit both when you change one');
});
