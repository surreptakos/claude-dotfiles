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
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const {
  generateRunId, buildBranchName, workerSuffix, pickInstrument, confineToCandidates, dropParkedTickets, resolveVerifierAgent, pickVerifierAgent,
  applyBlockerStates, shaMatches, worktreeMismatch, applyOpenPrs, selectWave,
  stableJson, stableText, stableList, priorFindingsBlock, unmetCriteriaOf,
  FLEET_BRANCH_PREFIXES, DISCOVERIES_BRANCH_PREFIX, buildDiscoveriesBranchName, isFleetBranch,
  classifyBranchLookup, classifyDelivery,
  LIVE_TREE_EXCLUSIONS, liveTreeFindCommand, liveTreeExclusionNote,
  buildTipLookupCommand, parseLsRemoteSha, parseTipLookupOutput,
} = require('./ticket-fleet-branch.js');
// Issue 488: every slice between two literals in this file goes through these, so a renamed anchor
// fails the assertion that depends on it instead of silently slicing to end-of-file.
const { sliceBetween, sliceBetweenTags } = require('./source-slice.js');

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

// Issue 377: the fleet creates two branch shapes, and the discoveries branch was added
// (issue 360) after every "the fleet's branches" enumeration had been written against
// `agent/issue-*`. FLEET_BRANCH_PREFIXES is the one list those enumerations widen against.
test('isFleetBranch covers both fleet branch shapes (issue 377)', () => {
  assert.deepEqual([...FLEET_BRANCH_PREFIXES], ['agent/issue-', 'agent/fleet-discoveries-'],
    'the fleet branch prefix list must name the discoveries prefix beside the issue prefix');
  assert.equal(buildDiscoveriesBranchName('testrun'), 'agent/fleet-discoveries-wf_testrun');
  assert.equal(isFleetBranch(buildDiscoveriesBranchName('testrun')), true,
    'the discoveries branch must be recognised as a fleet branch');
  assert.equal(isFleetBranch('refs/heads/' + buildBranchName(29, 'abc123', 0, 1)), true,
    'a refs/heads ref (what a worktree HEAD file holds) must be accepted');
  assert.equal(isFleetBranch('master'), false);
  assert.equal(isFleetBranch(DISCOVERIES_BRANCH_PREFIX), false,
    'a bare prefix with no runId is not a branch the fleet created');
  assert.equal(isFleetBranch(null), false);
});

// Issue 377: a merge pass or a worktree cleanup that matches `agent/issue-*` alone skips the
// discoveries PR and strands the run's bullets - the failure issue 360 exists to end. Pin the
// prefix against each place fleet branches are enumerated.
test('every enumeration of fleet branches names the discoveries prefix (issue 377)', () => {
  const runbook = fs.readFileSync(path.join(REPO_ROOT, 'orchestrator', 'RUNBOOK.md'), 'utf8');
  const mergePassStep = sliceBetween(runbook, '**Merge pass (before the fleet).**', '\n4. ',
    "RUNBOOK.md's merge pass step");
  assert.ok(mergePassStep.includes(DISCOVERIES_BRANCH_PREFIX + '*'),
    "RUNBOOK.md's merge pass must match agent/fleet-discoveries-* as well as agent/issue-*");

  const backfill = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'backfill-worktree-configs.js'), 'utf8');
  assert.match(backfill, /require\('\.\/ticket-fleet-branch\.js'\)/,
    'the worktree cleanup must take its fleet prefixes from this module, not spell its own');
  assert.match(backfill, /isFleetBranch\(branch\)/,
    'the worktree cleanup must classify a worktree branch through isFleetBranch');

  const fleetScript = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.ok(fleetScript.includes(DISCOVERIES_BRANCH_PREFIX + 'wf_${runId}'),
    `the fleet script's discoveries branch must keep the ${DISCOVERIES_BRANCH_PREFIX} shape this list enumerates`);
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
  assert.equal(pickInstrument(undefined, true, undefined), null,
    'gh on PATH says nothing about remoteness: a container has it too (issue 322)');
  assert.equal(pickInstrument(null, false, undefined), 'mcp');
});

// ---- pickVerifierAgent (issue 339) ----
// A SessionStart hook's write to ~/.claude/agents/ is not visible to that session's agent
// registry (experiment recorded in docs/tickets/339-decision.md), so a cloud session must
// never be handed a dotfiles-defined agentType.

test('pickVerifierAgent never pins a custom agent type in a remote session (issue 339)', () => {
  assert.equal(pickVerifierAgent(true, true), null, 'a container cannot resolve a dotfiles agent even when the file is on disk');
  assert.equal(pickVerifierAgent(true, false), null);
});

test('pickVerifierAgent pins fleet-verifier locally only when the agent file exists', () => {
  assert.equal(pickVerifierAgent(false, true), 'fleet-verifier');
  assert.equal(pickVerifierAgent(false, false), null);
});

// ---- unknown environment + verifier agent type (issues 316, 322) ----
// The workflow runtime does not expose `process`, so the script passes `null` rather than a
// fabricated `{}`: an absent env is an unknown environment, not an empty one. It used to fall
// back to `gh`, and a container run then pinned an agent type its registry did not hold and
// reached for a GraphQL PR call (issue 322), so an unknown environment now resolves to nothing
// and the caller has to name the instrument.

test('pickInstrument treats a missing process binding as an unknown environment', () => {
  const noProcessEnv = null; // what the script passes when nothing measured the environment
  assert.equal(pickInstrument(noProcessEnv, undefined, undefined), null,
    'unknown environment must resolve to nothing, never to gh (issue 322)');
  assert.equal(pickInstrument(noProcessEnv, undefined, 'auto'), null);
  assert.equal(pickInstrument(noProcessEnv, true, undefined), null,
    '`gh` on PATH is not evidence of a desktop session - a container carries it too');
  assert.equal(pickInstrument(noProcessEnv, undefined, 'mcp'), 'mcp',
    'an explicit instrument must still win when the environment is unknown');
  assert.equal(pickInstrument(noProcessEnv, false, undefined), 'mcp',
    'a measured absence of `gh` is positive evidence, so it still resolves');
});

test('resolveVerifierAgent pins fleet-verifier only when the probe saw the agent file (issue 322)', () => {
  assert.equal(resolveVerifierAgent('gh', undefined), undefined,
    'without probe facts nothing says the agent is registered, so the gh instrument must not pin it');
  assert.equal(resolveVerifierAgent('gh', null), undefined);
  assert.equal(resolveVerifierAgent('mcp', undefined), undefined);
  assert.equal(resolveVerifierAgent('gh', undefined, { remote: false, verifierAgentFile: true }), 'fleet-verifier',
    'a desktop session whose agent file is on disk pins it');
  assert.equal(resolveVerifierAgent('gh', undefined, { remote: false, verifierAgentFile: false }), undefined,
    'no agent file on disk, no pin');
  assert.equal(resolveVerifierAgent('gh', undefined, { remote: true, verifierAgentFile: true }), undefined,
    'a container never pins, whatever instrument it picked (issue 316)');
  assert.equal(resolveVerifierAgent('mcp', 'fleet-verifier'), 'fleet-verifier',
    'a named agent pins on either instrument');
});

