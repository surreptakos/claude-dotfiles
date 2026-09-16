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
  generateRunId, buildBranchName, workerSuffix, pickInstrument, confineToCandidates, resolveVerifierAgent, pickVerifierAgent,
  applyBlockerStates,
  stableJson, stableText, stableList, priorFindingsBlock,
  FLEET_BRANCH_PREFIXES, DISCOVERIES_BRANCH_PREFIX, buildDiscoveriesBranchName, isFleetBranch,
} = require('./ticket-fleet-branch.js');

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
  const fromMergePass = runbook.slice(runbook.indexOf('**Merge pass (before the fleet).**'));
  const mergePassStep = fromMergePass.slice(0, fromMergePass.indexOf('\n4. '));
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
  const promptEnd = body.indexOf('label: `open-pr-scan@');
  const prompt = body.slice(body.indexOf('found = await agent('), promptEnd);
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
  assert.match(src, /-not -path '\*\/hook-state\/\*' -not -path '\*\/\.claude\/projects\/\*'/,
    `${FLEET_SCRIPT_REL} live-tree find must exclude ~/.claude/projects (tool-results, transcripts) as well as hook-state`);
  assert.match(src, /~\/\.claude\/projects holds this session's transcripts, tool-results\/\*\.txt/,
    `${FLEET_SCRIPT_REL} must state the exclusion and why in the prompt so the verifier does not re-derive it`);
  for (const reportable of ['~/.claude/skills', '~/.claude/hooks', '~/.claude/settings.json', '~/.codex']) {
    assert.ok(src.includes(reportable),
      `${FLEET_SCRIPT_REL} verifier prompt must still name ${reportable} as a reportable live-tree write`);
  }
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

function extractMarked(src, name) {
  const startTag = `// [${name}-START]`;
  const endTag = `// [${name}-END]`;
  const s = src.indexOf(startTag);
  const e = src.indexOf(endTag);
  if (s < 0 || e < 0 || e <= s) {
    throw new Error(`${name} markers not found or out of order`);
  }
  // Return everything between the markers (exclusive).
  return src.slice(s + startTag.length, e);
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
  return new Function(`${generatedBlock(scriptPath)}\nreturn { stableJson, stableText, stableList, priorFindingsBlock };`)();
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
    // script's own worktreeMismatch, so the decision under test is the real one.
    revParse: async () => null,
  }, stubs)));
}

// The worktree cross-check the lanes reject a verdict with (issue 404), evaluated out of the
// script so the lane bodies below resolve the real one rather than a stand-in.
function loadWorktreeCheck(scriptPath) {
  const body = extractMarked(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-WORKTREE-CHECK');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn { shaMatches, worktreeMismatch };`)();
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
    worktreeMismatch: loadWorktreeCheck(scriptPath).worktreeMismatch,
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
async function driveReport(scriptPath, agentMock, discoveries, cfgOverrides) {
  const body = extractMarked(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-REPORT');
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${body}\nreturn runReport;\n}`);
  const runReport = await wrapper(laneScope({
    agent: agentMock,
    cfg: Object.assign({ deliver: true, reportModel: 'r', followupsFile: 'FOLLOW-UPS.md' }, cfgOverrides || {}),
    runId: 'testrun',
    scout: { defaultBranch: 'main' },
    rules: new Proxy({}, { get: () => () => 'gh pr create' }),
    instrument: 'gh',
    DISCOVERY_REPORT: {},
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
      const start = src.indexOf(anchor);
      assert.ok(start > 0, `${who} prompt not found by its opening line`);
      const prompt = src.slice(start, src.indexOf("phase: '", start));
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
    assert.match(src, /git merge --abort/,
      'a conflict outside the two classes must abort the merge rather than guess');
    const deliverIdx = src.indexOf('STEP A - merge the default branch BEFORE pushing');
    const pushIdx = src.indexOf('git push -u origin ${branch}');
    assert.ok(deliverIdx > 0 && pushIdx > deliverIdx,
      'the merge instructions must precede the push in the deliver prompt');
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
    assert.match(prompt, /git push -u origin \$\{branch\}/,
      'the deliverer must be told to push the branch, by the exact command');
    assert.match(prompt, /never conclude that the branch, or the issue, does not exist/,
      "the deliverer must never report the branch missing: #356's deliverer did exactly that without ever pushing");
    assert.match(prompt, /blockedReason:"push failed: <the git output of all three commands, VERBATIM>"/,
      'a failed push must come back with the git output verbatim, not a paraphrase');
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
  const body = extractMarked(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-OPEN-PR');
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
  const selectWave = selectWaveFrom(FLEET_SCRIPT);
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
  const startTag = '// [FLEET-SCOUT-GATE-START]';
  const endTag = '// [FLEET-SCOUT-GATE-END]';
  const s = src.indexOf(startTag);
  const e = src.indexOf(endTag);
  if (s < 0 || e < 0 || e <= s) {
    throw new Error('FLEET-SCOUT-GATE markers not found or out of order');
  }
  return src.slice(s + startTag.length, e);
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
  const wrapper = new AsyncFunction('agent', 'cfg', 'rules', 'HANDOFF', 'COMMENTED', 'stableList', 'stableText',
    'scratchFile', body + '\nreturn runHumanLane;');
  const cfg = { deliver: true, verifyModel: 'v', deliverModel: 'd' };
  const helpers = loadStableHelpers(scriptPath);
  // The lane names its own comment-body path (issue 439); the run's scratch root is module scope.
  const runHumanLane = await wrapper(agentMock, cfg, loadTrackerRules(scriptPath, mode), {}, {},
    helpers.stableList, helpers.stableText, (name) => `/tmp/fleet-testrun/${name}`);
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
  const selectWave = selectWaveFrom(FLEET_SCRIPT);
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
  const selectWave = selectWaveFrom(FLEET_SCRIPT);
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
