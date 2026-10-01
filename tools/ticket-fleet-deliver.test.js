#!/usr/bin/env node
/**
 * node --test tools/ticket-fleet-deliver.test.js
 *
 * Issue 1139: a deliverer whose shell command the classifier refuses still delivers. Run 6abd62b5
 * pushed and verified #177 and #17, then both deliverers stopped on "[Auto-Mode Bypass]" and the
 * run listed each as `did not deliver: pushed=null prUrl=(none)`. A refused command in a step
 * with no route of its own now goes to A9: the PR is opened from the pushed branch through the
 * GitHub connector, the refusal is quoted in its body, and the result is a delivery the
 * orchestrator merges rather than a branch it has to re-derive by hand.
 *
 * The prompt and the code lane are evaluated out of the fleet script's own marked blocks, so what
 * these tests drive is the text the fleet actually runs (the harness in ticket-fleet-branch.test.js
 * does the same for the lane's other paths).
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

// The generated helpers the prompt and the lane call, evaluated on their own so nothing else in
// that block (the difficulty agent, the tip lookup) joins the lane's scope.
// eslint-disable-next-line no-new-func
const helpers = new Function(`${block('FLEET-GENERATED')}\nreturn { stableJson, stableText, stableList, priorFindingsBlock, unmetCriteriaOf, gitSpelling, worktreeMismatch, classifyDelivery, createRunHalt };`)();

// Any binding not stubbed below is inert: callable, and '' inside a template literal.
const INERT = new Proxy(function stub() {}, {
  get: (_t, prop) => (prop === Symbol.toPrimitive ? () => '' : prop === 'then' ? undefined : INERT),
  apply: () => INERT,
});

async function loadFleet(agentMock, logs, instrument) {
  const stubs = Object.assign({}, helpers, {
    agent: agentMock, log: (m) => logs.push(m), instrument, runId: 'testrun', invocationId: 'inv1',
    cfg: { maxAttempts: 1, deliver: true, implModel: 'x', verifyModel: 'y', deliverModel: 'z' },
    scout: { defaultBranch: 'main', repoMap: '', testCommand: 'echo ok' }, testCommand: 'echo ok',
    rules: new Proxy({}, { get: () => () => '' }), dedupeBrief: () => '',
    treeGuardCheck: async () => {}, assertNoBreach: () => {}, revParse: async () => null,
    unusableReason: (who, detail) => `${who} output unusable: ${detail}`,
    runHalt: helpers.createRunHalt(() => {}),
  });
  const scope = new Proxy(stubs, {
    has: (_t, prop) => prop !== Symbol.unscopables,
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
      return prop in globalThis ? globalThis[prop] : INERT;
    },
  });
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${block('FLEET-DELIVER-PROMPT')}\n${block('FLEET-CODE-LANE')}\nreturn { deliverPrompt, runCodeLane };\n}`);
  return wrapper(scope);
}

const TICKET = { number: 1139, title: 't', criteria: '' };
const BRANCH = 'agent/issue-1139-attempt1-wf_testrun-w0';

for (const instrument of ['gh', 'mcp']) {
  test(`deliver prompt (${instrument}) routes a refused command with no route of its own to the connector (issue 1139)`, async () => {
    const { deliverPrompt } = await loadFleet(async () => null, [], instrument);
    const prompt = deliverPrompt({ t: TICKET, branch: BRANCH, evidence: 'ran the gate; exit 0', unmetCriteria: [], defaultBranch: 'main', testCommand: 'echo ok' });
    assert.match(prompt, /A9 for a refused command in any step that names no route of its own/,
      'A0 must send an unrouted refusal to A9, not end the delivery');
    assert.doesNotMatch(prompt, /When the step names no route, stop and return the refusal text/,
      'the old A0 ending is what left run 6abd62b5 with two verified branches and no PR');
    const a9 = prompt.slice(prompt.indexOf('A9. DELIVER THROUGH THE CONNECTOR'), prompt.indexOf('STEP B - push and open the PR'));
    assert.ok(a9.length > 0, 'A9 must sit in STEP A, before STEP B');
    assert.match(a9, /Open the PR with `mcp__github__create_pull_request`, head agent\/issue-1139-attempt1-wf_testrun-w0, base main/,
      'A9 opens the PR from the pushed branch with the connector');
    assert.match(a9, /names the refused command and quotes the refusal text VERBATIM/, 'the refusal is noted in the PR body');
    assert.match(a9, /`mcp__github__add_issue_comment`/, 'the ticket comment goes through the connector too');
    assert.match(a9, /Return pushed true, the prUrl, mergeStatus "unmerged-by-classifier", conflictPaths \[\] and blockedReason "<the refused command>: <the refusal text VERBATIM>"/,
      'A9 returns a delivery the lane and STEP D already treat as open and owed the default-branch merge');
    assert.match(a9, /do not reproduce the refused command's effect any other way/,
      'the connector opens the PR and nothing else: a refusal is never worked around');
    assert.match(prompt, /When origin holds the tip the verifier passed and lacks only STEP A's merge commit, go to A9/,
      'a refused push over an unpushed local merge still delivers the verified tip');
  });
}

test('runCodeLane records a delivery opened by A9 after a refused command as delivered, with a mergeNote (issue 1139)', async () => {
  const refusal = 'git fetch origin main agent/issue-1139-attempt1-wf_testrun-w0: blocked by safety classifier: [Auto-Mode Bypass]';
  const labels = [];
  const logs = [];
  const agentMock = async (_prompt, opts) => {
    labels.push(opts.label);
    if (opts.label.startsWith('impl:')) return { branch: BRANCH, committed: true, pushed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
    if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran the gate; exit 0', failures: [] };
    if (opts.label.startsWith('deliver:')) {
      return { pushed: true, prUrl: 'https://github.com/x/y/pull/1139', mergeStatus: 'unmerged-by-classifier', conflictPaths: [],
        blockedReason: refusal, merged: false, mergeSha: '', prState: 'not-attempted' };
    }
    throw new Error('unexpected label: ' + opts.label);
  };
  const { runCodeLane } = await loadFleet(agentMock, logs, 'mcp');
  const result = await runCodeLane(TICKET, 0);
  assert.ok(labels.some((l) => l.startsWith('deliver:')), 'the lane must reach the deliverer');
  assert.equal(result.done, true, 'a PR opened through the connector is a delivery');
  assert.equal(result.prUrl, 'https://github.com/x/y/pull/1139');
  assert.equal(result.deliveryFailure, null, 'not "did not deliver: pushed=null prUrl=(none)"');
  assert.equal(result.merged, false, 'STEP D leaves the PR for the orchestrator (D0)');
  assert.ok(result.mergeNote && result.mergeNote.includes(refusal), 'the mergeNote carries the refused command and its refusal text');
  assert.doesNotMatch(result.mergeNote, /refused `git merge/, 'the refused command is not always the merge');
  assert.ok(logs.some((m) => m.includes('https://github.com/x/y/pull/1139') && /WITHOUT the pre-push merge: the classifier refused a command of the Deliver stage/.test(m)),
    'the deliver log line names the PR and says it still owes the default-branch merge');
});
