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

// ---- Resume idempotence guard (issue 150) ----
// Extract the runCodeLane function body from each fleet script by its FLEET-CODE-LANE markers,
// drive it with a mocked `agent`, and assert that when the pre-loop PR check reports an open PR
// the impl/verify/deliver agents are NEVER invoked. This is the real behavior test the reviewer
// asked for: regex-only prompt-text assertions cannot prove the agent() calls are skipped.

const RESUME_GUARD_PAIR = [
  path.join(REPO_ROOT, '.claude', 'workflows', 'ticket-fleet.js'),
  path.join(REPO_ROOT, 'orchestrator', 'ticket-fleet-cloud.js'),
];

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function extractCodeLane(src) {
  const startTag = '// [FLEET-CODE-LANE-START]';
  const endTag = '// [FLEET-CODE-LANE-END]';
  const s = src.indexOf(startTag);
  const e = src.indexOf(endTag);
  if (s < 0 || e < 0 || e <= s) {
    throw new Error('FLEET-CODE-LANE markers not found or out of order');
  }
  // Return everything between the markers (exclusive) — the const runCodeLane = ... = { ... }.
  return src.slice(s + startTag.length, e);
}

async function driveCodeLane(scriptPath, agentMock, ticket, workerIndex = 0) {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const body = extractCodeLane(src);
  // Wrap the marker body in an async factory that closes over stub bindings, then invoke the
  // returned runCodeLane. cfg / runId / scout / log / schemas / PR_CHECK are provided as free
  // parameters so the body's references resolve. The stub `agent` is a spy the test drives.
  const wrapper = new AsyncFunction(
    'agent', 'log', 'cfg', 'runId', 'scout', 'PR_CHECK', 'IMPL', 'VERDICT', 'DELIVERED',
    body + '\nreturn runCodeLane;'
  );
  const cfg = { maxAttempts: 3, deliver: true, implModel: 'x', verifyModel: 'y', deliverModel: 'z' };
  const runId = 'testrun';
  const scout = { defaultBranch: 'main', repoMap: '', testCommand: 'echo ok' };
  const logs = [];
  const runCodeLane = await wrapper(agentMock, (m) => logs.push(m), cfg, runId, scout, {}, {}, {}, {});
  const result = await runCodeLane(ticket, workerIndex);
  return { result, logs };
}

for (const file of RESUME_GUARD_PAIR) {
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');

  test(`${rel} declares runCodeLane between FLEET-CODE-LANE markers`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /\/\/ \[FLEET-CODE-LANE-START\]/, 'missing FLEET-CODE-LANE-START marker');
    assert.match(src, /\/\/ \[FLEET-CODE-LANE-END\]/, 'missing FLEET-CODE-LANE-END marker');
    const body = extractCodeLane(src);
    assert.match(body, /const runCodeLane\s*=\s*async/, 'markers must enclose the runCodeLane arrow function');
    // The pre-loop PR check must precede the attempt loop (structural order in the source).
    // Match the agent opts labels (not casual references in comments) so a mention like
    // "impl:#97.1" in the failure-scenario comment does not defeat the ordering assertion.
    const preIdx = body.indexOf('label: `pr-check:#');
    const loopIdx = body.indexOf('for (let attempt');
    const implIdx = body.indexOf('label: `impl:#');
    const verifyIdx = body.indexOf('label: `verify:#');
    const deliverIdx = body.indexOf('label: `deliver:#');
    assert.ok(preIdx >= 0, 'runCodeLane must call the pre-loop PR check with label pr-check:#N');
    assert.ok(loopIdx > preIdx, 'PR check must precede the attempt for-loop');
    assert.ok(implIdx > preIdx, 'PR check label must precede the impl agent label');
    assert.ok(verifyIdx > preIdx, 'PR check label must precede the verify agent label');
    assert.ok(deliverIdx > preIdx, 'PR check label must precede the deliver agent label');
    // The early return on found must sit between the check and the loop.
    const returnIdx = body.indexOf("ticket: t.number, done: true, kind: 'code'");
    assert.ok(returnIdx > preIdx && returnIdx < loopIdx,
      'early return on openPR.found must sit between the PR check and the attempt loop');
  });

  test(`${rel} runCodeLane skips impl/verify/deliver when an open PR already exists`, async () => {
    const calls = [];
    const agentMock = async (_prompt, opts) => {
      calls.push(opts.label);
      if (opts.label.startsWith('pr-check:')) {
        return { found: true, prUrl: 'https://github.com/x/y/pull/137', branch: 'agent/issue-97-attempt1-wf_r1-w0' };
      }
      // Any other agent call means the guard failed.
      throw new Error(`unexpected agent call after PR-found short-circuit: ${opts.label}`);
    };
    const { result } = await driveCodeLane(file, agentMock, { number: 97, title: 'x', criteria: '' }, 0);
    assert.deepEqual(calls, ['pr-check:#97'], 'only the pr-check agent may be started when an open PR exists');
    assert.equal(result.done, true);
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/137');
    assert.equal(result.branch, 'agent/issue-97-attempt1-wf_r1-w0');
    assert.equal(result.commentUrl, null);
    assert.deepEqual(result.discoveries, []);
  });

  test(`${rel} runCodeLane runs the full impl/verify/deliver chain when no open PR exists`, async () => {
    const calls = [];
    const agentMock = async (_prompt, opts) => {
      calls.push(opts.label);
      if (opts.label.startsWith('pr-check:')) return { found: false };
      if (opts.label.startsWith('impl:')) {
        return { branch: 'agent/issue-9-attempt1-wf_testrun-w0', committed: true, testExitCode: 0, testTail: 'ok', discoveries: ['finding-A'] };
      }
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran tests', failures: [] };
      if (opts.label.startsWith('deliver:')) return { pushed: true, prUrl: 'https://github.com/x/y/pull/500' };
      throw new Error('unexpected label: ' + opts.label);
    };
    const { result } = await driveCodeLane(file, agentMock, { number: 9, title: 't', criteria: '' }, 0);
    assert.deepEqual(calls, ['pr-check:#9', 'impl:#9.1', 'verify:#9.1', 'deliver:#9'],
      'when no open PR exists the pre-check must be followed by impl/verify/deliver in order');
    assert.equal(result.done, true);
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/500');
    assert.deepEqual(result.discoveries, ['finding-A']);
  });
}
