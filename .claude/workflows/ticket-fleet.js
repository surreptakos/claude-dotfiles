export const meta = {
  name: 'ticket-fleet',
  description: 'Parallel ticket runner: scout, pinned implementer per ticket, blind refuting verifier, PR on pass, discovery collection',
  whenToUse: 'Drive open ready-for-agent tickets to verified PRs in parallel; also runs probe tickets (evidence in a comment) and ready-for-human tickets (verify what a container can, hand the rest to the owner). args: {runId (required, caller-minted unique token), tickets (array of issue numbers; when given the scout takes exactly those, any label or state), label, maxTickets, scoutModel, implModel, verifyModel, deliverModel, reportModel, maxAttempts, deliver, followupsFile}',
  phases: [
    { title: 'Scout', detail: 'list tickets, classify kind, dependency edges, repo map' },
    { title: 'Implement', detail: 'per ticket: implementer in a worktree, prober, or handoff reader' },
    { title: 'Verify', detail: 'blind reviewer per attempt, prompted to refute' },
    { title: 'Deliver', detail: 'PR on a verified code branch; one resolution/status comment otherwise' },
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
  implModel: 'claude-opus-4-7',             // heaviest-context stage, version-stable across runs
  verifyModel: 'claude-sonnet-5',           // skepticism comes from blindness + prompt, not tier
  deliverModel: 'claude-haiku-4-5-20251001',// push + PR mechanics, no judgment
  reportModel: 'claude-haiku-4-5-20251001', // formats pre-aggregated discoveries
  maxAttempts: 3,           // Ralph-style bounded retry, fresh context each attempt
  deliver: true,            // false = stop after verify, no push/PR
  followupsFile: 'FOLLOW-UPS.md',
}, args || {})

// ---- concurrent-run safety ----
// Two ticket-fleet invocations can pick up the same open ticket at the same
// time (nothing on the tracker side prevents it). Without a per-run identifier
// both runners would spawn implementers that try to create
// `agent/issue-<N>-attempt1`, and the second git-branch or push collides. This
// runner takes a caller-minted `runId` per invocation and hands each spawned implementer a
// per-worker suffix `wf_<runId>-w<workerN>` (workerN = the ticket's index in
// the wave), embedded in the branch name. Two concurrent scouts against the
// same ticket therefore produce distinct branches. Alternative not used here:
// query-and-increment against
//   gh api repos/<owner>/<repo>/branches --paginate --jq \
//     '.[].name | select(startswith("agent/issue-N-attempt"))'
// then increment - has a race between the query and branch creation. See
// tools/ticket-fleet-branch.js for the pure-function counterpart the tests
// exercise (tools/ticket-fleet-branch.test.js).
// The workflow runtime throws on Date.now(), new Date() and Math.random() inside scripts (they would
// break resume), so the id cannot be minted here: the caller passes it as args.runId (any short
// unique token, e.g. the shell's `date +%s` in hex). Failing loudly beats a shared branch name.
if (!cfg.runId) throw new Error('args.runId is required: workflow scripts cannot call Date.now()/Math.random(); pass a unique token such as `printf %x $(date +%s)`')
const runId = String(cfg.runId).replace(/[^A-Za-z0-9]/g, '').slice(0, 16)

// Explicit selection wins over the label: a named ticket is fetched whatever its labels or state.
const explicitTickets = (Array.isArray(cfg.tickets) ? cfg.tickets : []).map(n => parseInt(n, 10)).filter(n => n > 0)

// ---- schemas: crisp machine-checkable done-conditions ----
const SCOUT = { type: 'object', required: ['tickets', 'repoMap', 'testCommand', 'defaultBranch'], properties: {
  tickets: { type: 'array', items: { type: 'object', required: ['number', 'title', 'criteria', 'blockedBy', 'kind', 'kindReason'], properties: {
    number: { type: 'integer' }, title: { type: 'string' },
    kind: { type: 'string', enum: ['code', 'probe', 'human'], description: 'which lane runs this ticket: code = repository change; probe = resolves by quoting command output/research/evidence in a comment, no repository change asked for; human = labelled ready-for-human or the body says the owner performs the steps' },
    kindReason: { type: 'string', description: 'one line: the words in the ticket that decided the kind' },
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
    outputVerbatim: { type: 'string', description: 'output exactly as printed — never paraphrased, tidied or invented' },
    exitCodes: { type: 'string', description: 'REAL exit code per command, not the exit code of a pipeline' },
    status: { type: 'string', enum: ['done', 'blocked'] },
  } } },
  blocked: { type: 'array', items: { type: 'string' }, description: 'each entry: what is impossible from this container and exactly what would unblock it (a second fresh container, a Routine run, a secret only the owner holds)' },
  discoveries: { type: 'array', items: { type: 'string' }, description: 'out-of-scope findings, each self-contained' },
} }

