# Master orchestrator runbook (cloud, per-repo Routine)

The master orchestrator runs as four hourly Routines Dan created in the claude.ai Routines UI —
one per repo, each with that repo as source and the connectors ticked. Every Routine wake is a
FRESH cloud session. It boots from the repo's per-repo state issue, claims the venue, dispatches
triage / to-tickets / fleet in-session, does the merge pass, writes `Pass complete`, and ends.
Continuity lives in the state issue; nothing else outlives the run. Rewritten 2026-09-15 for the
per-repo Routine model (issue 217, parent #207); the retired PC-venue variant lives on in
`LOCAL-RUNBOOK.md` for history.

**Venue:** this file describes the CLOUD Routine masters, the only supported venue after cutover.
One venue per repo — a Routine that finds a live `cloud-routine` venue younger than 90 minutes on
its own state issue exits at boot without dispatching anything.

Repo priority (source of truth): the Routines themselves. Dan created one Routine per repo with
that repo ticked as source and the connectors it needs. There is no cross-repo scheduling here;
each Routine serves its own repo independently.

## Roles

- **Routine** — a claude.ai Routine Dan created in the Routines UI. Hourly, one per repo, with
  that repo as source and the connectors it needs. It is the clock and the launcher.
- **Session** — a fresh cloud session spawned by each Routine wake. Boots from the per-repo state
  issue, dispatches everything in-session, ends the turn on `Pass complete`. No session outlives
  one wake; continuity lives in the state issue.
- **Fleet** — the plugin-served `aac-skills/ticket-fleet/ticket-fleet.js`, copied into the repo as
  `.claude/workflows/ticket-fleet.js` and invoked in-session via the Workflow tool with
  `scriptPath = .claude/workflows/ticket-fleet.js`. A `${CLAUDE_PLUGIN_ROOT}` path is refused in a
  cloud container — the Workflow tool reads only a path under the working directory (issue 233).
  One script for local and cloud; it picks between the `gh` CLI and the connector tools at run
  time. Same scout / pinned implementer / blind refuting verifier / deliver shape.

## Boot

**First, check you were bootstrapped at all.** A Routine-fired session only reaches
`.claude/hooks/session-start.sh` when the Routine carries a source repo. One created from inside a
session carries none (`mcp__Claude_Code_Remote__create_trigger` has no `sources` field), and the
home-anchored seat at `~/.claude/hooks/aac-bootstrap.sh` is written *by* that hook — so in a fresh
container neither exists and nothing installs the payload. Measured 2026-09-22 on a Routine fired
for the purpose: no skills, no governance hooks, no rules text, no `~/.claude/settings.json`, and
`~/.claude/hooks` absent entirely (claude-dotfiles issue 649).

`ls ~/.claude/skills/session-check/check.js` answers it. If it is missing, self-heal before
anything else — the repo is public, so this needs no credential:

```bash
curl -fsSL https://raw.githubusercontent.com/surreptakos/claude-dotfiles/master/.claude/hooks/session-start.sh -o /tmp/aac-bootstrap.sh && bash /tmp/aac-bootstrap.sh
```

It installs the payload, the skills, the merged governance hooks and the home-anchored seat, and it
runs with no project directory. Verified from a bare `HOME`: 54 skills and
`payload matches dotfiles master`. The seat it leaves makes every later session in that container
bootstrap on its own.

Then, before anything else:

1. Read the per-repo state issue in `surreptakos/claude-dotfiles` — bill-intake #74,
   contract-builder #75, sales-cockpit #76, zoho-source-of-truth #77. Issue #44 is the shared
   registry (config defaults, the table of per-repo state issues) — read-only from here.
2. Read any Dan comments on the state issue posted since the last `Pass complete` line.
   Comments override everything else in this file.
3. Then run the guard (below). Do not dispatch anything until both guards have passed.

**Cross-repo reference rule.** The state issue lives in claude-dotfiles, so a bare `#N` in its
body points to a claude-dotfiles issue and reads to `tools/tracker-audit.js` as a
`dangling-reference` when the intent was another repo. Every reference to work in the served repo
— issues, PRs, heartbeat citations — is written `owner/repo#N`, never bare `#N`. Writing refs
right the first time is the master's job; `.github/workflows/repair-state-refs.yml` sweeps behind
as a backstop on issue-edit events, not a substitute.

## Guard

Two guards, both applied at boot before any dispatch.

### Venue guard

Read the state issue's `venue` field.

- `venue` is empty or `venueAt` is older than 90 minutes → claim it: rewrite the JSON block with
  `"venue": "cloud-routine"`, `"venueSessionId": <this session's id>`, `"venueAt": <UTC now>`,
  post the update, then continue.
- `venue` is `cloud-routine` with a `venueAt` within the last 90 minutes → another Routine wake
  is already serving this repo. Exit without dispatching anything and without overwriting the
  venue. The other wake will clear it at pass complete.
- `venue` is any legacy value (a stale `local-pc` from before cutover) → treat as stale, claim it
  as above, continue.

The 90-minute window is deliberately longer than a normal pass so a live run is not stolen from
itself; a stale value only survives if a run crashed mid-pass.

### Empty-pass skip

Read the state issue's `lastPassOutcome` field.

- `lastPassOutcome` is not `empty` → skip does not fire; continue.
- `lastPassOutcome` is `empty` → this pass may exit at boot. Continue only if at least one holds:
  - The repo has newer issue, PR or comment activity since `lastPassAt`.
  - The decision brief issue has a new comment since `lastPassAt`.
  - The UTC date has changed since `lastPassAt` AND that pass was cap-limited
    (`lastPassOutcome` starts with `cap-`; see the outcome slugs under Pass complete). This
    branch fires when a cap-limited pass has aged out, not on an ordinary `empty` outcome.
  - Twelve hours have elapsed since `lastPassAt`.

  Otherwise clear the venue back (rewrite the JSON with `venue: null`) and end the turn without
  dispatch. An empty run then costs one state-issue read plus one state-issue write.

## Skip

The empty-pass skip in the guard section is the only skip that happens at boot. The fleet carries
its own layer: the scout returning zero eligible `ready-for-agent` tickets exits the fleet before
any implementer starts, so an empty pass that reaches dispatch still costs nothing beyond the
scout. The Routines UI's pause switch is the kill switch for everything else.

## Two repos, one session

The served repo arrives as the Routine's source. `claude-dotfiles` arrives twice over, and neither
copy is a source:

- **This runbook** comes from the shallow clone the SessionStart bootstrap hook makes at
  `$HOME/.aac-dotfiles`, whole-repo, from master. Reading it needs no attachment; the cloud proxy
  clones a public repo the session never attached (issue 614).
- **The state issue** is a GitHub write, and that is the part attachment governs. Every REST call
  whose target repo is not attached to the session answers HTTP 403 `not enabled for this session`
  (`docs/agents/issue-tracker.md`). A master that cannot write `surreptakos/claude-dotfiles#<N>`
  cannot clear the venue or leave a `Pass complete` line, which is the whole record of the pass.

**So the Routine carries `surreptakos/claude-dotfiles` as a second source** wherever the Routines
UI accepts more than one. Where it does not, the master's first act is to attach it with the
repo-attach tool, before the boot reads — and that attach is classifier-gated, so a refusal there
ends the pass with a comment rather than silently skipping the record.

## Dispatch

Everything runs in-session from the Routine's fresh session. The session already has the repo
checkout (source), the project hooks, `gh`, the aac-skills plugin payload (installed by the
SessionStart bootstrap hook), and the connectors Dan ticked on the Routine.

In this order:

1. **Harness check.** If the repo lacks the tracker vocabulary (`ready-for-agent` /
   `ready-for-human` labels, `docs/agents/issue-tracker.md`), run `/project-harness` from the
   plugin and set `harnessInstalled` in the state issue.
2. **Triage and to-tickets, in the background.** Spawn `/triage` and `/to-tickets` as background
   subagents through the Agent tool with `run_in_background: true`. Do not wait; move on. Collect
   their results when the completion notifications arrive.
3. **Merge pass (before the fleet).** Run the merge policy below over the repo's open fleet PRs
   (`agent/issue-*` **and** `agent/fleet-discoveries-*` branches — both shapes the fleet creates;
   a pass that matches only `agent/issue-*` skips the discoveries PR and strands the run's
   bullets, issue 377), in this same session.
4. **Fleet.** After the triage / to-tickets subagents have returned (the fleet's scout reads the
   labels they produce), invoke the Workflow tool with
   `scriptPath = .claude/workflows/ticket-fleet.js` — copy it there first with `mkdir -p
   .claude/workflows && cp "${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/ticket-fleet.js"
   .claude/workflows/ticket-fleet.js` — and `args` from the
   state issue's `config.fleetArgs`, plus the three contract args: `contractVersion: 2`, a `runId`
   minted inline (`printf %x $(date +%s)`) and an `invocationId` minted fresh on every launch,
   resume included (`printf %x%x $(date +%s) $$`), never equal to the `runId`. The workflow runtime
   forbids `Date.now()` and `Math.random()` in scripts, so the caller mints both ids; a launch that
   omits any of the three is refused with a contract-mismatch error naming the version on both
   sides (the ripple table is in the ticket-fleet SKILL.md). Resuming a run (`resumeFromRunId`)
   keeps the same `runId` - the branch names embed it - and takes a NEW `invocationId`, which is
   what makes the open-PR guard re-ask the tracker instead of replaying the cached "no PR" it
   recorded before the PRs existed. A cloud session needs no `instrument` or `verifierAgent`
   argument: the fleet's env probe measures the session and runs its verifiers unpinned there,
   because custom agent types are desktop-only (issue 339). When the fleet returns, run the merge pass once more over
   the PRs it just opened.

   **A wave that died mid-delivery is finished, not re-run.** Every implementer pushes its branch
   as soon as it commits (issue 405), so a run that lost its container, its Deliver step or its
   turn to an interrupt still has its verified branches on origin. Launch the fleet again with
   `finishRunId` set to the dead run's id — the `wf_...` workflow id its journal directory carries,
   or the `runId` its branch names embed — plus the three contract args, and nothing else:

   ```
   Workflow({ scriptPath: '.claude/workflows/ticket-fleet.js',
              args: { contractVersion: 2, runId: '<hex>', invocationId: '<fresh hex>',
                      finishRunId: '<the dead run id>' } })
   ```

   That pass reads the dead run's journal and does delivery only: a PR for every branch the journal
   records as verified and undelivered, a skip naming the PR for every ticket it already delivered,
   nothing at all for a ticket no verifier passed, then the report writer over that run's
   discoveries. It starts no scout, no implementer and no verifier, and the deliverer is told to
   reuse an existing open PR for the branch, so repeating the pass is safe. It must run in the same
   container as the dead run — the journal is machine-local. Where that container is gone, fall back
   to the recorded run digest and a normal run with `priorImpl`.

   **Record the wave before doing anything else with it.** The moment the Workflow returns, run
   `node tools/fleet-run-record.js --latest` in the served repo, in THIS session's own shell —
   never through a subagent, which would re-derive the run from its own context instead of reading
   the journal. The harness journal the record distils is machine-local and dies with the
   container, so a wave that is not recorded before the pass ends is unrecoverable. The fleet logs
   the same reminder on its way out (aac-routines issue 269). Repos that gitignore `state/` keep
   nothing on disk either: there, post the record's digest as a comment on that repo's tracking
   issue, written `owner/repo#N`, so the run survives the container. A repo without
   `tools/fleet-run-record.js` has nothing to run — say so in the heartbeat and move on.
5. **Heartbeat.** After each step, rewrite the state issue's JSON block with the new state and
   append a `**Heartbeat N — <UTC>**` line to the heartbeat section. Ground truth is the tracker
   and PR list — never a subagent self-report.

## Merge

Merges go through the connector merge tool (the one whose suffix is `merge_pull_request`) — the
proxy exposes it under whatever product prefix the session was booted with, so match on the
suffix and never hard-code the prefix. Never `gh pr merge` and never a branch delete: the proxy
refuses ref deletes in every mode, and `delete_branch_on_merge` is on for every fleeted repo, so
merged branches clean themselves.

Merge a fleet PR when ALL hold:

- The PR body carries the blind verifier's pass evidence.
- CI on the head is green, or the repo has no CI workflow at all.
- No merge conflict.
- No human has requested changes.

Method: the repo's documented convention, else squash. After merge, act on the ticket by what the
PR body says:

- `Closes #N` — confirm the ticket closed; close it manually citing the PR if GitHub did not.
- `Refs #N` with a keep-open note — the deliver stage writes this when the ticket must stay open
  (a ratification ticket). Do NOT close the ticket. Relabel it `ready-for-human` (remove
  `ready-for-agent`) so the next scout does not re-implement it and the grill phase surfaces it.

A PR that fails the bar stays open and is the next pass's first work item.

**The discoveries PR.** The fleet's Report phase opens one PR per run from
`agent/fleet-discoveries-wf_<runId>`, carrying only the run's `FOLLOW-UPS.md` bullets (issue 360).
It has no ticket and therefore no verifier evidence, so the first bullet above does not apply to
it; merge it when CI is green (or absent), there is no conflict, and no human has requested
changes. Merge it in the same pass that opened it — bullets stranded on an unmerged branch are the
bug that ticket fixed. The fleet returns `discoveryReport` (`{ branch, sha, prUrl, bullets }`);
any triage chore filed for the bullets names that sha and branch in its body, so the triage agent
can `git show` them whether or not the PR has merged yet.

**CI exists but never ran on this head.** A repo that has a CI workflow and a PR head with zero
check runs satisfies neither "green" nor "no CI". Such a PR is NOT mergeable. Re-fire path, in
order of preference: close and reopen the PR through the issue-write tool (a `pull_request`
workflow fires on `reopened`), or a fresh push to the branch. The merge pass is allowed to
close-and-reopen on its own — it changes no code and no ticket — and records it in the state
issue with the PR number and time. Then wait: the PR is re-assessed on the next Routine wake, not
polled.

## Pass complete

When triage, to-tickets, the fleet and the merge pass have all completed for this wake (or a cap
has stopped further work):

1. Rewrite the state issue's JSON block:
   - `venue`, `venueSessionId`, `venueAt` → all null (clear the venue claim).
   - `lastPassOutcome` → one of the outcome slugs (list below).
   - `lastPassAt` → UTC now.
   - `lastCycle` → same shape it has today, updated.
2. Append a `**Pass complete — YYYY-MM-DD HH:MM UTC**` line at the top of the heartbeat section
   of the state issue body.
3. Say `pass complete` in the session and end the turn.

Outcome slugs for `lastPassOutcome`:

- `success` — one or more merges, or triage / to-tickets produced tracker changes.
- `empty` — nothing actionable; guards the next wake via the empty-pass skip.
- `cap-daily` — the daily wave cap stopped this pass.
- `cap-weekly` — the shared weekly pool warning tripped and the pass ended early.
- `stalled-<short-reason>` — a subagent hung or a Workflow refused; the reason is one hyphenated
  slug.
- `blocked-<short-reason>` — a rail conflict; the ticket that hit it is `ready-for-human` and
  named in the heartbeat.

The Routine's next hourly wake starts a fresh session that reads this state and decides whether to
run or skip via the empty-pass guard. Do not schedule anything — the Routine is the clock.

## Grill phase

When every open ticket across the four repos is either closed or `ready-for-human`, the master
enters the grill phase. Follow `grill-ready-for-human` from the plugin one ticket at a time — no
batch rulings — with the master grilling itself first. Per ticket:

1. Reconstruct the ruling the ticket actually waits on.
2. Hunt evidence: the repo's code, ADRs, MEMORY.md, tracker history, linked PRs.
3. **Determinable from evidence** (the answer is a fact, not a preference) → land the ruling as a
   tracker comment (AI disclaimer prefix), relabel per the skill, done.
4. **Preference-shaped** (risk appetite, money, staffing, product taste) → NEVER self-rule. Add
   to the brief: the question, the context a ruling needs, the master's recommendation and why.

Post the brief as one GitHub issue in claude-dotfiles with BOTH the `orchestrator` label AND the
`ready-for-human` label; title `Decision brief <date>`. Self-answered rulings first as FYI with
links, then the open decisions each as a checklist item. Plain, direct prose for Dan to read: no
metaphor or flourish where a literal phrase exists; one short paragraph per open decision. Dan
ratifies by commenting on the brief; each ruling lands on its ticket before the next pass.

Rewriting the state body on a heartbeat, keep the `owner/repo#N` rule holding and leave
`ready-for-human` off the state issue itself (it is a living notebook, not a pending ruling).
Only the decision brief carries both labels.

## State

Lives in per-repo GitHub issues in `surreptakos/claude-dotfiles`. Issue #44 is the shared registry
(defaults, the table of per-repo state issues). Each repo has its own issue titled **"Master
orchestrator state — <owner/repo>"** (label `orchestrator` only — no `ready-for-human`). A Routine
writes only its own repo's state issue — never #44 and never a peer's — so wakes from several
Routines cannot overwrite each other.

The body carries a JSON block plus a `## Heartbeat` section (heartbeat lines and Pass complete
markers). The JSON block shape:

```json
{
  "repo": "<owner/repo>",
  "venue": null,
  "venueSessionId": null,
  "venueAt": null,
  "phase": "DEV | GRILL | AWAIT_RATIFY",
  "harnessInstalled": true,
  "wavesToday": 0,
  "wavesDate": "2026-09-15",
  "lastCycle": { "at": null, "outcome": null },
  "lastPassOutcome": null,
  "lastPassAt": null,
  "drained": false,
  "decisionBriefIssue": null,
  "config": {
    "maxWavesPerRepoPerDay": 6,
    "fleetArgs": { "maxTickets": 3, "maxAttempts": 3, "verifierAgent": "" }
  }
}
```

- `venue`, `venueSessionId`, `venueAt` — the venue guard reads and writes these.
- `lastPassOutcome`, `lastPassAt` — the empty-pass guard reads these; Pass complete writes them.
- `wavesToday`, `wavesDate`, `config` — the caps. Dan hand-edits `config` when he wants to change
  a cap; the Routine re-reads it every wake.

Dan can edit the config block in the issue at any time; the next wake picks it up. The state
issue is the only memory that must survive between wakes — a fresh session reads it and rebuilds
from it.

## Caps

- `maxWavesPerRepoPerDay` (default 6). A pass that hits it writes `lastPassOutcome: "cap-daily"`
  and ends. Because a `cap-` outcome forces a run only on a UTC date change, hourly wakes on the
  same date exit via the empty-pass guard and the cap holds until midnight UTC.
- Weekly limit. Watched through heartbeats and the running total of pass outcomes; there is no
  in-file kill switch. When the shared weekly pool is near exhaustion, Dan pauses the Routine in
  the Routines UI. Four hourly masters should not exhaust the daily pool on their own if
  `maxWavesPerRepoPerDay` is respected.

## Boot prompt (what every Routine wake carries)

> You are the master orchestrator, cloud Routine variant, serving `<owner/repo>`. This session was
> launched by a Routine into a fresh container with the repo checkout as source. Read
> `orchestrator/RUNBOOK.md` in the claude-dotfiles clone the bootstrap hook installed, and follow
> it — binding. Your state issue is `surreptakos/claude-dotfiles#<N>`; issue #44 there is the
> shared registry — read it, never write to it or to another repo's state issue. Every reference
> to work in `<owner/repo>` is written `owner/repo#N`, never bare `#N`. Apply the venue guard and
> the empty-pass skip before dispatching anything. When the pass is done, clear the venue, write
> `**Pass complete — YYYY-MM-DD HH:MM UTC**` at the top of your state issue's heartbeat section,
> say `pass complete`, and end the turn. My comments on the state issue override everything here.

## Naming tools in a prompt

MCP tool names are not stable within a session. On a fresh cloud session's **first turn** every MCP
server is mounted under a UUID prefix — `mcp__<uuid>__create_session`, and the connectors likewise;
the product-named prefixes (`mcp__Claude_Code_Remote__*`, `mcp__Microsoft_365__*`) only appear on
later turns. `mcp__github__*` is the exception and is stable throughout (issue 166, container C,
item 10). A prompt that names a tool by its product prefix therefore works when a human tries it
interactively and fails on the first turn of the session it was written for — which is every wake
this runbook dispatches. Name tools by suffix or by capability ("the session-create tool", "the
issue-write tool") in every boot prompt, dispatch brief and skill this runbook writes.

## Rails

- Ground truth over self-reports: verify every subagent claim against the tracker and PR state
  before writing state.
- Cross-repo references are always `owner/repo#N`, never bare `#N` inside a claude-dotfiles state
  issue.
- Connector tools are referred to by suffix (the merge tool, the issue-write tool, the search
  tool), never by a product-name prefix. Prefixes rename between sessions and a hard-coded one
  will break a skill.
- Never fleet a repo not served by its own Routine; never touch `aac-sales-commissions`,
  `aac-message-board`, `aac-task-management`, `aac-routines` without a new ruling from Dan.
- Apps Script deploys stay on their existing path: every AAC script deploys itself from GitHub on
  a merge to its default branch (claude-dotfiles `gas/`). Never move a `deploy/*` ref, never run
  clasp, never touch production data paths.
- Respect repo CLAUDE.md rails absolutely; a rail conflict parks the ticket `ready-for-human`
  instead of bending the rail.
- Never delete a branch (the proxy refuses ref deletes; `delete_branch_on_merge` handles cleanup).
- Never call `AskUserQuestion`; nobody is at the keyboard. Anything needing Dan becomes a
  `ready-for-human` ticket with the evidence in its body, the heartbeat names it, and the pass
  continues.
- Cost: the per-day wave cap is hard. When it is hit, the state issue records `cap-daily` and the
  Routine waits for tomorrow — or for Dan to raise the cap in the config block.
- Everything Dan must act on goes in the decision brief or on the state issue in plain language —
  never only in a session transcript (he will not read those).
