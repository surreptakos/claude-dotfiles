#!/usr/bin/env node
/**
 * node --test tools/ticket-fleet-branch.test.js
 *
 * Covers issue 29 (concurrent-attempt-safe branch naming) and issue 138
 * (plugin-served merged fleet script with a gh/MCP instrument switch).
 * The workflow's naming and instrument-switch logic are factored into
 * `tools/ticket-fleet-branch.js` so their tests can run without spinning
 * up the Workflow tool. This suite exercises those pure functions and also
 * asserts that the plugin-served copy of the fleet at
 * `aac-skills/ticket-fleet/ticket-fleet.js` still inlines the same shape,
 * so the pure module and the workflow file cannot drift silently.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const { generateRunId, buildBranchName, workerSuffix, pickInstrument } = require('./ticket-fleet-branch.js');

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
  const runIdA = generateRunId();
  const runIdB = generateRunId();
  assert.notEqual(runIdA, runIdB, 'runIds must differ for two concurrent runs');
  const branchA = buildBranchName(29, runIdA, 0, 1);
  const branchB = buildBranchName(29, runIdB, 0, 1);
  assert.notEqual(branchA, branchB, 'concurrent scouts against same ticket must yield distinct branches');
});

test('two workers within the same run against the same ticket produce distinct branches', () => {
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

// ---- pickInstrument (issue 138) ----

test('pickInstrument returns gh in a local session with gh on PATH', () => {
  assert.equal(pickInstrument({}, true, undefined), 'gh');
  assert.equal(pickInstrument({}, true, 'auto'), 'gh');
});

test('pickInstrument returns mcp when CLAUDE_CODE_REMOTE_SESSION_ID is set', () => {
  assert.equal(pickInstrument({ CLAUDE_CODE_REMOTE_SESSION_ID: 'abc' }, true, undefined), 'mcp');
  assert.equal(pickInstrument({ CLAUDE_CODE_REMOTE_SESSION_ID: 'abc' }, undefined, 'auto'), 'mcp');
});

test('pickInstrument returns mcp when CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE is set', () => {
  assert.equal(pickInstrument({ CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: 'container' }, true, undefined), 'mcp');
});

test('pickInstrument returns mcp when gh is absent even without the remote env vars', () => {
  assert.equal(pickInstrument({}, false, undefined), 'mcp');
});

test('pickInstrument override wins over env detection', () => {
  assert.equal(pickInstrument({ CLAUDE_CODE_REMOTE_SESSION_ID: 'abc' }, true, 'gh'), 'gh');
  assert.equal(pickInstrument({}, true, 'mcp'), 'mcp');
});

test('pickInstrument tolerates a missing env argument', () => {
  assert.equal(pickInstrument(undefined, true, undefined), 'gh');
  assert.equal(pickInstrument(null, false, undefined), 'mcp');
});

// ---- Fleet-script drift guard (issue 138) ----
// The workflow environment cannot reliably `require` from tools/, so the same
// naming and instrument-switch shape is inlined in the plugin-served script.
// These tests fail if the inline logic no longer matches this module's contract.

const FLEET_SCRIPT = path.join(REPO_ROOT, 'aac-skills', 'ticket-fleet', 'ticket-fleet.js');
const FLEET_SCRIPT_REL = path.relative(REPO_ROOT, FLEET_SCRIPT).replace(/\\/g, '/');

test(`fleet script ${FLEET_SCRIPT_REL} is served by the plugin`, () => {
  assert.ok(fs.existsSync(FLEET_SCRIPT),
    `plugin-served fleet script must live at ${FLEET_SCRIPT_REL} (issue 138)`);
});

test(`fleet script ${FLEET_SCRIPT_REL} takes runId from args`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /if \(!cfg\.runId\)/,
    'fleet must throw on missing args.runId, not mint one with Date.now()');
  assert.match(src, /const runId = String\(cfg\.runId\)/,
    'fleet must derive runId from cfg.runId');
});

test(`fleet script ${FLEET_SCRIPT_REL} embeds runId+workerIndex+attempt in the branch name`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /wf_\$\{runId\}/, 'branch name must embed the runId');
  assert.match(src, /w\$\{workerIndex\}/, 'branch name must embed the workerIndex');
  assert.match(src, /attempt\$\{attempt\}/, 'branch name must embed the attempt counter');
});

test(`fleet script ${FLEET_SCRIPT_REL} carries the defaultBranch scout output`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /defaultBranch/, 'SCOUT schema must require defaultBranch');
  assert.match(src, /scout\.defaultBranch/, 'the deliver/verify stages must use scout.defaultBranch');
});

test(`fleet script ${FLEET_SCRIPT_REL} carries keepOpen (Refs vs Closes)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /keepOpen/, 'SCOUT must classify keepOpen');
  assert.match(src, /Refs #\$\{t\.number\}/, 'deliver must offer Refs #N under keepOpen');
});

test(`fleet script ${FLEET_SCRIPT_REL} inlines the pickInstrument switch`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /function pickInstrument/,
    'fleet must inline pickInstrument so the workflow runtime does not need require()');
  assert.match(src, /CLAUDE_CODE_REMOTE_SESSION_ID/,
    'fleet must sniff CLAUDE_CODE_REMOTE_SESSION_ID for the mcp branch');
  assert.match(src, /trackerRules/,
    'fleet must route tracker prompts through the instrument-specific rules');
});

test(`fleet script ${FLEET_SCRIPT_REL} carries the live-tree hard-rail sentence`, () => {
  const HARD_RAIL_SENTENCE =
    'Live-tree hard rail: ~/.claude, ~/.codex, ~/.agents and any path outside this worktree are ' +
    'read-only production paths - never write to them, never leave .bak files there; a change that ' +
    'would need a live-tree edit to land is committed to the branch only and named as a discovery.';
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.ok(src.includes(HARD_RAIL_SENTENCE),
    `${FLEET_SCRIPT_REL} is missing the live-tree hard-rail sentence (issue 149)`);
});

test(`fleet script ${FLEET_SCRIPT_REL} verifier prompt still runs the live-tree check`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src,
    /Live-tree hard rail: the implementer must not have written to ~\/\.claude, ~\/\.codex, ~\/\.agents/,
    `${FLEET_SCRIPT_REL} verifier prompt must instruct a check for files under the live-tree roots modified after the attempt's first commit`);
  assert.match(src, /-newermt/,
    `${FLEET_SCRIPT_REL} verifier prompt must instruct a find -newermt against the attempt's first-commit time`);
});

// ---- Three-copies gone (issue 138) ----
// The consolidation ticket deletes the pre-plugin copies. A regression that re-adds one
// silently re-opens the drift the plugin move was meant to close.

const REMOVED_COPIES = [
  '.claude/workflows/ticket-fleet.js',
  'orchestrator/ticket-fleet-cloud.js',
  'agents/skills/project-harness/templates/ticket-fleet.js',
];

for (const rel of REMOVED_COPIES) {
  test(`pre-plugin copy ${rel} no longer exists in the repo`, () => {
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, rel)),
      `${rel} was superseded by aac-skills/ticket-fleet/ticket-fleet.js in issue 138 and must not come back`);
  });
}