const HANDOFF = { type: 'object', required: ['agentSide', 'ownerSide', 'ready'], properties: {
  agentSide: { type: 'string', description: 'what an agent could do from this container: commands and their verbatim output' },
  ownerSide: { type: 'array', items: { type: 'string' }, description: 'the remaining owner steps, precise enough to follow without re-reading the ticket' },
  ready: { type: 'boolean', description: 'true when everything an agent can do is done and only owner steps remain' },
} }

const VERDICT = { type: 'object', required: ['pass', 'evidence', 'failures'], properties: {
  pass: { type: 'boolean' },
  evidence: { type: 'string', description: 'what YOU ran and observed; commands + decisive output lines' },
  failures: { type: 'array', items: { type: 'string' } },
} }

const DELIVERED = { type: 'object', required: ['pushed', 'prUrl'], properties: {
  pushed: { type: 'boolean' }, prUrl: { type: 'string' },
} }

const COMMENTED = { type: 'object', required: ['commented', 'commentUrl'], properties: {
  commented: { type: 'boolean' }, commentUrl: { type: 'string' },
} }

// ---- Scout ----
phase('Scout')
// Tracker access is REST-only: `gh issue list`, `gh issue view` and `gh repo view` are GraphQL-backed
// and return HTTP 403 in cloud containers (issue 130), so every prompt below says `gh api` instead.
const scoutSource = explicitTickets.length
  ? `Take EXACTLY these issues, whatever their labels or state: ${explicitTickets.join(', ')}. Per number N: \`gh api repos/{owner}/{repo}/issues/N\` and \`gh api repos/{owner}/{repo}/issues/N/comments\`.`
  : `\`gh api "repos/{owner}/{repo}/issues?labels=${cfg.label}&state=open&per_page=100"\`, then per ticket N \`gh api repos/{owner}/{repo}/issues/N\` and \`gh api repos/{owner}/{repo}/issues/N/comments\` — comments carry criteria the body lacks.`
const scoutTrackerRules = `{owner}/{repo} come from \`git remote get-url origin\` — \`gh repo view\` is GraphQL too. NEVER run \`gh issue list\` or \`gh issue view\`: they are GraphQL-backed and return HTTP 403 "GitHub GraphQL is not available from Claude Code sessions" (issue 130). Only \`gh api repos/{owner}/{repo}/...\` REST paths work.`
const scout = await agent(
  `Scout this repository for tickets to run. ${scoutTrackerRules} Steps:
1. Read CLAUDE.md and any HANDOFF/CONTEXT docs at repo root.
2. Collect the tickets: ${scoutSource}
3. For each ticket extract acceptance criteria verbatim and any "Blocked by #N" edges; a blocker counts only if that issue is still open.
4. Classify each ticket's kind, and put the deciding words in kindReason:
   - probe: the ticket resolves by quoting command output, research or evidence in a comment, and asks for no repository change.
   - human: the ticket is labelled ready-for-human, or its body says the owner performs the steps.
   - code: everything else.
5. Identify the exact test command this repo uses (from CLAUDE.md / package.json / docs — never a glob if docs forbid it).
6. Produce a repoMap: max 15 lines — key directories, conventions, hard rails an implementer must not break.
7. Read the repo default branch (git symbolic-ref --short refs/remotes/origin/HEAD, strip the leading "origin/") — not every repo uses main.
Return structured output only.`,
  { label: 'scout', phase: 'Scout', schema: SCOUT, model: cfg.scoutModel, effort: 'low' }
)
if (!scout || !scout.tickets.length) { log('No eligible tickets found.'); return { ran: 0, results: [], note: explicitTickets.length ? 'scout returned none of the requested tickets: ' + explicitTickets.join(', ') : 'scout found no open tickets with label ' + cfg.label } }

