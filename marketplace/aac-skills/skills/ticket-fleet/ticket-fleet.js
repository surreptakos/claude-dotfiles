// One ticket-fleet script served by the aac-skills plugin, replacing the three prior copies
// (.claude/workflows/ticket-fleet.js, orchestrator/ticket-fleet-cloud.js and the harness
// template at agents/skills/project-harness/templates/ticket-fleet.js). Same scout / three
// lanes (code / probe / human) each run by subagents / blind refuting verifier / deliver
// only on verified pass / single report writer shape as before.
//
// The tracker instrument is picked at run time: a local session with `gh` uses REST
// (`gh api repos/{owner}/{repo}/...`); a cloud container (CLAUDE_CODE_REMOTE_SESSION_ID
// set, or `gh` absent) uses the GitHub MCP tools. The scout is told which set of tools
// to use in one place, so a wrong pick fails loudly instead of silently swapping one
// prompt shape for another. The pure branch of the switch lives in
// tools/ticket-fleet-branch.js (pickInstrument, pickVerifierAgent, trackerRules), which the
// workflow runtime cannot require - the same shape is inlined below and both are covered by
// tools/ticket-fleet-branch.test.js so the two cannot drift silently.
//
// Which session shape this is gets MEASURED, not guessed: the first agent of every run is a
// cheap env-probe that reads the remote env vars, `gh` on PATH and whether
// ~/.claude/agents/fleet-verifier.md exists. The workflow runtime does not reliably expose
// `process.env` (issue 322), and a caller who has to remember `instrument: 'mcp'` in a
// container is a workaround, not a switch (issue 339). Nothing here needs an argument now.
export const meta = {
  name: 'ticket-fleet',
  description: 'Parallel ticket runner: scout, pinned implementer per ticket, blind refuting verifier, PR on pass, discovery collection',
  whenToUse: 'Drive open ready-for-agent tickets to verified PRs in parallel; also runs probe tickets (evidence in a comment) and ready-for-human tickets (verify what a container can, hand the rest to the owner). args: {runId (required, caller-minted unique token, kept the SAME across a resume), invocationId (required, a DIFFERENT fresh token per launch including every resume - it keeps the open-PR resume guard out of the agent cache), tickets (array of issue numbers; when given the scout takes exactly those, any label or state), label, maxTickets, scoutModel, implModel, verifyModel, deliverModel, reportModel, maxAttempts, deliver, followupsFile, instrument (auto|gh|mcp, default auto: measured by the env-probe agent - mcp when CLAUDE_CODE_REMOTE_SESSION_ID is set or `gh` is absent, gh otherwise; pass a value only to override the measurement), verifierAgent (agent type for the blind verifier; default: `fleet-verifier` on a desktop session whose ~/.claude/agents/fleet-verifier.md exists, unpinned in a cloud session because custom agent types are desktop-only (issue 339); empty string forces unpinned), testCommand (overrides the scout's test command), priorImpl/priorProbe ({ticketNumber: prior IMPL/PROBE result} reused for attempt 1 instead of spawning an implementer or prober), treeGuard (auto|true|false), treeGuardScript, orchestratorCwd, treeGuardStateDir}',
  phases: [
    { title: 'Setup', detail: 'baseline the orchestrator tree (aac-routines issue 192)' },
    { title: 'Scout', detail: 'list tickets, classify kind, dependency edges, repo map' },
    { title: 'Implement', detail: 'per ticket: implementer in a worktree, prober, or handoff reader' },
    { title: 'Isolation guard', detail: 'orchestrator-tree checkpoints after Implement, after Verify, after Deliver, and before Report (aac-routines issues 192, 270)' },
    { title: 'Verify', detail: 'blind reviewer per attempt, prompted to refute' },
    { title: 'Deliver', detail: 'pre-push merge of the default branch, then PR on a verified code branch; one resolution/status comment otherwise' },
    { title: 'Report', detail: 'single writer appends discoveries' },
  ],
}

// ---- config (all overridable via args) ----
const cfg = Object.assign({
  runId: null,              // REQUIRED from the caller; see concurrent-run safety below
  tickets: null,            // explicit issue numbers; overrides label listing (any label, any state)
  label: 'ready-for-agent',
  maxTickets: 3,            // wave cap; keeps run near the 15-agent guideline
  // Per-stage model pins. Frontier only where errors compound (implement); the orchestrator is the
  // main session's own model. Mid-tier for bounded, checkable work; cheap tier for pure mechanics.
  scoutModel: 'claude-sonnet-5',            // structured extraction from gh issues
  implModel: 'claude-opus-5',               // heaviest-context stage, version-stable across runs
  verifyModel: 'claude-sonnet-5',           // skepticism comes from blindness + prompt, not tier
  deliverModel: 'claude-haiku-4-5-20251001',// push + PR mechanics, no judgment
  reportModel: 'claude-haiku-4-5-20251001', // formats pre-aggregated discoveries
  maxAttempts: 3,           // Ralph-style bounded retry, fresh context each attempt
  deliver: true,            // false = stop after verify, no push/PR
  followupsFile: 'FOLLOW-UPS.md',
  invocationId: null,       // REQUIRED from the caller, re-minted on EVERY launch; see the resume guard below
  instrument: 'auto',       // 'auto' | 'gh' | 'mcp'; 'auto' resolves from the env probe below
  testCommand: null,        // replaces scout.testCommand when set; see the override note below
  priorImpl: null,          // {ticketNumber: IMPL-shaped result} - attempt 1 reuses it, no implementer
  priorProbe: null,         // {ticketNumber: PROBE-shaped result} - attempt 1 reuses it, no prober
  // ---- pre-push merge (issue 318) ----
  // The deliver stage merges origin/<defaultBranch> into the verified branch before pushing, so
  // the PR opens mergeable instead of landing the same generated-file conflict on the session
  // once per PR. Only two conflict classes are resolvable without judgment: a path the packager
  // generates, and a SKILL.md conflict confined to the four-key metadata stamp block. Anything
  // else stops delivery for that ticket.
  generatedPaths: ['.claude-plugin/marketplace.json', 'marketplace/**'],
  // Shell commands that re-stamp and rebuild the generated files after such a merge. null means
  // "read them out of CLAUDE.md" - this repo names both in its 'Skill stamps' section, and a
  // fork with different tooling passes its own list instead.
  regenCommands: null,
  verifierAgent: null,      // null = default (`fleet-verifier` on a desktop that has the agent file, unpinned in a cloud session); '' = unpinned
  // ---- orchestrator-tree isolation guard (aac-routines issue 192) ----
  // 'auto' (default) turns the guard on wherever the served repo ships the guard tool and off
  // where it does not; true makes a missing tool a hard abort; false disables the guard.
  treeGuard: 'auto',
  treeGuardScript: 'tools/orchestrator-tree-guard.js', // the served repo's copy of the guard tool
  orchestratorCwd: '.',     // the orchestrator's OWN checkout, as the guard agents see it
  treeGuardStateDir: '.git/orchestrator-tree-guard', // inside .git, so the baseline never shows in `git status`
}, args || {})

// ---- reusing a dead run's work (issue 317) ----
// A run can lose every verifier after its implementers have already committed their branches.
// Replaying it through the runtime's own resume does not help: the cache key of an
// `isolation: 'worktree'` agent includes the worktree slot the runtime assigned, and a resumed
// run assigns new slots, so the replay starts a fresh implementer inside another ticket's slot.
// Instead the caller lifts the finished results out of the dead run's journal and passes them as
// `priorImpl` / `priorProbe`, keyed by ticket number. Attempt 1 then takes the recorded result
// and spawns no implementer or prober; attempt 2+ is untouched, so a reused branch that fails
// verification is re-implemented exactly as a fresh one would be.

// ---- concurrent-run safety ----
// Two ticket-fleet invocations can pick up the same open ticket at the same time (nothing on
// the tracker side prevents it). Without a per-run identifier both runners would spawn
// implementers that try to create `agent/issue-<N>-attempt1`, and the second git-branch or
// push collides. This runner takes a caller-minted `runId` per invocation and hands each
// spawned implementer a per-worker suffix `wf_<runId>-w<workerN>` (workerN = the ticket's
// index in the wave), embedded in the branch name. See tools/ticket-fleet-branch.js for the
// pure-function counterpart the tests exercise.
// The workflow runtime throws on Date.now(), new Date() and Math.random() inside scripts (they
// would break resume), so the id cannot be minted here: the caller passes it as args.runId
// (any short unique token, e.g. the shell's `date +%s` in hex).
if (!cfg.runId) throw new Error('args.runId is required: workflow scripts cannot call Date.now()/Math.random(); pass a unique token such as `printf %x $(date +%s)`')
const runId = String(cfg.runId).replace(/[^A-Za-z0-9]/g, '').slice(0, 16)

// ---- per-invocation freshness for the resume guard (issue 291) ----
// `runId` is deliberately STABLE across a resume: the branch names embed it. The open-PR guard in
// runCodeLane below needs the opposite - the tracker as it is right now. It has to ask an agent
// (a workflow script has no filesystem, shell or network of its own), and the runtime replays
// cached agent results on resume, so under a stable cache key the guard replays the {found:false}
// it recorded before any PR existed and the ticket is implemented, verified and delivered a
// second time - the duplicate PR the guard exists to prevent. The freshness therefore arrives
// through args, exactly like runId: the caller mints a NEW invocationId on EVERY launch, resume
// included. It is spliced into the pr-check prompt and label and nowhere else, so two invocations
// of the same runId ask that one question under different cache keys while every other stage
// keeps its cache and the branch names stay put.
const invocationId = String(cfg.invocationId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16)
if (!invocationId) throw new Error('args.invocationId is required: mint a FRESH token on every launch INCLUDING every resume (e.g. `printf %x%x $(date +%s) $$`). It busts the open-PR guard\'s agent cache so a resume re-asks the tracker instead of replaying a stale "no PR" answer (issue 291); keep args.runId unchanged across a resume, the branch names embed it.')
if (invocationId === runId) throw new Error('args.invocationId must differ from args.runId: runId stays fixed across a resume (branch names embed it) while invocationId changes on every launch, which is what makes the open-PR guard re-ask the tracker (issue 291).')

// ---- instrument switch (gh vs GitHub MCP) ----
// The tracker prompts below differ in exactly one dimension: which tool set the scout, probe,
// handoff and deliver stages call. Pure form lives in tools/ticket-fleet-branch.js so the
// unit tests can pin it; the same shape is inlined here because the workflow runtime cannot
// reach node_modules. A wrong pick presents itself as a stage failure, not silent drift.
function pickInstrument(env, hasGh, override) {
  if (override === 'gh' || override === 'mcp') return override
  // Unknown environment (issue 316): a null/undefined env means there was no `process` binding
  // to read, so the sniff below cannot fire and a container is indistinguishable from a desktop
  // session. Fall back to gh - its REST paths work in both - and let the caller say which.
  if (env === undefined || env === null) return hasGh === false ? 'mcp' : 'gh'
  if (env.CLAUDE_CODE_REMOTE_SESSION_ID || env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE) return 'mcp'
  if (hasGh === false) return 'mcp'
  return 'gh'
}
// Whether the fleet may pin its `fleet-verifier` subagent type. Custom agent types are a
// desktop-only facility (issue 339): Claude Code reads the agent registry BEFORE SessionStart
// hooks run, so the cloud bootstrap hook cannot register ~/.claude/agents/fleet-verifier.md
// for the session that would use it, and pinning it there fails the launch with "Agent type
// 'fleet-verifier' not found" (how issue 316 surfaced). Keyed on remoteness, never on the
// tracker instrument - conflating the two is what made a container that picked `gh` try to
// launch a type it could never have.
function pickVerifierAgent(remote, agentFilePresent) {
  if (remote) return null
  return agentFilePresent ? 'fleet-verifier' : null
}
// The workflow runtime does not expose `process.env` (issue 322: a container run read an empty
// env and fell through to `gh`), so the environment is not guessed here at all - it is measured
// by the env-probe subagent below, which has a real shell. That removes the container-specific
// workaround the caller used to have to remember (`instrument: 'mcp'` by hand): `auto` now
// resolves correctly from either session shape with no argument.

