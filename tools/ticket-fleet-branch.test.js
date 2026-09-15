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

// Issue 233: the Workflow tool reads the file behind `scriptPath` and refuses any CR byte
// ("script contains control characters that would be hidden in the approval dialog"). The
// repo pins `* -text`, so a CRLF blob reaches every surface verbatim - the desktop plugin
// cache and the container payload the bootstrap hook copies out of a clone. Both the source
// and the packaged copy must be LF or the fleet cannot launch from the plugin path anywhere.
const FLEET_SCRIPT_PACKAGED = path.join(REPO_ROOT, 'marketplace', 'aac-skills', 'skills', 'ticket-fleet', 'ticket-fleet.js');
for (const file of [FLEET_SCRIPT, FLEET_SCRIPT_PACKAGED]) {
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  test(`fleet script ${rel} carries no CR byte (Workflow scriptPath refuses CRLF, issue 233)`, () => {
    const bytes = fs.readFileSync(file);
    const crs = bytes.filter((b) => b === 0x0d).length;
    assert.equal(crs, 0, `${rel} holds ${crs} CR byte(s); re-encode as LF and rebuild the plugin`);
  });
}

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

// ---- Resume idempotence guard (issue 150) ----
// Extract the runCodeLane function body from each fleet script by its FLEET-CODE-LANE markers,
// drive it with a mocked `agent`, and assert that when the pre-loop PR check reports an open PR
// the impl/verify/deliver agents are NEVER invoked. This is the real behavior test the reviewer
// asked for: regex-only prompt-text assertions cannot prove the agent() calls are skipped.

// One script since issue 138: the plugin-served aac-skills/ticket-fleet/ticket-fleet.js.
const RESUME_GUARD_PAIR = [FLEET_SCRIPT];

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
    'instrument', 'rules',
    body + '\nreturn runCodeLane;'
  );
  const cfg = { maxAttempts: 3, deliver: true, implModel: 'x', verifyModel: 'y', deliverModel: 'z' };
  const runId = 'testrun';
  const scout = { defaultBranch: 'main', repoMap: '', testCommand: 'echo ok' };
  const logs = [];
  // The unified script's lane also reads the instrument switch and the tracker rule helpers;
  // stub them so the extracted body evaluates the same way under either instrument.
  const rules = new Proxy({}, { get: () => () => '' });
  const runCodeLane = await wrapper(agentMock, (m) => logs.push(m), cfg, runId, scout, {}, {}, {}, {}, 'gh', rules);
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

// ---- Human-lane hand-back and the handoff skip rule (issue 266) ----
// A human-lane ticket used to be handed back with a comment and nothing else: it kept
// `ready-for-agent`, so the next label listing put it back in the wave and the fleet wrote the
// same handoff comment again. Two mechanisms close that, and both are driven here rather than
// asserted by regex: the delivery relabels the ticket (ready-for-agent off, ready-for-human on)
// under either instrument, and the scout's wave selection parks a ticket whose latest comment is
// still an unanswered fleet handoff.

function extractBetween(src, tag) {
  const startTag = `// [${tag}-START]`;
  const endTag = `// [${tag}-END]`;
  const s = src.indexOf(startTag);
  const e = src.indexOf(endTag);
  if (s < 0 || e < 0 || e <= s) { throw new Error(`${tag} markers not found or out of order`); }
  return src.slice(s + startTag.length, e);
}