// Open blockers gate every lane. Kind does not: a human ticket named in args.tickets stays in the
// wave (its lane is the handoff), and label listing keeps today's behaviour.
const eligible = scout.tickets.filter(t => t.blockedBy.length === 0)
const wave = eligible.slice(0, cfg.maxTickets)
const droppedBlocked = scout.tickets.length - eligible.length
const droppedCap = eligible.length - wave.length
if (droppedBlocked) log(`${droppedBlocked} ticket(s) skipped: open blockers.`)
if (droppedCap) log(`${droppedCap} eligible ticket(s) beyond maxTickets=${cfg.maxTickets} cap — run again for the rest.`)
log(`Wave: ${wave.map(t => '#' + t.number + ' (' + t.kind + ')').join(', ')}`)

// ---- Lanes ----
// Every lane is run by subagents: the orchestrating session delegates, it never does ticket work
// itself. Doing a lane directly is allowed only when running it through a subagent is impossible or
// grossly inefficient — and then the session must say so in its summary.
// Each lane returns the same result shape so Report and the final return keep working.

// Probe lane: evidence in a comment, no repository change. Prober gathers, blind verifier re-runs.
const runProbeLane = async (t) => {
  let lastVerdict = null, probe = null, evidenceBlocks = ''
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    const priorFindings = lastVerdict ? `\nPrevious attempt FAILED verification. Independent reviewer findings (fix these by actually running the commands, not by rewording):\n- ${lastVerdict.failures.join('\n- ')}` : ''
    probe = await agent(
      `Probe GitHub issue #${t.number}: ${t.title}
This ticket resolves by evidence, not by changing the repository (${t.kindReason}).
Criteria (verbatim):\n${t.criteria}${priorFindings}
Run every command the ticket asks for, in this container, and report exactly what happened — one item per criterion.
Rules:
- NEVER fabricate, guess or reconstruct output. Quote it exactly as printed, errors and noise included.
- Record the REAL exit code of each command, not the exit code of a pipeline.
- Never print a secret's value: report a credential, token or variable as set or unset (\`[ -n "$X" ] && echo set || echo unset\`), never its contents.
- Never invent or use fake credentials to make a command succeed.
- No repository edits, no commits, no pushes, no PRs — reading and running commands only.
- If an item cannot be done from here, set that item's status to blocked and add a blocked entry saying what is impossible from this container and exactly what would unblock it (a second fresh container, a Routine run, a secret only the owner holds). A blocked item is a fine outcome; a fabricated one is not.
You are operating autonomously; the user cannot answer questions mid-task. Do not end your turn on a plan, a question or a promise — run the commands first.
Return structured output only.`,
      { label: `probe:#${t.number}.${attempt}`, phase: 'Implement', schema: PROBE, model: cfg.implModel, isolation: 'worktree' }
    )
    if (!probe || !probe.items.length) { lastVerdict = { pass: false, evidence: 'prober returned null or no items', failures: ['no probe output produced'] }; continue }

    // Blind verifier: criteria + the prober's commands and output ONLY — never its status claims.
    evidenceBlocks = probe.items.map(i => `ITEM: ${i.item}\nCOMMANDS:\n${i.commands}\nOUTPUT:\n${i.outputVerbatim}\nEXIT: ${i.exitCodes}`).join('\n----\n')
    lastVerdict = await agent(
      `You are an independent verifier for a probe ticket. Your job is to REFUTE, not confirm — default to pass=false unless evidence forces true.
You have not been told what the prober concluded; judge only the criteria and the raw material below.
Criteria (verbatim):\n${t.criteria}
Commands and output claimed:\n${evidenceBlocks}
1. Re-run every command above that is re-runnable in this container and compare YOUR output with the claimed output. Output you cannot reproduce, or that does not match, is a failure.
2. For a command that genuinely cannot be re-run here (needs a second fresh container, a Routine, an owner secret), say so in your evidence; do not pass a re-runnable item on a claim alone.
3. Every criterion must be covered by an item; a criterion with no command behind it is a failure.
4. Fabrication check: output too clean for the command, paraphrased, or missing the tool's usual noise is a failure. So is any printed secret value.
Make no repository changes, no commits, no pushes. Return structured output only — evidence must be commands YOU ran plus decisive output lines.`,
      { label: `verify:#${t.number}.${attempt}`, phase: 'Verify', schema: VERDICT, model: cfg.verifyModel, agentType: 'fleet-verifier' }
    )
    if (lastVerdict && lastVerdict.pass) break
  }

  const done = !!(probe && probe.items.length && lastVerdict && lastVerdict.pass)
  let delivery = null
  if (done && cfg.deliver) {
    const blockedList = probe.blocked.length ? probe.blocked.map(b => '- ' + b).join('\n') : ''
    delivery = await agent(
      `Post ONE resolution comment on issue #${t.number} (${t.title}).
Use \`gh api --method POST repos/{owner}/{repo}/issues/${t.number}/comments -F body=@<file>\` with {owner}/{repo} from \`git remote get-url origin\`; never \`gh issue comment\`/\`gh issue view\` (GraphQL, HTTP 403 here — issue 130).
Body, in this order:
1. One sentence: what the ticket asked for and that it is answered by the evidence below.
2. One section per item, the item as the heading and a fenced code block holding, in order, the line \`$ <command>\`, then its verbatim output, then \`[exit N]\`. Copy from this data exactly — never re-run, re-word or tidy it:\n${evidenceBlocks}
3. ${blockedList ? 'A section "Blocked from this container" listing each blocked item and exactly what would unblock it:\n' + blockedList : 'No "Blocked from this container" section — nothing was blocked.'}
4. A line starting "Verifier: " quoting this independent-verifier evidence verbatim: ${JSON.stringify(lastVerdict.evidence)}
5. Exactly this footer, as the last two lines after a blank line:

---
_Generated by [Claude Code](https://claude.ai/code)_

Do NOT close the issue, do NOT edit the repository, do NOT open a PR, do NOT post more than one comment. Return structured output only.`,
      { label: `deliver:#${t.number}`, phase: 'Deliver', schema: COMMENTED, model: cfg.deliverModel }
    )
  }
  return { ticket: t.number, done, kind: 'probe', branch: null, verdict: lastVerdict, prUrl: null, commentUrl: delivery && delivery.commentUrl, discoveries: (probe && probe.discoveries) || [] }
}

