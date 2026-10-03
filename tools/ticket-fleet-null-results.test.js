#!/usr/bin/env node
/**
 * node --test tools/ticket-fleet-null-results.test.js
 *
 * A Workflow agent() call resolves to null when the user skips the agent or it dies after its
 * retries, and args reach the script verbatim. Each case here is one place where such a value
 * used to throw or vanish from the run result:
 *   - a priorProbe entry with no `items` array threw a TypeError out of the probe lane;
 *   - a probe or human deliverer that returned null left the ticket in neither `delivered` nor
 *     `failed` (aac-routines issue 191);
 *   - a report writer that returned null, or no commit sha, was logged as committed and its
 *     bullets left out of discoveryList;
 *   - a finish-mode delivery blocked at the pre-push merge was listed in `failed` with a null reason;
 *   - the Jev request's per-field cap and a non-array args.tickets were silent.
 *
 * Every block is evaluated out of the fleet script's own markers, as in ticket-fleet-deliver.test.js.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { sliceBetweenTags } = require('./source-slice.js');

const FLEET_SCRIPT = path.join(path.resolve(__dirname, '..'), 'aac-skills', 'ticket-fleet', 'ticket-fleet.js');
const SRC = fs.readFileSync(FLEET_SCRIPT, 'utf8');
const block = (name) => sliceBetweenTags(SRC, `// [${name}-START]`, `// [${name}-END]`, `the ${name} block`);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// eslint-disable-next-line no-new-func
const helpers = new Function(`${block('FLEET-GENERATED')}\nreturn { stableJson, stableText, stableList, priorFindingsBlock, unmetCriteriaOf, gitSpelling, worktreeMismatch, classifyDelivery, createRunHalt, implementerModel, difficultyRequest, parseDifficulty, pickImplModel, DIFFICULTY_TEXT_CAP, DIFFICULTY_CONFIDENCE_FLOOR };`)();

// Any binding not stubbed below is inert: callable, and '' inside a template literal.
const INERT = new Proxy(function stub() {}, {
  get: (_t, prop) => (prop === Symbol.toPrimitive ? () => '' : prop === 'then' ? undefined : INERT),
  apply: () => INERT,
});

async function load(blocks, returns, agentMock, logs, overrides = {}) {
  const stubs = Object.assign({}, helpers, {
    agent: agentMock, log: (m) => logs.push(m), instrument: 'gh', runId: 'testrun',
    cfg: { maxAttempts: 1, deliver: true, implModel: 'x', verifyModel: 'y', deliverModel: 'z', reportModel: 'r', followupsFile: 'FOLLOW-UPS.md', label: 'ready-for-agent' },
    scout: { defaultBranch: 'main', repoMap: '' },
    rules: new Proxy({}, { get: () => () => '' }), dedupeBrief: () => '',
    treeGuardCheck: async () => {}, assertNoBreach: () => {}, revParse: async () => null,
    unusableReason: (who, detail) => `${who} output unusable: ${detail}`,
    unusableVerdict: (detail, who) => ({ pass: false, evidence: '', failures: [`${who} output unusable: ${detail}`], unusable: true }),
    runHalt: helpers.createRunHalt(() => {}),
    scratchFile: (n) => `/tmp/fleet-testrun/${n}`,
  }, overrides);
  const scope = new Proxy(stubs, {
    has: (_t, prop) => prop !== Symbol.unscopables,
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
      return prop in globalThis ? globalThis[prop] : INERT;
    },
  });
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${blocks.map(block).join('\n')}\nreturn { ${returns} };\n}`);
  return wrapper(scope);
}

const PROBE_TICKET = { number: 77, title: 't', criteria: '- quote the output', kind: 'probe', kindReason: 'evidence' };
const PROBE_RESULT = { items: [{ item: 'quote the output', commands: 'echo hi', outputVerbatim: 'hi', exitCodes: '0', status: 'done' }], blocked: [], discoveries: [] };

test('a priorProbe entry with no items array is a failed attempt, not a TypeError out of the probe lane', async () => {
  const labels = [];
  const logs = [];
  const { runProbeLane } = await load(['FLEET-PROBE-LANE'], 'runProbeLane', async (_p, opts) => {
    labels.push(opts.label);
    throw new Error('unexpected label: ' + opts.label);
  }, logs, { cfg: { maxAttempts: 1, deliver: true, implModel: 'x', priorProbe: { 77: { discoveries: [] } } } });
  const result = await runProbeLane(PROBE_TICKET, 0);
  assert.deepEqual(labels, [], 'attempt 1 takes the prior entry, so no prober starts');
  assert.equal(result.done, false);
  assert.match(result.verdict.failures[0], /priorProbe entry for this ticket holds no items array/);
});

// Run wf_0b138fa5-528: the runtime resolves a subagent that died on the session limit to null.
// The probe lane reads that as the run's halt (issue 812) rather than burning its attempts.
test('a prober that resolves null halts the run and starts no further attempt', async () => {
  const labels = [];
  const runHalt = helpers.createRunHalt(() => {});
  const { runProbeLane } = await load(['FLEET-PROBE-LANE'], 'runProbeLane', async (_p, opts) => { labels.push(opts.label); return null; },
    [], { runHalt, cfg: { maxAttempts: 3, deliver: true, implModel: 'x', verifyModel: 'y' } });
  const result = await runProbeLane(PROBE_TICKET, 0);
  assert.deepEqual(labels, ['probe:#77.1']);
  assert.ok(runHalt.halted());
  assert.ok(result.verdict.failures.some((f) => /run halted after an agent resolved null/.test(f)), JSON.stringify(result.verdict));
});

test('a probe verifier that resolves null is not re-run and starts no further attempt', async () => {
  const labels = [];
  const runHalt = helpers.createRunHalt(() => {});
  const { runProbeLane } = await load(['FLEET-PROBE-LANE'], 'runProbeLane', async (_p, opts) => {
    labels.push(opts.label);
    return opts.label.startsWith('probe:') ? PROBE_RESULT : null;
  }, [], { runHalt, revParse: async () => 'a'.repeat(40), worktreeMismatch: helpers.worktreeMismatch, cfg: { maxAttempts: 3, deliver: true, implModel: 'x', verifyModel: 'y' } });
  const result = await runProbeLane(PROBE_TICKET, 0);
  assert.deepEqual(labels, ['probe:#77.1', 'verify:#77.1']);
  assert.equal(result.done, false);
  assert.ok(runHalt.halted());
});

test('a probe deliverer that returns null is a named delivery failure, not a ticket missing from the result', async () => {
  const logs = [];
  const { runProbeLane } = await load(['FLEET-PROBE-LANE'], 'runProbeLane', async (_p, opts) => {
    if (opts.label.startsWith('probe:')) return PROBE_RESULT;
    if (opts.label.startsWith('verify:')) return { pass: true, evidence: 're-ran echo hi; hi', failures: [], worktree: { path: '/tmp/x', head: 'a'.repeat(40) } };
    if (opts.label.startsWith('deliver:')) return null;
    throw new Error('unexpected label: ' + opts.label);
  }, logs);
  const result = await runProbeLane(PROBE_TICKET, 0);
  assert.equal(result.done, true, 'the evidence itself verified');
  assert.match(result.deliveryFailure, /deliver:#77 posted no resolution comment: the deliverer returned no result/);
  assert.ok(logs.some((m) => m.startsWith('deliver:#77 posted no resolution comment')), 'the failure is logged');
});

test('a probe deliverer that posts its comment is not a delivery failure', async () => {
  const { runProbeLane } = await load(['FLEET-PROBE-LANE'], 'runProbeLane', async (_p, opts) => {
    if (opts.label.startsWith('probe:')) return PROBE_RESULT;
    if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ok', failures: [], worktree: { path: '/tmp/x', head: 'a'.repeat(40) } };
    if (opts.label.startsWith('deliver:')) return { commented: true, commentUrl: 'https://github.com/x/y/issues/77#c1' };
    throw new Error('unexpected label: ' + opts.label);
  }, []);
  const result = await runProbeLane(PROBE_TICKET, 0);
  assert.equal(result.deliveryFailure, null);
  assert.equal(result.commentUrl, 'https://github.com/x/y/issues/77#c1');
});

test('a human-lane deliverer that returns null is a named delivery failure', async () => {
  const { runHumanLane } = await load(['FLEET-HUMAN-LANE'], 'runHumanLane', async (_p, opts) => {
    if (opts.label.startsWith('handoff:')) return { agentSide: '$ true', ownerSide: ['sign off'], ready: true, remainingKind: 'human' };
    if (opts.label.startsWith('deliver:')) return null;
    throw new Error('unexpected label: ' + opts.label);
  }, []);
  const result = await runHumanLane({ number: 88, title: 't', criteria: 'c', kindReason: 'labelled ready-for-human' });
  assert.equal(result.done, true);
  assert.match(result.deliveryFailure, /deliver:#88 posted no handoff comment: the deliverer returned no result/);
  assert.equal(result.commentUrl, null);
});

test('a report writer that returns null or no sha is an error, so the bullets stay in the run result', async () => {
  for (const [reply, why] of [[null, /the writer returned no result/], [{ branch: 'b', sha: '', prUrl: '', appended: 0 }, /the writer reported no commit sha/]]) {
    const { runReport } = await load(['FLEET-REPORT'], 'runReport', async () => reply, []);
    const report = await runReport(['finding-A'], 'main');
    assert.equal(report.sha, null);
    assert.equal(report.bullets, 1);
    assert.match(report.error, /^followups-writer committed nothing: /);
    assert.match(report.error, why);
  }
  const { runReport } = await load(['FLEET-REPORT'], 'runReport', async () => ({ branch: 'b', sha: 'abc', prUrl: '', appended: 1 }), []);
  assert.deepEqual(await runReport(['finding-A'], 'main'), { branch: 'b', sha: 'abc', prUrl: null, bullets: 1 });
});

test('a finish-mode delivery blocked at the pre-push merge is failed with a reason, not null', async () => {
  const logs = [];
  const { runFinish } = await load(['FLEET-DELIVER-PROMPT', 'FLEET-REPORT', 'FLEET-FINISH'], 'runFinish', async (_p, opts) => {
    if (opts.label.startsWith('deliver:')) {
      return { pushed: false, prUrl: '', mergeStatus: 'blocked', conflictPaths: ['tools/x.js'], blockedReason: 'both sides edited line 3', merged: false, mergeSha: '', prState: 'not-attempted' };
    }
    throw new Error('unexpected label: ' + opts.label);
  }, logs);
  const out = await runFinish({ defaultBranch: 'main', tickets: [{ number: 5, title: 't', branch: 'agent/issue-5-attempt1-wf_dead-w0', verified: true, pushed: true, evidence: 'ok', delivered: false, deliveryRef: '' }], discoveries: [] });
  assert.equal(out.failed.length, 1);
  assert.deepEqual(out.failed[0].conflictPaths, ['tools/x.js']);
  assert.equal(typeof out.failed[0].failures[0], 'string');
  assert.match(out.failed[0].failures[0], /pre-push merge of origin\/main blocked: tools\/x\.js - both sides edited line 3; no PR opened/);
  assert.ok(logs.some((m) => /deliver:#5: pre-push merge of origin\/main blocked/.test(m)), 'the run log names the blocked merge');
});

test('the Jev request logs the tickets whose criteria it cut', async () => {
  const logs = [];
  const long = 'x'.repeat(helpers.DIFFICULTY_TEXT_CAP + 1);
  const { scoreDifficulty } = await load(['FLEET-DIFFICULTY'], 'scoreDifficulty', async () => ({ status: 'unavailable', body: '', detail: 'no credential' }), logs,
    { cfg: { implModel: 'claude-opus-5-5', implPins: {} }, scout: { repoMap: 'short' }, scratchRoot: '/tmp/fleet-t' });
  await scoreDifficulty([{ number: 1, title: 'a', criteria: long, kind: 'code' }, { number: 2, title: 'b', criteria: 'short', kind: 'code' }]);
  const cut = logs.filter((m) => /were cut to their first/.test(m));
  assert.equal(cut.length, 1);
  assert.match(cut[0], /the criteria of #1 were cut/);
  assert.doesNotMatch(cut[0], /#2/);
});

test('a non-array args.tickets, or entries that are not issue numbers, are logged rather than silently dropped', async () => {
  const run = async (tickets) => {
    const logs = [];
    const { explicitTickets } = await load(['FLEET-EXPLICIT-TICKETS'], 'explicitTickets', async () => null, logs,
      { cfg: { tickets, label: 'ready-for-agent' } });
    return { explicitTickets, logs };
  };
  let r = await run(1069);
  assert.deepEqual(r.explicitTickets, [], 'the arg shape is unchanged: a scalar is still not a ticket list');
  assert.match(r.logs[0], /args\.tickets is 1069, not an array of issue numbers - ignored, so this run lists the "ready-for-agent" label instead/);
  r = await run([12, 'abc']);
  assert.deepEqual(r.explicitTickets, [12]);
  assert.match(r.logs[0], /1 entry is not an issue number and was dropped - \["abc"\]\.$/);
  r = await run(['abc']);
  assert.match(r.logs[0], /No number is left, so this run lists the "ready-for-agent" label instead/);
  for (const quiet of [[], [7], null, undefined]) assert.deepEqual((await run(quiet)).logs, [], `no log for ${JSON.stringify(quiet)}`);
});