// Which agent type the blind verifier launches under. Agent types are registered once at
// session start from ~/.claude/agents/; the desktop registry holds fleet-verifier.md (tools
// capped at Read, Grep, Glob, Bash - issue 86) and a cloud container's does not, where pinning
// it fails every verifier launch with `agent type 'fleet-verifier' not found` (issue 316).
// Pure counterpart: resolveVerifierAgent in tools/ticket-fleet-branch.js.
function resolveVerifierAgent(mode, override, facts) {
  if (override === undefined || override === null) {
    // No override: the env probe decides (issue 339) - never a custom type in a cloud session,
    // and on the desktop only when the agent file is on disk. Without probe facts (a unit test,
    // a caller that skipped the probe) the old instrument-keyed default stands.
    if (facts) return pickVerifierAgent(!!facts.remote, !!facts.verifierAgentFile) || undefined
    return mode === 'gh' ? 'fleet-verifier' : undefined
  }
  const name = String(override).trim()
  return name || undefined
}
// `verifierAgentType` is resolved right after the env probe in the Scout phase below.

// The tracker rule lines the scout and every delivery prompt embed. Same wording on both
// instruments except for the tool spellings and the "how to detect the tracker root" note.
// `labelSwap` is the human lane's hand-back: once the handoff comment is posted the ticket
// belongs to whoever takes the remaining steps, so the run takes `ready-for-agent` off it and
// puts `ready-for-local-agent` (a desktop session) or `ready-for-human` (a person) on. Without that the next label listing hands the same ticket back to the fleet and the
// handoff comment is written again (issue 266).
// [FLEET-TRACKER-RULES-START]
function trackerRules(mode) {
  if (mode === 'mcp') return {
    scoutList: (label) => `mcp__github__list_issues with label "${label}", state open (then mcp__github__issue_read with method get_comments per ticket - comments carry criteria the body lacks).`,
    scoutExplicit: (nums) => `Take EXACTLY these issues, whatever their labels or state: ${nums.join(', ')}. Per number: mcp__github__issue_read with method get, then method get_comments.`,
    scoutNotes: `There is no \`gh\` CLI here - GitHub goes through the MCP tools.`,
    handoffRead: (n) => `Read the ticket and its comments with mcp__github__issue_read (method get, then method get_comments).`,
    commentPost: () => `Use mcp__github__add_issue_comment.`,
    labelSwap: (n, target = 'ready-for-human') => `Read the ticket's current labels with mcp__github__issue_read (method "get_labels", issue_number ${n}), then call mcp__github__issue_write (method "update", issue_number ${n}) with labels = that list with "ready-for-agent" removed and "${target}" added. labels replaces the whole set, so send every label the ticket keeps. If "ready-for-agent" was not there, still make sure "${target}" ends up on the ticket.`,
    prCreate: () => `mcp__github__create_pull_request`,
    prComment: () => `mcp__github__add_issue_comment on issue`,
  }
  return {
    scoutList: (label) => `\`gh api "repos/{owner}/{repo}/issues?labels=${label}&state=open&per_page=100"\`, then per ticket N \`gh api repos/{owner}/{repo}/issues/N\` and \`gh api repos/{owner}/{repo}/issues/N/comments\` - comments carry criteria the body lacks.`,
    scoutExplicit: (nums) => `Take EXACTLY these issues, whatever their labels or state: ${nums.join(', ')}. Per number N: \`gh api repos/{owner}/{repo}/issues/N\` and \`gh api repos/{owner}/{repo}/issues/N/comments\`.`,
    scoutNotes: `{owner}/{repo} come from \`git remote get-url origin\` - \`gh repo view\` is GraphQL too. NEVER run \`gh issue list\` or \`gh issue view\`: they are GraphQL-backed and return HTTP 403 "GitHub GraphQL is not available from Claude Code sessions" (issue 130). Only \`gh api repos/{owner}/{repo}/...\` REST paths work.`,
    handoffRead: (n) => `Read the ticket and its comments with \`gh api repos/{owner}/{repo}/issues/${n}\` and \`gh api repos/{owner}/{repo}/issues/${n}/comments\` ({owner}/{repo} from \`git remote get-url origin\`); never \`gh issue view\`/\`gh issue list\` (GraphQL, HTTP 403 here - issue 130).`,
    commentPost: () => `Use \`gh api --method POST repos/{owner}/{repo}/issues/<N>/comments -F body=@<file>\` with {owner}/{repo} from \`git remote get-url origin\`; never \`gh issue comment\`/\`gh issue view\` (GraphQL, HTTP 403 here - issue 130).`,
    labelSwap: (n, target = 'ready-for-human') => `Remove \`ready-for-agent\` and add \`${target}\` with REST ({owner}/{repo} from \`git remote get-url origin\`): \`gh api --method DELETE repos/{owner}/{repo}/issues/${n}/labels/ready-for-agent\` (HTTP 404 just means the label was not on the ticket - carry on), then \`gh api --method POST repos/{owner}/{repo}/issues/${n}/labels -f "labels[]=${target}"\`. Never \`gh issue edit\` (GraphQL, HTTP 403 here - issue 130).`,
    prCreate: () => `gh pr create`,
    prComment: () => `gh api --method POST repos/{owner}/{repo}/issues/<N>/comments -F body=@<file>`,
  }
}
// [FLEET-TRACKER-RULES-END]
// `rules`, `instrument` and `verifierAgentType` are resolved from the env probe in the Scout phase
// below - the first thing the run does - so every prompt built after that point sees them.

// Explicit selection wins over the label: a named ticket is fetched whatever its labels or state.
const explicitTickets = (Array.isArray(cfg.tickets) ? cfg.tickets : []).map(n => parseInt(n, 10)).filter(n => n > 0)

// ---- resume-stable prompt inputs (issue 271) ----
// A resume replays every agent() call whose cache key is unchanged, and that key covers the
// prompt text. So a prompt built out of a previous agent's structured result must render the
// same bytes whether that result came back live from the tool call or was re-read from the
// journal on resume. The two sides differ in exactly the ways a JSON round trip differs: key
// order, absent vs null vs undefined members, numbers and booleans a live run held as JS
// values, and CR bytes inside quoted output. A `deliver: false` run resumed with
// `deliver: true` missed on `impl:#N.2` and `verify:#N.2` for that reason and re-implemented
// tickets whose verified branches already existed. Every prior result now reaches a prompt
// through one of these doors, and the verifier and deliver prompts name the branch this script
// computed rather than the one the implementer reported - so the branch delivered is the branch
// that was verified. Pure counterparts live in tools/ticket-fleet-branch.js; the block between
// the FLEET-RESUME-STABLE markers is extracted verbatim by tools/ticket-fleet-branch.test.js
// and compared against them, so the two copies cannot drift.
// [FLEET-RESUME-STABLE-START]
const stableJson = (value) => {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}'
  }
  if (value === undefined) return 'null'
  return JSON.stringify(value)
}
const stableText = (value) => {
  if (value === null || value === undefined) return ''
  const raw = typeof value === 'string' ? value
    : (typeof value === 'number' || typeof value === 'boolean') ? String(value)
    : stableJson(value)
  return raw.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim()
}
const stableList = (value) => {
  const items = Array.isArray(value) ? value : (value === null || value === undefined) ? [] : [value]
  return items.map(stableText).filter(s => s.length > 0)
}
const priorFindingsBlock = (verdict, howToFix) => verdict
  ? `\nPrevious attempt FAILED verification. Independent reviewer findings (${howToFix}):\n- ${stableList(verdict.failures).join('\n- ')}`
  : ''
// [FLEET-RESUME-STABLE-END]

// ---- schemas: crisp machine-checkable done-conditions ----
const ENVFACTS = { type: 'object', required: ['remote', 'hasGh', 'verifierAgentFile'], properties: {
  remote: { type: 'boolean', description: 'true when CLAUDE_CODE_REMOTE_SESSION_ID or CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE printed a non-empty value' },
  hasGh: { type: 'boolean', description: 'true when the gh CLI is on PATH and `gh --version` exits 0' },
  verifierAgentFile: { type: 'boolean', description: 'true when ~/.claude/agents/fleet-verifier.md exists on disk' },
} }

const SCOUT = { type: 'object', required: ['candidateNumbers', 'tickets', 'repoMap', 'testCommand', 'defaultBranch'], properties: {
  candidateNumbers: { type: 'array', items: { type: 'integer' }, description: 'every issue number the one listing in step 2 returned, before any filtering - [] when it returned none. The whole candidate set: no ticket outside it may appear in tickets.' },
  tickets: { type: 'array', items: { type: 'object', required: ['number', 'title', 'criteria', 'blockedBy', 'keepOpen', 'kind', 'kindReason', 'discoveryTriage', 'handoffPending'], properties: {
    number: { type: 'integer' }, title: { type: 'string' },
    keepOpen: { type: 'boolean', description: 'true only when the ticket body, its comments or its labels say the issue must stay open after its PR merges (leave open / keep open / ratification); decides Refs vs Closes in the PR body' },
    kind: { type: 'string', enum: ['code', 'probe', 'human'], description: 'which lane runs this ticket: code = repository change; probe = resolves by quoting command output/research/evidence in a comment, no repository change asked for; human = labelled ready-for-human or the body says the owner performs the steps' },
    kindReason: { type: 'string', description: 'one line: the words in the ticket that decided the kind' },
    handoffPending: { type: 'boolean', description: 'true when the ticket\'s LATEST comment is a fleet handoff (a "Remaining for a local session" or "Remaining for a person" section (older handoffs say "Remaining for the owner") and the "_Generated by [Claude Code](https://claude.ai/code)_" footer) and no later comment from the owner follows it: the ticket is parked on a human, so this run must skip it rather than repeat the handoff' },
    discoveryTriage: { type: 'boolean', description: 'true when the ticket is a discovery-triage chore: it asks for a list of findings (FOLLOW-UPS.md discoveries, a fleet run\'s follow-ups, a review list) to be turned into tracker items - tickets filed, doc fixes landed, noise struck. Two of these in one wave file the same finding twice if they run concurrently, so the fleet chains them.' },
    criteria: { type: 'string', description: 'acceptance criteria, verbatim from issue + comments' },
    blockedBy: { type: 'array', items: { type: 'integer' }, description: 'open blocker issue numbers' },
  } } },
  repoMap: { type: 'string', description: '15-line map: key dirs, test command, conventions, rails' },
  testCommand: { type: 'string' },
  defaultBranch: { type: 'string', description: 'default branch of the repo (e.g. main or master, from git symbolic-ref refs/remotes/origin/HEAD)' },
} }