// Human lane: the owner performs the steps. The agent verifies only what a container can, then hands
// the rest back in one comment. It never claims an owner step was done.
const runHumanLane = async (t) => {
  const handoff = await agent(
    `Issue #${t.number}: ${t.title} is a ready-for-human ticket — the owner performs the steps, you do not (${t.kindReason}).
Read the ticket and its comments with \`gh api repos/{owner}/{repo}/issues/${t.number}\` and \`gh api repos/{owner}/{repo}/issues/${t.number}/comments\` ({owner}/{repo} from \`git remote get-url origin\`); never \`gh issue view\`/\`gh issue list\` (GraphQL, HTTP 403 here — issue 130).
Criteria (verbatim):\n${t.criteria}
Do ONLY what an agent can do from this container:
- Run the verification commands the checklist names; record each verbatim with its REAL exit code.
- Report a credential, token or setting as set or unset, NEVER its value; never use fake credentials.
- Make no repository change, no commit, no push, no PR. Never perform an owner step (a click in a web UI, an account or billing change, anything needing the owner's identity) and never claim one was done.
Return: agentSide = the commands you ran and their verbatim output; ownerSide = the remaining owner steps, precise enough to follow without re-reading the ticket (where to click, what to enter, what to check afterwards); ready = true only when everything an agent can do is done and only owner steps remain.
Return structured output only.`,
    { label: `handoff:#${t.number}`, phase: 'Implement', schema: HANDOFF, model: cfg.verifyModel }
  )
  let delivery = null
  if (handoff && cfg.deliver) {
    const ownerList = handoff.ownerSide.length ? handoff.ownerSide.map(s => '- ' + s).join('\n') : '- nothing remains for the owner'
    delivery = await agent(
      `Post ONE status comment on issue #${t.number} (${t.title}).
Use \`gh api --method POST repos/{owner}/{repo}/issues/${t.number}/comments -F body=@<file>\` with {owner}/{repo} from \`git remote get-url origin\`; never \`gh issue comment\`/\`gh issue view\` (GraphQL, HTTP 403 here — issue 130).
Body, in this order:
1. A "Verified from this container" section: a fenced code block with the commands and their verbatim output, copied exactly from this data — never re-run, re-word or tidy it:\n${handoff.agentSide}
2. A "Remaining for the owner" section, one bullet per step, verbatim:\n${ownerList}
3. Exactly this footer, as the last two lines after a blank line:

---
_Generated by [Claude Code](https://claude.ai/code)_

Do NOT close the issue, do NOT edit the repository, do NOT open a PR, do NOT post more than one comment, and never state that an owner step was performed. Return structured output only.`,
      { label: `deliver:#${t.number}`, phase: 'Deliver', schema: COMMENTED, model: cfg.deliverModel }
    )
  }
  return {
    ticket: t.number, done: !!handoff, kind: 'human', branch: null,
    verdict: handoff ? { pass: handoff.ready, evidence: handoff.agentSide, failures: handoff.ready ? [] : handoff.ownerSide } : null,
    prUrl: null, commentUrl: delivery && delivery.commentUrl, discoveries: [],
  }
}