test('verifier agentType is unset when verifierAgent is empty', () => {
  // A cloud container has no ~/.claude/agents entry, so the pin must be clearable: an empty
  // verifierAgent means the verifier launches under the session's default agent type.
  assert.equal(resolveVerifierAgent('gh', ''), undefined);
  assert.equal(resolveVerifierAgent('gh', '   '), undefined);
  assert.equal(resolveVerifierAgent('mcp', ''), undefined);
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

// The Workflow tool parses the file behind `scriptPath` before it shows the approval dialog, so a
// script that does not parse cannot launch anywhere - and nothing else on the gate ran the parser:
// f9bace7 shipped an unescaped apostrophe inside meta.whenToUse and every fleet launch failed with
// "Script parse error" until it was noticed by hand. The runtime wraps the body in an async
// function (top-level `return` and `await` are legal there) after lifting the `export const meta`
// line, so the check does the same before handing the text to node's parser.
for (const file of [FLEET_SCRIPT, FLEET_SCRIPT_PACKAGED]) {
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  test(`fleet script ${rel} parses as a workflow script (Workflow scriptPath refuses a parse error)`, () => {
    const body = fs.readFileSync(file, 'utf8').replace(/^export /m, '');
    const res = spawnSync(process.execPath, ['--check', '-'], {
      input: `(async () => {\n${body}\n});\n`, encoding: 'utf8',
    });
    assert.equal(res.status, 0, `${rel} does not parse:\n${res.stderr}`);
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

test(`fleet script ${FLEET_SCRIPT_REL} measures the environment instead of reading process.env (issues 322, 339)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /label: 'env-probe'/,
    'fleet must resolve the instrument from an env-probe agent, not from a caller-passed flag');
  assert.doesNotMatch(src, /typeof process !== 'undefined'/,
    'fleet must not sniff process.env: the workflow runtime does not expose it (issue 322)');
  assert.match(src, /re-run with instrument: "gh"[\s\S]*?or instrument: "mcp"/,
    'a failed probe on instrument:auto must stop the run and name what to pass, not default to gh');
  assert.match(src, /remote: null,/,
    'fleet must expose args.remote so a caller whose probe cannot run can still resolve the switch (issue 322)');
  assert.match(src, /if \(!instrument\) \{/,
    'an unresolved instrument must stop the run rather than proceeding on a default (issue 322)');
});

test(`fleet script ${FLEET_SCRIPT_REL} opens PRs through REST on the gh instrument (issue 322)`, () => {
  const ghRules = loadTrackerRules(FLEET_SCRIPT, 'gh');
  const bodyFile = '/tmp/fleet-testrun/pr-9-body.md';
  assert.match(ghRules.prCreate(bodyFile), /gh api --method POST repos\/\{owner\}\/\{repo\}\/pulls/,
    'the gh deliver prompt must open the PR with the REST pulls endpoint');
  assert.match(ghRules.prCreate(bodyFile), /NEVER `gh pr create`/,
    'the prompt must name the GraphQL-backed spelling it forbids (HTTP 403 here - issues 130, 322)');
  assert.match(loadTrackerRules(FLEET_SCRIPT, 'mcp').prCreate(bodyFile), /mcp__github__create_pull_request/);
});

// Issue 439: the scratchpad a sub-agent is told is "session-specific" is keyed by project and
// parent session, so every worker of one wave shares it - one worker's `msg.txt` commit message
// was overwritten by another's mid-run. Every prompt that asks for a file must therefore name the
// path itself, and that path must carry the run id, so two workers cannot pick the same one.
test(`fleet script ${FLEET_SCRIPT_REL} names a per-worker path for every file it asks a worker to write (issue 439)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /const scratchRoot = `\/tmp\/fleet-\$\{runId\}`/,
    'the scratch root must carry the run id so two concurrent runs cannot share it');
  assert.doesNotMatch(src, /body=@<file>|<scratch dir>|<a fresh scratch directory>/,
    'no prompt may leave the file or worktree path to the worker: a generic name collides in the shared scratchpad');
  const bodyFile = '/tmp/fleet-testrun/probe-9-comment.md';
  const ghRules = loadTrackerRules(FLEET_SCRIPT, 'gh');
  assert.match(ghRules.commentPost(bodyFile), /-F body=@\/tmp\/fleet-testrun\/probe-9-comment\.md/,
    'the gh comment rule must post the body file it names, not an unspecified <file>');
  assert.match(ghRules.prComment(bodyFile), /-F body=@\/tmp\/fleet-testrun\/probe-9-comment\.md/,
    'the gh PR-comment rule must post the body file it names');
  // Every per-ticket scratch path is built from a template, and each must carry the ticket number:
  // the run id alone is shared by every worker of the wave. The two run-level writers (the
  // discovery branch and its PR body) are single-writer per run and pass a plain string.
  for (const call of src.match(/scratchFile\(`[^`]+`\)/g) || []) {
    assert.match(call, /\$\{t\.number\}/,
      `${call} must carry the ticket number, not a name every worker of the wave would pick`);
  }
  assert.match(src, /SCRATCH_RAIL/,
    'the implementer and prober prompts must carry the scratch-file rail');
});

test(`fleet script ${FLEET_SCRIPT_REL} dates the Report phase heading (issue 322)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /## Run <DATE> \(ticket-fleet \$\{runId\}\)/,
    'the FOLLOW-UPS heading must carry both the ISO date and the run id so two runs are tellable apart');
  assert.match(src, /date -u \+%F/,
    'the writer has a shell, so the date comes from it - workflow scripts cannot call new Date()');
});

test(`fleet script ${FLEET_SCRIPT_REL} gates the verifier agentType on remoteness, not the instrument (issue 339)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /function pickVerifierAgent/,
    'fleet must inline pickVerifierAgent so the workflow runtime does not need require()');
  assert.doesNotMatch(src, /agentType: instrument ===/,
    "the agentType pin must not be keyed on the tracker instrument (issue 316's container picked gh and had no registry)");
  const pins = src.match(/agentType: [^,}\n]+/g) || [];
  assert.ok(pins.length > 0, 'expected at least one agentType pin in the fleet script');
  for (const pin of pins) {
    assert.match(pin, /verifierAgent/, `agentType pin must come from pickVerifierAgent, found: ${pin}`);
  }
});

test(`fleet script ${FLEET_SCRIPT_REL} resolves the verifier agentType from args.verifierAgent`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /verifierAgent: null/,
    'fleet must expose verifierAgent in cfg so a container can clear the pin (issue 316)');
  assert.match(src, /function resolveVerifierAgent/,
    'fleet must inline resolveVerifierAgent so the workflow runtime does not need require()');
  assert.match(src, /const verifierAgentType = resolveVerifierAgent\(instrument, cfg\.verifierAgent, facts\)/,
    'fleet must resolve the verifier agentType once from the instrument and cfg.verifierAgent');
  assert.equal((src.match(/agentType: verifierAgentType/g) || []).length, 2,
    'both verify stages (probe lane and code lane) must pass the resolved agentType');
  assert.ok(!/agentType: instrument === 'gh'/.test(src),
    'the hard-coded fleet-verifier pin must be gone - it fails every launch in a container (issue 316)');
});

test(`fleet script ${FLEET_SCRIPT_REL} VERDICT schema does not require failures (issue 265)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const decl = /const VERDICT = \{ type: 'object', required: \[([^\]]*)\]/.exec(src);
  assert.ok(decl, 'VERDICT schema declaration not found');
  assert.ok(!/failures/.test(decl[1]),
    "VERDICT must not require `failures`: a verifier returning {pass:true, evidence} without it burned the StructuredOutput retry cap on issue 241");
  assert.match(src, /if \(lastVerdict && !Array\.isArray\(lastVerdict\.failures\)\) lastVerdict\.failures = \[\]/,
    'each verifier call site must normalise a missing failures key to []');
});

// ---- Open-PR guard freshness (issue 291) ----
// The guard is an agent() call and the runtime replays cached agent results on resume, so the
// guard is only honest while its cache key moves between invocations. `runId` cannot supply that:
// it is deliberately fixed across a resume because the branch names embed it. `invocationId` is
// the caller-minted per-launch token, and it must appear in the open-PR scan's prompt and label - and
// nowhere else, so no other stage loses its cache and no branch name moves.
test(`fleet script ${FLEET_SCRIPT_REL} keys the open-PR guard on a per-invocation token (issue 291)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /const invocationId = String\(cfg\.invocationId/,
    'invocationId must come from args - a value derived from runId is stable across a resume');
  assert.match(src, /if \(!invocationId\) throw (?:new Error|contractError)\(/,
    'the fleet must refuse to run without a per-invocation token rather than guard on a stale cache');
  assert.match(src, /if \(invocationId === runId\) throw (?:new Error|contractError)\(/,
    'invocationId must be rejected when it merely repeats runId');
  const body = extractMarked(src, 'FLEET-OPEN-PR');
  assert.match(body, /label: `open-pr-scan@\$\{invocationId\}`/,
    'the open-PR scan agent label must carry invocationId');
  const prompt = sliceBetween(body, 'found = await agent(', 'label: `open-pr-scan@', 'the open-PR scan prompt');
  assert.match(prompt, /\$\{invocationId\}/, 'the open-PR scan prompt must carry invocationId');
  assert.equal((src.match(/\$\{invocationId\}/g) || []).length, 2,
    'invocationId belongs in the open-PR scan prompt and label only: anywhere else it would move a branch name or bust another stage cache');
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

// Issue 334: the harness itself writes under ~/.claude/projects during every run (session
// transcript, tool-results/*.txt, subagent and workflow logs), so an unfiltered -newermt sweep
// reported a live-tree breach for an implementer that never left its worktree. The two
// exclusions must be spelled out in the prompt - a verifier left to re-derive them either
// re-reports the false breach or quietly widens the hole.
test(`fleet script ${FLEET_SCRIPT_REL} excludes harness-written session state from the live-tree sweep (issue 334)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(liveTreeFindCommand('T'), /-not -path '\*\/hook-state\/\*' -not -path '\*\/\.claude\/projects\/\*'/,
    `${FLEET_SCRIPT_REL} live-tree find must exclude ~/.claude/projects (tool-results, transcripts) as well as hook-state`);
  assert.match(src, /~\/\.claude\/projects holds this session's transcripts, tool-results\/\*\.txt/,
    `${FLEET_SCRIPT_REL} must state the exclusion and why in the prompt so the verifier does not re-derive it`);
  for (const reportable of ['~/.claude/skills', '~/.claude/hooks', '~/.claude/settings.json', '~/.codex']) {
    assert.ok(src.includes(reportable),
      `${FLEET_SCRIPT_REL} verifier prompt must still name ${reportable} as a reportable live-tree write`);
  }
});

// Issue 489: ~/.claude/sessions/<pid>.json is the CLI's own process registry, heartbeat-rewritten
// by the PARENT session, so it is always newer than the implementer's first commit - without this
// exclusion no attempt can pass the rail, and a rail that always fires teaches the next verifier
// to wave it through.
test(`fleet script ${FLEET_SCRIPT_REL} excludes the CLI session registry from the live-tree sweep (issue 489)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(liveTreeFindCommand('T'), /-not -path '\*\/hook-state\/\*' -not -path '\*\/\.claude\/projects\/\*' -not -path '\*\/\.claude\/sessions\/\*'/,
    `${FLEET_SCRIPT_REL} live-tree find must exclude ~/.claude/sessions alongside hook-state and projects`);
  assert.match(src, /~\/\.claude\/sessions\/<pid>\.json is the CLI's own process registry, heartbeat-rewritten/,
    `${FLEET_SCRIPT_REL} must state why ~/.claude/sessions is excluded so the verifier does not re-derive it`);
});

// Issue 677: ~/.claude/skills/synced/<id>/manifest.json is the CLI's skills-sync catalogue, rewritten
// by the verifying session's own Skill and ToolSearch loads. Run the generated find against a fake
// home: the bookkeeping paths stay quiet and a real implementer write under ~/.claude still fires.
test('live-tree find skips the CLI skills-sync manifest but still catches an implementer write (issue 677)', (t) => {
  // The rail runs in a Linux container. On a Windows runner Git Bash's `find` prints POSIX paths
  // (/c/Users/...) for a HOME the test created with a drive letter, so path.relative() cannot pair
  // them and the assertion below fails on the path spelling, not on the exclusions: the restore
  // suite went red on master at 1c250885 for exactly that. The Linux gate keeps the case live.
  if (process.platform === 'win32') { t.skip('bash find prints POSIX paths for a Windows HOME; covered by the Linux gate'); return; }
  const home = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fleet-677-'));
  try {
    const quiet = ['.claude/skills/synced/abc_def/manifest.json', '.claude/sessions/42.json',
      '.claude/projects/p/s.jsonl', '.claude/hook-state/x/state.json'];
    const loud = ['.claude/skills/foo/SKILL.md', '.claude/settings.json', '.codex/config.toml', '.agents/a.md'];
    for (const rel of [...quiet, ...loud]) {
      fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
      fs.writeFileSync(path.join(home, rel), 'x');
    }
    const r = spawnSync('bash', ['-c', liveTreeFindCommand('2000-01-01T00:00:00Z')],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const hits = r.stdout.split('\n').filter(Boolean).map((f) => path.relative(home, f)).sort();
    assert.deepStrictEqual(hits, [...loud].sort());
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test(`fleet script ${FLEET_SCRIPT_REL} builds the live-tree exclusions from one list (issue 677)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const handWritten = src.slice(0, src.indexOf('// [FLEET-GENERATED-START]'))
    + src.slice(src.indexOf('// [FLEET-GENERATED-END]'));
  for (const e of LIVE_TREE_EXCLUSIONS) {
    assert.ok(!handWritten.includes(e.path),
      `${FLEET_SCRIPT_REL} must not spell exclusion ${e.path} outside the generated LIVE_TREE_EXCLUSIONS`);
  }
  assert.ok(handWritten.includes("${liveTreeFindCommand('<that time>')}") && handWritten.includes('${liveTreeExclusionNote()}'),
    `${FLEET_SCRIPT_REL} verifier prompt must take the rail's find command and reasons from the generated helpers`);
  assert.ok(LIVE_TREE_EXCLUSIONS.some((e) => e.path === '*/.claude/skills/synced/*'));
  assert.match(liveTreeExclusionNote(), /add none of your own, do not re-derive them/,
    'the prompt must still forbid the verifier inventing its own exclusions');
});

// ---- Three-copies gone (issue 138) ----
// The consolidation ticket deletes the pre-plugin copies. A regression that re-adds one
// silently re-opens the drift the plugin move was meant to close.

const REMOVED_COPIES = [
  '.claude/workflows/ticket-fleet.js',
  'orchestrator/ticket-fleet-cloud.js',
  'aac-skills/project-harness/templates/ticket-fleet.js',
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
// Issue 755: every push instruction in the fleet's prompts goes through gitSpelling, so the
// source anchor for "the push" is that call, not a bare `git push` literal.
const PUSH_ANCHOR = 'gitSpelling(instrument, `push -u origin ${branch}`)';

function extractMarked(src, name) {
  // Everything between the markers (exclusive); a marker that moved is a named failure (issue 488).
  return sliceBetweenTags(src, `// [${name}-START]`, `// [${name}-END]`, `the ${name} block`);
}

// A stand-in for any module-scope binding the lane references that this harness does not model:
// callable, constructable, property-readable, and it renders as '' inside a template literal. It is
// deliberately inert - it exists so an unmodelled reference resolves instead of throwing.
const PERMISSIVE = new Proxy(function stub() {}, {
  get(_t, prop) {
    if (prop === Symbol.toPrimitive) return () => '';
    if (prop === 'then') return undefined; // never look thenable to `await`
    return PERMISSIVE;
  },
  apply: () => PERMISSIVE,
  construct: () => PERMISSIVE,
});

// Issue 340: the lane body used to be evaluated with a hand-maintained parameter list, so every new
// module-scope binding in the fleet (verifierAgentType, dedupeBrief, ...) failed here as a bare
// `ReferenceError: X is not defined` that read like a lane regression. Instead the body now runs
// inside `with (scope)` over a Proxy whose `has` trap claims every name: a name this harness stubs
// resolves to the stub, a real global resolves to itself, and anything else resolves to PERMISSIVE.
// Adding a binding to the lane therefore needs no edit here. Bodies built by the Function
// constructor are non-strict whatever the enclosing module says, so `with` is legal.
function laneScope(stubs) {
  return new Proxy(stubs, {
    has: (_t, prop) => prop !== Symbol.unscopables,
    get(target, prop) {
      // Symbols are never free identifiers, and `with` reads Symbol.unscopables off the scope
      // object: answering PERMISSIVE there marks every name unscopable and blocks the binding.
      if (typeof prop === 'symbol') return undefined;
      if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
      if (prop in globalThis) return globalThis[prop];
      return PERMISSIVE;
    },
  });
}

// The runCodeLane body — the const runCodeLane = async (...) => { ... }.
function extractCodeLane(src) { return extractMarked(src, 'FLEET-CODE-LANE'); }

// The block the fleet script carries generated from tools/ticket-fleet-branch.js (issue 440):
// the instrument switch, the verifier-agent decision, the scout gate's candidate filter, the
// blocker-state filter and the resume-stable projections. Every harness below that needs one of
// them evaluates this block, so what the tests drive is the text the fleet script actually runs.
function generatedBlock(scriptPath = FLEET_SCRIPT) {
  return extractMarked(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-GENERATED');
}

// The resume-stable helpers the lanes funnel every prior agent result through (issue 271).
// Evaluated out of the script's generated block so the lane body below resolves them.
function loadStableHelpers(scriptPath) {
  // eslint-disable-next-line no-new-func
  return new Function(`${generatedBlock(scriptPath)}\nreturn { stableJson, stableText, stableList, priorFindingsBlock, unmetCriteriaOf, gitSpelling };`)();
}

// Evaluate a lane body and return its runCodeLane. `agent` is the spy the test drives; the rest are
// the bindings the assertions depend on (the lane also reads the instrument switch, the tracker
// rule helpers, the resume-stable helpers, the verifier agent type, the dedupe brief and the test
// command, stubbed so the body evaluates the same way under either instrument). `stubs` overrides
// any of them for one test.
async function instantiateCodeLane(body, agentMock, logs = [], stubs = {}, scriptPath = FLEET_SCRIPT) {
  // The Deliver prompt lives in its own marked block since issue 405 (the finish mode builds the
  // same text), so it is evaluated into the lane's own scope: the prompt the lane sends is the
  // real one, not a stub.
  const deliverBody = extractMarked(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-DELIVER-PROMPT');
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${deliverBody}\n${body}\nreturn runCodeLane;\n}`);
  return wrapper(laneScope(Object.assign({
    agent: agentMock,
    log: (m) => logs.push(m),
    cfg: { maxAttempts: 3, deliver: true, implModel: 'x', verifyModel: 'y', deliverModel: 'z' },
    runId: 'testrun',
    invocationId: 'inv1',
    scout: { defaultBranch: 'main', repoMap: '', testCommand: 'echo ok' },
    instrument: 'gh',
    rules: new Proxy({}, { get: () => () => '' }),
    verifierAgentType: 'fleet-verifier',
    // The discovery-triage dedupe brief (issue 319) is empty for every ticket that is not a
    // discovery-triage chore.
    dedupeBrief: () => '',
    testCommand: 'echo ok',
    // The aac-routines ports (issues 191, 192, 270): the isolation checkpoints and the
    // unusable-output helpers. Inert here; driveCodeLane swaps in a recording checkpoint.
    treeGuardCheck: async () => {},
    assertNoBreach: () => {},
    unusableReason: (who, detail) => `${who} output unusable: ${detail}`,
    unusableVerdict: (detail, who) => ({ pass: false, evidence: '', failures: [`${who || 'verifier'} output unusable: ${detail}`], unusable: true }),
    // Issue 404: the expected tip is read by its own one-command agent. Unreadable by default, so
    // the worktree cross-check is inert unless a test supplies a tip; driveCodeLane injects the
    // module's worktreeMismatch - the very function the generated block carries (issue 486) - so
    // the decision under test is the real one.
    revParse: async () => null,
    // Issue 654: the Deliver-result classifier is the module's own, the one the generated block carries.
    classifyDelivery,
  }, stubs)));
}

async function driveCodeLane(scriptPath, agentMock, ticket, workerIndex = 0, cfgOverrides = {}, invocationId = 'inv1', guardSpy = null, stubOverrides = {}) {
  const body = extractCodeLane(fs.readFileSync(scriptPath, 'utf8'));
  const helpers = loadStableHelpers(scriptPath);
  const logs = [];
  // Every orchestrator-tree checkpoint the lane reaches is recorded here (aac-routines issue 192).
  const checkpoints = [];
  const treeGuardCheck = async (label, ticketNumber) => {
    checkpoints.push(`${label}#${ticketNumber}`);
    if (guardSpy) await guardSpy(label, ticketNumber);
  };
  // runId is fixed while invocationId varies - the resume shape of issue 291. The resume-stable
  // helpers are the script's own (issue 271), so the prompts under test are the real ones.
  const runCodeLane = await instantiateCodeLane(body, agentMock, logs, Object.assign({
    cfg: Object.assign({ maxAttempts: 3, deliver: true, implModel: 'x', verifyModel: 'y', deliverModel: 'z' }, cfgOverrides),
    invocationId,
    stableJson: helpers.stableJson, stableText: helpers.stableText,
    stableList: helpers.stableList, priorFindingsBlock: helpers.priorFindingsBlock,
    unmetCriteriaOf: helpers.unmetCriteriaOf,
    gitSpelling: helpers.gitSpelling,
    worktreeMismatch,
    treeGuardCheck,
  }, stubOverrides), scriptPath);
  const result = await runCodeLane(ticket, workerIndex);
  return { result, logs, checkpoints };
}

test('lane harness resolves a module-scope binding it does not model (issue 340)', async () => {
  // Stands in for a future fleet edit: the lane references bindings this harness never names.
  const body = `const runCodeLane = async (t) => {
    const out = await agent(\`brief: \${dedupeBrief(t.number)}\`,
      { label: \`impl:#\${t.number}\`, schema: IMPL, agentType: verifierAgentType });
    return { ticket: t.number, out };
  }`;
  const calls = [];
  const runCodeLane = await instantiateCodeLane(body, async (_p, opts) => { calls.push(opts.label); return 'ok'; });
  const result = await runCodeLane({ number: 7 });
  assert.deepEqual(calls, ['impl:#7'], 'unmodelled bindings must not stop the lane from running');
  assert.deepEqual(result, { ticket: 7, out: 'ok' });
});

// Issue 360: the Report phase must commit its discovery bullets onto a branch cut from the repo
// default branch rather than appending them into whatever branch the session sits on. Drive the
// marked block with a mocked `agent` so the branch choice and the returned sha are behavior,
// not prompt-text trivia. Same proxy scope as the lanes, so an unmodelled binding is inert.
async function driveReport(scriptPath, agentMock, discoveries, cfgOverrides, stubs = {}) {
  const body = extractMarked(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-REPORT');
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${body}\nreturn runReport;\n}`);
  const runReport = await wrapper(laneScope({
    gitSpelling: loadStableHelpers(scriptPath).gitSpelling,
    agent: agentMock,
    cfg: Object.assign({ deliver: true, reportModel: 'r', followupsFile: 'FOLLOW-UPS.md' }, cfgOverrides || {}),
    runId: 'testrun',
    scout: { defaultBranch: 'main' },
    rules: new Proxy({}, { get: () => () => 'gh pr create' }),
    instrument: 'gh',
    DISCOVERY_REPORT: {},
    ...stubs,
  }));
  // The writer takes the default branch as an argument since issue 405: the finish mode calls it
  // with the branch its journal names, long before a scout would have run.
  return { result: await runReport(discoveries, 'main') };
}

for (const file of RESUME_GUARD_PAIR) {
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');

  test(`${rel} declares runCodeLane between FLEET-CODE-LANE markers`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /\/\/ \[FLEET-CODE-LANE-START\]/, 'missing FLEET-CODE-LANE-START marker');
    assert.match(src, /\/\/ \[FLEET-CODE-LANE-END\]/, 'missing FLEET-CODE-LANE-END marker');
    const body = extractCodeLane(src);
    assert.match(body, /const runCodeLane\s*=\s*async/, 'markers must enclose the runCodeLane arrow function');
    // Source order inside the lane: implement, then verify, then deliver. Match the agent opts
    // labels (not casual references in comments) so a mention like "impl:#97.1" in a
    // failure-scenario comment does not defeat the ordering assertion.
    const loopIdx = body.indexOf('for (let attempt');
    const implIdx = body.indexOf('label: `impl:#');
    // The verifier's label is built once per pass (issue 404's single re-run), so its anchor is
    // the label template rather than the opts key; the backtick still keeps comments out.
    const verifyIdx = body.indexOf('`verify:#');
    const deliverIdx = body.indexOf('label: `deliver:#');
    assert.ok(loopIdx >= 0, 'runCodeLane must hold the bounded attempt loop');
    assert.ok(implIdx > loopIdx, 'the impl agent label must sit inside the attempt loop');
    assert.ok(verifyIdx > implIdx, 'the verify agent label must follow the impl agent label');
    assert.ok(deliverIdx > verifyIdx, 'the deliver agent label must follow the verify agent label');
    // Issue 430: the open-PR guard is one Scout-phase listing for the whole candidate set. A lane
    // that asks again would spend an agent per ticket on a question already answered.
    assert.ok(!/pr-check:/.test(body), 'no pr-check agent may run inside a code lane (issue 430)');
    assert.ok(!/open-pr-scan/.test(body), 'the open-PR listing must not run inside a code lane (issue 430)');
  });

  test(`${rel} runReport commits discoveries to their own branch off the default branch`, async () => {
    const prompts = [];
    const agentMock = async (prompt, opts) => {
      prompts.push([opts.label, prompt]);
      return { branch: 'agent/fleet-discoveries-wf_testrun', sha: 'abc123def456', prUrl: 'https://github.com/x/y/pull/9', appended: 2 };
    };
    const { result } = await driveReport(file, agentMock, ['finding-A', 'finding-B'], { deliver: true });
    assert.deepEqual(prompts.map((p) => p[0]), ['followups-writer'], 'exactly one report writer runs');
    const prompt = prompts[0][1];
    assert.match(prompt, /agent\/fleet-discoveries-wf_testrun/, 'writer must be told the discoveries branch name');
    assert.match(prompt, /origin\/main/, 'the discoveries branch must be cut from origin/<defaultBranch>');
    assert.ok(prompt.includes('finding-A') && prompt.includes('finding-B'), 'every bullet must reach the writer verbatim');
    assert.match(prompt, /commit/i, 'the writer must commit the bullets, not leave them uncommitted');
    assert.deepEqual(result, {
      branch: 'agent/fleet-discoveries-wf_testrun',
      sha: 'abc123def456',
      prUrl: 'https://github.com/x/y/pull/9',
      bullets: 2,
    }, 'the run must return branch + sha + prUrl so a triage chore can name the discovery commit');
  });

  test(`${rel} runReport opens no discoveries PR when deliver is off`, async () => {
    const prompts = [];
    const agentMock = async (prompt, opts) => {
      prompts.push(prompt);
      return { branch: 'agent/fleet-discoveries-wf_testrun', sha: 'sha1', prUrl: '', appended: 1 };
    };
    const { result } = await driveReport(file, agentMock, ['finding-A'], { deliver: false });
    assert.match(prompts[0], /do NOT push and do NOT open a PR/, 'deliver:false must forbid the push/PR step');
    assert.equal(result.prUrl, null, 'no PR url when deliver is off');
    assert.equal(result.sha, 'sha1', 'the commit still happens so the bullets have a sha to cite');
  });

  test(`${rel} runReport starts no writer when the run found nothing`, async () => {
    const agentMock = async () => { throw new Error('report writer must not run with zero discoveries'); };
    const { result } = await driveReport(file, agentMock, [], { deliver: true });
    assert.equal(result, null);
});

  // Issue 265: requiring `failures` made a passing verdict unexpressible. A verifier that
  // returns {pass:true, evidence} with no `failures` key must be accepted - the lane delivers
  // and the verdict it reports carries an empty failures array rather than undefined.
  test(`${rel} runCodeLane accepts a passing verdict with no failures key`, async () => {
    const calls = [];
    const agentMock = async (_prompt, opts) => {
      calls.push(opts.label);
      if (opts.label.startsWith('impl:')) {
        return { branch: 'agent/issue-241-attempt1-wf_testrun-w0', committed: true, pushed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
      }
      // No `failures` key at all - exactly what tripped the StructuredOutput retry cap on #241.
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran node --test; exit 0' };
      if (opts.label.startsWith('deliver:')) return { pushed: true, prUrl: 'https://github.com/x/y/pull/241' };
      throw new Error('unexpected label: ' + opts.label);
    };
    const { result } = await driveCodeLane(file, agentMock, { number: 241, title: 't', criteria: '' }, 0);
    assert.deepEqual(calls, ['impl:#241.1', 'verify:#241.1', 'deliver:#241'],
      'a key-less pass must be accepted on the first attempt, not retried');
    assert.equal(result.done, true);
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/241');
    assert.deepEqual(result.verdict.failures, [],
      'a verdict with no failures key must be normalised to an empty array for the run report');
  });

  test(`${rel} runCodeLane runs the full impl/verify/deliver chain when no open PR exists`, async () => {
    const calls = [];
    const agentMock = async (_prompt, opts) => {
      calls.push(opts.label);
      if (opts.label.startsWith('impl:')) {
        return { branch: 'agent/issue-9-attempt1-wf_testrun-w0', committed: true, pushed: true, testExitCode: 0, testTail: 'ok', discoveries: ['finding-A'] };
      }
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran tests', failures: [] };
      if (opts.label.startsWith('deliver:')) return { pushed: true, prUrl: 'https://github.com/x/y/pull/500' };
      throw new Error('unexpected label: ' + opts.label);
    };
    const { result, checkpoints } = await driveCodeLane(file, agentMock, { number: 9, title: 't', criteria: '' }, 0);
    assert.deepEqual(calls, ['impl:#9.1', 'verify:#9.1', 'deliver:#9'],
      'a code lane runs impl/verify/deliver in order and starts no PR check of its own (issue 430)');
    assert.equal(result.done, true);
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/500');
    assert.deepEqual(result.discoveries, ['finding-A']);
    // Ported from the aac-routines fork (issues 192, 270): one orchestrator-tree checkpoint after
    // the implementer, one after the (unisolated) verifier, one after Deliver pushes.
    assert.deepEqual(checkpoints, ['implement-attempt1#9', 'verify-attempt1#9', 'deliver#9'],
      'the code lane must checkpoint the orchestrator tree after Implement, Verify and Deliver');
  });

  // ---- The verdict's worktree is cross-checked against the branch tip (issue 404) ----

  test(`${rel} accepts a verdict whose worktree HEAD is the branch tip`, async () => {
    const tip = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const calls = [];
    const agentMock = async (_prompt, opts) => {
      calls.push(opts.label);
      if (opts.label.startsWith('impl:')) return { branch: 'b', committed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran tests', failures: [], worktree: { path: '/scratch/v', head: tip } };
      if (opts.label.startsWith('deliver:')) return { pushed: true, prUrl: 'https://github.com/x/y/pull/404' };
      throw new Error('unexpected label: ' + opts.label);
    };
    const { result } = await driveCodeLane(file, agentMock, { number: 404, title: 't', criteria: '' }, 0, {}, 'inv1', null,
      { revParse: async () => tip });
    assert.deepEqual(calls, ['impl:#404.1', 'push:#404.1', 'verify:#404.1', 'deliver:#404'],
      'a verdict produced at the branch tip must be accepted without a re-run');
    assert.equal(result.done, true);
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/404');
  });

  test(`${rel} rejects a verdict produced outside the branch's worktree and re-runs the verifier once`, async () => {
    // The main checkout sitting on the session's own branch is exactly the 2026-09-16 failure:
    // the verifier answers about a tree that predates the code under review.
    const tip = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const mainCheckout = 'ffffeeee00001111222233334444555566667777';
    const calls = [];
    const prompts = [];
    const agentMock = async (prompt, opts) => {
      calls.push(opts.label);
      if (opts.label.startsWith('impl:')) return { branch: 'b', committed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
      if (opts.label.startsWith('verify:')) {
        prompts.push([opts.label, prompt]);
        return { pass: true, evidence: 'ran tests in /home/user/aac-routines', failures: [], worktree: { path: '/home/user/aac-routines', head: mainCheckout } };
      }
      throw new Error(`nothing may be delivered on a rejected verdict: ${opts.label}`);
    };
    const { result, logs } = await driveCodeLane(file, agentMock, { number: 404, title: 't', criteria: '' }, 0, { maxAttempts: 1 }, 'inv1', null,
      { revParse: async () => tip });
    assert.deepEqual(calls, ['impl:#404.1', 'push:#404.1', 'verify:#404.1', 'verify:#404.1-rerun'],
      'a mismatched verdict must be re-run exactly once, and a second mismatch must not deliver');
    assert.match(prompts[1][1], new RegExp(`${mainCheckout}[\\s\\S]*${tip}`),
      're-run prompt must name the mismatch: the HEAD the verdict came from and the tip it had to be');
    assert.match(prompts[1][1], /never .*fall back to the repository you started in|main checkout is never a test surface/,
      're-run prompt must still carry the rule it was rejected under');
    assert.equal(result.done, false, 'a verdict from the wrong tree is not a pass');
    assert.equal(result.prUrl, undefined);
    assert.equal(result.verdict.failures.length, 1, 'only the mismatch is recorded; the wrong-tree findings are not passed on');
    assert.match(result.verdict.failures[0], new RegExp(mainCheckout));
    assert.ok(logs.some((m) => m.includes('Re-running the verifier once')), 'the rejection and its single re-run must be logged');
  });

  test(`${rel} verifier and prober prompts say the main checkout is never a test surface (issue 404)`, () => {
    const src = fs.readFileSync(file, 'utf8');
    const anchors = [
      ['code-lane verifier', 'You are an independent verifier. Your job is to REFUTE'],
      ['probe-lane verifier', 'You are an independent verifier for a probe ticket'],
      ['prober', 'Probe GitHub issue #'],
    ];
    for (const [who, anchor] of anchors) {
      const prompt = sliceBetween(src, anchor, "phase: '", `the ${who} prompt`);
      assert.match(prompt, /The main checkout is never a test surface \(issue 404\)/,
        `${who} prompt must say in one sentence that the main checkout is never a test surface`);
      assert.match(prompt, /sits on whatever branch this session is on, which is not the code/,
        `${who} prompt must say WHY: the main checkout is on this session's branch, not the code under test`);
    }
  });

  // ---- Deliver never ticks acceptance boxes (aac-routines issue 264) ----

  test(`${rel} Deliver prompt forbids ticking acceptance boxes`, () => {
    // The prompt moved into its own marked block in issue 405 - the finish mode sends the same
    // text - so it is read from there rather than from the lane body.
    const prompt = extractMarked(fs.readFileSync(file, 'utf8'), 'FLEET-DELIVER-PROMPT');
    assert.match(prompt, /`Deliver verified branch/, 'the deliver-prompt block must build the Deliver prompt');
    assert.match(prompt, /do NOT tick any acceptance box/,
      'Deliver prompt must forbid ticking acceptance boxes: the boxes wait for the merge (aac-routines issue 264)');
    assert.doesNotMatch(prompt, /tick-acceptance-boxes\.js/,
      'Deliver must not run the acceptance-box ticker itself; the merge workflow owns that step');
    assert.doesNotMatch(prompt, /tick (?:each|the|every) (?:unticked )?acceptance box/i,
      'Deliver prompt must carry no instruction to tick a box');
  });

  // ---- every per-ticket agent() call is wrapped (aac-routines issues 191, 270) ----

  test(`${rel} wraps every per-ticket agent() call so a schema failure cannot null the ticket`, () => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const unwrapped = [];
    lines.forEach((line, i) => {
      if (!/await agent\(/.test(line)) return;
      if (/const (?:scout|envFacts) = await agent\(/.test(line)) return; // runs before any ticket exists
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === '') j--;
      if (!/try \{$/.test(lines[j] || '')) unwrapped.push(`${i + 1}: ${line.trim()}`);
    });
    assert.deepEqual(unwrapped, [],
      'each of these agent() calls must sit directly inside a try block, or a StructuredOutput '
      + 'retry-cap throw drops its ticket out of the run report entirely (aac-routines issues 191, 270)');
  });

  // ---- Pre-push merge (issue 318) ----
  // The deliver stage merges origin/<defaultBranch> before pushing. Two conflict classes are
  // resolvable without judgment (generated files, SKILL.md stamp blocks); anything else stops
  // the ticket with its conflicting paths and no PR.

  test(`${rel} deliver prompt merges the default branch before pushing`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /git merge --no-edit origin\/\$\{defaultBranch\}/,
      'deliver must merge origin/<defaultBranch> into the verified branch');
    assert.match(src, /git checkout --theirs/,
      'deliver must take the default branch side for a generated-file conflict');
    assert.match(src, /node tools\/resolve-stamp-conflict\.js/,
      'deliver must classify a SKILL.md stamp conflict with the resolver script, not by eye');
    assert.match(src, /node tools\/renumber-harness-upgrade\.js/,
      'deliver must renumber a colliding harness upgrade row with the script, not by hand (issue 515)');
    assert.match(src, /git merge --abort/,
      'a conflict outside the two classes must abort the merge rather than guess');
    const deliverIdx = src.indexOf('STEP A - merge the default branch BEFORE pushing');
    const pushIdx = src.indexOf(PUSH_ANCHOR);
    assert.ok(deliverIdx > 0 && pushIdx > deliverIdx,
      'the merge instructions must precede the push in the deliver prompt');
  });

  // ---- No push before the conflict-marker scan (issue 514) ----
  // Run 6aab1eac's deliverer resolved a merge by staging the conflict markers, committed that,
  // pushed it, and then asked the session for a force push. The scan is what stands between the
  // merge commit and `git push`, and a commit that did reach origin is repaired forward.

  test(`${rel} deliver prompt scans the merge result for conflict markers before pushing (issue 514)`, () => {
    const prompt = extractMarked(fs.readFileSync(file, 'utf8'), 'FLEET-DELIVER-PROMPT');
    assert.match(prompt, /git grep -l -e '\^<<<<<<< ' -e '\^>>>>>>> ' HEAD/,
      'deliver must scan the merge result for committed conflict markers, by the exact command');
    const scanIdx = prompt.indexOf('git grep -l -e');
    const pushIdx = prompt.indexOf(PUSH_ANCHOR);
    assert.ok(scanIdx > 0 && pushIdx > scanIdx,
      'the marker scan must come before the push: the gate that ran before the bad commit did not catch it');
    assert.match(prompt, /runs on EVERY path through STEP A, a clean merge included/,
      'the scan must run on the clean-merge path too, not only after a resolved conflict');
    assert.match(prompt, /mergeStatus:"blocked", conflictPaths:\[every path the scan listed\]/,
      'a scan hit that cannot be resolved must block delivery with the marker-carrying paths, not push');
  });

  // ---- The regenerate is not evidence that the stamps are right (issue 553) ----
  // Run 6aac4a53 delivered #550 and #552 with every stamp hashed against the container's home
  // instead of the owner's: A4's regenerate ran, the payload rebuilt, the tests passed, and
  // skill-stamps.yml's `pull_request` run (the merge ref) was green - while the push-event run of
  // the same `check` job was red the moment each PR opened. A5's first half is what stands
  // between that regenerate and the push.

  test(`${rel} deliver prompt runs the stamps check after the regenerate and before the push (issue 553)`, () => {
    const src = fs.readFileSync(file, 'utf8');
    const prompt = extractMarked(src, 'FLEET-DELIVER-PROMPT');
    assert.match(prompt, /\(i\) STAMPS CHECK \(issue 553\): \$\{regenCheckNote\}/,
      "A5's first half must run the repo's configured stamps check");
    const regenIdx = prompt.indexOf('${regenNote}');
    const checkIdx = prompt.indexOf('${regenCheckNote}');
    const pushIdx = prompt.indexOf(PUSH_ANCHOR);
    assert.ok(regenIdx > 0 && checkIdx > regenIdx && pushIdx > checkIdx,
      'the stamps check must sit between A4 regenerate and the STEP B push, in that order');
    assert.match(prompt, /Do NOT hand-edit a stamp to make this pass/,
      'a stamp bumped by hand makes the check green and the dates a lie - the recipe is the only fix');
    assert.match(prompt, /If the second run still fails.*blockedReason naming every skill the check listed/,
      'a stamp still stale after one re-run must block the push with a named reason, not arrive as a red PR');
    assert.match(prompt, /run A5\(i\)'s stamps check on the merge result/,
      'the clean-merge path has no regenerate behind it and still needs the check');
  });

  // ---- regenCheckCommands defaults empty; a fork gets no check unless it asks (issue 814) ----
  // Line 99 used to default this to the concrete claude-dotfiles command, so a fork that copies
  // this script and never passes regenCheckCommands sent every Deliver stage to A5(i) with a
  // command naming a tool (tools/skill-stamps.py) it does not have. The check is a claude-dotfiles
  // concern, not a fleet one: the default is now empty and claude-dotfiles' own launch recipe
  // (SKILL.md) passes the concrete command explicitly.

  test(`${rel} regenCheckCommands defaults empty, so a fork delivers without a stamps check (issue 814)`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /regenCheckCommands: \[\],/,
      'the default must be empty - the stamps check is a claude-dotfiles concern, not a fleet default');
    assert.doesNotMatch(src, /regenCheckCommands: \[[^\]]*skill-stamps\.py/,
      'the default must not name tools/skill-stamps.py: every fork lacks it (issue 814)');
    const prompt = extractMarked(src, 'FLEET-DELIVER-PROMPT');
    assert.match(prompt, /this repo configures no stamps check - skip \(i\) and go to \(ii\)/,
      'an empty regenCheckCommands must read as "no check configured", not as an empty command to run');
  });

  test(`claude-dotfiles' own launch recipe passes the concrete stamps check explicitly (issue 814)`, () => {
    const skillDoc = fs.readFileSync(path.join(REPO_ROOT, 'aac-skills', 'ticket-fleet', 'SKILL.md'), 'utf8');
    assert.match(skillDoc, /regenCheckCommands: \["python3 tools\/skill-stamps\.py check aac-skills --home '/,
      "claude-dotfiles' own launch example must pass the stamps check by name, now that the script default is empty");
  });

  test(`${rel} deliver prompt repairs a pushed bad merge forward rather than force-pushing (issue 514)`, () => {
    const prompt = extractMarked(fs.readFileSync(file, 'utf8'), 'FLEET-DELIVER-PROMPT');
    assert.match(prompt, /git read-tree -u --reset <corrected-commit>/,
      'the repair must set the tree of the corrected merge onto the pushed head (the read-tree pattern of b00db2e)');
    assert.match(prompt, /git push --force\\`, \\`git push --force-with-lease\\`, deleting the remote branch and rewriting its pushed history are out of bounds/,
      'the prompt must forbid a force push outright - PR #504 was recovered without one and none should ever be asked for');
    assert.doesNotMatch(prompt, /(?:run|use|do) (?:a )?(?:`?git )?push --force/i,
      'nothing in the prompt may instruct a force push');
  });

  test(`${rel} runCodeLane reports the conflicting paths and opens no PR when the merge is blocked`, async () => {
    const calls = [];
    const agentMock = async (_prompt, opts) => {
      calls.push(opts.label);
      if (opts.label.startsWith('impl:')) {
        return { branch: 'agent/issue-11-attempt1-wf_testrun-w0', committed: true, pushed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
      }
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran tests', failures: [] };
      if (opts.label.startsWith('deliver:')) {
        return { pushed: false, prUrl: '', mergeStatus: 'blocked', conflictPaths: ['aac-skills/ticket-fleet/SKILL.md', 'README.md'], blockedReason: 'prose hunk outside the stamp block' };
      }
      throw new Error('unexpected label: ' + opts.label);
    };
    const { result, logs } = await driveCodeLane(file, agentMock, { number: 11, title: 't', criteria: '' }, 0);
    assert.deepEqual(calls, ['impl:#11.1', 'verify:#11.1', 'deliver:#11']);
    assert.equal(result.prUrl, null, 'a blocked pre-push merge must open no PR');
    assert.equal(result.done, false, 'a blocked pre-push merge is a delivery failure');
    assert.deepEqual(result.conflictPaths, ['aac-skills/ticket-fleet/SKILL.md', 'README.md'],
      'the conflicting paths must reach the run result');
    assert.match(result.verdict.failures.join('\n'), /aac-skills\/ticket-fleet\/SKILL\.md/);
    assert.ok(logs.some((m) => /no PR opened/.test(m)), 'the block must be logged');
  });

  test(`${rel} runCodeLane still delivers when the pre-push merge resolves`, async () => {
    const agentMock = async (_prompt, opts) => {
      if (opts.label.startsWith('impl:')) {
        return { branch: 'agent/issue-12-attempt1-wf_testrun-w0', committed: true, pushed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
      }
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran tests', failures: [] };
      if (opts.label.startsWith('deliver:')) {
        return { pushed: true, prUrl: 'https://github.com/x/y/pull/501', mergeStatus: 'resolved', conflictPaths: [] };
      }
      throw new Error('unexpected label: ' + opts.label);
    };
    const { result } = await driveCodeLane(file, agentMock, { number: 12, title: 't', criteria: '' }, 0);
    assert.equal(result.done, true);
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/501');
    assert.deepEqual(result.conflictPaths, []);
  });

  // ---- Prior-implementer reuse (issue 317) ----
  // A run whose verifiers all died leaves committed branches behind. The caller passes those
  // implementer results back as args.priorImpl; attempt 1 must take the recorded result and
  // start no implementer, so the wave is finished by verifiers alone.
  test(`${rel} runCodeLane reuses a priorImpl entry instead of spawning an implementer`, async () => {
    const calls = [];
    const agentMock = async (_prompt, opts) => {
      calls.push(opts.label);
      if (opts.label.startsWith('impl:')) throw new Error(`implementer spawned despite a priorImpl entry: ${opts.label}`);
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran the gate on the prior branch', failures: [] };
      if (opts.label.startsWith('deliver:')) return { pushed: true, prUrl: 'https://github.com/x/y/pull/501' };
      throw new Error('unexpected label: ' + opts.label);
    };
    const prior = {
      branch: 'agent/issue-274-attempt1-wf_dd0cf9a4091-w0',
      committed: true, pushed: true, testExitCode: 0, testTail: 'ok', discoveries: ['finding-B'],
    };
    const { result, logs } = await driveCodeLane(
      file, agentMock, { number: 274, title: 't', criteria: '' }, 0, { priorImpl: { 274: prior } }
    );
    assert.deepEqual(calls, ['verify:#274.1', 'deliver:#274'],
      'a ticket with a priorImpl entry must go straight to the verifier');
    const verifyIdx = calls.findIndex((l) => l.startsWith('verify:'));
    const implIdx = calls.findIndex((l) => l.startsWith('impl:'));
    assert.ok(verifyIdx >= 0, 'the verifier must still run on the reused branch');
    assert.equal(implIdx, -1, 'no impl: agent may be spawned before the verifier when priorImpl carries the ticket');
    assert.equal(result.branch, prior.branch, 'the reused branch must be the one delivered');
    assert.equal(result.done, true);
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/501');
    assert.deepEqual(result.discoveries, ['finding-B'], 'the reused result carries its discoveries forward');
    assert.ok(logs.some((m) => /priorImpl/.test(m)), 'the reuse must be logged');
  });

  // ---- The verified branch is on origin before Deliver starts (issue 405) ----
  // A container restart mid-Deliver, a deliverer that never pushed, and an interrupt during Verify
  // each left verified commits on a branch that existed nowhere but the dead container. The
  // implementer is now asked to push and to report `pushed`; when it did not, the lane pushes the
  // branch itself - before the verifier, so nothing downstream can lose it. `origin` here is the
  // set of branches the push agent has put there, read at the moment Deliver is invoked.
  test(`${rel} pushes the verified branch to origin before Deliver starts (issue 405)`, async () => {
    const calls = [];
    const origin = new Set();
    let originAtDeliver = null;
    const branch = 'agent/issue-405-attempt1-wf_testrun-w0';
    const agentMock = async (prompt, opts) => {
      calls.push(opts.label);
      // The implementer did NOT push - the case the script has to cover itself.
      if (opts.label.startsWith('impl:')) {
        return { branch, committed: true, pushed: false, testExitCode: 0, testTail: 'ok', discoveries: [] };
      }
      if (opts.label.startsWith('push:')) {
        assert.ok(prompt.includes(`git push -u origin ${branch}`), 'the push agent must be given the exact command');
        origin.add(branch);
        return { pushed: true, output: `branch '${branch}' set up to track 'origin/${branch}'` };
      }
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran the gate; exit 0', failures: [] };
      if (opts.label.startsWith('deliver:')) {
        originAtDeliver = [...origin];
        return { pushed: true, prUrl: 'https://github.com/x/y/pull/405', mergeStatus: 'clean', conflictPaths: [] };
      }
      throw new Error('unexpected label: ' + opts.label);
    };
    const { result, logs } = await driveCodeLane(file, agentMock, { number: 405, title: 't', criteria: '' }, 0);
    assert.deepEqual(calls, ['impl:#405.1', 'push:#405.1', 'verify:#405.1', 'deliver:#405'],
      'the push must happen straight after the implementer, before the verifier and the deliverer');
    assert.deepEqual(originAtDeliver, [branch],
      'the branch Deliver is handed must already exist on origin - that is the work a dead Deliver step must not be able to lose');
    assert.equal(result.done, true);
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/405');
    assert.ok(logs.some((m) => /is on origin before verification/.test(m)), 'the push the run performed must be logged');
    // And when the implementer reports pushed: true, no push agent is started at all - the
    // full-chain test above drives exactly that case and its label list carries no `push:`.
  });

  test(`${rel} deliver prompt pushes the branch and fails loudly rather than calling it missing (issue 405)`, () => {
    const prompt = extractMarked(fs.readFileSync(file, 'utf8'), 'FLEET-DELIVER-PROMPT');
    assert.ok(prompt.includes(PUSH_ANCHOR),
      'the deliverer must be told to push the branch, by the exact command');
    assert.match(prompt, /never conclude that the branch, or the issue, does not exist/,
      "the deliverer must never report the branch missing: #356's deliverer did exactly that without ever pushing");
    assert.match(prompt, /blockedReason:"push failed: <the git output of all three commands, VERBATIM>"/,
      'a failed push must come back with the git output verbatim, not a paraphrase');
  });

  // ---- A refused merge does not lose the delivery (issue 544) ----
  // Run 6aac3d3b ended with no PR for #489 or #493: the auto-mode classifier refused the pre-push
  // `git merge` in each lane and both deliverers returned {pushed:false, prUrl:""} over a branch
  // that was verified and complete. The refusals are non-deterministic on byte-identical retries,
  // so the stage retries once and then delivers without the merge.

  test(`${rel} deliver prompt retries a classifier-refused merge once, byte-identical (issue 544)`, () => {
    const prompt = extractMarked(fs.readFileSync(file, 'utf8'), 'FLEET-DELIVER-PROMPT');
    assert.match(prompt, /re-issue it ONCE, byte-identical/,
      'the deliverer must be told to re-issue a refused command once with the same spelling - that is what usually goes through');
    assert.match(prompt, /If the classifier REFUSES that merge command, re-issue it byte-identical once \(A0\); if the retry is refused as well, go to A8/,
      'the merge step itself must name the retry and the fallback, not only the general rule');
    assert.match(prompt, /"Modify Shared Resources".*"Interfere With Workloads"/,
      'the prompt must name the classifier categories the waves have seen, so a refusal does not read as a rule violation');
    assert.match(prompt, /never as a sign that you are doing something forbidden and never as a reason to stop the delivery/,
      'the prompt must say outright that a refusal is not a rule violation');
  });

  test(`${rel} deliver prompt delivers without the merge when it is refused twice (issue 544)`, () => {
    const prompt = extractMarked(fs.readFileSync(file, 'utf8'), 'FLEET-DELIVER-PROMPT');
    assert.match(prompt, /A8\. DELIVER WITHOUT THE MERGE/,
      'a twice-refused merge must have its own step, reached from A1');
    assert.match(prompt, /go to STEP B with mergeStatus "unmerged-by-classifier", conflictPaths \[\] and blockedReason holding the refusal text VERBATIM/,
      'the unmerged path must push, open the PR and record the refusal text verbatim');
    assert.match(prompt, /STEP B - push and open the PR \(only when STEP A ended clean, resolved, or unmerged-by-classifier\)/,
      "STEP B's gate must admit the unmerged path, or A8 would hand over to a step that refuses to run");
    assert.match(prompt, /Not merged with \$\{defaultBranch\}: classifier refusal/,
      'the PR body must carry the refusal under a heading a reviewer can act on');
    assert.match(prompt, /NEVER end this stage with \{pushed:false, prUrl:""\} while the branch is verified/,
      'the rule that a verified branch always reaches origin and a PR must be stated, not implied');
    assert.match(prompt, /mcp__github__create_pull_request/,
      'a refused PR call has the MCP route as its fallback (issue 245 evidence), so the refusal cannot end the delivery either');
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /enum: \['clean', 'resolved', 'blocked', 'unmerged-by-classifier'[,\]]/,
      'the DELIVERED schema must accept the status the prompt asks for, or the deliverer cannot return it');
  });

  test(`${rel} runCodeLane keeps a delivery whose merge the classifier refused (issue 544)`, async () => {
    const refusal = 'Permission denied to execute git merge by Claude Code auto mode classifier - Modify Shared Resources';
    const agentMock = async (_prompt, opts) => {
      if (opts.label.startsWith('impl:')) {
        return { branch: 'agent/issue-544-attempt1-wf_testrun-w0', committed: true, pushed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
      }
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran the gate; exit 0', failures: [] };
      if (opts.label.startsWith('deliver:')) {
        return { pushed: true, prUrl: 'https://github.com/x/y/pull/544', mergeStatus: 'unmerged-by-classifier', conflictPaths: [], blockedReason: refusal };
      }
      throw new Error('unexpected label: ' + opts.label);
    };
    const { result, logs } = await driveCodeLane(file, agentMock, { number: 544, title: 't', criteria: '' }, 0);
    assert.equal(result.done, true, 'an unmerged-by-classifier delivery is a delivery, not a blocked merge');
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/544', 'the PR the deliverer opened must reach the run result');
    assert.equal(result.deliveryFailure, null, 'a delivery with a PR is not a delivery failure');
    assert.deepEqual(result.conflictPaths, [], 'a refused merge conflicted with nothing - it never ran');
    assert.match(result.mergeNote, new RegExp(refusal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the run result must carry the refusal text, so the orchestrator merges master instead of re-implementing');
    assert.ok(logs.some((m) => /WITHOUT the pre-push merge/.test(m)),
      'the log must say the PR still owes the default-branch merge');
  });
}

// ---- The open-PR check runs once, in the Scout phase, before wave selection (issue 430) ----
// It used to be the first agent of every code lane: twelve tickets meant twelve agents asking for
// the same PR list, and a ticket that already had a PR was SELECTED and then skipped inside its
// lane, so the wave ran fewer real tickets than `maxTickets` while runnable candidates sat
// unselected. One listing now answers for the whole candidate set and the matches are dropped
// before selectWave. Driven with a stubbed instrument rather than asserted by regex: what matters
// is which agents run and which tickets survive.
async function driveOpenPrFilter(scriptPath, agentMock, tickets, { invocationId = 'inv1', instrument = 'gh' } = {}) {
  // applyOpenPrs comes from the generated block since issue 486; the marked block holds only
  // the read that feeds it.
  const body = generatedBlock(scriptPath)
    + extractMarked(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-OPEN-PR');
  const logs = [];
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${body}\nreturn dropTicketsWithOpenPr;\n}`);
  const drop = await wrapper(laneScope({
    agent: agentMock,
    log: (m) => logs.push(m),
    cfg: { deliverModel: 'z' },
    invocationId,
    instrument,
    unusableReason: (who, detail) => `${who} output unusable: ${detail}`,
  }));
  return { filtered: await drop(tickets), logs };
}

const OPEN_PR_CANDIDATES = [
  { number: 101, blockedBy: [], handoffPending: false },
  { number: 102, blockedBy: [], handoffPending: false },
  { number: 103, blockedBy: [], handoffPending: false },
];

test(`fleet script ${FLEET_SCRIPT_REL} drops a candidate with an open PR before wave selection, so the cap runs maxTickets real tickets (issue 430)`, async () => {
  const calls = [];
  const agentMock = async (prompt, opts) => {
    calls.push({ label: opts.label, phase: opts.phase, prompt });
    return { withOpenPr: [{ number: 101, prUrl: 'https://github.com/x/y/pull/137', branch: 'agent/issue-101-attempt1-wf_r1-w0' }] };
  };
  const { filtered, logs } = await driveOpenPrFilter(FLEET_SCRIPT, agentMock, OPEN_PR_CANDIDATES);
  assert.equal(calls.length, 1, 'one PR listing answers for the whole candidate set, not one per ticket');
  assert.equal(calls[0].phase, 'Scout', 'the journal must file the check under phase Scout - nothing is implemented by it');
  for (const n of [101, 102, 103]) {
    assert.ok(calls[0].prompt.includes(`#${n}`), `the listing agent must be given candidate #${n}`);
  }
  assert.match(calls[0].prompt, /repos\/\{owner\}\/\{repo\}\/pulls\?state=open/,
    'the gh instrument must list open PRs through REST, once');
  const { wave } = selectWave(filtered.tickets, 2);
  assert.deepEqual(wave.map((t) => t.number), [102, 103],
    'the wave cap must fill with tickets that will run - the ticket with a PR must not occupy a slot');
  assert.deepEqual(filtered.skipped, [{ ticket: 101, prUrl: 'https://github.com/x/y/pull/137', branch: 'agent/issue-101-attempt1-wf_r1-w0' }],
    'the dropped ticket must be reported with the PR url that stopped it, for skippedOpenPR');
  assert.ok(logs.some((m) => m.includes('#101') && m.includes('https://github.com/x/y/pull/137')),
    'the drop must be logged with its PR url');
});

test(`fleet script ${FLEET_SCRIPT_REL} runs exactly one PR-listing agent per launch and re-runs it under a fresh invocationId (issues 430, 291)`, async () => {
  const keys = [];
  const agentMock = async (prompt, opts) => { keys.push(`${opts.label}\n${prompt}`); return { withOpenPr: [] }; };
  const first = await driveOpenPrFilter(FLEET_SCRIPT, agentMock, OPEN_PR_CANDIDATES, { invocationId: 'invA' });
  await driveOpenPrFilter(FLEET_SCRIPT, agentMock, OPEN_PR_CANDIDATES, { invocationId: 'invB' });
  assert.equal(keys.length, 2, 'each launch runs the listing once - three candidates, one agent');
  assert.ok(keys[0].startsWith('open-pr-scan@invA\n'), 'the label is open-pr-scan@<invocationId>');
  assert.ok(keys[1].startsWith('open-pr-scan@invB\n'), 'a resume re-labels the scan with its fresh invocationId');
  assert.notEqual(keys[0], keys[1],
    'two invocations of one runId must ask under different cache keys, or the resume replays a stale "no PR"');
  await driveOpenPrFilter(FLEET_SCRIPT, agentMock, OPEN_PR_CANDIDATES, { invocationId: 'invA' });
  assert.equal(keys[2], keys[0], 'the key must be a function of invocationId, not of call order');
  assert.deepEqual(first.filtered.tickets.map((t) => t.number), [101, 102, 103],
    'a listing that matches nothing drops nothing');
  assert.deepEqual(first.filtered.skipped, []);
});

test(`fleet script ${FLEET_SCRIPT_REL} treats an unusable open-PR answer as "no open PRs" for the whole wave (issue 430)`, async () => {
  const thrown = async () => { throw new Error('StructuredOutput retry cap'); };
  const { filtered, logs } = await driveOpenPrFilter(FLEET_SCRIPT, thrown, OPEN_PR_CANDIDATES);
  assert.deepEqual(filtered.tickets.map((t) => t.number), [101, 102, 103],
    'an unusable answer must not strand the wave: worst case is a duplicate PR a human closes');
  assert.deepEqual(filtered.skipped, []);
  assert.equal(logs.length, 1, 'the fallback is logged once for the wave, not once per ticket');
  assert.match(logs[0], /open-pr-scan output unusable/);
});

test(`fleet script ${FLEET_SCRIPT_REL} files the open-PR check under Scout and names the drops in the run result (issue 430)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.ok(!/pr-check:/.test(src), 'no pr-check agent label may survive anywhere in the script');
  assert.equal((src.match(/label: `open-pr-scan@\$\{invocationId\}`/g) || []).length, 1,
    'exactly one open-PR listing call site may exist');
  assert.match(src, /label: `open-pr-scan@\$\{invocationId\}`, phase: 'Scout'/,
    "the listing agent must run under phase 'Scout'");
  const scanIdx = src.indexOf('await dropTicketsWithOpenPr(');
  const selectIdx = src.indexOf('const selection = selectWave(');
  assert.ok(scanIdx > 0 && selectIdx > scanIdx, 'the filter must run before wave selection');
  assert.match(src, /const selection = selectWave\(openPrFilter\.tickets, cfg\.maxTickets\)/,
    'wave selection must read the filtered candidate list');
  assert.match(src, /\n  skippedOpenPR,/,
    'the run result must name the dropped tickets under skippedOpenPR');
});

// ---- The pure helpers the fleet script inlines (issue 486) ----
// shaMatches/worktreeMismatch (issue 404), applyOpenPrs (issue 430) and selectWave were the last
// three helpers written only in the fleet script and reachable only by eval-ing their marker block.
// They live here now and travel into the script through tools/build-fleet-inline.js, so these are
// ordinary unit tests on the module.

test('shaMatches compares object names on their common prefix, and rejects non-shas (issue 404)', () => {
  const full = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  assert.ok(shaMatches(full, full.slice(0, 7)), 'an abbreviated HEAD still names the same commit');
  assert.ok(shaMatches(' A1B2C3D4E5F ', full), 'case and surrounding whitespace are not a mismatch');
  assert.ok(!shaMatches(full, 'b1b2c3d4e5f60718293a4b5c6d7e8f9012345678'), 'a different commit must not match');
  assert.ok(!shaMatches(full, 'HEAD'), 'a word that is not an object name is not evidence of anything');
  assert.ok(!shaMatches(full, 'a1b2c3'), 'six characters is below the 7-40 hex window');
  assert.ok(!shaMatches(null, undefined), 'a missing sha never matches a missing sha');
});

test('worktreeMismatch rejects a verdict produced somewhere other than the expected tip (issue 404)', () => {
  const head = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const at = (h, p) => ({ pass: true, worktree: { head: h, path: p } });
  assert.equal(worktreeMismatch(at(head, '/wt'), head, 'the tip of agent/issue-1'), null,
    'a verdict produced at the expected tip stands');
  assert.equal(worktreeMismatch(at(head, '/wt'), '', 'the tip of agent/issue-1'), null,
    'no readable expected tip means there is nothing to check against - the verdict stands');
  assert.equal(worktreeMismatch({ unusable: true }, head, 'the tip of agent/issue-1'), null,
    'an unusable verdict is already a failed attempt; re-running it for its worktree adds nothing');
  const missing = worktreeMismatch({ pass: true }, head, 'the tip of agent/issue-1');
  assert.match(missing, /reported no worktree HEAD/, 'a verdict with no HEAD is not evidence it ran anywhere');
  const elsewhere = worktreeMismatch(at('0000000000000000000000000000000000000000', '/repo'), head, 'the tip of agent/issue-1');
  assert.match(elsewhere, /^the verdict was produced at HEAD 0000000/, 'the line names the HEAD it actually ran at');
  assert.match(elsewhere, /\(worktree \/repo\)/, 'and where, so the re-run prompt can quote it');
  assert.match(elsewhere, /the tip of agent\/issue-1 \(a1b2c3d/, 'and the tip it should have been');
});

test('applyOpenPrs drops only candidates with a NAMED open PR (issue 430)', () => {
  const tickets = [{ number: 101 }, { number: '102' }, { number: 103 }];
  const applied = applyOpenPrs(tickets, [
    { number: 101, prUrl: 'https://github.com/x/y/pull/7', branch: 'agent/issue-101-attempt1-wf_r1-w0' },
    { number: 102, prUrl: '   ' },
    { number: 0, prUrl: 'https://github.com/x/y/pull/9' },
  ]);
  assert.deepEqual(applied.tickets.map((t) => t.number), ['102', 103],
    'a number with no url is not evidence of anything: only a named PR skips a ticket');
  assert.deepEqual(applied.skipped,
    [{ ticket: 101, prUrl: 'https://github.com/x/y/pull/7', branch: 'agent/issue-101-attempt1-wf_r1-w0' }],
    'the dropped ticket carries the PR that stopped it, for skippedOpenPR');
  assert.deepEqual(applyOpenPrs(null, null), { tickets: [], skipped: [] },
    'a listing nothing reported drops nothing');
});

test('dropParkedTickets drops a Maybe Someday ticket from a label-driven listing (issue 786)', () => {
  const tickets = [
    { number: 4, milestone: 'Maybe Someday' },
    { number: 5, milestone: '' },
    { number: 22, milestone: 'maybe someday' },
    { number: 38 },
  ];
  const applied = dropParkedTickets(tickets, []);
  assert.deepEqual(applied.tickets.map((t) => t.number), [5, 38],
    'a ticket parked in Maybe Someday never survives a label-driven listing, whatever its labels');
  assert.deepEqual(applied.skipped, [
    { ticket: 4, milestone: 'Maybe Someday' },
    { ticket: 22, milestone: 'maybe someday' },
  ], 'the dropped tickets carry their milestone, for skippedParked');
});

test('dropParkedTickets leaves an explicit args.tickets list untouched (issue 786)', () => {
  const tickets = [{ number: 4, milestone: 'Maybe Someday' }, { number: 5, milestone: '' }];
  const applied = dropParkedTickets(tickets, [4]);
  assert.deepEqual(applied.tickets.map((t) => t.number), [4, 5],
    'a parked ticket named explicitly by number still runs - the caller asked for it');
  assert.deepEqual(applied.skipped, [], 'nothing is dropped when the caller named tickets explicitly');
});

test('dropParkedTickets handles absent input', () => {
  assert.deepEqual(dropParkedTickets(null, null), { tickets: [], skipped: [] });
  assert.deepEqual(dropParkedTickets(undefined, []), { tickets: [], skipped: [] });
});

test('selectWave splits the candidates into the wave and the three reasons the rest do not run', () => {
  const t = (number, blockedBy, handoffPending) => ({ number, blockedBy, handoffPending });
  const out = selectWave([t(1, []), t(2, [99]), t(3, [], true), t(4, []), t(5, [])], 2);
  assert.deepEqual(out.wave.map((x) => x.number), [1, 4], 'the cap fills with runnable tickets only');
  assert.deepEqual(out.blocked.map((x) => x.number), [2], 'an open blocker gates the ticket');
  assert.deepEqual(out.pendingHandoff.map((x) => x.number), [3],
    'a ticket awaiting the owner after a handoff is parked, not re-run (issue 266)');
  assert.deepEqual(out.overCap.map((x) => x.number), [5], 'the rest are reported over cap, not lost');
});

// ---- Empty-label listing ends the run (issue 298) ----
// A scout whose label listing matched nothing used to route around the dead end and hand back
// every open ticket it could find, so the fleet spawned open-PR scans and implementer agents for work
// nobody asked for. The prompt now says an empty listing is a complete answer; confineToCandidates
// is the mechanical half, inlined in the fleet script between the FLEET-SCOUT-GATE markers.

test('confineToCandidates drops tickets the listing never returned', () => {
  const invented = [{ number: 11 }, { number: 12 }];
  assert.deepEqual(confineToCandidates(invented, []), [],
    'an empty candidate listing must confine the wave to nothing');
  assert.deepEqual(confineToCandidates(invented, [12]), [{ number: 12 }],
    'only tickets whose number the listing returned may survive');
  assert.deepEqual(confineToCandidates(invented, undefined), invented,
    'with no listing reported there is nothing to confine against');
});

function extractScoutGate(src) {
  return extractMarked(src, 'FLEET-SCOUT-GATE');
}

async function driveScoutGate(scout, { explicitTickets = [], label = 'ready-for-agent' } = {}) {
  // confineToCandidates comes from the generated block since issue 440, so the gate under test
  // runs the filter the fleet script really holds rather than a stand-in.
  const body = generatedBlock() + extractScoutGate(fs.readFileSync(FLEET_SCRIPT, 'utf8'));
  const logs = [];
  const wrapper = new AsyncFunction(
    'scout', 'explicitTickets', 'cfg', 'instrument', 'log',
    body + "\nreturn 'fell-through';"
  );
  const result = await wrapper(scout, explicitTickets, { label }, 'gh', (m) => logs.push(m));
  return { result, logs };
}

test(`fleet script ${FLEET_SCRIPT_REL} ends the run when the label listing is empty`, async () => {
  // The scout reports an empty listing but hands back open tickets anyway - the failure mode.
  const { result } = await driveScoutGate({
    candidateNumbers: [],
    tickets: [{ number: 41, blockedBy: [] }, { number: 42, blockedBy: [] }],
  });
  assert.equal(result.ran, 0, 'an empty label listing must end the run with ran: 0');
  assert.equal(result.note, 'scout found no open tickets with label ready-for-agent');
  assert.deepEqual(result.results, []);
  const kept = await driveScoutGate({
    candidateNumbers: [42],
    tickets: [{ number: 41, blockedBy: [] }, { number: 42, blockedBy: [] }],
  });
  assert.equal(kept.result, 'fell-through', 'a ticket the listing returned must still reach the wave');
});

// ---- Maybe Someday milestone parks a ticket before the wave (issue 786) ----
// The reaper parks a ticket by milestone without touching its labels, so a label-driven scout
// listing still returns it; the gate must drop it before the wave, name it in skippedParked, and
// still run it when the caller named it explicitly.

test(`fleet script ${FLEET_SCRIPT_REL} scout gate drops a Maybe Someday ticket from a label listing`, async () => {
  const scout = {
    candidateNumbers: [4, 5],
    tickets: [
      { number: 4, blockedBy: [], milestone: 'Maybe Someday' },
      { number: 5, blockedBy: [], milestone: '' },
    ],
  };
  const allParked = await driveScoutGate({ candidateNumbers: [4], tickets: [{ number: 4, blockedBy: [], milestone: 'Maybe Someday' }] });
  assert.equal(allParked.result.ran, 0, 'a listing that is entirely parked ends the run with ran: 0');
  assert.deepEqual(allParked.result.skippedParked, [{ ticket: 4, milestone: 'Maybe Someday' }],
    'the parked ticket is still named in skippedParked on the early return');

  const body = generatedBlock() + extractScoutGate(fs.readFileSync(FLEET_SCRIPT, 'utf8'));
  const wrapper = new AsyncFunction(
    'scout', 'explicitTickets', 'cfg', 'instrument', 'log',
    body + '\nreturn { eligibleTickets, skippedParked };'
  );
  const logs = [];
  const { eligibleTickets, skippedParked } = await wrapper(scout, [], { label: 'ready-for-agent' }, 'gh', (m) => logs.push(m));
  assert.deepEqual(eligibleTickets.map((t) => t.number), [5],
    'the scout gate\'s candidate filter must drop the parked ticket before the wave, whatever its labels');
  assert.deepEqual(skippedParked, [{ ticket: 4, milestone: 'Maybe Someday' }],
    'the run result must list the drop under skippedParked with its number');
  assert.ok(logs.some((m) => /parked in the Maybe Someday milestone.*#4/.test(m)), 'the drop is logged');
});

test(`fleet script ${FLEET_SCRIPT_REL} scout gate still runs a parked ticket named explicitly`, async () => {
  const scout = { candidateNumbers: [4], tickets: [{ number: 4, blockedBy: [], milestone: 'Maybe Someday' }] };
  const body = generatedBlock() + extractScoutGate(fs.readFileSync(FLEET_SCRIPT, 'utf8'));
  const wrapper = new AsyncFunction(
    'scout', 'explicitTickets', 'cfg', 'instrument', 'log',
    body + '\nreturn { eligibleTickets, skippedParked };'
  );
  const { eligibleTickets, skippedParked } = await wrapper(scout, [4], { label: 'ready-for-agent' }, 'gh', () => {});
  assert.deepEqual(eligibleTickets.map((t) => t.number), [4],
    'a parked ticket named explicitly in args.tickets must still run');
  assert.deepEqual(skippedParked, [], 'nothing is dropped when the caller named the ticket by number');
});

test(`fleet script ${FLEET_SCRIPT_REL} gates the lanes before any agent is spawned`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const gateEnd = src.indexOf('// [FLEET-SCOUT-GATE-END]');
  assert.ok(gateEnd > 0, 'missing FLEET-SCOUT-GATE-END marker');
  for (const label of ['label: `open-pr-scan@', 'label: `impl:#', 'label: `probe:#', 'label: `handoff:#']) {
    const idx = src.indexOf(label);
    assert.ok(idx > gateEnd, `${label} must be spawned only after the scout gate returns`);
  }
});

test(`fleet script ${FLEET_SCRIPT_REL} scout prompt calls the listing the whole candidate set`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /That one listing is the WHOLE candidate set\./,
    'the scout prompt must state that the listing is the whole candidate set');
  assert.match(src, /zero tickets is a valid and complete answer, not a cue to go looking/,
    'the scout prompt must state that an empty listing is a valid answer, not a cue to search');
  assert.match(src, /candidateNumbers/,
    'the SCOUT schema must carry candidateNumbers so the listing can be pinned');
});

// ---- Human-lane hand-back and the handoff skip rule (issue 266) ----
// A human-lane ticket used to be handed back with a comment and nothing else: it kept
// `ready-for-agent`, so the next label listing put it back in the wave and the fleet wrote the
// same handoff comment again. Two mechanisms close that, and both are driven here rather than
// asserted by regex: the delivery relabels the ticket (ready-for-agent off, ready-for-human on)
// under either instrument, and the scout's wave selection parks a ticket whose latest comment is
// still an unanswered fleet handoff.

const extractBetween = extractMarked;

function loadTrackerRules(scriptPath, mode) {
  const body = extractBetween(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-TRACKER-RULES');
  // eslint-disable-next-line no-new-func
  const make = new Function(body + '\nreturn trackerRules;')();
  return make(mode);
}

async function driveHumanLane(scriptPath, agentMock, ticket, mode) {
  const body = extractBetween(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-HUMAN-LANE');
  // Issue 488: `with (laneScope(...))`, as the code lane and the marker blocks already do, rather
  // than a hand-kept parameter list - a new module-scope binding referenced from the lane used to
  // throw a bare ReferenceError here and needed a hand edit (issue 439 added scratchFile that way).
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${body}\nreturn runHumanLane;\n}`);
  const helpers = loadStableHelpers(scriptPath);
  const runHumanLane = await wrapper(laneScope({
    agent: agentMock,
    cfg: { deliver: true, verifyModel: 'v', deliverModel: 'd' },
    rules: loadTrackerRules(scriptPath, mode),
    HANDOFF: {},
    COMMENTED: {},
    stableList: helpers.stableList,
    stableText: helpers.stableText,
    // The lane names its own comment-body path (issue 439); the run's scratch root is module scope.
    scratchFile: (name) => `/tmp/fleet-testrun/${name}`,
  }));
  return await runHumanLane(ticket);
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
  const parked = { number: 266, kind: 'human', blockedBy: [], handoffPending: true };
  const fresh = { number: 267, kind: 'human', blockedBy: [], handoffPending: false };
  const blocked = { number: 268, kind: 'code', blockedBy: [10], handoffPending: false };
  const { wave, pendingHandoff, blocked: gated } = selectWave([parked, fresh, blocked], 3);
  assert.deepEqual(wave.map((t) => t.number), [267], 'only the ticket with no pending handoff may run');
  assert.deepEqual(pendingHandoff.map((t) => t.number), [266], 'the parked ticket must be reported as skipped by number');
  assert.deepEqual(gated.map((t) => t.number), [268], 'open blockers must still gate independently of the handoff skip');
});

test(`${FLEET_SCRIPT_REL} a run whose only ticket already carries a handoff comment starts no agents`, async () => {
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
// ---- Resume cache stability (issue 271) ----
// A `deliver: false` run resumed with `deliver: true` must replay every impl/verify agent from
// cache and start only the deliver stage. The runtime replays a call while its cache key — which
// covers the prompt text — is unchanged, so the fix is that no impl or verify prompt may vary
// between the two runs. Two things used to make them vary: the verdict text was rendered straight
// off the previous agent's result object, and the verifier/deliver prompts named the branch the
// *implementer reported* rather than the one this script instructed. These tests pin both.

// JSON round trip with every object's keys reversed — the shape a cached result comes back in.
function reorderKeys(value) {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).reverse()) { out[k] = reorderKeys(value[k]); }
    return out;
  }
  return value;
}
const roundTrip = (value) => JSON.parse(JSON.stringify(reorderKeys(value)));

// Ticket #42 fails verification on attempt 1 and passes on attempt 2, so the run exercises the
// attempt-2 implementer prompt (built from the attempt-1 verdict) and both verifier prompts.
function twoAttemptAgent(capture, shape = (x) => x, implBranch = null) {
  return async (prompt, opts) => {
    capture.push({ label: opts.label, prompt });
    if (opts.label === 'impl:#42.1') {
      return shape({
        branch: implBranch || 'agent/issue-42-attempt1-wf_testrun-w0',
        committed: true, pushed: true, testExitCode: 1, testTail: 'not ok', discoveries: ['finding-A'],
      });
    }
    if (opts.label === 'verify:#42.1') {
      return shape({
        pass: false,
        evidence: 'ran the suite; exit 1',
        failures: ['criterion 2 is not met', undefined, 'the suite exits 1'],
      });
    }
    if (opts.label === 'impl:#42.2') {
      return shape({
        branch: implBranch || 'agent/issue-42-attempt2-wf_testrun-w0',
        committed: true, pushed: true, testExitCode: 0, testTail: 'ok', discoveries: [],
      });
    }
    if (opts.label === 'verify:#42.2') {
      return shape({ pass: true, evidence: 'ran the suite; exit 0', failures: [] });
    }
    if (opts.label === 'deliver:#42') return shape({ pushed: true, prUrl: 'https://github.com/x/y/pull/9' });
    throw new Error('unexpected label: ' + opts.label);
  };
}

const TICKET_42 = { number: 42, title: 'a ticket', criteria: '- do the thing', keepOpen: false };

// ---- The verdict decides Closes vs Refs (issue 699) ----
// aac-bill-intake#682 was closed by a PR whose verifier had passed a branch that stopped short of
// the ticket. A passing verdict that names any criterion unmet now makes the PR say Refs #N and
// list those criteria; a verdict with none still says Closes #N.

async function deliverPromptFor(verdict) {
  const calls = [];
  const agentMock = async (prompt, opts) => {
    calls.push({ label: opts.label, prompt });
    if (opts.label === 'impl:#42.1') {
      return { branch: 'agent/issue-42-attempt1-wf_testrun-w0', committed: true, pushed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
    }
    if (opts.label === 'verify:#42.1') return verdict;
    if (opts.label === 'deliver:#42') return { pushed: true, prUrl: 'https://github.com/x/y/pull/9', mergeStatus: 'clean', conflictPaths: [] };
    throw new Error('unexpected label: ' + opts.label);
  };
  await driveCodeLane(FLEET_SCRIPT, agentMock, TICKET_42, 0);
  const deliver = calls.find((c) => c.label === 'deliver:#42');
  assert.ok(deliver, 'a passing verdict must reach the deliver stage');
  return deliver.prompt;
}

test('a passing verdict that marks criteria unmet delivers Refs #N, no closing keyword, and lists them (issue 699)', async () => {
  const prompt = await deliverPromptFor({
    pass: true, evidence: 'doc-only change; suite exit 0', failures: [],
    unmetCriteria: ['- [ ] remove the fallback once the owner rules', '  ', '- [ ] migrate the 5 work orders'],
  });
  assert.match(prompt, /"Refs #42"/, 'an unmet criterion must turn the PR reference into Refs #N');
  assert.doesNotMatch(prompt, /"Closes #42"/, 'no closing keyword may be offered while a criterion is unmet');
  assert.match(prompt, /never write Closes, Fixes or Resolves/);
  assert.match(prompt, /Acceptance criteria not met by this PR/, 'the PR body must carry a section for the unmet criteria');
  assert.match(prompt, /- - \[ \] remove the fallback once the owner rules\n\s+- - \[ \] migrate the 5 work orders/,
    'each unmet criterion must be listed by its text, blank entries dropped');
});

test('a passing verdict with every criterion met still delivers Closes #N (issue 699)', async () => {
  for (const verdict of [
    { pass: true, evidence: 'suite exit 0', failures: [], unmetCriteria: [] },
    { pass: true, evidence: 'suite exit 0' },
  ]) {
    const prompt = await deliverPromptFor(verdict);
    assert.match(prompt, /"Closes #42"/, 'a verdict naming no unmet criterion must close the ticket');
    assert.doesNotMatch(prompt, /"Refs #42"/);
    assert.doesNotMatch(prompt, /Acceptance criteria not met by this PR/);
  }
});

test('unmetCriteriaOf in the fleet script matches tools/ticket-fleet-branch.js (issue 699)', () => {
  const inlined = loadStableHelpers(FLEET_SCRIPT);
  for (const v of [null, {}, { unmetCriteria: [] }, { unmetCriteria: ['a', ' ', null, 'b\r\n'] }, { unmetCriteria: 'one' }]) {
    assert.deepEqual(inlined.unmetCriteriaOf(v), unmetCriteriaOf(v));
  }
  assert.deepEqual(unmetCriteriaOf({ unmetCriteria: ['a', ' ', null, 'b\r\n'] }), ['a', 'b']);
});

test('resume-stable helpers inlined in the fleet script match tools/ticket-fleet-branch.js', () => {
  const inlined = loadStableHelpers(FLEET_SCRIPT);
  const verdict = { evidence: 'ran it', pass: false, failures: ['one', '  two  ', '', null, 3, { b: 1, a: 2 }] };
  const cases = [
    null, undefined, '', 'plain', 'crlf\r\nfolded\r', 'trailing   \nspace\t', 7, false,
    { b: 1, a: 2 }, [1, 'two', null],
  ];
  for (const value of cases) {
    assert.equal(inlined.stableText(value), stableText(value), `stableText drifted on ${JSON.stringify(value)}`);
    assert.deepEqual(inlined.stableList(value), stableList(value), `stableList drifted on ${JSON.stringify(value)}`);
    assert.equal(inlined.stableJson(value), stableJson(value), `stableJson drifted on ${JSON.stringify(value)}`);
  }
  assert.equal(inlined.priorFindingsBlock(verdict, 'fix it'), priorFindingsBlock(verdict, 'fix it'));
  assert.equal(inlined.priorFindingsBlock(null, 'fix it'), '');
  assert.equal(priorFindingsBlock(verdict, 'fix it'), priorFindingsBlock(roundTrip(verdict), 'fix it'),
    'a verdict and its JSON round trip must render the same findings block');
});

for (const file of RESUME_GUARD_PAIR) {
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');

  test(`${rel} builds identical attempt-2 implementer and verifier prompts from a live result and its JSON round trip`, async () => {
    const live = [];
    const cached = [];
    await driveCodeLane(file, twoAttemptAgent(live), TICKET_42, 0);
    await driveCodeLane(file, twoAttemptAgent(cached, roundTrip), TICKET_42, 0);
    assert.deepEqual(live.map((c) => c.label), cached.map((c) => c.label));
    assert.ok(live.some((c) => c.label === 'impl:#42.2'), 'the run must reach an attempt-2 implementer');
    for (let i = 0; i < live.length; i++) {
      assert.equal(cached[i].prompt, live[i].prompt,
        `${live[i].label} prompt is not byte-identical when the prior result is round-tripped through JSON with keys reordered; its cache key would move on resume`);
    }
  });

  test(`${rel} starts no impl or verify agent that a deliver:true resume would re-run`, async () => {
    const first = [];
    const resumed = [];
    await driveCodeLane(file, twoAttemptAgent(first), TICKET_42, 0, { deliver: false });
    await driveCodeLane(file, twoAttemptAgent(resumed), TICKET_42, 0, { deliver: true });
    assert.deepEqual(first.map((c) => c.label), ['impl:#42.1', 'verify:#42.1', 'impl:#42.2', 'verify:#42.2'],
      'a deliver:false run stops after the passing verify');
    assert.deepEqual(resumed.map((c) => c.label), first.map((c) => c.label).concat(['deliver:#42']),
      'the deliver:true resume must add exactly one new agent: deliver:#42');
    for (let i = 0; i < first.length; i++) {
      assert.equal(resumed[i].prompt, first[i].prompt,
        `${first[i].label} prompt differs between the deliver:false run and the deliver:true resume; the resume would re-run it instead of replaying it from cache`);
    }
  });

  test(`${rel} verifies and delivers the instructed branch, not the implementer's self-report`, async () => {
    const calls = [];
    const { result, logs } = await driveCodeLane(
      file, twoAttemptAgent(calls, (x) => x, 'agent/issue-42-attempt9-somewhere-else'), TICKET_42, 0
    );
    const verify2 = calls.find((c) => c.label === 'verify:#42.2').prompt;
    const deliver = calls.find((c) => c.label === 'deliver:#42').prompt;
    const instructed = buildBranchName(42, 'testrun', 0, 2);
    for (const [label, prompt] of [['verify:#42.2', verify2], ['deliver:#42', deliver]]) {
      assert.ok(prompt.includes(instructed), `${label} must name the instructed branch ${instructed}`);
      assert.ok(!prompt.includes('somewhere-else'),
        `${label} must not carry the implementer's self-reported branch: the branch delivered is the branch that was verified`);
    }
    assert.equal(result.branch, instructed, 'the lane reports the branch it verified and delivered');
    assert.ok(logs.some((m) => m.includes('not the instructed')), 'a self-report mismatch must be logged');
  });
}

// ---- A re-run implementer sees the verifier's own findings (issue 277) ----
// Run 6aa99b19 re-ran issue 241 three times and the reviewer feedback each retry carried was the
// filler `test1` / `test2`, so the implementer could not see why it had been rejected and shipped
// the same approach again. The trace: a verdict reaches the next attempt through exactly one door,
// priorFindingsBlock, which reads `failures` - the filler came from the verifier itself, which had
// to invent entries while `failures` was a required property (issue 265). What the script did lose
// is the empty case: both lanes normalise a missing `failures` key to `[]`, and an empty list used
// to render as a lone `- ` bullet. These two drive the whole lane, so what is asserted is the text
// the attempt-2 implementer agent is actually sent.

test(`${FLEET_SCRIPT_REL} quotes the verifier's own findings in the next attempt's implementer prompt (issue 277)`, async () => {
  const calls = [];
  await driveCodeLane(FLEET_SCRIPT, twoAttemptAgent(calls), TICKET_42, 0);
  const impl1 = calls.find((c) => c.label === 'impl:#42.1').prompt;
  const impl2 = calls.find((c) => c.label === 'impl:#42.2').prompt;
  assert.ok(!impl1.includes('Previous attempt FAILED'), 'attempt 1 has no prior verdict to quote');
  assert.ok(impl2.includes('Previous attempt FAILED verification'),
    'the retry must be told the previous attempt was refuted');
  for (const finding of ['criterion 2 is not met', 'the suite exits 1']) {
    assert.ok(impl2.includes(`- ${finding}`),
      `the attempt-2 implementer prompt must quote the verifier finding "${finding}" verbatim`);
  }
});

test(`${FLEET_SCRIPT_REL} falls back to the verifier's evidence when a failing verdict lists no findings (issue 277)`, async () => {
  const calls = [];
  const evidence = 'ran `node --test tools/x.test.js` in the scratch worktree; exit 2, 3 assertions failed';
  const agentMock = async (prompt, opts) => {
    calls.push({ label: opts.label, prompt });
    const attempt = Number(opts.label.slice(-1));
    if (opts.label.startsWith('impl:')) {
      return { branch: buildBranchName(42, 'testrun', 0, attempt), committed: true, pushed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
    }
    // Attempt 1 fails with no `failures` key at all - the shape the schema allows since issue 265
    // and the lanes normalise to []. Attempt 2 passes, so the lane stops there.
    if (opts.label === 'verify:#42.1') return { pass: false, evidence };
    if (opts.label === 'verify:#42.2') return { pass: true, evidence: 'exit 0', failures: [] };
    if (opts.label === 'deliver:#42') return { pushed: true, prUrl: 'https://github.com/x/y/pull/9' };
    throw new Error('unexpected label: ' + opts.label);
  };
  await driveCodeLane(FLEET_SCRIPT, agentMock, TICKET_42, 0);
  const impl2 = calls.find((c) => c.label === 'impl:#42.2').prompt;
  assert.ok(!/findings \([^)]*\):\n-\s*\n/.test(impl2),
    'a findings block whose only bullet is empty tells the retry nothing - that is the issue 277 drop');
  assert.ok(impl2.includes(evidence),
    "with no findings listed, the retry must carry the verifier's own evidence verbatim");
});

// ---- Closed blockers are cleared in code, not by editing the body (issue 403) ----
// The scout reports the numbers a ticket's "Blocked by" section names; the fleet reads each of
// those issues through the tracker instrument and drops the ones the tracker calls closed. These
// drive the block between the FLEET-BLOCKER-STATE markers with a stubbed instrument, so the
// state comes from the reply rather than from whatever the ticket body still says.

async function driveBlockerState(tickets, blockerReply, { mode = 'gh' } = {}) {
  // applyBlockerStates comes from the generated block since issue 440; the marked block holds
  // only the read that feeds it.
  const body = generatedBlock() + extractBetween(fs.readFileSync(FLEET_SCRIPT, 'utf8'), 'FLEET-BLOCKER-STATE');
  const logs = [];
  const prompts = [];
  const agentMock = async (prompt, opts) => { prompts.push([opts.label, prompt]); return blockerReply(prompt, opts); };
  const wrapper = new AsyncFunction('agent', 'cfg', 'rules', 'log',
    body + '\nreturn { resolveBlockerStates, applyBlockerStates };');
  const fns = await wrapper(agentMock, { reportModel: 'r' }, loadTrackerRules(FLEET_SCRIPT, mode), (m) => logs.push(m));
  const resolved = await fns.resolveBlockerStates(tickets);
  return { resolved, logs, prompts, applyBlockerStates: fns.applyBlockerStates };
}

test(`${FLEET_SCRIPT_REL} runs a ticket whose only blocker is closed, with no body edit (issue 403)`, async () => {
  const ticket = { number: 305, kind: 'code', blockedBy: [199], handoffPending: false };
  const { resolved, logs, prompts } = await driveBlockerState(
    [ticket], async () => ({ blockers: [{ number: 199, state: 'closed' }] })
  );
  assert.match(prompts[0][1], /gh api repos\/\{owner\}\/\{repo\}\/issues\/N --jq \.state/,
    'the blocker state must be read through the instrument, not inferred from the body');
  assert.deepEqual(resolved[0].blockedBy, [],
    'a blocker the tracker reports closed must stop gating the ticket');
  assert.deepEqual(selectWave(resolved, 3).wave.map((t) => t.number), [305],
    'the ticket must be eligible without anyone rewriting its "Blocked by" section');
  assert.ok(logs.some((m) => m.includes('#305') && m.includes('#199') && m.includes('closed')),
    'the cleared blocker must appear in the run log, naming ticket and blocker');
});

test(`${FLEET_SCRIPT_REL} still skips a ticket whose blocker is open, naming the blocker (issue 403)`, async () => {
  const ticket = { number: 305, kind: 'code', blockedBy: [199], handoffPending: false };
  const { resolved, prompts } = await driveBlockerState(
    [ticket], async () => ({ blockers: [{ number: 199, state: 'open' }] }), { mode: 'mcp' }
  );
  assert.match(prompts[0][1], /mcp__github__issue_read/,
    'the container instrument must read the blocker through the GitHub MCP tools');
  assert.deepEqual(resolved[0].blockedBy, [199], 'an open blocker must survive the resolution');
  const selection = selectWave(resolved, 3);
  assert.deepEqual(selection.wave, [], 'a ticket with an open blocker must not run');
  assert.deepEqual(selection.blocked.map((t) => ({ ticket: t.number, blockedBy: t.blockedBy })),
    [{ ticket: 305, blockedBy: [199] }], 'the skipped ticket must carry the open blocker numbers');
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /const droppedBlocked = selection\.blocked\.map\(t => \(\{ ticket: t\.number, blockedBy: t\.blockedBy \}\)\)/,
    'the run result must build skippedBlocked as entries naming the open blockers, not a count');
  assert.match(src, /skippedBlocked: droppedBlocked/,
    'the run result must carry those entries');
});

test('applyBlockerStates inlined in the fleet script matches tools/ticket-fleet-branch.js', async () => {
  const { applyBlockerStates: inlined } = await driveBlockerState([], async () => ({ blockers: [] }));
  const tickets = [
    { number: 30, blockedBy: [199, 206] },
    { number: 32, blockedBy: ['207'] },
    { number: 134, blockedBy: [] },
    { number: 135, blockedBy: [900] },
  ];
  const blockers = [
    { number: 199, state: 'closed' }, { number: 206, state: 'open' },
    { number: 207, state: 'CLOSED ' }, { number: 305, state: 'closed' },
  ];
  const mine = applyBlockerStates(tickets, blockers);
  assert.deepEqual(inlined(tickets, blockers), mine, 'the two copies of the filter have drifted');
  assert.deepEqual(mine.tickets.map((t) => t.blockedBy), [[206], [], [], [900]],
    'only blockers the reader reported closed may be dropped; one it never reported keeps blocking');
  assert.deepEqual(mine.cleared, [{ ticket: 30, blocker: 199 }, { ticket: 32, blocker: 207 }],
    'every cleared (ticket, blocker) pair is reported so the run can log it');
  assert.deepEqual(applyBlockerStates(tickets, [{ number: 900, state: 'unknown' }]).cleared, [],
    'an unreadable blocker keeps blocking: the gate opens only on positive evidence');
});

// ---- Finish mode: deliver what a dead run verified (issue 405) ----
// A run whose Deliver step or container died leaves verified branches with no PR and no report
// writer, and its journal holds every result. `args.finishRunId` replays that journal: it delivers
// every verified-but-undelivered branch, skips the ones already delivered, leaves the unverified
// alone, and runs the report writer over the discoveries. Driven here against a journal fixture
// with one of each, so the skipping is behavior rather than prompt text.
async function driveFinish(scriptPath, agentMock, journal, cfgOverrides = {}) {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const helpers = loadStableHelpers(scriptPath);
  const body = [
    extractMarked(src, 'FLEET-DELIVER-PROMPT'),
    extractMarked(src, 'FLEET-REPORT'),
    extractMarked(src, 'FLEET-FINISH'),
  ].join('\n');
  const logs = [];
  const checkpoints = [];
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${body}\nreturn runFinish;\n}`);
  const runFinish = await wrapper(laneScope({
    agent: agentMock,
    log: (m) => logs.push(m),
    cfg: Object.assign({ deliver: true, deliverModel: 'd', reportModel: 'r', followupsFile: 'FOLLOW-UPS.md' }, cfgOverrides),
    runId: 'testrun',
    instrument: 'gh',
    rules: new Proxy({}, { get: () => () => 'gh pr create' }),
    stableText: helpers.stableText,
    stableList: helpers.stableList,
    unusableReason: (who, detail) => `${who} output unusable: ${detail}`,
    treeGuardCheck: async (label, ticketNumber) => { checkpoints.push(`${label}#${ticketNumber}`); },
    classifyDelivery,
    DELIVERED: {},
    DISCOVERY_REPORT: {},
  }));
  return { result: await runFinish(journal), logs, checkpoints };
}

// One delivered ticket, one verified-but-undelivered, one that never passed a verifier.
const DEAD_RUN_JOURNAL = {
  journalPath: '/home/u/.claude/projects/p/s/subagents/workflows/wf_dead/journal.jsonl',
  defaultBranch: 'main',
  testCommand: 'node --test tools/*.test.js',
  tickets: [
    {
      number: 320, title: 'already delivered', kind: 'code', branch: 'agent/issue-320-attempt1-wf_dead-w0',
      verified: true, evidence: 'ran the gate; exit 0', keepOpen: false, criteria: '- one',
      delivered: true, deliveryRef: 'https://github.com/x/y/pull/320',
    },
    {
      number: 324, title: 'verified, never delivered', kind: 'code', branch: 'agent/issue-324-attempt1-wf_dead-w1',
      verified: true, evidence: 'ran the gate; exit 0', keepOpen: false, criteria: '- two',
      delivered: false, deliveryRef: '',
    },
    {
      number: 356, title: 'never verified', kind: 'code', branch: 'agent/issue-356-attempt1-wf_dead-w2',
      verified: false, evidence: '', keepOpen: false, criteria: '- three',
      delivered: false, deliveryRef: '',
    },
  ],
  discoveries: ['finding-A'],
};

test(`${FLEET_SCRIPT_REL} finish mode delivers only the verified-but-undelivered branch, then runs the report writer (issue 405)`, async () => {
  const calls = [];
  const prompts = {};
  const agentMock = async (prompt, opts) => {
    calls.push(opts.label);
    prompts[opts.label] = prompt;
    if (opts.label.startsWith('deliver:')) {
      return { pushed: true, prUrl: 'https://github.com/x/y/pull/324', mergeStatus: 'clean', conflictPaths: [] };
    }
    if (opts.label === 'followups-writer') {
      return { branch: 'agent/fleet-discoveries-wf_testrun', sha: 'abc123', prUrl: 'https://github.com/x/y/pull/9', appended: 1 };
    }
    throw new Error('unexpected label: ' + opts.label);
  };
  const { result, logs, checkpoints } = await driveFinish(FLEET_SCRIPT, agentMock, DEAD_RUN_JOURNAL);
  assert.deepEqual(calls, ['deliver:#324', 'followups-writer'],
    'exactly one delivery (the verified, undelivered ticket) plus the report writer - no implementer, no verifier, nothing for the delivered or unverified tickets');
  const deliver = prompts['deliver:#324'];
  assert.ok(deliver.includes('agent/issue-324-attempt1-wf_dead-w1'), 'the deliverer must be given the branch the journal recorded');
  assert.ok(!deliver.includes('wf_dead-w0') && !deliver.includes('wf_dead-w2'), 'no other ticket may reach the deliverer');
  assert.match(deliver, /FINISH pass/, 'the finish delivery must tell the deliverer an existing PR for this branch is not to be duplicated');
  assert.deepEqual(result.delivered, [{ ticket: 324, branch: 'agent/issue-324-attempt1-wf_dead-w1', pr: 'https://github.com/x/y/pull/324' }]);
  assert.deepEqual(result.skippedDelivered, [{ ticket: 320, ref: 'https://github.com/x/y/pull/320' }],
    'a ticket the journal records as delivered must be skipped, with the PR it already has');
  assert.deepEqual(result.skippedUnverified, [356], 'a ticket no verifier passed must not be delivered by a finish pass');
  assert.deepEqual(result.failed, []);
  assert.equal(result.discoveryReport.sha, 'abc123', "the dead run's discoveries must still reach the follow-ups file");
  assert.deepEqual(checkpoints, ['finish-deliver#324'],
    'the orchestrator tree is checkpointed after each finish delivery, as it is in the code lane');
  assert.ok(logs.some((m) => /already delivered/.test(m)) && logs.some((m) => /no passing verdict/.test(m)),
    'both skips must say why in the run log');
});

test(`${FLEET_SCRIPT_REL} finish mode is reached from args.finishRunId without a scout (issue 405)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /finishRunId: null/, 'finishRunId must be a declared arg with a default');
  const finishIdx = src.indexOf('if (cfg.finishRunId) {');
  const scoutIdx = src.indexOf('const scout = await agent(');
  assert.ok(finishIdx > 0 && scoutIdx > finishIdx,
    'the finish branch must return before the scout agent is ever started');
  assert.match(src, /label: `journal-read:\$\{finishRunId\}`/, 'finish mode must read the dead run journal through its own agent');
});

// ---- "Could not tell" is not "absent" (issue 654) ----
// Run 6ab1884a: the implementer pushed, the verifier passed, and the deliverer returned
// {mergeStatus:"blocked", conflictPaths:[], blockedReason:"Branch ... not found on origin or locally"}
// while the ref sat on origin. The ticket was listed under `failed`, as if nothing were to deliver.
test('classifyBranchLookup calls a branch absent only on two authoritative exit-2 lookups (issue 654)', () => {
  assert.equal(classifyBranchLookup([]), 'undetermined', 'no lookup at all says nothing');
  assert.equal(classifyBranchLookup([{ exitCode: 0, output: '' }]), 'undetermined', 'an exit 0 that printed nothing is not an answer');
  assert.equal(classifyBranchLookup([{ exitCode: 128, output: 'fatal: could not read from remote repository' }]), 'undetermined');
  assert.equal(classifyBranchLookup([{ exitCode: 2, output: '' }]), 'undetermined', 'one lookup is never enough to call a branch absent');
  assert.equal(classifyBranchLookup([{ exitCode: 2, output: '' }, { exitCode: 2, output: '' }]), 'absent');
  assert.equal(classifyBranchLookup([{ exitCode: 128, output: '' }, { exitCode: 0, output: 'c4065bcc\trefs/heads/agent/issue-629-attempt1-wf_6ab1884a-w1' }]), 'present',
    'a later lookup that prints the ref wins over an earlier failed one');
});

function lane654Mock(branch, { implPushed, pushBack, delivery }) {
  const calls = [];
  const agentMock = async (_prompt, opts) => {
    calls.push(opts.label);
    if (opts.label.startsWith('impl:')) return { branch, committed: true, pushed: implPushed, testExitCode: 0, testTail: 'ok', discoveries: [] };
    if (opts.label.startsWith('push:')) return pushBack;
    if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran the gate; exit 0', failures: [] };
    if (opts.label.startsWith('deliver:')) return delivery;
    throw new Error('unexpected label: ' + opts.label);
  };
  return { calls, agentMock };
}

test(`${FLEET_SCRIPT_REL} a deliverer whose first ls-remote comes back empty does not conclude the branch is missing (issue 654)`, async () => {
  const branch = 'agent/issue-629-attempt1-wf_testrun-w0';
  const { agentMock } = lane654Mock(branch, {
    implPushed: false,
    pushBack: { pushed: false, output: 'fatal: unable to access origin' },
    delivery: { pushed: false, prUrl: '', mergeStatus: 'branch-unconfirmed', conflictPaths: [], branchLookup: [{ exitCode: 128, output: '' }], blockedReason: 'fatal: unable to access origin' },
  });
  const { result } = await driveCodeLane(FLEET_SCRIPT, agentMock, { number: 629, title: 't', criteria: '' }, 0);
  assert.equal(result.mergeStatus, 'branch-unconfirmed');
  assert.deepEqual(result.conflictPaths, [], 'a lookup failure is not a merge conflict');
  assert.ok(!result.verdict.failures.some((f) => /pre-push merge/.test(f)), 'a lookup that could not tell must not be reported as a blocked merge');
  assert.match(result.deliveryFailure, /could not determine whether branch agent\/issue-629-attempt1-wf_testrun-w0 is on origin/);
  assert.doesNotMatch(result.deliveryFailure, /is not on origin/, 'one failed ls-remote must never read as "the branch is missing"');
  assert.equal(result.inconsistency, null, 'the run never recorded this branch as pushed, so this is not an inconsistency');
  const prompt = extractMarked(fs.readFileSync(FLEET_SCRIPT, 'utf8'), 'FLEET-DELIVER-PROMPT');
  assert.match(prompt, /git ls-remote --exit-code --heads origin \$\{branch\}/, 'the deliverer must run the lookup whose exit code tells absent from unknown');
  assert.match(prompt, /mergeStatus:"branch-unconfirmed"/, 'and return an unseen branch under its own status');
  assert.match(prompt, /never mergeStatus "blocked"/, 'never as a blocked merge');
});

test(`${FLEET_SCRIPT_REL} a pushed, verified branch the deliverer cannot find is an inconsistency naming the branch (issue 654)`, async () => {
  const branch = 'agent/issue-629-attempt1-wf_testrun-w0';
  const { calls, agentMock } = lane654Mock(branch, {
    implPushed: true,
    delivery: {
      pushed: false, prUrl: '', mergeStatus: 'blocked', conflictPaths: [], branchLookup: [{ exitCode: 0, output: '' }],
      blockedReason: `Branch ${branch} not found on origin or locally; git ls-remote --heads origin returned no matching refs`,
    },
  });
  const { result, logs } = await driveCodeLane(FLEET_SCRIPT, agentMock, { number: 629, title: 't', criteria: '' }, 0);
  assert.deepEqual(calls, ['impl:#629.1', 'verify:#629.1', 'deliver:#629']);
  assert.deepEqual(result.inconsistency && result.inconsistency.branch, branch, 'the inconsistency must name the branch');
  assert.match(result.inconsistency.detail, /^INCONSISTENCY: branch agent\/issue-629-attempt1-wf_testrun-w0 is recorded pushed:true with a verifier pass:true/);
  assert.match(result.inconsistency.detail, /manual delivery/, 'it must say the branch may need delivering by hand');
  assert.ok(!result.verdict.failures.some((f) => /pre-push merge/.test(f)), 'it is not a blocked merge, whatever mergeStatus the deliverer chose');
  assert.ok(logs.some((m) => /INCONSISTENCY/.test(m)), 'the inconsistency must be logged loudly');
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /failed: clean\.filter\(r => \(!r\.done \|\| r\.deliveryFailure\) && !r\.inconsistency\)/,
    'the run result must keep an inconsistent ticket out of `failed`');
  assert.match(src, /inconsistent: clean\.filter\(r => r\.inconsistency\)/, 'and list it under `inconsistent`');
});

test(`${FLEET_SCRIPT_REL} finish mode reports a journal-pushed branch the deliverer cannot find as inconsistent (issue 654)`, async () => {
  const branch = 'agent/issue-324-attempt1-wf_dead-w1';
  const journal = Object.assign({}, DEAD_RUN_JOURNAL, {
    tickets: [Object.assign({}, DEAD_RUN_JOURNAL.tickets[1], { pushed: true })],
  });
  const agentMock = async (_prompt, opts) => {
    if (opts.label.startsWith('deliver:')) {
      return { pushed: false, prUrl: '', mergeStatus: 'branch-unconfirmed', conflictPaths: [], branchLookup: [{ exitCode: 128, output: 'fatal' }, { exitCode: 2, output: '' }], blockedReason: 'fatal' };
    }
    if (opts.label === 'followups-writer') return { branch: 'b', sha: 's', prUrl: '', appended: 1 };
    throw new Error('unexpected label: ' + opts.label);
  };
  const { result } = await driveFinish(FLEET_SCRIPT, agentMock, journal);
  assert.deepEqual(result.failed, [], 'an inconsistency is not an ordinary failure');
  assert.equal(result.inconsistent.length, 1);
  assert.equal(result.inconsistent[0].branch, branch);
  assert.match(result.inconsistent[0].detail, /INCONSISTENCY: branch agent\/issue-324-attempt1-wf_dead-w1/);
});

// ---- Implementer model per ticket from a Jev difficulty Score (issue 725) ----
// Jev is stubbed throughout: the `difficulty` agent is the only thing that talks to the service,
// so a mocked agent returning Jev-shaped bodies is the whole service boundary.
const DIFF_CFG = { implModel: 'heavy', implPins: { mechanical: 'light', 'multi-file': 'mid', design: null }, deliverModel: 'd' };
function jevBody(scores) {
  const answers = {};
  for (const [n, score] of Object.entries(scores)) answers[`ticket-${n}`] = { type: 'score', score, confidence: 0.9 };
  return JSON.stringify({ model: 'jev-1.13.0', answers });
}
function generatedPickImplModel() {
  // eslint-disable-next-line no-new-func
  return new Function(`${generatedBlock()}\nreturn pickImplModel;`)();
}
async function driveScoreDifficulty(agentMock, tickets, cfgOverrides = {}) {
  const logs = [];
  const body = extractMarked(fs.readFileSync(FLEET_SCRIPT, 'utf8'), 'FLEET-DIFFICULTY');
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${generatedBlock()}\n${body}\nreturn scoreDifficulty;\n}`);
  const scoreDifficulty = await wrapper(laneScope({
    agent: agentMock, log: (m) => logs.push(m), wave: [], cfg: Object.assign({}, DIFF_CFG, cfgOverrides),
    scout: { repoMap: 'tools/ holds the scripts' }, scratchRoot: '/tmp/fleet-t', scratchFile: (n) => `/tmp/fleet-t/${n}`,
    unusableReason: (who, detail) => `${who} output unusable: ${detail}`,
  }));
  return { levels: await scoreDifficulty(tickets), logs };
}
const DIFF_TICKETS = [
  { number: 1, title: 'fix a typo', criteria: '- [ ] typo gone', kind: 'code' },
  { number: 2, title: 'add a flag and its tests', criteria: '- [ ] flag', kind: 'code' },
  { number: 3, title: 'design a new contract', criteria: '- [ ] contract', kind: 'code' },
];