const IMPL = { type: 'object', required: ['branch', 'committed', 'testExitCode', 'testTail', 'discoveries'], properties: {
  branch: { type: 'string' }, committed: { type: 'boolean' },
  testExitCode: { type: 'integer', description: 'REAL exit code of test command, not piped' },
  testTail: { type: 'string', description: 'decisive final lines of test output' },
  discoveries: { type: 'array', items: { type: 'string' }, description: 'out-of-scope findings, each self-contained' },
} }

const PROBE = { type: 'object', required: ['items', 'blocked', 'discoveries'], properties: {
  items: { type: 'array', items: { type: 'object', required: ['item', 'commands', 'outputVerbatim', 'exitCodes', 'status'], properties: {
    item: { type: 'string', description: 'the criterion this item answers, verbatim' },
    commands: { type: 'string', description: 'the exact command(s) run, one per line' },
    outputVerbatim: { type: 'string', description: 'output exactly as printed - never paraphrased, tidied or invented' },
    exitCodes: { type: 'string', description: 'REAL exit code per command, not the exit code of a pipeline' },
    status: { type: 'string', enum: ['done', 'blocked'] },
  } } },
  blocked: { type: 'array', items: { type: 'string' }, description: 'each entry: what is impossible from this container and exactly what would unblock it (a second fresh container, a Routine run, a secret only the owner holds)' },
  discoveries: { type: 'array', items: { type: 'string' }, description: 'out-of-scope findings, each self-contained' },
} }

const HANDOFF = { type: 'object', required: ['agentSide', 'ownerSide', 'ready', 'remainingKind'], properties: {
  agentSide: { type: 'string', description: 'what an agent could do from this container: commands and their verbatim output' },
  ownerSide: { type: 'array', items: { type: 'string' }, description: 'the remaining steps, precise enough to follow without re-reading the ticket' },
  ready: { type: 'boolean', description: 'true when everything an agent can do is done and only human/local-agent steps remain' },
  remainingKind: { type: 'string', enum: ['local-agent', 'human'], description: "local-agent when the remaining steps are things a desktop session can do without a person (a live-tree edit to ~/.claude or ~/.codex plus sync.ps1 -Mode push, a remote branch delete the session proxy refuses, an edit the auto-mode classifier blocks in a container); human when the remaining steps are a person's judgment, credential or sign-off (a click in a web UI, an account or billing change, a design decision, anything needing the owner's identity)" },
} }

// `failures` is deliberately NOT required (issue 265). Requiring it made a passing verdict
// unexpressible: on issue 241 attempt 3 the verifier returned {pass:true, evidence} five times
// without the key and the run died on "StructuredOutput retry cap (5) exceeded ... must have
// required property 'failures'", so a green branch got no verdict and no delivery. A pass may
// omit the key or send []; every read of it goes through the normalisation below, which fills
// in [] so the retry prompt's `.failures.join` can never throw on a key-less verdict.
const VERDICT = { type: 'object', required: ['pass', 'evidence'], properties: {
  pass: { type: 'boolean' },
  evidence: { type: 'string', description: 'what YOU ran and observed; commands + decisive output lines' },
  failures: { type: 'array', items: { type: 'string' }, description: 'one entry per criterion that failed; on a pass send [] or omit this key entirely' },
} }

const DELIVERED = { type: 'object', required: ['pushed', 'prUrl', 'mergeStatus', 'conflictPaths'], properties: {
  pushed: { type: 'boolean' }, prUrl: { type: 'string' },
  mergeStatus: { type: 'string', enum: ['clean', 'resolved', 'blocked'], description: 'outcome of the pre-push merge of origin/<defaultBranch>: clean = merged with no conflict; resolved = conflicts were confined to generated files or SKILL.md stamp blocks and were resolved, regenerated, re-tested and committed; blocked = a conflict outside those classes, or the test command failed after the merge - nothing was pushed and no PR was opened' },
  conflictPaths: { type: 'array', items: { type: 'string' }, description: 'when mergeStatus is blocked, every path still in conflict (git diff --name-only --diff-filter=U) plus any path the stamp resolver refused; empty otherwise' },
  blockedReason: { type: 'string', description: 'when mergeStatus is blocked, one line saying why - the conflicting hunk, or the failing test tail' },
} }

const COMMENTED = { type: 'object', required: ['commented', 'commentUrl'], properties: {
  commented: { type: 'boolean' }, commentUrl: { type: 'string' },
  labels: { type: 'array', items: { type: 'string' }, description: 'human lane only: the ticket labels after the hand-back relabel - ready-for-local-agent or ready-for-human present, ready-for-agent gone' },
} }

// ---- unusable-output helpers (aac-routines issues 191, 270) ----
// A sub-agent can fail to return schema-conformant output at all: the harness retries
// StructuredOutput up to five times and then throws out of `agent(...)`. An unwrapped throw
// inside a per-ticket stage makes `pipeline` record that ticket as null, so the ticket vanishes
// from BOTH `delivered` and `failed` in the run report - aac-routines run wf_348ca8c2-663
// (2026-09-11) lost its #121 that way, leaving a green implementer branch nobody looked at.
// Every per-ticket `agent(...)` call below is therefore wrapped, and every reason is phrased the
// same way - `<who> output unusable: ...` with the harness's own error text in parentheses,
// never a bare 'failed'. The Scout call is deliberately NOT wrapped: it runs before any ticket
// exists, so a throw there ends the run with nothing to lose.
function unusableReason(who, detail) {
  const d = String(detail || '').trim()
  const base = `${who} output unusable: no reply matching its schema within the StructuredOutput retry cap`
  return d ? `${base} (${d})` : base
}

function unusableVerdict(detail, who) {
  return { pass: false, evidence: '', failures: [unusableReason(who || 'verifier', detail)], unusable: true }
}

// Every read of a verdict's failures goes through this: a reason-less entry in the run report is
// exactly the silence aac-routines issue 191 is about.
function failuresOf(verdict) {
  if (!verdict) return ['no verdict recorded for this attempt']
  const list = (Array.isArray(verdict.failures) ? verdict.failures : []).map(f => String(f).trim()).filter(Boolean)
  if (list.length) return list
  return [verdict.pass ? 'verifier passed and listed no failures' : 'verifier returned pass=false with no failures listed']
}

// ---------------------------------------------------------------------------
// Orchestrator-tree isolation guard (aac-routines issue 192, extended by 270)
// ---------------------------------------------------------------------------
// aac-routines run wf_348ca8c2-663 (2026-09-11) ended with nine files STAGED in the
// orchestrator's own index, byte-identical to `agent/issue-132-attempt1`. The Implement phase is
// not the exposed one - implementers run with `isolation: 'worktree'`. The VERIFY phase has no
// isolation option at all: it runs in the orchestrator's own checkout by design, because it needs
// `git worktree add` from a real repository, and a verifier that reaches for
// `git checkout <branch> -- .` instead of a scratch worktree stages exactly that branch's files in
// exactly this index. The Deliver phase runs unisolated for the same reason (aac-routines 270).
//
// So the guard is wired at four checkpoints - after Implement, after Verify, after Deliver, and
// before Report - and each one THROWS. A throw inside a pipeline stage drops that ticket to null,
// so its own Verify and Deliver never run; the `breaches` array then trips every other in-flight
// ticket's next checkpoint and the Deliver gate, and the run itself fails before Report. The probe
// and human lanes have no per-lane checkpoint of their own: they open no PR and push nothing, so
// the pre-report checkpoint is the one that covers them.
//
// Concurrency: `pipeline()` interleaves tickets, so checkpoints overlap. Two design choices make
// that safe rather than racy. (1) The guard tool never mutates shared state - the baseline is
// written once and only read afterwards, and `check` takes no git lock. (2) Attribution is by
// CONTENT, not by timing: each check is handed every wave branch as a `--candidate`, and a leaked
// file is blamed on the branch whose blob it matches, so the ticket that CAUSED the leak is named
// even when another ticket's checkpoint OBSERVED it first. The only mutable bookkeeping
// (`attributed`, `breaches`) lives here, in the workflow's single-threaded JavaScript, where a
// synchronous read-modify-write between awaits cannot interleave.
//
// Portability: this one script serves every fleeted repo, and `tools/orchestrator-tree-guard.js`
// ships in aac-routines only. The baseline command therefore probes for the tool first and exits 3
// when it is absent; under the default `treeGuard: 'auto'` that turns the guard off for repos that
// do not serve it, and `treeGuard: true` makes the same absence a hard abort.
const GUARD_CMD = `node ${cfg.treeGuardScript}`
const breaches = []
const attributed = new Set()
let guardStatePath = null
let guardCandidates = ''   // filled in once the wave is known, below
let treeGuardOn = cfg.treeGuard === true || cfg.treeGuard === 'auto'

// A guard agent runs ONE fixed command and hands back its exit code and stdout verbatim. Nothing
// is left to its judgement, so a paraphrase is detectable: stdout that does not JSON.parse is
// treated as could-not-audit, not as a pass.
const TREE_GUARD = { type: 'object', required: ['exitCode', 'stdout', 'stderr'], properties: {
  exitCode: { type: 'integer', description: 'REAL exit code of the guard command (0 clean, 1 leak, 2 could-not-audit, 3 guard tool not present in this repo)' },
  stdout: { type: 'string', description: 'the command stdout VERBATIM - one line of JSON when the guard ran; do not reformat, summarise or re-key it' },
  stderr: { type: 'string', description: 'the command stderr verbatim ("" if none)' },
} }

function guardAgentPrompt(command) {
  return `Run exactly this one bash command, from the repository root, and report its result:

${command}

Do not cd anywhere first. Do not run any other command. Do not read, write, stage or delete any
file. Do not interpret the output. Return the command's REAL exit code (0, 1, 2 or 3 - not the exit
code of a pipe) plus its stdout and stderr VERBATIM. When the guard ran at all its stdout is a
single line of JSON: copy it character for character; do not reformat it, summarise it, or invent
fields.`
}

function breachMessage() {
  return 'ticket-fleet run FAILED - orchestrator worktree isolation breached (aac-routines issue 192). '
    + breaches.map(b => `${b.label}: ${b.who} - ${b.entries.join('; ')}`).join(' | ')
    + '. The orchestrator\'s own checkout is dirty: reset it against the named ticket\'s branch '
    + 'before re-running.'
}

// A breach recorded anywhere in the wave stops every other chain before it spends another
// sub-session or - worse - reaches Deliver and pushes from a tree nobody can trust.
function assertNoBreach() { if (breaches.length) throw new Error(breachMessage()) }