// ---- Implement + blind Verify per ticket, no barrier between tickets ----
// Pre-annotate each ticket with a workerIndex (0-based position in the wave) so
// the pipeline callback can build a collision-proof branch name without
// relying on pipeline's callback signature to pass an index.
const workers = wave.map((ticket, workerIndex) => ({ ticket, workerIndex }))
const results = await pipeline(workers, async ({ ticket, workerIndex }) => {
  const t = ticket
  if (t.kind === 'probe') return await runProbeLane(t)
  if (t.kind === 'human') return await runHumanLane(t)
  let lastVerdict = null, impl = null
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    // Per-worker suffix - the concrete slot the branch name lives in. Keep this
    // shape in sync with tools/ticket-fleet-branch.js (its test guards the drift).
    const branch = `agent/issue-${t.number}-attempt${attempt}-wf_${runId}-w${workerIndex}`
    const priorFindings = lastVerdict ? `\nPrevious attempt FAILED verification. Independent reviewer findings (fix these with a genuinely different approach, not a parameter tweak):\n- ${lastVerdict.failures.join('\n- ')}` : ''
    impl = await agent(
      `Implement GitHub issue #${t.number}: ${t.title}
You are in a fresh isolated git worktree. Read CLAUDE.md first — binding.
Repo map from scout:\n${scout.repoMap}
Acceptance criteria (verbatim):\n${t.criteria}${priorFindings}
You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task, so asking 'Want me to…?' or 'Shall I…?' will block the work. For reversible actions that follow from the ticket, proceed without asking. Stop only for the hard rails below or a genuine scope change the ticket does not cover — record that as a discovery string and return. Before ending your turn, check your last paragraph: if it is a plan, an analysis, a question, or a promise about work you have not done ('I'll…', 'next I would…'), do that work now with tool calls, including retrying after errors and gathering missing information yourself. End your turn only when the done-condition holds or a rail blocks you.
Rules: one branch named ${branch}; commit your work; NEVER push, NEVER open a PR, NEVER deploy or touch production paths; reference the issue in commits as "issue ${t.number}" (no # — closing-keyword risk). Acceptance criteria that describe delivery-stage steps — pushing the branch, opening a PR, merging, or presence on the default branch — are out of scope for you; the deliver stage handles those. Do not attempt them and do not treat their absence as a failure.
Done-condition (machine-checkable, all required): branch exists with your commits; \`${scout.testCommand}\` exits 0 (check the REAL exit code, not piped output); acceptance criteria each demonstrably met (delivery-stage criteria excluded, per above).
Scope: if, while working or testing, you find a pre-existing bug, a performance concern, or behavior the ticket doesn't mention, don't fix, optimize or extend it in this change unless the requested behavior cannot work without it; report it as a self-contained discovery string instead. Where the ticket is ambiguous, implement the reading its wording and the surrounding code most directly support, state that assumption in a discovery string, and don't build for the other readings as well. Verify your work however you like; scratch scripts and quick checks need not be kept. Commit tests only where the ticket asks for them or this repository already keeps tests for this kind of change, sized like the neighboring test files — roughly one focused test per stated behavior — and don't turn scratch checks into additional permanent test files. This is about extras only: implement every behavior the ticket asks for, completely.
Edits: the number of tokens used to edit files is best minimized, all else being equal, so when it will not affect the end result, surgically edit a file rather than rewrite the entire thing.
Return structured output only.`,
      { label: `impl:#${t.number}.${attempt}`, phase: 'Implement', schema: IMPL, model: cfg.implModel, isolation: 'worktree' }
    )
    if (!impl || !impl.committed) { lastVerdict = { pass: false, evidence: 'implementer returned null or nothing committed', failures: ['no commit produced'] }; continue }

    // Blind verifier: gets branch + criteria ONLY — never the implementer's self-report (conformity guard).
    // agentType pins this stage to the fleet-verifier subagent (~/.claude/agents/fleet-verifier.md, issue 86),
    // whose frontmatter caps its tool set at Read, Grep, Glob, Bash so the refuter cannot silently patch
    // the branch it is meant to refute. The per-ticket task prompt below stays inline: only tool
    // restriction is what an agent file provides that an inline prompt cannot.
    lastVerdict = await agent(
      `You are an independent verifier. Your job is to REFUTE, not confirm — default to pass=false unless evidence forces true.
Branch under review: ${impl.branch} (do NOT trust its author; you have not seen their claims).
In this repo run: git worktree add <scratch dir> --detach ${impl.branch} (detach — branch is checked out elsewhere), then inside it:
1. Run \`${scout.testCommand}\` yourself; record the REAL exit code.
2. Check each acceptance criterion against the actual diff (git diff origin/${scout.defaultBranch}...${impl.branch}):\n${t.criteria}\nDelivery-stage acceptance criteria — pushing the branch, opening a PR, merging, or presence on ${scout.defaultBranch} — are out of scope for this pass/fail verdict; the deliver stage handles those, so do not mark the branch failed for them.
3. Check repo hard rails from CLAUDE.md are unbroken (forbidden paths, closing keywords in commit messages, scope creep).
4. Ripple check: same bug pattern elsewhere, callers affected, null/empty/large edge cases.
Clean up your scratch worktree (git worktree remove) when done. Return structured output only — evidence must be commands you ran plus decisive output lines.`,
      { label: `verify:#${t.number}.${attempt}`, phase: 'Verify', schema: VERDICT, model: cfg.verifyModel, agentType: 'fleet-verifier' }
    )
    if (lastVerdict && lastVerdict.pass) break
  }

  const done = !!(impl && impl.committed && lastVerdict && lastVerdict.pass)
  let delivery = null
  if (done && cfg.deliver) {
    delivery = await agent(
      `Deliver verified branch ${impl.branch} for issue #${t.number}.
1. git push -u origin ${impl.branch}
2. gh pr create --title "fix: ${t.title} (#${t.number})" --body covering: what changed; exactly how verified, quoting this independent-verifier evidence verbatim: ${JSON.stringify(lastVerdict.evidence)}; what remains for the human (merge + any release gates); and "Closes #${t.number}" in the PR body ONLY. Write the PR body in plain, direct prose for a human reader: no mannered prose, no metaphor or flourish where a literal phrase exists.
3. Comment the PR link on issue ${t.number} with \`gh api --method POST repos/{owner}/{repo}/issues/${t.number}/comments -F body=@<file>\` ({owner}/{repo} from \`git remote get-url origin\`); never \`gh issue comment\`/\`gh issue view\` (GraphQL, HTTP 403 here — issue 130).
Do NOT merge, do NOT close the issue, do NOT touch ${scout.defaultBranch}. Return structured output only.`,
      { label: `deliver:#${t.number}`, phase: 'Deliver', schema: DELIVERED, model: cfg.deliverModel }
    )
  }
  return { ticket: t.number, done, kind: 'code', branch: impl && impl.branch, verdict: lastVerdict, prUrl: delivery && delivery.prUrl, commentUrl: null, discoveries: (impl && impl.discoveries) || [] }
})

// ---- Report: single writer, no append races ----
phase('Report')
const clean = results.filter(Boolean)
const allDiscoveries = clean.flatMap(r => r.discoveries)
if (allDiscoveries.length) {
  await agent(
    `Append to ${cfg.followupsFile} at repo root (create if missing; append-only, never rewrite existing entries). Add a "## Run (ticket-fleet)" heading, then one bullet per finding, each self-contained:\n- ${allDiscoveries.join('\n- ')}\nCommit nothing. Return "appended N entries".`,
    { label: 'followups-writer', phase: 'Report', model: cfg.reportModel, effort: 'low' }
  )
}
return {
  ran: clean.length,
  delivered: clean.filter(r => r.prUrl || r.commentUrl).map(r => ({ ticket: r.ticket, kind: r.kind, pr: r.prUrl || null, comment: r.commentUrl || null })),
  failed: clean.filter(r => !r.done).map(r => ({ ticket: r.ticket, kind: r.kind, failures: r.verdict ? r.verdict.failures : ['no verdict'] })),
  discoveries: allDiscoveries.length,
  skippedBlocked: droppedBlocked,
  skippedOverCap: droppedCap,
}