function loadTrackerRules(scriptPath, mode) {
  const body = extractBetween(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-TRACKER-RULES');
  // eslint-disable-next-line no-new-func
  const make = new Function(body + '\nreturn trackerRules;')();
  return make(mode);
}

async function driveHumanLane(scriptPath, agentMock, ticket, mode) {
  const body = extractBetween(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-HUMAN-LANE');
  const wrapper = new AsyncFunction('agent', 'cfg', 'rules', 'HANDOFF', 'COMMENTED',
    body + '\nreturn runHumanLane;');
  const cfg = { deliver: true, verifyModel: 'v', deliverModel: 'd' };
  const runHumanLane = await wrapper(agentMock, cfg, loadTrackerRules(scriptPath, mode), {}, {});
  return await runHumanLane(ticket);
}

function selectWaveFrom(scriptPath) {
  const body = extractBetween(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-WAVE-SELECT');
  // eslint-disable-next-line no-new-func
  return new Function(body + '\nreturn selectWave;')();
}

for (const mode of ['gh', 'mcp']) {
  test(`${FLEET_SCRIPT_REL} human-lane delivery drops ready-for-agent and adds ready-for-human under ${mode}`, async () => {
    const prompts = [];
    const agentMock = async (prompt, opts) => {
      prompts.push([opts.label, prompt]);
      if (opts.label.startsWith('handoff:')) {
        return { agentSide: '$ node -v\nv22', ownerSide: ['click Save in the console'], ready: true };
      }
      if (opts.label.startsWith('deliver:')) {
        return { commented: true, commentUrl: 'https://github.com/x/y/issues/266#c1', labels: ['ready-for-human'] };
      }
      throw new Error('unexpected label: ' + opts.label);
    };
    const result = await driveHumanLane(FLEET_SCRIPT, agentMock, { number: 266, title: 't', criteria: 'c', kindReason: 'labelled ready-for-human' }, mode);
    const deliver = prompts.find(([label]) => label === 'deliver:#266');
    assert.ok(deliver, 'the human lane must run a deliver agent');
    const text = deliver[1];
    assert.match(text, /ready-for-agent/, `${mode} deliver prompt must name the label being removed`);
    assert.match(text, /ready-for-human/, `${mode} deliver prompt must name the label being added`);
    const toolCall = mode === 'mcp' ? /mcp__github__issue_write/ : /gh api --method DELETE repos\/\{owner\}\/\{repo\}\/issues\/266\/labels\/ready-for-agent/;
    assert.match(text, toolCall, `${mode} deliver prompt must relabel through the ${mode} instrument`);
    assert.deepEqual(result.labels, ['ready-for-human'], 'the lane must report the labels the ticket carries afterwards');
    assert.equal(result.commentUrl, 'https://github.com/x/y/issues/266#c1');
  });
}

test(`${FLEET_SCRIPT_REL} wave selection parks a ticket whose latest comment is an unanswered fleet handoff`, () => {
  const selectWave = selectWaveFrom(FLEET_SCRIPT);
  const parked = { number: 266, kind: 'human', blockedBy: [], handoffPending: true };
  const fresh = { number: 267, kind: 'human', blockedBy: [], handoffPending: false };
  const blocked = { number: 268, kind: 'code', blockedBy: [10], handoffPending: false };
  const { wave, pendingHandoff, blocked: gated } = selectWave([parked, fresh, blocked], 3);
  assert.deepEqual(wave.map((t) => t.number), [267], 'only the ticket with no pending handoff may run');
  assert.deepEqual(pendingHandoff.map((t) => t.number), [266], 'the parked ticket must be reported as skipped by number');
  assert.deepEqual(gated.map((t) => t.number), [268], 'open blockers must still gate independently of the handoff skip');
});

test(`${FLEET_SCRIPT_REL} a run whose only ticket already carries a handoff comment starts no agents`, async () => {
  const selectWave = selectWaveFrom(FLEET_SCRIPT);
  const parked = { number: 266, kind: 'human', blockedBy: [], handoffPending: true };
  const { wave, pendingHandoff } = selectWave([parked], 3);
  const calls = [];
  const agentMock = async (_prompt, opts) => { calls.push(opts.label); throw new Error('no agent may run for a parked ticket'); };
  for (const t of wave) { await driveHumanLane(FLEET_SCRIPT, agentMock, t, 'gh'); }
  assert.deepEqual(calls, [], 'a parked ticket must start no handoff and no deliver agent - nothing is posted');
  assert.deepEqual(pendingHandoff.map((t) => t.number), [266],
    'the run result must name the parked ticket as skipped');
});

test(`${FLEET_SCRIPT_REL} scout classifies handoffPending and the run result names the skipped tickets`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /'handoffPending'\]/, 'SCOUT must require handoffPending per ticket');
  assert.match(src, /skippedAwaitingOwner: skippedHandoff/,
    'the run result must carry the parked ticket numbers, not just a count');
});