phase('Setup')
if (treeGuardOn) {
  // Wrapped (aac-routines issue 270): a guard agent that blows the StructuredOutput retry cap
  // throws out of agent(...), and an unwrapped throw here would abort the run with the harness's
  // raw message instead of the one that tells the operator what it means.
  let baseline = null, baselineError = null
  try {
    baseline = await agent(
      guardAgentPrompt(`[ -f ${cfg.treeGuardScript} ] || exit 3; ${GUARD_CMD} baseline --cwd ${cfg.orchestratorCwd} --state-dir ${cfg.treeGuardStateDir}`),
      { label: 'tree-guard:baseline', phase: 'Setup', schema: TREE_GUARD, model: cfg.reportModel, effort: 'low' }
    )
  } catch (err) {
    baselineError = unusableReason('tree-guard:baseline', (err && err.message) || err)
  }
  let parsed = null
  try { parsed = JSON.parse(String((baseline && baseline.stdout) || '')) } catch (e) { parsed = null }
  if (baseline && baseline.exitCode === 3) {
    if (cfg.treeGuard === 'auto') {
      treeGuardOn = false
      log(`Orchestrator-tree guard OFF: ${cfg.treeGuardScript} is not in this repo (aac-routines issue 192 ships the guard tool there). Pass treeGuard:true to make its absence abort instead.`)
    } else {
      throw new Error(`ticket-fleet run ABORTED before Scout - treeGuard:true but ${cfg.treeGuardScript} is not in this repo (aac-routines issue 192). Add the guard tool to the served repo or run with treeGuard:'auto'.`)
    }
  } else if (!baseline || baseline.exitCode !== 0 || !parsed || !parsed.statePath) {
    throw new Error(
      'ticket-fleet run ABORTED before Scout - could not baseline the orchestrator tree (aac-routines issue 192). '
      + `exit=${baseline ? baseline.exitCode : 'null'} stderr=${baseline ? baseline.stderr : ''} error=${baselineError || 'none'}. `
      + 'Exit 2 is never a pass: without a baseline a leak cannot be told from pre-existing dirt, '
      + 'so the run must not start.'
    )
  } else {
    guardStatePath = parsed.statePath
    log(`Orchestrator-tree baseline taken (aac-routines issue 192): ${parsed.baselineCount} pre-existing entr${parsed.baselineCount === 1 ? 'y' : 'ies'}, state ${guardStatePath}. Dirt that pre-dates this run is the operator's and is never blamed on a ticket.`)
  }
} else {
  log('Orchestrator-tree guard DISABLED by args (treeGuard:false) - isolation breaches will not fail this run (aac-routines issue 192).')
}

/**
 * One isolation checkpoint. Throws on a breach and on could-not-audit; returns quietly when the
 * orchestrator's tree holds nothing beyond the run baseline. `label` names the checkpoint (e.g.
 * `implement-attempt1`), `ticketNumber` is the ticket whose chain is being checked - which is who
 * OBSERVED a leak, not necessarily who caused it.
 */
async function treeGuardCheck(label, ticketNumber) {
  if (!treeGuardOn) return
  // A breach already recorded elsewhere in the wave fails this chain too, before it can spend
  // another sub-session or reach Deliver.
  assertNoBreach()

  // Wrapped (aac-routines issue 270): a guard agent that cannot produce schema-conformant output
  // throws out of agent(...) after the StructuredOutput retry cap. That throw is a
  // could-not-audit, and could-not-audit is never a pass - so it is converted into the named
  // throw below, carrying the harness's error text, rather than escaping unattributed.
  let res = null, agentError = null
  try {
    res = await agent(
      guardAgentPrompt(`${GUARD_CMD} check --cwd ${cfg.orchestratorCwd} --state ${guardStatePath} --label ${label} --ticket ${ticketNumber} ${guardCandidates}`),
      { label: `tree-guard:${label}#${ticketNumber}`, phase: 'Isolation guard', schema: TREE_GUARD, model: cfg.reportModel, effort: 'low' }
    )
  } catch (err) {
    agentError = unusableReason(`tree-guard:${label}#${ticketNumber}`, (err && err.message) || err)
  }
  let report = null
  try { report = JSON.parse(String((res && res.stdout) || '')) } catch (e) { report = null }

  if (!res || res.exitCode === 2 || !report || !Array.isArray(report.newEntries)) {
    throw new Error(
      `orchestrator-tree guard COULD NOT AUDIT at ${label} (ticket #${ticketNumber}) - aac-routines issue 192. `
      + `exit=${res ? res.exitCode : 'null'} stderr=${res ? res.stderr : ''} error=${agentError || 'none'}. `
      + 'Exit 2 is never a pass.'
    )
  }

  // Synchronous read-modify-write: no await inside, so concurrent checkpoints cannot interleave
  // here and one leak is blamed on one ticket, once.
  const fresh = report.newEntries.filter(e => !attributed.has(e.path))
  for (const e of fresh) attributed.add(e.path)
  if (!fresh.length) return

  const blamed = [...new Set(fresh.flatMap(e => e.matchedTickets || []))]
  const who = blamed.length
    ? `ticket ${blamed.map(n => '#' + n).join(', #')} (content-matched to ${[...new Set(fresh.flatMap(e => e.matchedBranches || []))].join(', ')})`
    : `ticket #${ticketNumber} (observed at its checkpoint; content matched no wave branch, so this names the observer, not a proven author)`
  const entries = fresh.map(e => `${e.status} ${e.path}`)
  breaches.push({ label, observedBy: ticketNumber, blamed, who, entries })
  log(`ISOLATION BREACH (aac-routines issue 192) at ${label} - ${who}: ${entries.join('; ')}`)
  throw new Error(breachMessage())
}

// Two discovery-triage chores in one wave filed one finding as two tickets (issue 319: #281 and
// #285, two minutes apart, both the tools/tracker-audit.js short-fetch). The chain below the lanes
// stops them racing; this brief is the other half, and it travels with any discovery-triage ticket
// so a lone chore also dedupes against what earlier waves already filed.
const dedupeBrief = (t) => t.discoveryTriage ? `
Discovery-triage dedupe rail: this ticket turns findings into tracker items. Before creating ANY ticket, search the OPEN issues for the same file, symbol or failure - by what the finding is about, not just its wording - and list them fresh at the moment you are about to file, not once at the start: another chore in this same wave may have filed one minutes ago. On a match, comment on that existing ticket with the new evidence instead of creating a second one, and record that comment's URL as the finding's outcome. File a new ticket only when no open ticket covers the finding.` : ''

// ---- Scout ----
phase('Scout')

// Env probe: the one thing in this run that cannot be decided from inside the workflow runtime.
// A subagent has a real shell, so it reads the facts instead of the script guessing them from a
// `process` binding the runtime may not expose (issue 322) - and the caller no longer has to
// remember `instrument: 'mcp'` in a container. Cheap tier, no judgment, three commands.
const envFacts = await agent(
  `Report three facts about the session YOU are running in. Run exactly these commands and answer only from their output - never from assumption.
1. \`printenv CLAUDE_CODE_REMOTE_SESSION_ID; printenv CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE\` - remote = true when either prints a non-empty value, false when both are empty or unset.
2. \`command -v gh && gh --version\` - hasGh = true only when a path is printed AND \`gh --version\` exits 0.
3. \`test -f "$HOME/.claude/agents/fleet-verifier.md" && echo present || echo absent\` - verifierAgentFile = true on "present".
Print no secret value: these three are paths, a version string and set/unset, nothing else. Make no repository change, no commit, no comment. Return structured output only.`,
  { label: 'env-probe', phase: 'Scout', schema: ENVFACTS, model: cfg.reportModel, effort: 'low' }
)
// A failed probe must not silently become `gh` - that is the issue 322 failure. With an explicit
// instrument the run can continue on the caller's word; on `auto` it stops and says what to pass.
if (!envFacts && (cfg.instrument !== 'gh' && cfg.instrument !== 'mcp')) {
  throw new Error('env-probe returned nothing and instrument is "auto": re-run with instrument: "gh" (local session with the gh CLI) or instrument: "mcp" (cloud container)')
}
const facts = envFacts || { remote: false, hasGh: true, verifierAgentFile: false }
const instrument = pickInstrument(
  facts.remote ? { CLAUDE_CODE_REMOTE_SESSION_ID: 'probed' } : {}, facts.hasGh, cfg.instrument)
const verifierAgentType = resolveVerifierAgent(instrument, cfg.verifierAgent, facts)
const rules = trackerRules(instrument)
log(`instrument = ${instrument} (remote=${facts.remote}, gh=${facts.hasGh}${envFacts ? '' : ', probe failed - using args.instrument'})`)
log(`verifier agentType = ${verifierAgentType || 'none (unpinned: custom agent types are desktop-only, issue 339)'}`)

const scoutSource = explicitTickets.length ? rules.scoutExplicit(explicitTickets) : rules.scoutList(cfg.label)
const scout = await agent(
  `Scout this repository for tickets to run. ${rules.scoutNotes} Steps:
1. Read CLAUDE.md and any HANDOFF/CONTEXT docs at repo root.
2. Collect the tickets: ${scoutSource}
   That one listing is the WHOLE candidate set. Do not widen it under any circumstances: not another label, not a sweep of open issues, not a search, not a ticket you happened to read elsewhere. Report every number it returned in candidateNumbers, before any filtering, and return no ticket whose number is absent from it.
   A listing that comes back with zero tickets is a valid and complete answer, not a cue to go looking: return candidateNumbers: [] and tickets: [] and stop. The run ending with nothing to do is the correct outcome there.
3. For each ticket extract acceptance criteria verbatim and any "Blocked by #N" edges; a blocker counts only if that issue is still open. Per ticket set keepOpen to true only when the ticket body, its comments or its labels instruct that the issue stay open after its PR merges ("leave open", "keep open", a ratification ticket, a keep-open label); otherwise false.
4. Classify each ticket's kind, and put the deciding words in kindReason:
   - probe: the ticket resolves by quoting command output, research or evidence in a comment, and asks for no repository change.
   - human: the ticket is labelled ready-for-human, or its body says the owner performs the steps.
   - code: everything else.
4b. Set handoffPending per ticket. Read the comments in posting order and look at the LAST one. It is a fleet handoff when it carries a "Remaining for a local session" or "Remaining for a person" section (older handoffs say "Remaining for the owner") and the footer "_Generated by [Claude Code](https://claude.ai/code)_". handoffPending = true when that last comment is a fleet handoff and no comment from the owner (any comment the fleet did not write - it lacks that footer) comes after it; otherwise false. A ticket with handoffPending true is already parked on the owner and this run must not hand it off again.
   Also set discoveryTriage: true when the ticket asks for a list of findings (FOLLOW-UPS.md discoveries, a fleet run's follow-ups, a review list) to be triaged into tracker items - tickets filed, doc fixes landed, noise struck - and false otherwise. Say in kindReason which words decided it.
5. Identify the exact test command this repo uses (from CLAUDE.md / package.json / docs - never a glob if docs forbid it).
6. Produce a repoMap: max 15 lines - key directories, conventions, hard rails an implementer must not break.
7. Read the repo default branch (git symbolic-ref --short refs/remotes/origin/HEAD, strip the leading "origin/") - not every repo uses main.
Return structured output only.`,
  { label: 'scout', phase: 'Scout', schema: SCOUT, model: cfg.scoutModel, effort: 'low' }
)
// [FLEET-SCOUT-GATE-START]
// A scout whose listing matched nothing is prone to route around the dead end and hand back every
// open ticket it can find; the fleet would then spawn pr-check and implementer agents for work
// nobody asked for (issue 298). The prompt says an empty listing is a valid answer - this is the
// mechanical half: only tickets whose number was in the candidate set (the label listing, or the
// explicitly named numbers) survive. Pure counterpart: confineToCandidates in
// tools/ticket-fleet-branch.js, which ticket-fleet-branch.test.js pins against this inline copy.
function confineToCandidates(tickets, candidateNumbers) {
  const list = Array.isArray(tickets) ? tickets : []
  if (!Array.isArray(candidateNumbers)) return list
  const allowed = new Set(candidateNumbers.map(n => parseInt(n, 10)).filter(n => n > 0))
  return list.filter(t => t && allowed.has(parseInt(t.number, 10)))
}
const candidateSet = explicitTickets.length ? explicitTickets : (scout && scout.candidateNumbers)
const scoutTickets = confineToCandidates(scout && scout.tickets, candidateSet)
const offListing = ((scout && Array.isArray(scout.tickets)) ? scout.tickets.length : 0) - scoutTickets.length
if (offListing > 0) log(`${offListing} ticket(s) dropped: not in the ${explicitTickets.length ? 'requested numbers' : 'label listing'} the scout was given.`)
if (!scout || !scoutTickets.length) { log('No eligible tickets found.'); return { ran: 0, results: [], instrument, note: explicitTickets.length ? 'scout returned none of the requested tickets: ' + explicitTickets.join(', ') : 'scout found no open tickets with label ' + cfg.label } }
// [FLEET-SCOUT-GATE-END]

