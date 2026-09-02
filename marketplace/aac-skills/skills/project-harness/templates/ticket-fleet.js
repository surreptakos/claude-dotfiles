export const meta = {
  name: 'ticket-fleet',
  description: 'Parallel ticket runner: scout, pinned implementer per ticket, blind refuting verifier, PR on pass, discovery collection',
  whenToUse: 'Drive open ready-for-agent tickets to verified PRs in parallel. args: {label, maxTickets, scoutModel, implModel, verifyModel, deliverModel, reportModel, maxAttempts, deliver, followupsFile}',
  phases: [
    { title: 'Scout', detail: 'list tickets, dependency edges, repo map' },
    { title: 'Implement', detail: 'one pinned agent per ticket, isolated worktree, bounded retries' },
    { title: 'Verify', detail: 'blind reviewer per attempt, prompted to refute' },
    { title: 'Deliver', detail: 'push branch and open PR only on verified pass' },
    { title: 'Report', detail: 'single writer appends discoveries' },
  ],
}

// ---- config (all overridable via args) ----
const cfg = Object.assign({
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
// runner mints a `runId` per invocation and hands each spawned implementer a
// per-worker suffix `wf_<runId>-w<workerN>` (workerN = the ticket's index in
// the wave), embedded in the branch name. Two concurrent scouts against the
// same ticket therefore produce distinct branches. Alternative not used here:
// query-and-increment against
//   gh api repos/<owner>/<repo>/branches --paginate --jq \
//     '.[].name | select(startswith("agent/issue-N-attempt"))'
// then increment - has a race between the query and branch creation.
const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// ---- schemas: crisp machine-checkable done-conditions ----
const SCOUT = { type: 'object', required: ['tickets', 'repoMap', 'testCommand'], properties: {
  tickets: { type: 'array', items: { type: 'object', required: ['number', 'title', 'criteria', 'blockedBy', 'keepOpen'], properties: {
    number: { type: 'integer' }, title: { type: 'string' },
    keepOpen: { type: 'boolean', description: 'true only when the ticket body, its comments or its labels say the issue must stay open after its PR merges (leave open / keep open / ratification); decides Refs vs Closes in the PR body' },
    criteria: { type: 'string', description: 'acceptance criteria, verbatim from issue + comments' },
    blockedBy: { type: 'array', items: { type: 'integer' }, description: 'open blocker issue numbers' },
  } } },
  repoMap: { type: 'string', description: '15-line map: key dirs, test command, conventions, rails' },
  testCommand: { type: 'string' },
} }

const IMPL = { type: 'object', required: ['branch', 'committed', 'testExitCode', 'testTail', 'discoveries'], properties: {
  branch: { type: 'string' }, committed: { type: 'boolean' },
  testExitCode: { type: 'integer', description: 'REAL exit code of test command, not piped' },
  testTail: { type: 'string', description: 'decisive final lines of test output' },
  discoveries: { type: 'array', items: { type: 'string' }, description: 'out-of-scope findings, each self-contained' },
} }

const VERDICT = { type: 'object', required: ['pass', 'evidence', 'failures'], properties: {
  pass: { type: 'boolean' },
  evidence: { type: 'string', description: 'what YOU ran and observed; commands + decisive output lines' },
  failures: { type: 'array', items: { type: 'string' } },
} }

const DELIVERED = { type: 'object', required: ['pushed', 'prUrl'], properties: {
  pushed: { type: 'boolean' }, prUrl: { type: 'string' },
} }

// ---- Scout ----
phase('Scout')
const scout = await agent(
  `Scout this repository for agent-ready tickets. Steps:
1. Read CLAUDE.md and any HANDOFF/CONTEXT docs at repo root.
2. gh issue list --label ${cfg.label} --state open --json number,title (then gh issue view N --comments per ticket — comments carry criteria the body lacks).
3. For each ticket extract acceptance criteria verbatim and any "Blocked by #N" edges; a blocker counts only if that issue is still open. Per ticket set keepOpen to true only when the ticket body, its comments or its labels instruct that the issue stay open after its PR merges ("leave open", "keep open", a ratification ticket, a keep-open label); otherwise false.
4. Identify the exact test command this repo uses (from CLAUDE.md / package.json / docs — never a glob if docs forbid it).
5. Produce a repoMap: max 15 lines — key directories, conventions, hard rails an implementer must not break.
Return structured output only.`,
  { label: 'scout', phase: 'Scout', schema: SCOUT, model: cfg.scoutModel, effort: 'low' }
)
if (!scout || !scout.tickets.length) { log('No eligible tickets found.'); return { ran: 0, results: [], note: 'scout found no open tickets with label ' + cfg.label } }

const eligible = scout.tickets.filter(t => t.blockedBy.length === 0)
const wave = eligible.slice(0, cfg.maxTickets)
const droppedBlocked = scout.tickets.length - eligible.length
const droppedCap = eligible.length - wave.length
if (droppedBlocked) log(`${droppedBlocked} ticket(s) skipped: open blockers.`)
if (droppedCap) log(`${droppedCap} eligible ticket(s) beyond maxTickets=${cfg.maxTickets} cap — run again for the rest.`)
log(`Wave: ${wave.map(t => '#' + t.number).join(', ')}`)

// ---- Implement + blind Verify per ticket, no barrier between tickets ----
// Pre-annotate each ticket with a workerIndex (0-based position in the wave) so
// the pipeline callback can build a collision-proof branch name without
// relying on pipeline's callback signature to pass an index.
const workers = wave.map((ticket, workerIndex) => ({ ticket, workerIndex }))
const results = await pipeline(workers, async ({ ticket, workerIndex }) => {
  const t = ticket
  let lastVerdict = null, impl = null
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    // Per-worker suffix - the concrete slot the branch name lives in.
    const branch = `agent/issue-${t.number}-attempt${attempt}-wf_${runId}-w${workerIndex}`
    const priorFindings = lastVerdict ? `\nPrevious attempt FAILED verification. Independent reviewer findings (fix these with a genuinely different approach, not a parameter tweak):\n- ${lastVerdict.failures.join('\n- ')}` : ''
    impl = await agent(
      `Implement GitHub issue #${t.number}: ${t.title}
You are in a fresh isolated git worktree. Read CLAUDE.md first — binding.
Repo map from scout:\n${scout.repoMap}
Acceptance criteria (verbatim):\n${t.criteria}${priorFindings}
Rules: one branch named ${branch}; commit your work; NEVER push, NEVER open a PR, NEVER deploy or touch production paths; reference the issue in commits as "issue ${t.number}" (no # — closing-keyword risk).
Done-condition (machine-checkable, all required): branch exists with your commits; \`${scout.testCommand}\` exits 0 (check the REAL exit code, not piped output); acceptance criteria each demonstrably met.
Log any out-of-scope findings as self-contained discovery strings — do not fix them, do not widen the diff.
Return structured output only.`,
      { label: `impl:#${t.number}.${attempt}`, phase: 'Implement', schema: IMPL, model: cfg.implModel, isolation: 'worktree' }
    )
    if (!impl || !impl.committed) { lastVerdict = { pass: false, evidence: 'implementer returned null or nothing committed', failures: ['no commit produced'] }; continue }

    // Blind verifier: gets branch + criteria ONLY — never the implementer's self-report (conformity guard).
    lastVerdict = await agent(
      `You are an independent verifier. Your job is to REFUTE, not confirm — default to pass=false unless evidence forces true.
Branch under review: ${impl.branch} (do NOT trust its author; you have not seen their claims).
In this repo run: git worktree add <scratch dir> --detach ${impl.branch} (detach — branch is checked out elsewhere), then inside it:
1. Run \`${scout.testCommand}\` yourself; record the REAL exit code.
2. Check each acceptance criterion against the actual diff (git diff origin/main...${impl.branch}):\n${t.criteria}
3. Check repo hard rails from CLAUDE.md are unbroken (forbidden paths, closing keywords in commit messages, scope creep).
4. Ripple check: same bug pattern elsewhere, callers affected, null/empty/large edge cases.
Clean up your scratch worktree (git worktree remove) when done. Return structured output only — evidence must be commands you ran plus decisive output lines.`,
      { label: `verify:#${t.number}.${attempt}`, phase: 'Verify', schema: VERDICT, model: cfg.verifyModel }
    )
    if (lastVerdict && lastVerdict.pass) break
  }

  const done = !!(impl && impl.committed && lastVerdict && lastVerdict.pass)
  let delivery = null
  if (done && cfg.deliver) {
    // The ticket decides the closing keyword, not the template (claude-dotfiles issue 72). A ratification
    // ticket says "leave open"; GitHub acts on Closes #N at merge time whatever the commit messages say.
    const keepOpen = t.keepOpen === true || /\b(?:leave|keep|stay|remain)s?\s+(?:this\s+|the\s+|it\s+)?(?:ticket\s+|issue\s+)?open\b/i.test(t.criteria || '')
    const issueRef = keepOpen
      ? `"Refs #${t.number}" (this ticket stays OPEN by its own instruction; never write Closes, Fixes or Resolves)`
      : `"Closes #${t.number}"`
    const keepOpenNote = keepOpen ? ' and the sentence "Ticket left open per its own instruction; this PR does not close it."' : ''
    delivery = await agent(
      `Deliver verified branch ${impl.branch} for issue #${t.number}.
1. git push -u origin ${impl.branch}
2. gh pr create --title "fix: ${t.title} (#${t.number})" --body covering: what changed; exactly how verified, quoting this independent-verifier evidence verbatim: ${JSON.stringify(lastVerdict.evidence)}; what remains for the human (merge + any release gates); and ${issueRef} in the PR body ONLY.
3. gh issue comment ${t.number} --body with the PR link${keepOpenNote}.
Do NOT merge, do NOT close the issue, do NOT touch main. Return structured output only.`,
      { label: `deliver:#${t.number}`, phase: 'Deliver', schema: DELIVERED, model: cfg.deliverModel }
    )
  }
  return { ticket: t.number, done, branch: impl && impl.branch, verdict: lastVerdict, prUrl: delivery && delivery.prUrl, discoveries: (impl && impl.discoveries) || [] }
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
  delivered: clean.filter(r => r.prUrl).map(r => ({ ticket: r.ticket, pr: r.prUrl })),
  failed: clean.filter(r => !r.done).map(r => ({ ticket: r.ticket, failures: r.verdict ? r.verdict.failures : ['no verdict'] })),
  discoveries: allDiscoveries.length,
  skippedBlocked: droppedBlocked,
  skippedOverCap: droppedCap,
}
