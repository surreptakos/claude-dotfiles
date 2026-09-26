#!/usr/bin/env node
/**
 * node --test tools/ticket-fleet-contract.test.js
 *
 * Covers issue 333: forked `.claude/workflows/ticket-fleet.js` copies and the
 * runbooks that launch them went stale silently whenever the plugin's arg list
 * moved. The contract is versioned now, so a launch at the wrong version fails
 * naming both sides and the ripple list - and the ripple list itself is pinned
 * here against the INTERNALS.md ripple table that documents it and the script that enforces it.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const FLEET_SCRIPT = path.join(REPO_ROOT, 'aac-skills', 'ticket-fleet', 'ticket-fleet.js');
const FLEET_SKILL = path.join(REPO_ROOT, 'aac-skills', 'ticket-fleet', 'INTERNALS.md');
const contract = require('./ticket-fleet-contract.js');
const { sliceBetween } = require('./source-slice.js');
const {
  CONTRACT_VERSION, FORKS, RUNBOOKS, checkLaunchArgs, contractVersionOf, auditForkFiles,
  FLEET_SOURCE_REPO, decideFleetRefresh,
} = contract;

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

test('decideFleetRefresh skips every FORKS repo and the source repo before any refresh step (issue 804)', () => {
  for (const fork of FORKS) {
    assert.deepEqual(decideFleetRefresh(fork.repo), { skip: true, reason: 'fork keeps its own edits' },
      `a served repo listed in FORKS (${fork.repo}) must never reach the refresh step`);
  }
  assert.deepEqual(decideFleetRefresh(FLEET_SOURCE_REPO), { skip: true, reason: 'source repo' });
  assert.deepEqual(decideFleetRefresh('surreptakos/some-other-repo'), { skip: false },
    'a repo that is neither the source nor a listed fork must be allowed to refresh');
});

test('the plugin-served script decides the fork skip in JS before spawning the refresh agent (issue 804)', () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /FLEET_FORKS\.includes\(servedRepo\)/,
    'the skip must be a JS check against FLEET_FORKS, not a step inside the refresh agent\'s own prompt');
  assert.match(src, /FLEET_FORK_MARKER = 'PROMPT_CONTRACT'/,
    'the refresh agent must be told to refuse a copy carrying the cockpit fork marker, as a second rail');
  const servedRepoLabelIdx = src.indexOf("label: 'fleet-refresh-repo'");
  const decisionIdx = src.indexOf('FLEET_FORKS.includes(servedRepo)');
  const refreshLabelIdx = src.indexOf("label: 'fleet-refresh'");
  assert.ok(servedRepoLabelIdx > -1 && decisionIdx > servedRepoLabelIdx,
    'the servedRepo-reporting agent must be spawned before the FLEET_FORKS check runs');
  assert.ok(refreshLabelIdx > -1 && decisionIdx < refreshLabelIdx,
    'the FLEET_FORKS check must precede the refresh agent spawn in source order, so a fork never reaches it');
});

test('the script\'s own refresh block never spawns the refresh agent for a FORKS repo, however servedRepo is spelled (issue 804)', async () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const start = src.indexOf('// [FLEET-REFRESH-START]');
  const end = src.indexOf('// [FLEET-REFRESH-END]');
  assert.ok(start > -1 && end > start, 'the FLEET-REFRESH marker pair must bracket the refresh block');
  const scriptForks = JSON.parse(((src.match(/const FLEET_FORKS = (\[[^\]]*\])/) || [])[1] || '[]').replace(/'/g, '"'));
  assert.deepEqual(scriptForks.sort(), FORKS.map((f) => f.repo).sort(),
    'the script\'s FLEET_FORKS must list exactly the FORKS of tools/ticket-fleet-contract.js');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  // gitSpelling is the script's own helper (issue 883); the block calls it, so the sandbox supplies it.
  const run = new AsyncFunction('agent', 'log', 'cfg', 'unusableReason', 'gitSpelling', src.slice(start, end));
  const spellings = (repo) => [repo, `${repo}.git`, repo.toUpperCase(), `https://github.com/${repo}.git`, `git@github.com:${repo}.git`];
  const reachesRefresh = async (reported) => {
    const labels = [];
    await run(async (_prompt, opts) => {
      labels.push(opts.label);
      return opts.label === 'fleet-refresh-repo' ? { servedRepo: reported } : { refreshed: [], unchanged: [], commit: '', errors: [] };
    }, () => {}, { reportModel: 'm' }, (_label, msg) => msg, (_instrument, args) => `git ${args}`);
    assert.equal(labels[0], 'fleet-refresh-repo', 'the servedRepo-only agent must be the first spawn');
    return labels.includes('fleet-refresh');
  };
  for (const fork of FORKS) {
    for (const reported of spellings(fork.repo)) {
      assert.equal(await reachesRefresh(reported), false, `servedRepo "${reported}" is the fork ${fork.repo} and must never reach the refresh agent`);
    }
  }
  for (const reported of spellings(FLEET_SOURCE_REPO)) assert.equal(await reachesRefresh(reported), false);
  assert.equal(await reachesRefresh('surreptakos/some-other-repo'), true, 'a non-fork served repo must still be refreshed');
});

test('the INTERNALS.md ripple table names every fork holder, runbook and the current version', () => {
  const skill = fs.readFileSync(FLEET_SKILL, 'utf8');
  assert.match(skill, new RegExp(`contract v${CONTRACT_VERSION}\\b`),
    'INTERNALS.md must state the contract version a caller has to declare');
  for (const fork of FORKS) {
    assert.ok(skill.includes(fork.repo) && skill.includes(fork.path),
      `INTERNALS.md must list the fork at ${fork.repo} ${fork.path} as a ripple target`);
  }
  for (const doc of RUNBOOKS) {
    const file = doc.split(' ').pop();
    assert.ok(skill.includes(file), `INTERNALS.md must list ${file} as a ripple target`);
  }
});

test('the SCOUT ticket schema has a body field, and the implementer prompt interpolates it (issue 886)', () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /body: \{ type: 'string', description: "the ticket's issue body, verbatim/,
    'SCOUT tickets must declare a body field, distinct from the extracted criteria');

  // Pull the implementer prompt's template literal out of the source and actually render it
  // against a fixture ticket (issue 807: the implementer got only title + criteria and guessed the
  // fix), rather than trusting that a `${t.body}` substring nearby means it is really threaded in.
  const promptSrc = sliceBetween(
    src,
    'Implement GitHub issue #${t.number}: ${t.title}',
    "Return structured output only.`,\n      { label: `impl:#",
    "the implementer prompt template in ticket-fleet.js's code lane"
  );

  const fixtureBody = 'FIXTURE ISSUE BODY: reproduce with `foo --bar`, expected baz (issue 886 fixture)';
  const t = { number: 886, title: 'Fixture ticket', criteria: 'Fixture acceptance criteria', body: fixtureBody };
  const branch = 'agent/issue-886-fixture';
  const scout = { repoMap: 'fixture repo map', defaultBranch: 'main' };
  const chainStart = '';
  const priorFindings = '';
  const instrument = 'gh';
  const testCommand = 'npm test';
  const PYTHON_RAIL = '(python rail fixture)';
  const SCRATCH_RAIL = '(scratch rail fixture)';
  const HARNESS_RELAY_RAIL = '(harness relay rail fixture)';
  const dedupeBrief = () => '';
  const gitSpelling = (_instrument, cmd) => `git ${cmd}`;

  // eslint-disable-next-line no-new-func
  const render = new Function(
    't', 'branch', 'scout', 'chainStart', 'priorFindings', 'instrument', 'testCommand',
    'PYTHON_RAIL', 'SCRATCH_RAIL', 'HARNESS_RELAY_RAIL', 'dedupeBrief', 'gitSpelling',
    `return \`${promptSrc}\`;`
  );
  const rendered = render(t, branch, scout, chainStart, priorFindings, instrument, testCommand,
    PYTHON_RAIL, SCRATCH_RAIL, HARNESS_RELAY_RAIL, dedupeBrief, gitSpelling);

  assert.ok(rendered.includes(fixtureBody),
    "the rendered implementer prompt must contain the fixture ticket's body text verbatim");
});

test('the implementer and prober prompts tell a worker not to file the harness-relayed launch request as a discovery (issue 885)', () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const railIdx = src.indexOf('const HARNESS_RELAY_RAIL = `Harness-relayed request rail (issue 885):');
  assert.ok(railIdx > -1, 'the harness-relayed request rail must be defined as its own shared const, like PYTHON_RAIL and SCRATCH_RAIL');
  const probeLabelIdx = src.indexOf("label: `probe:#");
  const implLabelIdx = src.indexOf("label: `impl:#");
  assert.ok(probeLabelIdx > -1 && implLabelIdx > -1, 'both the prober and implementer agent calls must still exist');
  const probePromptStart = src.lastIndexOf('`Probe GitHub issue', probeLabelIdx);
  const implPromptStart = src.lastIndexOf('`Implement GitHub issue', implLabelIdx);
  assert.ok(probePromptStart > -1 && probePromptStart < probeLabelIdx,
    'the prober prompt template must reference ${HARNESS_RELAY_RAIL} between its own start and its agent() call');
  assert.ok(implPromptStart > -1 && implPromptStart < implLabelIdx,
    'the implementer prompt template must reference ${HARNESS_RELAY_RAIL} between its own start and its agent() call');
  assert.ok(src.slice(probePromptStart, probeLabelIdx).includes('${HARNESS_RELAY_RAIL}'),
    'the prober prompt must splice in HARNESS_RELAY_RAIL');
  assert.ok(src.slice(implPromptStart, implLabelIdx).includes('${HARNESS_RELAY_RAIL}'),
    'the implementer prompt must splice in HARNESS_RELAY_RAIL');
});