// ---- test command override (issue 317) ----
// The scout reports the gate this repo documents, and that gate can be unrunnable where the
// fleet is: a PowerShell suite in a Linux container makes every implementer report exit 127 and
// every verifier refute on its first step. A caller that knows the container names the runnable
// gate instead; it replaces the scout's value for every lane, logged once.
const testCommand = cfg.testCommand ? String(cfg.testCommand) : scout.testCommand
if (cfg.testCommand) log(`testCommand overridden by args: ${testCommand} (scout read: ${scout.testCommand})`)

// Open blockers gate every lane. Kind does not: a human ticket named in args.tickets stays in the
// wave (its lane is the handoff), and label listing keeps today's behaviour. A ticket whose latest
// comment is a fleet handoff still waiting on the owner is parked, not run: re-running its lane
// would post the same handoff comment again on every wave (issue 266). The selection is a pure
// function so tools/ticket-fleet-branch.test.js can drive it with fabricated scout output.
// [FLEET-WAVE-SELECT-START]
const selectWave = (tickets, maxTickets) => {
  const blocked = tickets.filter(t => t.blockedBy.length > 0)
  const eligible = tickets.filter(t => t.blockedBy.length === 0)
  const pendingHandoff = eligible.filter(t => t.handoffPending === true)
  const runnable = eligible.filter(t => t.handoffPending !== true)
  return { wave: runnable.slice(0, maxTickets), blocked, pendingHandoff, overCap: runnable.slice(maxTickets) }
}
// [FLEET-WAVE-SELECT-END]
const selection = selectWave(scoutTickets, cfg.maxTickets)
const wave = selection.wave
const droppedBlocked = selection.blocked.length
const droppedCap = selection.overCap.length
const skippedHandoff = selection.pendingHandoff.map(t => t.number)
if (droppedBlocked) log(`${droppedBlocked} ticket(s) skipped: open blockers.`)
if (skippedHandoff.length) log(`${skippedHandoff.length} ticket(s) skipped: awaiting the owner after a fleet handoff comment - ${skippedHandoff.map(n => '#' + n).join(', ')}.`)
if (droppedCap) log(`${droppedCap} eligible ticket(s) beyond maxTickets=${cfg.maxTickets} cap - run again for the rest.`)
log(`Wave: ${wave.map(t => '#' + t.number + ' (' + t.kind + ')').join(', ')}`)

// Every branch this wave can possibly produce, offered to every checkpoint as a
// content-attribution candidate (aac-routines issue 192). A branch that was never created simply
// never matches, so predicting the names costs nothing and removes the need to know which ticket
// is ahead of which - the point of doing this under concurrency. The shape is this script's own
// per-worker branch name, not the fork's: ticket, attempt, runId and the wave index.
guardCandidates = wave
  .flatMap((t, workerIndex) => Array.from({ length: cfg.maxAttempts }, (_, i) => `--candidate ${t.number}=agent/issue-${t.number}-attempt${i + 1}-wf_${runId}-w${workerIndex}`))
  .join(' ')

// ---- Lanes ----
// Every lane is run by subagents: the orchestrating session delegates, it never does ticket work
// itself. Doing a lane directly is allowed only when running it through a subagent is impossible
// or grossly inefficient - and then the session must say so in its summary.

// Probe lane: evidence in a comment, no repository change. Prober gathers, blind verifier re-runs.
const runProbeLane = async (t) => {
  let lastVerdict = null, probe = null, evidenceBlocks = '', deliveryFailure = null
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    const priorFindings = priorFindingsBlock(lastVerdict, 'fix these by actually running the commands, not by rewording')
    // Attempt 1 takes a recorded prober result when the caller supplied one (issue 317); the
    // `||` short-circuits, so no prober agent is started for it. Attempt 2+ always re-probes.
    const reuse = attempt === 1 && cfg.priorProbe ? cfg.priorProbe[t.number] : null
    if (reuse) log(`#${t.number}: reusing prior prober result from args.priorProbe (${(reuse.items || []).length} item(s)); no probe agent started for attempt 1.`)
    // Wrapped (aac-routines issue 270).
    let probeError = null
    probe = null
    try {
      probe = reuse || await agent(
      `Probe GitHub issue #${t.number}: ${t.title}
This ticket resolves by evidence, not by changing the repository (${t.kindReason}).
Criteria (verbatim):\n${t.criteria}${dedupeBrief(t)}${priorFindings}
Run every command the ticket asks for, in this container, and report exactly what happened - one item per criterion.
Rules:
- NEVER fabricate, guess or reconstruct output. Quote it exactly as printed, errors and noise included.
- Record the REAL exit code of each command, not the exit code of a pipeline.
- Never print a secret's value: report a credential, token or variable as set or unset (\`[ -n "$X" ] && echo set || echo unset\`), never its contents.
- Never invent or use fake credentials to make a command succeed.
- No repository edits, no commits, no pushes, no PRs - reading and running commands only.
- If an item cannot be done from here, set that item's status to blocked and add a blocked entry saying what is impossible from this container and exactly what would unblock it (a second fresh container, a Routine run, a secret only the owner holds). A blocked item is a fine outcome; a fabricated one is not.
You are operating autonomously; the user cannot answer questions mid-task. Do not end your turn on a plan, a question or a promise - run the commands first.
Return structured output only.`,
      { label: `probe:#${t.number}.${attempt}`, phase: 'Implement', schema: PROBE, model: cfg.implModel, isolation: 'worktree' }
      )
    } catch (err) {
      probeError = unusableReason(`probe:#${t.number}.${attempt}`, (err && err.message) || err)
      probe = null
    }
    if (!probe || !probe.items.length) {
      lastVerdict = probeError
        ? unusableVerdict(probeError, `probe:#${t.number}.${attempt}`)
        : { pass: false, evidence: 'prober returned null or no items', failures: ['no probe output produced'] }
      if (probeError) log(`${lastVerdict.failures[0]} - attempt recorded as failed.`)
      continue
    }

    evidenceBlocks = probe.items.map(i => `ITEM: ${stableText(i.item)}\nCOMMANDS:\n${stableText(i.commands)}\nOUTPUT:\n${stableText(i.outputVerbatim)}\nEXIT: ${stableText(i.exitCodes)}`).join('\n----\n')
    // Wrapped (aac-routines issues 191, 270).
    try {
      lastVerdict = await agent(
      `You are an independent verifier for a probe ticket. Your job is to REFUTE, not confirm - default to pass=false unless evidence forces true.
You have not been told what the prober concluded; judge only the criteria and the raw material below.
Criteria (verbatim):\n${t.criteria}
Commands and output claimed:\n${evidenceBlocks}
1. Re-run every command above that is re-runnable in this container and compare YOUR output with the claimed output. Output you cannot reproduce, or that does not match, is a failure.
2. For a command that genuinely cannot be re-run here (needs a second fresh container, a Routine, an owner secret), say so in your evidence; do not pass a re-runnable item on a claim alone.
3. Every criterion must be covered by an item; a criterion with no command behind it is a failure.
4. Fabrication check: output too clean for the command, paraphrased, or missing the tool's usual noise is a failure. So is any printed secret value.
Make no repository changes, no commits, no pushes. Return structured output only - evidence must be commands YOU ran plus decisive output lines.`,
      { label: `verify:#${t.number}.${attempt}`, phase: 'Verify', schema: VERDICT, model: cfg.verifyModel, agentType: verifierAgentType }
      )
    } catch (err) {
      lastVerdict = unusableVerdict((err && err.message) || err, `verify:#${t.number}.${attempt}`)
    }
    if (!lastVerdict) lastVerdict = unusableVerdict('verifier returned no structured output', `verify:#${t.number}.${attempt}`)
    // A pass may arrive with no `failures` key at all (issue 265) - fill it in here so every
    // later read (the retry prompt, the run report) sees an array.
    if (lastVerdict && !Array.isArray(lastVerdict.failures)) lastVerdict.failures = []
    if (lastVerdict.unusable) log(`${lastVerdict.failures[0]} - attempt recorded as failed.`)
    if (lastVerdict.pass) break
  }

  const done = !!(probe && probe.items.length && lastVerdict && lastVerdict.pass)
  let delivery = null
  if (done && cfg.deliver) {
    const blocked = stableList(probe.blocked)
    const blockedList = blocked.length ? blocked.map(b => '- ' + b).join('\n') : ''
    // Wrapped (aac-routines issue 270).
    try {
      delivery = await agent(
      `Post ONE resolution comment on issue #${t.number} (${t.title}).
${rules.commentPost()}
Body, in this order:
1. One sentence: what the ticket asked for and that it is answered by the evidence below.
2. One section per item, the item as the heading and a fenced code block holding, in order, the line \`$ <command>\`, then its verbatim output, then \`[exit N]\`. Copy from this data exactly - never re-run, re-word or tidy it:\n${evidenceBlocks}
3. ${blockedList ? 'A section "Blocked from this container" listing each blocked item and exactly what would unblock it:\n' + blockedList : 'No "Blocked from this container" section - nothing was blocked.'}
4. A line starting "Verifier: " quoting this independent-verifier evidence verbatim: ${JSON.stringify(stableText(lastVerdict.evidence))}
5. Exactly this footer, as the last two lines after a blank line:

---
_Generated by [Claude Code](https://claude.ai/code)_

Do NOT close the issue, do NOT edit the repository, do NOT open a PR, do NOT post more than one comment. Return structured output only.`,
      { label: `deliver:#${t.number}`, phase: 'Deliver', schema: COMMENTED, model: cfg.deliverModel }
      )
    } catch (err) {
      deliveryFailure = unusableReason(`deliver:#${t.number}`, (err && err.message) || err)
      delivery = null
      log(deliveryFailure)
    }
  }
  return { ticket: t.number, done, kind: 'probe', deliveryFailure, branch: null, verdict: lastVerdict, prUrl: null, commentUrl: delivery && delivery.commentUrl, discoveries: (probe && probe.discoveries) || [] }
}

