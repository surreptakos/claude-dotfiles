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
  stableJson, stableText, stableList, priorFindingsBlock,
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

// ---- unknown environment + verifier agent type (issue 316) ----
// The workflow runtime does not expose `process`, so the script passes `null` rather than a
// fabricated `{}`: an absent env is an unknown environment, not an empty one. It still falls
// back to `gh` (REST works in both shapes) - the container caller is the one who says which.

test('pickInstrument treats a missing process binding as an unknown environment', () => {
  const noProcessEnv = null; // what the script passes when `typeof process === 'undefined'`
  assert.equal(pickInstrument(noProcessEnv, undefined, undefined), 'gh',
    'unknown environment must fall back to gh, whose REST paths work locally and in a container');
  assert.equal(pickInstrument(noProcessEnv, undefined, 'auto'), 'gh');
  assert.equal(pickInstrument(noProcessEnv, undefined, 'mcp'), 'mcp',
    'an explicit instrument must still win when the environment is unknown');
});

test('resolveVerifierAgent defaults to fleet-verifier under gh and unpinned under mcp', () => {
  assert.equal(resolveVerifierAgent('gh', undefined), 'fleet-verifier');
  assert.equal(resolveVerifierAgent('gh', null), 'fleet-verifier');
  assert.equal(resolveVerifierAgent('mcp', undefined), undefined);
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
// the caller-minted per-launch token, and it must appear in the pr-check prompt and label - and
// nowhere else, so no other stage loses its cache and no branch name moves.
test(`fleet script ${FLEET_SCRIPT_REL} keys the open-PR guard on a per-invocation token (issue 291)`, () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  assert.match(src, /const invocationId = String\(cfg\.invocationId/,
    'invocationId must come from args - a value derived from runId is stable across a resume');
  assert.match(src, /if \(!invocationId\) throw (?:new Error|contractError)\(/,
    'the fleet must refuse to run without a per-invocation token rather than guard on a stale cache');
  assert.match(src, /if \(invocationId === runId\) throw (?:new Error|contractError)\(/,
    'invocationId must be rejected when it merely repeats runId');
  const body = extractCodeLane(src);
  assert.match(body, /label: `pr-check:#\$\{t\.number\}@\$\{invocationId\}`/,
    'the pr-check agent label must carry invocationId');
  const promptEnd = body.indexOf('label: `pr-check:');
  const prompt = body.slice(body.indexOf('openPR = await agent('), promptEnd);
  assert.match(prompt, /\$\{invocationId\}/, 'the pr-check prompt must carry invocationId');
  assert.equal((src.match(/\$\{invocationId\}/g) || []).length, 2,
    'invocationId belongs in the pr-check prompt and label only: anywhere else it would move a branch name or bust another stage cache');
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

// The resume-stable helpers the lanes funnel every prior agent result through (issue 271).
// Evaluated out of the script so the lane body below resolves them, and compared against
// tools/ticket-fleet-branch.js so the inlined copy cannot drift from the pure one.
function loadStableHelpers(scriptPath) {
  const body = extractMarked(fs.readFileSync(scriptPath, 'utf8'), 'FLEET-RESUME-STABLE');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn { stableJson, stableText, stableList, priorFindingsBlock };`)();
}

// Evaluate a lane body and return its runCodeLane. `agent` is the spy the test drives; the rest are
// the bindings the assertions depend on (the lane also reads the instrument switch, the tracker
// rule helpers, the resume-stable helpers, the verifier agent type, the dedupe brief and the test
// command, stubbed so the body evaluates the same way under either instrument). `stubs` overrides
// any of them for one test.
async function instantiateCodeLane(body, agentMock, logs = [], stubs = {}) {
  const wrapper = new AsyncFunction('scope', `with (scope) {\n${body}\nreturn runCodeLane;\n}`);
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
  }, stubs)));
}

async function driveCodeLane(scriptPath, agentMock, ticket, workerIndex = 0, cfgOverrides = {}, invocationId = 'inv1', guardSpy = null) {
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
  const runCodeLane = await instantiateCodeLane(body, agentMock, logs, {
    cfg: Object.assign({ maxAttempts: 3, deliver: true, implModel: 'x', verifyModel: 'y', deliverModel: 'z' }, cfgOverrides),
    invocationId,
    stableJson: helpers.stableJson, stableText: helpers.stableText,
    stableList: helpers.stableList, priorFindingsBlock: helpers.priorFindingsBlock,
    treeGuardCheck,
  });
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
  return { result: await runReport(discoveries) };
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
    assert.deepEqual(calls, ['pr-check:#97@inv1'], 'only the pr-check agent may be started when an open PR exists');
    assert.equal(result.done, true);
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/137');
    assert.equal(result.branch, 'agent/issue-97-attempt1-wf_r1-w0');
    assert.equal(result.commentUrl, null);
    assert.deepEqual(result.discoveries, []);
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
      if (opts.label.startsWith('pr-check:')) return { found: false };
      if (opts.label.startsWith('impl:')) {
        return { branch: 'agent/issue-241-attempt1-wf_testrun-w0', committed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
      }
      // No `failures` key at all - exactly what tripped the StructuredOutput retry cap on #241.
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran node --test; exit 0' };
      if (opts.label.startsWith('deliver:')) return { pushed: true, prUrl: 'https://github.com/x/y/pull/241' };
      throw new Error('unexpected label: ' + opts.label);
    };
    const { result } = await driveCodeLane(file, agentMock, { number: 241, title: 't', criteria: '' }, 0);
    assert.deepEqual(calls, ['pr-check:#241@inv1', 'impl:#241.1', 'verify:#241.1', 'deliver:#241'],
      'a key-less pass must be accepted on the first attempt, not retried');
    assert.equal(result.done, true);
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/241');
    assert.deepEqual(result.verdict.failures, [],
      'a verdict with no failures key must be normalised to an empty array for the run report');
  });

  test(`${rel} pr-check cache key differs between two invocations of one runId (issue 291)`, async () => {
    // A resume keeps runId (branch names embed it) and re-mints invocationId. Capture the agent
    // cache key the runtime would see - label plus prompt - on two such invocations and assert it
    // moved, which is what makes the guard re-ask the tracker instead of replaying {found:false}.
    const keys = [];
    const agentMock = async (prompt, opts) => {
      if (!opts.label.startsWith('pr-check:')) {
        throw new Error(`unexpected agent call after PR-found short-circuit: ${opts.label}`);
      }
      keys.push(`${opts.label}\n${prompt}`);
      return { found: true, prUrl: 'https://github.com/x/y/pull/137', branch: 'agent/issue-97-attempt1-wf_testrun-w0' };
    };
    const ticket = { number: 97, title: 'x', criteria: '' };
    const first = await driveCodeLane(file, agentMock, ticket, 0, {}, 'invA');
    const second = await driveCodeLane(file, agentMock, ticket, 0, {}, 'invB');
    assert.equal(keys.length, 2, 'both invocations must reach the pr-check');
    assert.notEqual(keys[0], keys[1],
      'two invocations of the same runId must ask the pr-check under different cache keys');
    // Same invocation token, same key - the difference tracks invocationId, nothing incidental.
    await driveCodeLane(file, agentMock, ticket, 0, {}, 'invA');
    assert.equal(keys[2], keys[0], 'the key must be a function of invocationId, not of call order');
    for (const r of [first, second]) {
      assert.equal(r.result.done, true);
      assert.equal(r.result.prUrl, 'https://github.com/x/y/pull/137');
    }
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
    const { result, checkpoints } = await driveCodeLane(file, agentMock, { number: 9, title: 't', criteria: '' }, 0);
    assert.deepEqual(calls, ['pr-check:#9@inv1', 'impl:#9.1', 'verify:#9.1', 'deliver:#9'],
      'when no open PR exists the pre-check must be followed by impl/verify/deliver in order');
    assert.equal(result.done, true);
    assert.equal(result.prUrl, 'https://github.com/x/y/pull/500');
    assert.deepEqual(result.discoveries, ['finding-A']);
    // Ported from the aac-routines fork (issues 192, 270): one orchestrator-tree checkpoint after
    // the implementer, one after the (unisolated) verifier, one after Deliver pushes.
    assert.deepEqual(checkpoints, ['implement-attempt1#9', 'verify-attempt1#9', 'deliver#9'],
      'the code lane must checkpoint the orchestrator tree after Implement, Verify and Deliver');
  });

  // ---- Deliver never ticks acceptance boxes (aac-routines issue 264) ----

  test(`${rel} Deliver prompt forbids ticking acceptance boxes`, () => {
    const body = extractCodeLane(fs.readFileSync(file, 'utf8'));
    const deliverIdx = body.indexOf('`Deliver verified branch');
    assert.ok(deliverIdx > 0, 'code lane must build a Deliver prompt');
    const prompt = body.slice(deliverIdx, body.indexOf('label: `deliver:#', deliverIdx));
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
    assert.match(src, /git merge --no-edit origin\/\$\{scout\.defaultBranch\}/,
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
      if (opts.label.startsWith('pr-check:')) return { found: false };
      if (opts.label.startsWith('impl:')) {
        return { branch: 'agent/issue-11-attempt1-wf_testrun-w0', committed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
      }
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran tests', failures: [] };
      if (opts.label.startsWith('deliver:')) {
        return { pushed: false, prUrl: '', mergeStatus: 'blocked', conflictPaths: ['aac-skills/ticket-fleet/SKILL.md', 'README.md'], blockedReason: 'prose hunk outside the stamp block' };
      }
      throw new Error('unexpected label: ' + opts.label);
    };
    const { result, logs } = await driveCodeLane(file, agentMock, { number: 11, title: 't', criteria: '' }, 0);
    assert.deepEqual(calls, ['pr-check:#11@inv1', 'impl:#11.1', 'verify:#11.1', 'deliver:#11']);
    assert.equal(result.prUrl, null, 'a blocked pre-push merge must open no PR');
    assert.equal(result.done, false, 'a blocked pre-push merge is a delivery failure');
    assert.deepEqual(result.conflictPaths, ['aac-skills/ticket-fleet/SKILL.md', 'README.md'],
      'the conflicting paths must reach the run result');
    assert.match(result.verdict.failures.join('\n'), /aac-skills\/ticket-fleet\/SKILL\.md/);
    assert.ok(logs.some((m) => /no PR opened/.test(m)), 'the block must be logged');
  });

  test(`${rel} runCodeLane still delivers when the pre-push merge resolves`, async () => {
    const agentMock = async (_prompt, opts) => {
      if (opts.label.startsWith('pr-check:')) return { found: false };
      if (opts.label.startsWith('impl:')) {
        return { branch: 'agent/issue-12-attempt1-wf_testrun-w0', committed: true, testExitCode: 0, testTail: 'ok', discoveries: [] };
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
      if (opts.label.startsWith('pr-check:')) return { found: false };
      if (opts.label.startsWith('impl:')) throw new Error(`implementer spawned despite a priorImpl entry: ${opts.label}`);
      if (opts.label.startsWith('verify:')) return { pass: true, evidence: 'ran the gate on the prior branch', failures: [] };
      if (opts.label.startsWith('deliver:')) return { pushed: true, prUrl: 'https://github.com/x/y/pull/501' };
      throw new Error('unexpected label: ' + opts.label);
    };
    const prior = {
      branch: 'agent/issue-274-attempt1-wf_dd0cf9a4091-w0',
      committed: true, testExitCode: 0, testTail: 'ok', discoveries: ['finding-B'],
    };
    const { result, logs } = await driveCodeLane(
      file, agentMock, { number: 274, title: 't', criteria: '' }, 0, { priorImpl: { 274: prior } }
    );
    assert.deepEqual(calls, ['pr-check:#274@inv1', 'verify:#274.1', 'deliver:#274'],
      'a ticket with a priorImpl entry must go straight from the PR check to the verifier');
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
}

// ---- Empty-label listing ends the run (issue 298) ----
// A scout whose label listing matched nothing used to route around the dead end and hand back
// every open ticket it could find, so the fleet spawned pr-check and implementer agents for work
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
  const body = extractScoutGate(fs.readFileSync(FLEET_SCRIPT, 'utf8'));
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
  for (const label of ['label: `pr-check:#', 'label: `impl:#', 'label: `probe:#', 'label: `handoff:#']) {
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
    body + '\nreturn runHumanLane;');
  const cfg = { deliver: true, verifyModel: 'v', deliverModel: 'd' };
  const helpers = loadStableHelpers(scriptPath);
  const runHumanLane = await wrapper(agentMock, cfg, loadTrackerRules(scriptPath, mode), {}, {},
    helpers.stableList, helpers.stableText);
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
    if (opts.label === 'pr-check:#42@inv1') return shape({ found: false });
    if (opts.label === 'impl:#42.1') {
      return shape({
        branch: implBranch || 'agent/issue-42-attempt1-wf_testrun-w0',
        committed: true, testExitCode: 1, testTail: 'not ok', discoveries: ['finding-A'],
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
        committed: true, testExitCode: 0, testTail: 'ok', discoveries: [],
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
    assert.deepEqual(first.map((c) => c.label), ['pr-check:#42@inv1', 'impl:#42.1', 'verify:#42.1', 'impl:#42.2', 'verify:#42.2'],
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