test('stubbed Jev: each of the three levels maps to its own attempt-1 pin, retries to the heaviest', async () => {
  let prompt = null;
  const { levels } = await driveScoreDifficulty(async (p, opts) => {
    assert.equal(opts.label, 'difficulty');
    prompt = p;
    return { status: 'ok', body: jevBody({ 1: 0.1, 2: 1.2, 3: 1.8 }) };
  }, DIFF_TICKETS.concat([{ number: 4, title: 'probe', criteria: '', kind: 'probe' }]));
  assert.deepEqual(Object.fromEntries(Object.entries(levels).map(([n, d]) => [n, d.level])),
    { 1: 'mechanical', 2: 'multi-file', 3: 'design' }, 'probe tickets are not scored');
  assert.match(prompt, /"ticket-1":\{"type":"score"/, 'the agent posts one Score per code ticket');
  assert.doesNotMatch(prompt, /"ticket-4"/);
  const pickImplModel = generatedPickImplModel();
  assert.deepEqual(['mechanical', 'multi-file', 'design'].map(l => pickImplModel(l, 1, DIFF_CFG)), ['light', 'mid', 'heavy']);
  assert.deepEqual(['mechanical', 'multi-file', 'design'].map(l => pickImplModel(l, 2, DIFF_CFG)), ['heavy', 'heavy', 'heavy'],
    'a retry after a failed verify takes the heaviest pin');
});

test('stubbed Jev unavailable: no levels, so every ticket and attempt runs on implModel', async () => {
  const pickImplModel = generatedPickImplModel();
  const shapes = [
    async () => ({ status: 'unavailable', body: '', detail: 'curl exit 28 (timeout)' }),
    async () => ({ status: 'ok', body: '<html>502</html>' }),
    async () => { throw new Error('agent died'); },
    async () => null,
  ];
  for (const mock of shapes) {
    const { levels, logs } = await driveScoreDifficulty(mock, DIFF_TICKETS);
    assert.deepEqual(levels, {});
    assert.ok(logs.some(l => /implModel/.test(l)), 'the fallback is logged');
    for (const attempt of [1, 2, 3]) assert.equal(pickImplModel(null, attempt, DIFF_CFG), 'heavy');
  }
  const off = await driveScoreDifficulty(async () => { throw new Error('must not be called'); }, DIFF_TICKETS, { difficulty: false });
  assert.deepEqual(off.levels, {}, 'difficulty:false skips the call');
});

test('runCodeLane runs attempt 1 on the level pin, the retry on the heaviest, and records both', async () => {
  const pickImplModel = generatedPickImplModel();
  for (const [difficulty, expected] of [['mechanical', ['light', 'heavy']], [null, ['heavy', 'heavy']]]) {
    const models = [];
    let verifies = 0;
    const agentMock = async (_prompt, opts) => {
      if (opts.label.startsWith('impl:')) { models.push(opts.model); return { branch: 'b', committed: true, pushed: true, testExitCode: 0, testTail: 'ok', discoveries: [] }; }
      if (opts.label.startsWith('verify:')) return ++verifies === 1 ? { pass: false, evidence: 'x', failures: ['criterion 2 unmet'] } : { pass: true, evidence: 'ok', failures: [] };
      if (opts.label.startsWith('deliver:')) return { pushed: true, prUrl: 'https://github.com/x/y/pull/1' };
      throw new Error('unexpected label: ' + opts.label);
    };
    const { result } = await driveCodeLane(FLEET_SCRIPT, agentMock, { number: 725, title: 't', criteria: '', difficulty }, 0,
      DIFF_CFG, 'inv1', null, { pickImplModel });
    assert.deepEqual(models, expected);
    assert.equal(result.difficulty, difficulty);
    assert.deepEqual(result.implModels, expected.map((model, i) => ({ attempt: i + 1, model })), 'the run record names the model per attempt');
  }
  assert.match(fs.readFileSync(FLEET_SCRIPT, 'utf8'), /implModels: clean\.filter\(r => r\.kind === 'code'\)\.map\(r => \(\{ ticket: r\.ticket, difficulty:/,
    'the run result names the level and models per ticket');
});

test('difficultyEvalSet labels a ticket "hard" when a fleet branch shows attempt 2 or later', () => {
  const { difficultyEvalSet } = require('./ticket-fleet-branch.js');
  assert.deepEqual(difficultyEvalSet([
    'agent/issue-12-attempt1-wf_a-w0', 'agent/issue-12-attempt2-wf_a-w0',
    'agent/issue-7-attempt1-wf_b-w1', 'feat/other', 'agent/fleet-discoveries-wf_a',
  ]), [{ number: 7, label: null, maxAttempt: 1 }, { number: 12, label: 'hard', maxAttempt: 2 }]);
});

// Issue 757: every MCP tool the fleet calls takes owner and repo as arguments. A prompt that never
// named them left the open-pr-scan agent to guess ("Dan-AAC"), and its fallback call stalled run
// 6ab4840f for 106 minutes. Every MCP tracker rule, and the open-pr-scan MCP steps, name the source.
test(`${FLEET_SCRIPT_REL} MCP tracker prompts name where owner and repo come from (issue 757)`, () => {
  const rules = loadTrackerRules(FLEET_SCRIPT, 'mcp');
  const texts = {
    scoutList: rules.scoutList('ready-for-agent'),
    scoutExplicit: rules.scoutExplicit([1]),
    handoffRead: rules.handoffRead(1),
    commentPost: rules.commentPost('/tmp/x'),
    labelSwap: rules.labelSwap(1),
    blockerState: rules.blockerState([1]),
    prCreate: rules.prCreate('/tmp/x'),
    prComment: rules.prComment('/tmp/x'),
  };
  for (const [name, text] of Object.entries(texts)) {
    assert.match(text, /git remote get-url origin/, `mcp rule ${name} does not say where owner/repo come from`);
  }
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const fn = src.slice(src.indexOf('async function dropTicketsWithOpenPr'), src.indexOf("found = await agent(", src.indexOf('async function dropTicketsWithOpenPr')));
  assert.match(fn, /instrument === 'mcp'\s*\?\s*`[^`]*\$\{rules\.repoNote\}/, 'open-pr-scan MCP steps must embed rules.repoNote');
});

// Issue 770: the deliverer merges the PR it opened, in the instrument the rest of the stage uses.
test(`${FLEET_SCRIPT_REL} deliver rules carry the PR merge in both instruments (issue 770)`, () => {
  const mcp = loadTrackerRules(FLEET_SCRIPT, 'mcp');
  const gh = loadTrackerRules(FLEET_SCRIPT, 'gh');
  for (const [name, rules] of [['mcp', mcp], ['gh', gh]]) {
    for (const fn of ['prState', 'prChecks', 'prReviews', 'prMerge', 'issueState', 'issueClose']) {
      assert.equal(typeof rules[fn], 'function', `${name} rules lack ${fn}`);
    }
    assert.match(rules.prMerge(7, 'fix: x (#7)'), /squash/, `${name} prMerge must squash`);
    assert.match(rules.prChecks(7), /check.runs/, `${name} prChecks must read the head's check runs`);
  }
  assert.match(mcp.prMerge(7, 'fix: x (#7)'), /mcp__github__merge_pull_request/);
  assert.match(mcp.prMerge(7, 'fix: x (#7)'), /expectedHeadSha/);
  assert.match(gh.prMerge(7, 'fix: x (#7)'), /gh api --method PUT repos\/\{owner\}\/\{repo\}\/pulls\/7\/merge/);
  assert.match(gh.prMerge(7, 'fix: x (#7)'), /-f sha=/);
  assert.doesNotMatch(gh.prMerge(7, 'fix: x (#7)').split('(never')[0], /gh pr merge/, 'gh prMerge must not run gh pr merge');
  assert.match(gh.prState(7), /never `gh pr view`/);
});

test(`${FLEET_SCRIPT_REL} deliver prompt runs STEP D: wait for CI, the runbook bar, merge, then the ticket (issue 770)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const prompt = src.slice(src.indexOf('function deliverPrompt('), src.indexOf('// [FLEET-DELIVER-PROMPT-END]'));
  assert.match(prompt, /STEP D - merge the PR you opened/, 'STEP D missing');
  assert.match(prompt, /at most 20 minutes/, 'the CI wait must name its bound');
  assert.match(prompt, /\$\{rules\.prChecks\(/, 'D1 must read check runs through the instrument rule');
  assert.match(prompt, /\$\{rules\.prMerge\(/, 'D4 must merge through the instrument rule');
  assert.match(prompt, /never merge a head with a red check/);
  assert.match(prompt, /\$\{rules\.labelSwap\(t\.number\)\}/, 'a keep-open ticket is relabelled ready-for-human after the merge');
  assert.match(prompt, /\$\{rules\.issueClose\(t\.number/, 'a Closes ticket still open after the merge is closed citing the PR');
  assert.doesNotMatch(prompt, /Do NOT merge the PR/, 'the old prohibition would contradict STEP D');
  const delivered = src.slice(src.indexOf('const DELIVERED = '), src.indexOf('const COMMENTED = '));
  for (const key of ['merged', 'mergeSha', 'prState']) {
    assert.match(delivered, new RegExp(`required: \\[[^\\]]*'${key}'`), `DELIVERED must require ${key}`);
  }
});

// Issue 770: every run refreshes the served repo's copy of this script from claude-dotfiles master,
// except the forks the contract names.
test(`${FLEET_SCRIPT_REL} refreshes the served repo's copy from claude-dotfiles master, forks excepted (issue 770)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const block = extractBetween(src, 'FLEET-REFRESH');
  assert.match(block, /https:\/\/raw\.githubusercontent\.com\/surreptakos\/claude-dotfiles\/master\/aac-skills\/ticket-fleet/);
  assert.match(block, /label: 'fleet-refresh', phase: 'Setup'/);
  assert.match(block, /sha256sum/, 'a copy that already matches must not be rewritten');
  assert.match(block, /git commit -m "chore\(fleet\): refresh ticket-fleet script from claude-dotfiles master \(issue 770\)"/);
  assert.match(block, /never created/, 'a repo with no copy launches from the plugin path and gets none');
  const forks = /const FLEET_FORKS = \[([^\]]*)\]/.exec(block);
  assert.ok(forks, 'FLEET_FORKS missing');
  const listed = forks[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
  const contract = require(path.join(REPO_ROOT, 'tools', 'ticket-fleet-contract.js'));
  assert.deepEqual(listed, contract.FORKS.map((f) => f.repo).sort(), 'the inlined fork list must equal the contract FORKS');
  const setupIdx = src.indexOf("phase('Setup')");
  assert.ok(src.indexOf('[FLEET-REFRESH-START]') > setupIdx && src.indexOf('[FLEET-REFRESH-END]') < src.indexOf('if (treeGuardOn) {', setupIdx),
    'the refresh runs first in Setup, before the tree-guard baseline, so its commit is inside the baseline');
});

// Issue 755: in a cloud container a hook wraps a bare `git ...` in caveman and the worktree guard
// refuses it ("runs caveman with a git command among its operands"), while /usr/bin/git is accepted
// every time. Run 6ab47219 lost two workers' pushes to prompts that named only the bare spelling.
// Every push instruction now carries the accepted spelling; the bare one survives only where it is
// the one that runs, the Windows desktop (no /usr/bin/git), and there the absolute path is the retry.
const { gitSpelling } = require('./ticket-fleet-branch.js');
const BARE_PUSH_RE = /(?<![/\w])git push (?!--force)/g;

function assertAcceptedPush(prompt, args, instrument, who) {
  const absolute = `/usr/bin/git ${args}`;
  assert.ok(prompt.includes(`\`${absolute}\``), `${who} (${instrument}) must name the spelling the guard accepts: ${absolute}`);
  const bare = (prompt.match(BARE_PUSH_RE) || []).length;
  const accepted = (prompt.match(/\/usr\/bin\/git push /g) || []).length;
  assert.ok(bare <= accepted, `${who} (${instrument}): every bare \`git push\` must be paired with /usr/bin/git (${bare} bare, ${accepted} absolute)`);
  if (instrument === 'mcp') {
    assert.ok(prompt.indexOf(absolute) < prompt.indexOf(`\`git ${args}\``),
      `${who}: in a cloud container the absolute path must lead, the bare spelling is only the fallback`);
  } else {
    assert.ok(prompt.includes(`\`git ${args}\``), `${who}: the desktop, where /usr/bin/git does not exist, must keep the bare spelling`);
  }
}

test('gitSpelling names both spellings and leads with the one each instrument runs (issue 755)', () => {
  const cloud = gitSpelling('mcp', 'push -u origin b');
  assert.ok(cloud.startsWith('`/usr/bin/git push -u origin b`'), cloud);
  assert.match(cloud, /only where \/usr\/bin\/git does not exist, run `git push -u origin b`/);
  const desktop = gitSpelling('gh', 'push -u origin b');
  assert.ok(desktop.startsWith('`git push -u origin b`'), desktop);
  assert.match(desktop, /runs caveman with a git command among its operands", run `\/usr\/bin\/git push -u origin b` instead/);
});

for (const instrument of ['gh', 'mcp']) {
  test(`${FLEET_SCRIPT_REL} push instructions in the generated prompts use the accepted spelling under ${instrument} (issue 755)`, async () => {
    const branch = 'agent/issue-755-attempt1-wf_testrun-w0';
    const prompts = {};
    const agentMock = async (prompt, opts) => {
      prompts[opts.label.split(':')[0]] = prompt;
      if (opts.label.startsWith('impl:')) return { branch, committed: true, pushed: false, testExitCode: 0, testTail: 'ok', discoveries: [] };
      if (opts.label.startsWith('push:')) return { pushed: true, output: 'ok' };
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran the gate; exit 0', failures: [] };
      if (opts.label.startsWith('deliver:')) return { pushed: true, prUrl: 'https://github.com/x/y/pull/755', mergeStatus: 'clean', conflictPaths: [] };
      throw new Error('unexpected label: ' + opts.label);
    };
    await driveCodeLane(FLEET_SCRIPT, agentMock, { number: 755, title: 't', criteria: '' }, 0, {}, 'inv1', null, { instrument });
    assert.deepEqual(Object.keys(prompts).sort(), ['deliver', 'impl', 'push', 'verify']);
    assertAcceptedPush(prompts.impl, `push -u origin ${branch}`, instrument, 'implementer');
    assertAcceptedPush(prompts.push, `push -u origin ${branch}`, instrument, 'push agent');
    assertAcceptedPush(prompts.deliver, `push -u origin ${branch}`, instrument, 'deliverer B1');
    assertAcceptedPush(prompts.deliver, `push origin ${branch}`, instrument, 'deliverer C4/D3');
    const report = [];
    await driveReport(FLEET_SCRIPT, async (p) => { report.push(p); return { branch: 'b', sha: 's', prUrl: '', appended: 1 }; },
      ['finding'], { deliver: true }, { instrument });
    assertAcceptedPush(report[0], 'push -u origin agent/fleet-discoveries-wf_testrun', instrument, 'report writer');
  });
}

test(`${FLEET_SCRIPT_REL} spells no push instruction as a bare \`git push\` literal (issue 755)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const bare = src.split('\n').filter((l) => /(?<![/\w])git push (?!--force)/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  assert.deepEqual(bare, [], 'a push instruction must go through gitSpelling, which carries the spelling the guard accepts');
});

// ---------------------------------------------------------------------------
// Issue 562: every sub-agent below is FRESH and starts wherever the orchestrating session's shell
// cwd happens to be at the moment it is launched - not wherever it was when this run started. A
// `cfg.orchestratorCwd` default of '.' is only ever correct until the parent session's shell `cd`s
// away, which silently turns the guard off (or, worse, points it at whatever other repo now sits
// there) and sends the tip-check agents a ref they resolve against the wrong tree. The fix is a
// one-time absolute-path measurement at Setup, baked into every later prompt as a literal string.
// ---------------------------------------------------------------------------

// The one Setup-time measurement the fix depends on, plus the guard baseline/check block that
// consumes it. Extracted from the real source (not re-described) so drift is caught here.
function treeGuardSetupBody(src) {
  return [
    extractMarked(src, 'FLEET-TREE-GUARD-DEFS'),
    extractMarked(src, 'FLEET-TREE-GUARD-SETUP'),
    extractMarked(src, 'FLEET-TREE-GUARD-CHECK'),
  ].join('\n');
}

test(`${FLEET_SCRIPT_REL}: no guard/rev-parse/worktree-add prompt runs without the Setup-measured absolute path (issue 562)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const guardBody = treeGuardSetupBody(src);

  // The default is still relative - only the caller's own explicit override skips measurement.
  assert.match(guardBody, /let orchestratorCwd = cfg\.orchestratorCwd/,
    'orchestratorCwd must start from the cfg default so an explicit caller override is honoured');
  assert.match(guardBody, /if \(orchestratorCwd === '\.'\)/,
    'measurement must run precisely when the default (relative) path was not overridden');
  // The measurement is its own one-command Setup agent, in the same "run exactly this and report
  // it" shape the guard and tip agents already use - nothing is left to an agent's judgement.
  assert.match(guardBody, /label: 'orchestrator-cwd'/, 'the cwd measurement must be its own labelled Setup agent');
  assert.match(guardBody, /phase: 'Setup'/, 'the measurement must run in the Setup phase, before any checkpoint needs it');
  assert.match(guardBody, /'pwd'|`pwd`/, 'the measurement command must be pwd - nothing else could tell the truth about the shell cwd');
  assert.match(guardBody, /measured\.cwd\[0\] !== '\/'/, 'an unmeasured or non-absolute result must abort the run rather than fall back to a relative path');

  // Every actual guard command - baseline and check - is built from `orchestratorCwd`, never from
  // `cfg.orchestratorCwd` directly (which would still read '.' after a parent `cd`).
  const cwdFlags = guardBody.match(/--cwd \$\{orchestratorCwd\}/g) || [];
  assert.equal(cwdFlags.length, 2, `expected the baseline and the check command to both pass --cwd \${orchestratorCwd}, found ${cwdFlags.length}`);
  assert.ok(!guardBody.includes('--cwd .'), 'no guard command may hardcode the relative default');
  assert.ok(!guardBody.includes('--cwd ${cfg.orchestratorCwd}'), 'no guard command may read cfg.orchestratorCwd directly - only the measured orchestratorCwd');
  assert.match(guardBody, /\$\{GUARD_CMD\} baseline --cwd \$\{orchestratorCwd\}/, 'tree-guard:baseline must run node tools/orchestrator-tree-guard.js with the absolute path');
  assert.match(guardBody, /\$\{GUARD_CMD\} check --cwd \$\{orchestratorCwd\}/, 'every tree-guard:<label> check must run node tools/orchestrator-tree-guard.js with the absolute path');

  // The tip agent (revParse, `tip:#<ticket>`) reads a ref from the orchestrator's own checkout too,
  // and is exactly as exposed to a mid-run `cd` as the guard - it must carry the same absolute path.
  // Since issue 561 the command it runs is `buildTipLookupCommand(orchestratorCwd, ref)`'s fallback
  // chain, not a literal `git rev-parse` inline - the absolute path still has to be the measured
  // orchestratorCwd, just passed through the call instead of interpolated directly.
  assert.match(src, /buildTipLookupCommand\(orchestratorCwd, ref\)/,
    'the tip-check agent (revParse) must build its command from buildTipLookupCommand(orchestratorCwd, ref), never a bare `git rev-parse` that trusts the ambient shell cwd');
  assert.ok(!src.includes('git rev-parse ${ref}'), 'no bare, unqualified `git rev-parse ${ref}` may remain');

  // Every scratch-worktree prompt built against the orchestrator's own checkout (the probe and code
  // verify lanes, and the Report phase's discoveries worktree) must use the same absolute path.
  const worktreeAddCwd = (src.match(/git -C \$\{orchestratorCwd\} worktree add/g) || []).length;
  assert.ok(worktreeAddCwd >= 3,
    `expected at least 3 \`git -C \${orchestratorCwd} worktree add\` prompts (probe verify, code verify, Report), found ${worktreeAddCwd}`);
  assert.ok(!/(?<!-C \$\{orchestratorCwd\} )git worktree add \$\{scratchFile/.test(src),
    'no scratch-worktree `git worktree add` built from scratchFile() may omit the absolute -C path');
});

// Behavioral half: drive the REAL treeGuardCheck (not a stub, unlike the code-lane tests above,
// which inject a recording checkpoint precisely so the lane body under test does not depend on
// this mechanism's internals). A mocked agent stands in for both the one-time cwd measurement and
// every later guard command, and records the exact command string each checkpoint sent - proving
// that a parent session's `cd` after Setup (simulated by never letting anything downstream
// re-consult cfg.orchestratorCwd or a live cwd) cannot misdirect a later checkpoint, because the
// absolute path was already baked into the command as a literal string at Setup.
async function driveTreeGuard(agentMock, cfgOverrides = {}) {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const body = treeGuardSetupBody(src);
  const logs = [];
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${body}\nreturn treeGuardCheck;\n}`);
  const treeGuardCheck = await wrapper(laneScope({
    agent: agentMock,
    log: (m) => logs.push(m),
    cfg: Object.assign({
      treeGuard: 'auto', treeGuardScript: 'tools/orchestrator-tree-guard.js',
      treeGuardStateDir: '.git/orchestrator-tree-guard', reportModel: 'r', orchestratorCwd: '.',
    }, cfgOverrides),
    unusableReason: (who, detail) => `${who} output unusable: ${detail}`,
  }));
  return { treeGuardCheck, logs };
}

const MEASURED_ORCHESTRATOR_CWD = '/home/runner/work/measured-checkout';

test('treeGuardCheck: a parent cd after Setup cannot misdirect a later checkpoint (issue 562)', async () => {
  const commands = []; // { label, cmd } for every real guard command (baseline + each check)
  let cwdMeasurements = 0;
  const agentMock = async (prompt, opts) => {
    if (opts.label === 'orchestrator-cwd') {
      cwdMeasurements++;
      // However many times a later checkpoint runs, the measurement itself must happen once, at
      // Setup - simulating the parent `cd`ing away right after this call returns.
      return { cwd: MEASURED_ORCHESTRATOR_CWD };
    }
    if (opts.label === 'tree-guard:baseline') {
      commands.push({ label: opts.label, prompt });
      return { exitCode: 0, stdout: JSON.stringify({ statePath: `${MEASURED_ORCHESTRATOR_CWD}/.git/orchestrator-tree-guard/state.json`, baselineCount: 0 }), stderr: '' };
    }
    if (opts.label.startsWith('tree-guard:')) {
      commands.push({ label: opts.label, prompt });
      return { exitCode: 0, stdout: JSON.stringify({ newEntries: [] }), stderr: '' };
    }
    throw new Error(`unexpected agent label in treeGuardCheck test: ${opts.label}`);
  };

  const { treeGuardCheck } = await driveTreeGuard(agentMock);
  // Two checkpoints, standing in for the Implement and Verify checkpoints of one ticket's chain -
  // the parent session is free to have `cd`d anywhere between them; nothing here re-measures.
  await treeGuardCheck('implement-attempt1', 42);
  await treeGuardCheck('verify-attempt1', 42);

  assert.equal(cwdMeasurements, 1, 'the absolute path must be measured exactly once, at Setup - never re-queried per checkpoint');
  assert.equal(commands.length, 3, 'expected the baseline plus two checks');
  for (const { label, prompt } of commands) {
    assert.match(prompt, new RegExp(`--cwd ${MEASURED_ORCHESTRATOR_CWD.replace(/\//g, '\\/')}(?!\\S)`),
      `${label} must carry the Setup-measured absolute path verbatim`);
    assert.ok(!prompt.includes('--cwd .'), `${label} must never fall back to the relative default`);
  }
  assert.match(commands[1].prompt, /--label implement-attempt1 --ticket 42/);
  assert.match(commands[2].prompt, /--label verify-attempt1 --ticket 42/);
});

test('treeGuardCheck: an explicit orchestratorCwd override skips measurement and is used as-is (issue 562)', async () => {
  const commands = [];
  const agentMock = async (prompt, opts) => {
    assert.notEqual(opts.label, 'orchestrator-cwd', 'an already-absolute caller override must not trigger a measurement agent');
    if (opts.label === 'tree-guard:baseline') {
      commands.push(prompt);
      return { exitCode: 0, stdout: JSON.stringify({ statePath: '/caller/given/path/.git/orchestrator-tree-guard/state.json', baselineCount: 0 }), stderr: '' };
    }
    if (opts.label.startsWith('tree-guard:')) {
      commands.push(prompt);
      return { exitCode: 0, stdout: JSON.stringify({ newEntries: [] }), stderr: '' };
    }
    throw new Error(`unexpected agent label: ${opts.label}`);
  };
  const { treeGuardCheck } = await driveTreeGuard(agentMock, { orchestratorCwd: '/caller/given/path' });
  await treeGuardCheck('implement-attempt1', 7);
  assert.equal(commands.length, 2, 'expected the baseline plus one check');
  for (const prompt of commands) assert.match(prompt, /--cwd \/caller\/given\/path(?!\S)/);
});

// ---------------------------------------------------------------------------
// Tip lookup fallback chain (issue 561): a branch present only as `origin/<branch>` - handed in
// through `priorImpl` from an earlier run, or pushed by an implementer in another container - used
// to exit 128 from a bare `git rev-parse <branch>` in the orchestrator's own checkout, skipping the
// whole issue-404 verdict cross-check. `buildTipLookupCommand` builds the one-command `||` fallback
// chain (ref, then origin/ref, then `git ls-remote --heads origin <ref>`); `parseLsRemoteSha` and
// `parseTipLookupOutput` read the chain's output back into a sha and which spelling answered.
// ---------------------------------------------------------------------------

test('buildTipLookupCommand: a single `||` chain, ref then origin/ref then ls-remote, no other command', () => {
  const cmd = buildTipLookupCommand('/abs/cwd', 'agent/issue-9-attempt1');
  const steps = cmd.split(/\s*\|\|\s*/);
  assert.equal(steps.length, 3, `expected exactly 3 fallback steps, found ${steps.length}: ${cmd}`);
  assert.match(steps[0], /^\{ git -C \/abs\/cwd rev-parse --verify agent\/issue-9-attempt1 2>\/dev\/null && echo SPELLING=given; \}$/);
  assert.match(steps[1], /^\{ git -C \/abs\/cwd rev-parse --verify origin\/agent\/issue-9-attempt1 2>\/dev\/null && echo SPELLING=origin; \}$/);
  assert.match(steps[2], /^git -C \/abs\/cwd ls-remote --heads origin agent\/issue-9-attempt1 2>\/dev\/null$/);
  // One logical command: no `;` outside the `{ ... }` groups, no `&&`/`||` loop construct (`for`,
  // `while`) anywhere - the guard this repo runs refuses loops, not `||` (issue 561's own wording).
  assert.ok(!/\bfor\b|\bwhile\b/.test(cmd), 'the fallback chain must not be a loop');
});

test('buildTipLookupCommand: the cwd and ref are both interpolated verbatim, not re-derived', () => {
  const cmd = buildTipLookupCommand('/measured/at/setup', 'main');
  assert.ok(cmd.includes('-C /measured/at/setup'), 'every step must carry the given cwd');
  assert.ok(cmd.split('-C /measured/at/setup').length - 1 === 3, 'all three steps must carry -C, not just the first');
});

test('parseLsRemoteSha: a matching heads line yields its sha', () => {
  const sha = parseLsRemoteSha('abc123def456abc123def456abc123def456789\trefs/heads/agent/issue-9-attempt1\n');
  assert.equal(sha, 'abc123def456abc123def456abc123def456789');
});

test('parseLsRemoteSha: empty output (git ls-remote found nothing but still exited 0) is null, not a parse failure', () => {
  assert.equal(parseLsRemoteSha(''), null);
  assert.equal(parseLsRemoteSha(null), null);
  assert.equal(parseLsRemoteSha(undefined), null);
});

test('parseLsRemoteSha: a line with no refs/heads/ marker (a tag, or garbage) is null', () => {
  assert.equal(parseLsRemoteSha('abc123def456abc123def456abc123def456789\trefs/tags/v1\n'), null);
  assert.equal(parseLsRemoteSha('not a ls-remote line at all'), null);
});

test('parseTipLookupOutput: step 1 (the ref as given) answers - spelling "given"', () => {
  const out = 'abc123def456abc123def456abc123def456789\nSPELLING=given\n';
  assert.deepEqual(parseTipLookupOutput(out), { sha: 'abc123def456abc123def456abc123def456789', spelling: 'given' });
});

test('parseTipLookupOutput: step 1 fails, step 2 (origin/<ref>) answers - spelling "origin" (issue 561 acceptance criterion)', () => {
  const out = 'def456abc123def456abc123def456abc123def4\nSPELLING=origin\n';
  assert.deepEqual(parseTipLookupOutput(out), { sha: 'def456abc123def456abc123def456abc123def4', spelling: 'origin' });
});

test('parseTipLookupOutput: steps 1 and 2 both fail, ls-remote (step 3) answers - spelling "ls-remote", no marker needed', () => {
  const out = 'abc123def456abc123def456abc123def456789\trefs/heads/agent/issue-9-attempt1\n';
  assert.deepEqual(parseTipLookupOutput(out), { sha: 'abc123def456abc123def456abc123def456789', spelling: 'ls-remote' });
});

test('parseTipLookupOutput: all three steps fail (branch absent on both spellings) - null, not a guess (issue 561 acceptance criterion)', () => {
  assert.equal(parseTipLookupOutput(''), null);
  assert.equal(parseTipLookupOutput(null), null);
  assert.equal(parseTipLookupOutput(undefined), null);
});

test('parseTipLookupOutput: a marker line with nothing above it (malformed stdout) is null, never a guessed sha', () => {
  assert.equal(parseTipLookupOutput('SPELLING=given\n'), null);
});

test('parseTipLookupOutput: an unrecognised marker value is ignored, falling through to the ls-remote parse', () => {
  // Defensive: the schema does not allow a third marker value, but the parser must not crash or
  // misattribute a spelling it was never told to expect if one ever appears.
  assert.equal(parseTipLookupOutput('abc123\nSPELLING=bogus\n'), null);
});

// Behavioral half: drive the REAL revParse (not a stub, unlike the code-lane tests above, which
// inject `revParse: async () => null` precisely so the lane body under test does not depend on this
// mechanism's internals). Extracted from the real generated source, evaluated with a mocked `agent`
// that returns exactly the shape the tip agent would report - so the acceptance criterion "a mocked
// agent whose first rev-parse fails and whose origin/ fallback answers" is driven at the same
// abstraction the agent itself operates at: what came back on stdout, not which JS branch ran.
function driveRevParse(agentMock, logs = []) {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const generated = generatedBlock(FLEET_SCRIPT); // buildTipLookupCommand, parseTipLookupOutput live here
  const revParseBody = extractMarked(src, 'FLEET-TIP-REVPARSE');
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${generated}\n${revParseBody}\nreturn revParse;\n}`);
  return wrapper(laneScope({
    agent: agentMock,
    log: (m) => logs.push(m),
    cfg: { deliverModel: 'z' },
    orchestratorCwd: '/abs/orchestrator',
    unusableReason: (who, detail) => `${who} output unusable: ${detail}`,
  }));
}

test('revParse: a branch present only as origin/<branch> still returns its tip and the run is told which spelling answered (issue 561)', async () => {
  const logs = [];
  const calls = [];
  const agentMock = async (prompt, opts) => {
    calls.push({ prompt, opts });
    // Simulates what the real agent would report after running the fallback chain in a checkout
    // where the branch was never fetched locally: the first rev-parse (ref as given) produced no
    // SPELLING=given line, and origin/<ref> is what actually resolved.
    return {
      exitCode: 0,
      stdout: 'def456abc123def456abc123def456abc123def4\nSPELLING=origin\n',
      stderr: '',
      spelling: 'origin',
    };
  };
  const revParse = await driveRevParse(agentMock, logs);
  const sha = await revParse('agent/issue-777-attempt1', 'tip:#777.1');

  assert.equal(sha, 'def456abc123def456abc123def456abc123def4', 'the origin/-only branch tip must still come back');
  assert.equal(calls.length, 1, 'the tip is read by exactly one agent call - one bash command, not a retry loop');
  assert.match(calls[0].prompt, /agent\/issue-777-attempt1/, 'the command must be built from the ref the caller passed');
  assert.match(calls[0].prompt, /ls-remote/, 'the prompt must still describe the full fallback chain, not just the branch as given');
  assert.ok(logs.some((l) => /origin/.test(l) && /def456abc123def456abc123def456abc123def4/.test(l)),
    'the resolved spelling must be logged next to the head (issue 561: "log the resolved spelling next to the head")');
});

test('revParse: a branch absent on both spellings (and on the remote) still reports null, and the lane logs the skip unchanged (issue 561 acceptance criterion)', async () => {
  const logs = [];
  const agentMock = async () => ({ exitCode: 0, stdout: '', stderr: '', spelling: '' });
  const revParse = await driveRevParse(agentMock, logs);
  const sha = await revParse('agent/issue-778-attempt1', 'tip:#778.1');

  assert.equal(sha, null, 'an unresolvable ref must report null, never a guessed sha');
  // revParse itself logs only the resolved case; the "accepted without the worktree cross-check"
  // skip message is the caller's (unchanged - see aac-skills/ticket-fleet/ticket-fleet.js around
  // both `revParse(...)` call sites), so this behavioral test only has to prove revParse stays
  // silent and returns null for the caller's existing skip-logging to fire on.
  assert.equal(logs.length, 0, 'revParse must not itself log anything when nothing resolved');
});

test('revParse: an agent() throw is still caught and reported through unusableReason, unchanged by the fallback chain', async () => {
  const logs = [];
  const agentMock = async () => { throw new Error('StructuredOutput retry cap exceeded'); };
  const revParse = await driveRevParse(agentMock, logs);
  const sha = await revParse('agent/issue-779-attempt1', 'tip:#779.1');

  assert.equal(sha, null);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /output unusable.*StructuredOutput retry cap exceeded/);
  assert.match(logs[0], /worktree HEAD cannot be cross-checked/);
});

test(`${FLEET_SCRIPT_REL}: the REV schema the tip agent reports against carries a spelling field (issue 561)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const revParseBody = extractMarked(src, 'FLEET-TIP-REVPARSE');
  assert.match(revParseBody, /spelling:\s*\{\s*type:\s*'string'/, 'REV must carry a spelling field so the run can report which spelling answered');
  assert.match(revParseBody, /buildTipLookupCommand\(orchestratorCwd, ref\)/, 'the prompt must be built from the fallback-chain command, not a literal rev-parse');
});