// Human lane: a desktop session or a person performs the steps. The agent verifies only what
// a container can, then hands the rest back in one comment under a "Remaining for a local
// session" heading - unless the remaining steps are genuinely a person's judgment, credential or
// sign-off, in which case the heading is "Remaining for a person". It never claims a step was
// done that it did not do. After the comment it moves the ticket's label from ready-for-agent
// to the hand-back state that heading implies (ready-for-local-agent or ready-for-human), so
// the next label listing leaves it alone (issue 266). Bounded by the FLEET-HUMAN-LANE markers
// so tools/ticket-fleet-branch.test.js can extract it verbatim and drive it with a mocked
// `agent` under either instrument.
// [FLEET-HUMAN-LANE-START]
const runHumanLane = async (t) => {
  // Wrapped (aac-routines issue 270).
  let handoff = null, handoffError = null, deliveryFailure = null
  try {
    handoff = await agent(
    `Issue #${t.number}: ${t.title} is a human-lane ticket - either a desktop session or a person performs the remaining steps, you do not (${t.kindReason}).
${rules.handoffRead(t.number)}
Criteria (verbatim):\n${t.criteria}
Do ONLY what an agent can do from this container:
- Run the verification commands the checklist names; record each verbatim with its REAL exit code.
- Report a credential, token or setting as set or unset, NEVER its value; never use fake credentials.
- Make no repository change, no commit, no push, no PR. Never perform a step that only a desktop session or a person can do, and never claim one was done.
Return: agentSide = the commands you ran and their verbatim output; ownerSide = the remaining steps, precise enough to follow without re-reading the ticket (where to click, what to enter, what to check afterwards); ready = true only when everything an agent can do is done and only human/local-agent steps remain; remainingKind = 'local-agent' when a desktop session could take the remaining steps (a live-tree edit to ~/.claude or ~/.codex plus sync.ps1 -Mode push, a remote branch delete the session proxy refuses, an edit the auto-mode classifier blocks in a container), 'human' when they are genuinely a person's judgment, credential or sign-off.
Return structured output only.`,
    { label: `handoff:#${t.number}`, phase: 'Implement', schema: HANDOFF, model: cfg.verifyModel }
    )
  } catch (err) {
    handoffError = unusableReason(`handoff:#${t.number}`, (err && err.message) || err)
    handoff = null
    log(handoffError)
  }
  let delivery = null
  if (handoff && cfg.deliver) {
    const remainingKind = handoff.remainingKind === 'local-agent' ? 'local-agent' : 'human'
    const remainingHeading = remainingKind === 'local-agent' ? 'Remaining for a local session' : 'Remaining for a person'
    const emptyLine = remainingKind === 'local-agent' ? '- nothing remains for a local session' : '- nothing remains for a person'
    const handBackLabel = remainingKind === 'local-agent' ? 'ready-for-local-agent' : 'ready-for-human'
    const ownerSide = stableList(handoff.ownerSide)
    const ownerList = ownerSide.length ? ownerSide.map(s => '- ' + s).join('\n') : emptyLine
    try {
      delivery = await agent(
      `Post ONE status comment on issue #${t.number} (${t.title}), then hand the ticket back to the owner by relabelling it.
${rules.commentPost()}
Body, in this order:
1. A "Verified from this container" section: a fenced code block with the commands and their verbatim output, copied exactly from this data - never re-run, re-word or tidy it:\n${stableText(handoff.agentSide)}
2. A "${remainingHeading}" section, one bullet per step, verbatim:\n${ownerList}
3. Exactly this footer, as the last two lines after a blank line:

---
_Generated by [Claude Code](https://claude.ai/code)_

Then, and only after the comment is posted, relabel the ticket so the next run leaves it alone instead of repeating this handoff: ${rules.labelSwap(t.number, handBackLabel)}
Return the ticket's labels after the update in \`labels\`; "${handBackLabel}" must be among them and "ready-for-agent" must not.
Do NOT close the issue, do NOT edit the repository, do NOT open a PR, do NOT post more than one comment, do NOT change any label other than those two, and never state that a step outside this container was performed. Return structured output only.`,
      { label: `deliver:#${t.number}`, phase: 'Deliver', schema: COMMENTED, model: cfg.deliverModel }
      )
    } catch (err) {
      deliveryFailure = unusableReason(`deliver:#${t.number}`, (err && err.message) || err)
      delivery = null
      log(deliveryFailure)
    }
  }
  return {
    ticket: t.number, done: !!handoff, kind: 'human', branch: null, deliveryFailure, labels: (delivery && delivery.labels) || null,
    verdict: handoff
      ? { pass: handoff.ready, evidence: handoff.agentSide, failures: handoff.ready ? [] : handoff.ownerSide }
      : unusableVerdict(handoffError, `handoff:#${t.number}`),
    prUrl: null, commentUrl: delivery && delivery.commentUrl, discoveries: [],
  }
}
// [FLEET-HUMAN-LANE-END]

// ---- Implement + blind Verify per ticket, no barrier between tickets ----
// Pre-loop idempotence guard for resume (issue 150). Fetches the open-PR state from the tracker
// and shapes it into a small stable structured answer so the code lane can early-return before
// spawning any impl/verify/deliver agent. See runCodeLane below.
const PR_CHECK = { type: 'object', required: ['found'], properties: {
  found: { type: 'boolean' },
  prUrl: { type: 'string' },
  branch: { type: 'string' },
} }

// runCodeLane is bounded by the FLEET-CODE-LANE markers so the lockstep test in
// tools/ticket-fleet-branch.test.js can extract this function verbatim and drive
// it with a mocked `agent`, asserting that impl/verify/deliver agents are NOT
// invoked when the pre-loop PR check reports an open PR (issue 150 acceptance).
// [FLEET-CODE-LANE-START]
const runCodeLane = async (t, workerIndex) => {
  // Idempotence guard for resume (issue 150), kept fresh across resumes (issue 291). If the
  // tracker already has an open PR whose head ref matches this ticket's branch shape, skip the
  // whole ticket: no impl, verify or deliver agent is spawned. The observed failure mode
  // (wf_911fa64d-102, run id 6aa46942): a resumed run served impl:#97.1 from cache, but
  // verify:#97.1 and deliver:#97 ran under changed cache keys, re-verified the ticket, and
  // opened PR 145 while PR 137 was still open. What moved those keys inside the workflow runtime
  // is opaque here; the fix short-circuits the pipeline body with this pre-loop tracker check,
  // before any of the drifting keys are hit.
  // The guard is itself an agent() call, so it needs its own cache key to move: invocationId
  // (fresh on every launch, resume included - see the block above) is spliced into both the
  // prompt and the label, which is what stops a resume replaying the {found:false} recorded
  // before the PR existed. Keep it in both; a key derived from runId alone is stable across a
  // resume and the guard becomes a cached lie.
  const prCheckSteps = instrument === 'mcp'
    ? `There is no gh CLI here: use mcp__github__list_pull_requests with state="open" and per_page=100.
Filter the returned array to entries whose head.ref (the branch name of the PR's head) starts with agent/issue-${t.number}-.`
    : `Steps:
1. Read the repo slug from \`git remote get-url origin\`: the {owner}/{repo} used below.
2. Run \`gh api "repos/{owner}/{repo}/pulls?state=open&per_page=100"\`. Never \`gh pr list\`, \`gh pr view\`, \`gh issue list\` or \`gh issue view\`: they are GraphQL-backed and return HTTP 403 in cloud containers (issue 130).
3. Filter the returned array to entries whose head.ref starts with agent/issue-${t.number}-.`
  // Wrapped (aac-routines issue 270): a pr-check that blows the StructuredOutput retry cap must
  // not null the whole ticket. An unusable answer is treated as "no open PR" - the worst case is
  // a duplicate PR, which a human can close; the alternative is a ticket that never runs and
  // never appears in the run report.
  let openPR = null
  try {
    openPR = await agent(
    `Check whether the tracker already has an OPEN pull request whose head ref matches this ticket's branch shape agent/issue-${t.number}-.
Answer from the tracker as it stands right now, in this invocation (${invocationId}): run the query yourself, never report a remembered or previously given answer.
${prCheckSteps}
If any match exists, return {found:true, prUrl:<first match's html_url>, branch:<first match's head ref>}. If none, return {found:false}.
Make no repository change, no comment, no PR. Return structured output only.`,
    { label: `pr-check:#${t.number}@${invocationId}`, phase: 'Implement', schema: PR_CHECK, model: cfg.deliverModel, effort: 'low' }
    )
  } catch (err) {
    log(`${unusableReason(`pr-check:#${t.number}`, (err && err.message) || err)} - proceeding as if no open PR exists.`)
    openPR = null
  }
  if (openPR && openPR.found) {
    log(`#${t.number}: open PR ${openPR.prUrl} already exists, skipping (no impl/verify/deliver agents started).`)
    return {
      ticket: t.number, done: true, kind: 'code', branch: openPR.branch || null,
      verdict: { pass: true, evidence: 'existing open PR ' + openPR.prUrl, failures: [] },
      prUrl: openPR.prUrl, commentUrl: null, discoveries: [],
    }
  }
  let lastVerdict = null, impl = null, branch = null
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    // Per-worker suffix - the concrete slot the branch name lives in. Keep this
    // shape in sync with tools/ticket-fleet-branch.js (its test guards the drift).
    // Attempt 1 takes a recorded implementer result when the caller supplied one (issue 317):
    // the branch is already committed and only its verifier is missing. The `||` short-circuits,
    // so no implementer agent is started for it, and the recorded branch is the one verified and
    // delivered. Attempt 2+ always re-implements, so a reused branch the verifier refutes is
    // retried exactly as a fresh one would be.
    const reuse = attempt === 1 && cfg.priorImpl ? cfg.priorImpl[t.number] : null
    if (reuse) log(`#${t.number}: reusing prior implementer result from args.priorImpl (branch ${reuse.branch}); no impl agent started for attempt 1.`)
    branch = (reuse && reuse.branch) ? String(reuse.branch) : `agent/issue-${t.number}-attempt${attempt}-wf_${runId}-w${workerIndex}`
    const priorFindings = priorFindingsBlock(lastVerdict, 'fix these with a genuinely different approach, not a parameter tweak')
    // Wrapped (aac-routines issue 270): an implementer that blows the StructuredOutput retry cap
    // used to throw straight out of this stage, so `pipeline` nulled the ticket and it vanished
    // from both `delivered` and `failed`. It is now a failed attempt carrying the error text,
    // which the next attempt's prior-findings repeats and the run report prints. The checkpoint
    // below still runs: an implementer that died mid-run can still have left dirt behind.
    let implError = null
    impl = null
    try {
      impl = reuse || await agent(
      `Implement GitHub issue #${t.number}: ${t.title}
You are in a fresh isolated git worktree. Read CLAUDE.md first - binding.
Worktree rule (aac-routines issue 192, non-negotiable): EVERY command you run - shell, git, script file, editor, test runner - must target THIS sub-session's own worktree and nothing else; never \`cd\`, \`git -C\`, \`--git-dir\`/\`--work-tree\`, \`GIT_DIR=\`, absolute path, symlink, \`npm run\`, Makefile or generated script your way into the shared checkout at the repository root, and never write a byte outside your worktree - the harness refuses some of those spellings and silently permits the rest, so this rule is yours to keep, not its.
Repo map from scout:\n${scout.repoMap}
Acceptance criteria (verbatim):\n${t.criteria}${dedupeBrief(t)}${priorFindings}
You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task, so asking 'Want me to...?' or 'Shall I...?' will block the work. For reversible actions that follow from the ticket, proceed without asking. Stop only for the hard rails below or a genuine scope change the ticket does not cover - record that as a discovery string and return. Before ending your turn, check your last paragraph: if it is a plan, an analysis, a question, or a promise about work you have not done ('I'll...', 'next I would...'), do that work now with tool calls, including retrying after errors and gathering missing information yourself. End your turn only when the done-condition holds or a rail blocks you.
Rules: one branch named ${branch}; commit your work; NEVER push, NEVER open a PR, NEVER deploy or touch production paths; reference the issue in commits as "issue ${t.number}" (no # - closing-keyword risk). Acceptance criteria that describe delivery-stage steps - pushing the branch, opening a PR, merging, or presence on the default branch - are out of scope for you; the deliver stage handles those. Do not attempt them and do not treat their absence as a failure.
Live-tree hard rail: ~/.claude, ~/.codex, ~/.agents and any path outside this worktree are read-only production paths - never write to them, never leave .bak files there; a change that would need a live-tree edit to land is committed to the branch only and named as a discovery.
Done-condition (machine-checkable, all required): branch exists with your commits; \`${testCommand}\` exits 0 (check the REAL exit code, not piped output); acceptance criteria each demonstrably met (delivery-stage criteria excluded, per above).
Scope: if, while working or testing, you find a pre-existing bug, a performance concern, or behavior the ticket doesn't mention, don't fix, optimize or extend it in this change unless the requested behavior cannot work without it; report it as a self-contained discovery string instead. Where the ticket is ambiguous, implement the reading its wording and the surrounding code most directly support, state that assumption in a discovery string, and don't build for the other readings as well. Verify your work however you like; scratch scripts and quick checks need not be kept. Commit tests only where the ticket asks for them or this repository already keeps tests for this kind of change, sized like the neighboring test files - roughly one focused test per stated behavior - and don't turn scratch checks into additional permanent test files. This is about extras only: implement every behavior the ticket asks for, completely.
Edits: the number of tokens used to edit files is best minimized, all else being equal, so when it will not affect the end result, surgically edit a file rather than rewrite the entire thing.
Return structured output only.`,
      { label: `impl:#${t.number}.${attempt}`, phase: 'Implement', schema: IMPL, model: cfg.implModel, isolation: 'worktree' }
      )
    } catch (err) {
      implError = unusableReason(`impl:#${t.number}.${attempt}`, (err && err.message) || err)
      impl = null
    }

    // Checkpoint 1 of 4 (aac-routines issue 192): the orchestrator's own tree, right after this
    // ticket's implementer returned. A throw here drops the ticket out of the pipeline, so its
    // Verify and Deliver stages never run.
    await treeGuardCheck(`implement-attempt${attempt}`, t.number)

    if (!impl || !impl.committed) {
      lastVerdict = implError
        ? unusableVerdict(implError, `impl:#${t.number}.${attempt}`)
        : { pass: false, evidence: 'implementer returned null or nothing committed', failures: ['no commit produced'] }
      if (implError) log(`${lastVerdict.failures[0]} - attempt recorded as failed.`)
      continue
    }
    // The implementer's self-reported branch never reaches a prompt: it is an agent result, so
    // embedding it would tie the verifier's cache key to that result's serialization (issue 271),
    // and a wrong self-report would point the verifier at a branch nobody asked for. The
    // instructed branch is what gets verified and delivered; a mismatch is logged, loudly.
    if (impl.branch && impl.branch !== branch) log(`#${t.number}.${attempt}: implementer reported branch ${impl.branch}, not the instructed ${branch}; verifying and delivering the instructed branch.`)

    // Blind verifier: gets branch + criteria ONLY - never the implementer's self-report (conformity
    // guard). On a desktop session the verifier runs under the fleet-verifier subagent
    // (~/.claude/agents/fleet-verifier.md, issue 86) whose frontmatter caps its tool set at
    // Read, Grep, Glob, Bash. A cloud session gets no agentType at all: its registry is read
    // before the bootstrap hook can write one (issue 339, docs/tickets/339-decision.md), so the
    // restraint there is the container sandbox plus the detached scratch worktree.
    // Wrapped (aac-routines issues 191, 270).
    try {
      lastVerdict = await agent(
      `You are an independent verifier. Your job is to REFUTE, not confirm - default to pass=false unless evidence forces true.
Branch under review: ${branch} (do NOT trust its author; you have not seen their claims).
Orchestrator-tree rule (aac-routines issue 192, non-negotiable): unlike the implementer you are NOT worktree-isolated - the repository you start in IS the orchestrator's own checkout, and nothing stops you writing to it. Do not. The only commands allowed to touch it are \`git fetch\`, \`git worktree add\`, \`git worktree remove\`, and read-only \`git log\`/\`show\`/\`diff\`/\`rev-parse\`. \`git add\`, \`git checkout <branch> -- <path>\`, \`git restore\`, \`git stash\`, \`git reset\`, \`git apply\` and every file write belong inside your scratch worktree or nowhere: \`git checkout ${branch} -- .\` run here is precisely the leak issue 192 was filed for - it stages that branch's files in the orchestrator's index. A checkpoint runs straight after you and fails the whole run if this tree is dirty.
In this repo run: git worktree add <scratch dir> --detach ${branch} (detach - branch is checked out elsewhere), then inside it:
1. Run \`${testCommand}\` yourself; record the REAL exit code.
2. Check each acceptance criterion against the actual diff (git diff origin/${scout.defaultBranch}...${branch}):\n${t.criteria}\nDelivery-stage acceptance criteria - pushing the branch, opening a PR, merging, or presence on ${scout.defaultBranch} - are out of scope for this pass/fail verdict; the deliver stage handles those, so do not mark the branch failed for them.
3. Check repo hard rails from CLAUDE.md are unbroken (forbidden paths, closing keywords in commit messages, scope creep).
4. Live-tree hard rail: the implementer must not have written to ~/.claude, ~/.codex, ~/.agents or any path outside the worktree. The attempt's first commit time is \`git log --reverse --format=%cI origin/${scout.defaultBranch}..${branch} | head -1\`; from that timestamp, run \`find ~/.claude ~/.codex ~/.agents -type f -newermt "<that time>" -not -path '*/hook-state/*' -not -path '*/.claude/projects/*'\`. Those two exclusions are the harness's own scratch, not implementer output: ~/.claude/hook-state is hook bookkeeping and ~/.claude/projects holds this session's transcripts, tool-results/*.txt, subagent and workflow logs, which every fleet run writes - keep both exclusions exactly as given, do not re-derive them and do not count their contents as a breach. Everything else still counts: a write to ~/.claude/skills, ~/.claude/hooks, ~/.claude/settings.json, ~/.claude/CLAUDE.md, or anything under ~/.codex or ~/.agents is a hard-rail failure - mark pass=false and quote the file list in evidence.
5. Ripple check: same bug pattern elsewhere, callers affected, null/empty/large edge cases.
Clean up your scratch worktree (git worktree remove) when done. Return structured output only - evidence must be commands you ran plus decisive output lines.`,
      { label: `verify:#${t.number}.${attempt}`, phase: 'Verify', schema: VERDICT, model: cfg.verifyModel, agentType: verifierAgentType }
      )
    } catch (err) {
      lastVerdict = unusableVerdict((err && err.message) || err, `verify:#${t.number}.${attempt}`)
    }

    // Checkpoint 2 of 4 (aac-routines issue 192): straight after the verifier, the one fleet
    // sub-session that runs unisolated in the orchestrator's own checkout - the phase the
    // transcript forensics put the 2026-09-11 leak on.
    await treeGuardCheck(`verify-attempt${attempt}`, t.number)

    if (!lastVerdict) lastVerdict = unusableVerdict('verifier returned no structured output', `verify:#${t.number}.${attempt}`)
    // A pass may arrive with no `failures` key at all (issue 265) - fill it in here so every
    // later read (the retry prompt, the run report) sees an array.
    if (lastVerdict && !Array.isArray(lastVerdict.failures)) lastVerdict.failures = []
    if (lastVerdict.unusable) log(`${lastVerdict.failures[0]} - attempt recorded as failed.`)
    if (lastVerdict.pass) break
  }

  const done = !!(impl && impl.committed && lastVerdict && lastVerdict.pass)
  let delivery = null
  let deliveryFailure = null
  if (done && cfg.deliver) {
    // Nothing gets pushed once any ticket in the wave has breached isolation (aac-routines issue
    // 192): the tree the verifier judged from is no longer trustworthy.
    assertNoBreach()
    // The ticket decides the closing keyword, not the template (claude-dotfiles issue 72). A
    // ratification ticket says "leave open"; GitHub acts on Closes #N at merge time whatever the
    // commit messages say.
    const keepOpen = t.keepOpen === true || /\b(?:leave|keep|stay|remain)s?\s+(?:this\s+|the\s+|it\s+)?(?:ticket\s+|issue\s+)?open\b/i.test(t.criteria || '')
    const issueRef = keepOpen
      ? `"Refs #${t.number}" (this ticket stays OPEN by its own instruction; never write Closes, Fixes or Resolves)`
      : `"Closes #${t.number}"`
    const keepOpenNote = keepOpen ? ' and the sentence "Ticket left open per its own instruction; this PR does not close it."' : ''
    const prToolNote = instrument === 'mcp'
      ? `There is no \`gh\` CLI here - use git and the GitHub MCP tools.`
      : ''
    // Deliver DOES NOT TICK ACCEPTANCE BOXES (aac-routines issue 264). It used to, straight after
    // the PR was created, which meant every fleet issue read `- verified in PR #N` while #N was
    // open and the default branch carried none of the change. A ticked box is a claim that the
    // work shipped, so it waits for the merge: where the served repo has a tick-acceptance-boxes
    // merge workflow, that workflow ticks the boxes on the `pull_request` closed+merged event.
    // Wrapped (aac-routines issue 270): a Deliver sub-agent that blows the StructuredOutput retry
    // cap used to throw out of this stage, nulling a ticket whose branch had already passed
    // verification - quite possibly after the push and the PR had already happened. The ticket now
    // carries a named deliveryFailure into the run report instead of disappearing from it.
    // Pre-push merge (issue 318). A wave's branches all fork from the same commit; by the time
    // the last one is verified, master has moved and every branch that touched a skill carries a
    // rotated stamp block and a rebuilt marketplace payload. Merging here, with the two safe
    // conflict classes named explicitly, means the PR opens mergeable. Anything outside those
    // classes is a real merge and stops this ticket: PR #306 showed what taking master's whole
    // SKILL.md costs when the branch had edited its prose.
    const generatedList = (cfg.generatedPaths || []).map(p => '`' + p + '`').join(', ') || '(none configured)'
    const regenNote = Array.isArray(cfg.regenCommands) && cfg.regenCommands.length
      ? 'run exactly these, in order, from the repo root:\n' + cfg.regenCommands.map(c => '   $ ' + c).join('\n')
      : "read CLAUDE.md for the commands this repo uses to re-stamp its skills and rebuild its generated payload (in claude-dotfiles they are the two commands in the 'Skill stamps' section) and run them from the repo root"
    try {
      delivery = await agent(
      `Deliver verified branch ${branch} for issue #${t.number}.${prToolNote ? ' ' + prToolNote : ''}

STEP A - merge the default branch BEFORE pushing, so the PR opens mergeable:
A1. \`git fetch origin ${scout.defaultBranch}\`, then from a checkout of ${branch}: \`git merge --no-edit origin/${scout.defaultBranch}\`.
A2. Clean merge (exit 0, nothing conflicted): mergeStatus is "clean" - go to STEP B.
A3. Conflicts: list them with \`git diff --name-only --diff-filter=U\`. Exactly two classes may be resolved here; a path in neither is a real merge you must NOT guess at.
    (a) GENERATED FILE - the path matches one of ${generatedList}. Take the default branch's side: \`git checkout --theirs -- <path>\` then \`git add -- <path>\`.
    (b) SKILL.md STAMP BLOCK - a SKILL.md whose conflict sits entirely inside the four-key metadata stamp block (modified, previous-modified, revision, content-sha). Do NOT judge this by eye and do NOT take the default branch's whole file: run \`node tools/resolve-stamp-conflict.js <path>\`. Exit 0 means every hunk in that file was stamp-only and was resolved to the default branch's side - then \`git add -- <path>\`. A NON-ZERO exit means the file conflicts outside the stamp block; that path belongs to class (c). If this repo has no such script, class (b) does not apply here: treat the path as class (c).
    (c) ANYTHING ELSE - any other path, and any SKILL.md the resolver refused. Stop this ticket: \`git merge --abort\`, do NOT push, do NOT open a PR, do NOT post a comment, and return {pushed:false, prUrl:"", mergeStatus:"blocked", conflictPaths:[every such path], blockedReason:"one line naming the conflicting hunk"}.
A4. Once every conflicted path was class (a) or (b): regenerate, because the resolved stamps and payload are now stale - ${regenNote}. Then \`git add -A\`.
A5. Re-run \`${testCommand}\` and record the REAL exit code, not a pipeline's. Non-zero: \`git merge --abort\`, push nothing, open no PR, and return mergeStatus "blocked" with conflictPaths listing the paths that were in conflict and blockedReason holding the decisive failing lines.
A6. Tests green: commit the merge (\`git commit --no-edit\` while the merge is in progress, or \`git commit -am "merge origin/${scout.defaultBranch} into ${branch} (issue ${t.number}): generated files re-stamped and rebuilt"\`). mergeStatus is "resolved".

STEP B - push and open the PR (only when STEP A ended clean or resolved):
B1. git push -u origin ${branch}
B2. ${rules.prCreate()} - title "fix: ${t.title} (#${t.number})"; body covering: what changed; exactly how verified, quoting this independent-verifier evidence verbatim: ${JSON.stringify(stableText(lastVerdict.evidence))}; if STEP A ended "resolved", one sentence naming the paths the merge resolved and that the generated files were rebuilt and the tests re-run; what remains for the human (merge + any release gates); and ${issueRef} in the PR body ONLY. Write the PR body in plain, direct prose for a human reader: no mannered prose, no metaphor or flourish where a literal phrase exists.
B3. ${rules.prComment()} ${t.number} with the PR link${keepOpenNote}.
B4. Return conflictPaths: [] and the real mergeStatus ("clean" or "resolved").

Do NOT merge the PR, do NOT close the issue, do NOT push or otherwise touch ${scout.defaultBranch} itself. Do NOT edit the issue body at all and do NOT tick any acceptance box, ticked or otherwise (aac-routines issue 264): a ticked box claims the work shipped, the work ships at merge, and where this repo has a tick-acceptance-boxes merge workflow that workflow ticks them then. Return structured output only.`,
      { label: `deliver:#${t.number}`, phase: 'Deliver', schema: DELIVERED, model: cfg.deliverModel }
      )
    } catch (err) {
      deliveryFailure = unusableReason(`deliver:#${t.number}`, (err && err.message) || err)
      delivery = null
    }
    if (!deliveryFailure && !(delivery && (delivery.prUrl || delivery.mergeStatus === 'blocked'))) {
      deliveryFailure = `deliver:#${t.number} did not deliver: pushed=${delivery ? String(delivery.pushed) : 'null'} prUrl=${(delivery && delivery.prUrl) || '(none)'} - branch ${impl.branch} is verified but has no PR.`
    }
    // Log before the checkpoint below: a Deliver-phase breach throws out of this stage, and the PR
    // URL (or the delivery failure) must not be lost with it.
    log(deliveryFailure || `deliver:#${t.number}: ${(delivery && delivery.prUrl) || 'no PR (pre-push merge blocked)'}`)

    // Checkpoint 3 of 4 (aac-routines issue 270): the Deliver step pushes and opens the PR from
    // the parent's context - unisolated, like the verifier - so it can dirty the orchestrator's
    // tree itself. Before issue 270 the only checkpoint that could see that was `pre-report`,
    // which runs after every ticket association has been dropped, so the breach was attributed to
    // ticket #0. Checking here, while this ticket is still the one being delivered, names it.
    await treeGuardCheck('deliver', t.number)
  }
  // A blocked pre-push merge is a delivery failure, not a silent no-op: the ticket lands in the
  // run result's `failed` list with the conflicting paths, and no PR exists to review.
  const mergeBlocked = !!(delivery && (delivery.mergeStatus === 'blocked'
    || (!delivery.prUrl && Array.isArray(delivery.conflictPaths) && delivery.conflictPaths.length)))
  const conflictPaths = mergeBlocked ? (delivery.conflictPaths || []) : []
  if (mergeBlocked) log(`#${t.number}: delivery stopped - merging origin/${scout.defaultBranch} conflicts outside the resolvable classes (${conflictPaths.join(', ') || 'paths not reported'}); no PR opened.`)
  const mergeFailure = mergeBlocked
    ? `pre-push merge of origin/${scout.defaultBranch} blocked: ${conflictPaths.join(', ') || 'conflicting paths not reported'}${delivery.blockedReason ? ' - ' + delivery.blockedReason : ''}`
    : null
  return {
    ticket: t.number, done: done && !mergeBlocked, kind: 'code', branch: impl ? branch : null,
    verdict: mergeBlocked
      ? { pass: false, evidence: (lastVerdict && lastVerdict.evidence) || '', failures: ((lastVerdict && lastVerdict.failures) || []).concat([mergeFailure]) }
      : lastVerdict,
    prUrl: mergeBlocked ? null : (delivery && delivery.prUrl), commentUrl: null, deliveryFailure,
    conflictPaths, discoveries: (impl && impl.discoveries) || [],
  }
}
// [FLEET-CODE-LANE-END]

// Pre-annotate each ticket with a workerIndex (0-based position in the wave) so
// the pipeline callback can build a collision-proof branch name without
// relying on pipeline's callback signature to pass an index.
const workers = wave.map((ticket, workerIndex) => ({ ticket, workerIndex }))
const runWorker = async ({ ticket, workerIndex }) => {
  const t = ticket
  if (t.kind === 'probe') return await runProbeLane(t)
  if (t.kind === 'human') return await runHumanLane(t)
  return await runCodeLane(t, workerIndex)
}
// Discovery-triage chores are the one kind of ticket that writes to the tracker rather than to the
// repository, so two of them running side by side cannot see each other's tickets and file the same
// finding twice (issue 319). They go into ONE lane and run one after the other - the second reads a
// tracker the first has already added to. Every other ticket still runs in parallel; a wave holding
// at most one chore behaves exactly as before.
const chores = workers.filter(w => w.ticket.discoveryTriage === true)
const lanes = workers.filter(w => w.ticket.discoveryTriage !== true).map(w => [w])
if (chores.length > 1) log(`${chores.length} discovery-triage chores in this wave (${chores.map(w => '#' + w.ticket.number).join(', ')}) - running them one after another so each sees the tickets the previous one filed.`)
if (chores.length) lanes.push(chores)
const grouped = await pipeline(lanes, async (lane) => {
  const out = []
  for (const w of lane) out.push(await runWorker(w))
  return out
})
const results = (grouped || []).flat()

// Checkpoint 4 of 4 (aac-routines issue 192): the whole wave has drained. This is the one that
// catches a leak no per-ticket checkpoint was still running to see - one from the last ticket
// after its final check, from the probe or human lanes, or anything the parent context did
// between the wave and here. It runs with ticket #0, so whatever it finds is attributed by
// CONTENT or not at all; that is why the Deliver checkpoint above exists rather than leaving
// Deliver-phase dirt to this one (aac-routines issue 270). It throws before Report, so a breached
// run never finishes quietly.
await treeGuardCheck('pre-report', 0)
assertNoBreach()

// ---- Report: single writer, no append races ----
phase('Report')
// Reconcile against the wave rather than dropping falsy results (aac-routines issue 191): a ticket
// whose per-ticket stage produced nothing at all still belongs in `failed` with a reason.
// `pipeline` returns one slot per input, in order, and nulls the slot when the stage threw.
const clean = wave.map((t, i) => (results || [])[i] || {
  ticket: t.number, done: false, kind: t.kind, branch: null,
  verdict: { pass: false, evidence: '', failures: ['per-ticket stage produced no result; see the run log for the error that ended it'] },
  prUrl: null, commentUrl: null, deliveryFailure: null, discoveries: [],
})
const allDiscoveries = clean.flatMap(r => r.discoveries)
// Wrapped (aac-routines issue 270): the writer is the last agent(...) of the run, and a throw here
// lost the whole run report - every delivered PR included - to a harness error. It is now a named
// report entry, and the discovery strings it failed to append come back in `discoveryList` so
// nothing has to be reconstructed from the log.
let followupsError = null
if (allDiscoveries.length) {
  try {
    await agent(
      `Append to ${cfg.followupsFile} at repo root (create if missing; append-only, never rewrite existing entries). Add a "## Run (ticket-fleet)" heading, then one bullet per finding, each self-contained:\n- ${allDiscoveries.join('\n- ')}\nCommit nothing. Return "appended N entries".`,
      { label: 'followups-writer', phase: 'Report', model: cfg.reportModel, effort: 'low' }
    )
  } catch (err) {
    followupsError = unusableReason('followups-writer', (err && err.message) || err)
    log(`${followupsError} - ${allDiscoveries.length} discovery string(s) were NOT appended to ${cfg.followupsFile}; they are in this report's discoveryList.`)
  }
}

// ---- durable run record (aac-routines issue 269) ----
// Everything above this line lives in the harness journal, which is machine-local and dies with
// the container: aac-routines run wf_348ca8c2-663 was unrecoverable four days later, so issue
// 192's mechanism had to be re-derived by reasoning instead of read off the transcript. The record
// that fixes that is written by the ORCHESTRATING SESSION - the session that invoked this workflow
// - running RECORD_COMMAND in its own shell the moment this returns. Deliberately not a sub-agent:
// a sub-session composing the record would be re-deriving the run's history from its own context,
// which is the hallucination surface the record exists to remove. A Workflow script has no
// filesystem of its own, so this phase names the command rather than running it.
const RECORD_COMMAND = 'node tools/fleet-run-record.js --latest'
log(`Run forensics (aac-routines issue 269): run \`${RECORD_COMMAND}\` in the served repo from THIS session - not via a sub-agent - before the container is gone. It distils this run's journal into state/fleet-runs/<runId>.json. Where the served repo gitignores state/, post the record's digest as a comment on that repo's tracking issue: an ignored file dies with the container.`)

// A ticket that verified but did not deliver is neither `delivered` (no PR or comment URL) nor,
// before aac-routines issue 270, `failed` (done was true) - the issue 191 silence one phase later.
// It is now listed in `failed` with the delivery error text.
return {
  ran: clean.length,
  instrument,
  delivered: clean.filter(r => r.prUrl || r.commentUrl).map(r => ({ ticket: r.ticket, kind: r.kind, pr: r.prUrl || null, comment: r.commentUrl || null })),
  // conflictPaths is populated only by a code-lane ticket whose pre-push merge hit a conflict
  // outside the generated files and the SKILL.md stamp blocks (issue 318); no PR was opened.
  failed: clean.filter(r => !r.done || r.deliveryFailure).map(r => ({
    ticket: r.ticket,
    kind: r.kind,
    failures: (r.done ? [] : failuresOf(r.verdict)).concat(r.deliveryFailure ? [r.deliveryFailure] : []),
    conflictPaths: r.conflictPaths || [],
  })),
  discoveries: allDiscoveries.length,
  followupsError,
  discoveryList: followupsError ? allDiscoveries : undefined,
  skippedBlocked: droppedBlocked,
  // Named, not counted: the reader has to know WHICH ticket is parked on the owner (issue 266).
  skippedAwaitingOwner: skippedHandoff,
  skippedOverCap: droppedCap,
  recordCommand: RECORD_COMMAND,
}
