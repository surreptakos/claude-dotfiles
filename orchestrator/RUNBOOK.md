# Master orchestrator runbook

The babysitter and decision maker. One persistent cloud session (the **master**) drives the
prioritized repos through the dev loop continuously, spawning one disposable **worker** session per
repo cycle, until no agent-ready work remains anywhere — then it grills the `ready-for-human` queue,
answers what the evidence lets it answer, and puts the rest to Dan as one decision brief. After Dan
ratifies, it goes back to the dev loop. Commissioned 2026-09-01 in the apps-script-head-sync
session; this file is the master's binding instructions — the boot prompt just points here.

**Venue:** this file describes the CLOUD master. `LOCAL-RUNBOOK.md` is the PC variant of the same
orchestrator. One master per repo (Dan, 2026-09-02 — replaces "exactly one master anywhere"): each
target repo has its own state issue whose `"venue"` field records which venue serves that repo, and
a master must verify no other venue is active for its repo before booting. Two masters on one repo
is the double-run that exhausted the weekly limit on 2026-09-01; several masters on several repos is
the intended shape.

## Roles

- **Master** — a Claude Code cloud session, woken hourly by a Routine bound to it. Never implements
  tickets itself. It reads state, decides which repo gets the next cycle, spawns the worker, checks
  the previous worker's results against ground truth (the tracker and PRs, not the worker's
  self-report), advances the phase machine, updates the state issue.
- **Worker** — a fresh cloud session created per cycle with `create_session(source_url = the repo)`.
  Runs one full cycle from `orchestrator/worker-cycle.md` and is archived afterward. Workers are
  disposable by design: context can never grow unbounded because no worker outlives one cycle;
  continuity lives in the repo (tracker, MEMORY.md, session harness), never in a worker's window.
- **Fleet** — the plugin-served `aac-skills/ticket-fleet/ticket-fleet.js`, run by the worker
  via the Workflow tool with `scriptPath = ${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/ticket-fleet.js`.
  One script for local and cloud sessions: it picks between the `gh` CLI and the GitHub MCP
  tools at run time (a container sets `CLAUDE_CODE_REMOTE_SESSION_ID`, or has no `gh` on PATH).
  Same scout / pinned implementer / blind refuting verifier / deliver shape.

## Repo priority (Dan, 2026-09-01)

1. `surreptakos/aac-bill-intake`
2. `surreptakos/aac-contract-builder`
3. `surreptakos/aac-sales-cockpit`
4. `surreptakos/zoho-source-of-truth`

Depth-first: each heartbeat serves the highest-priority repo that has actionable work (untriaged
issues, eligible `ready-for-agent` tickets, or unmerged fleet PRs). A repo with nothing actionable
yields to the next. All fleet blocks are lifted (Dan, 2026-09-01 — including the bill-intake block
from the 2026-08-26 owner review; its concerns live on as ordinary tickets).

## State

Lives in GitHub issues in `surreptakos/claude-dotfiles`. Issue #44 ("Master orchestrator state") is
the registry: the shared config defaults, the table of per-repo state issues, and the run history
from before the split. Each repo has its own issue titled **"Master orchestrator state — <owner/repo>"**
(label `orchestrator` only — no `ready-for-human`; create on first boot if missing and add it to
the registry). A master rewrites only its own repo's issue — never #44 and never a peer's — so
heartbeats from several masters cannot overwrite each other. The per-repo body = a fenced JSON block
plus the handoff summary; the shared-registry shape below is the single-master original, kept for
the cloud variant. Per-repo fields are the inner `repos.<owner/repo>` object plus `repo`, `venue`,
`phase`, `decisionBriefIssue` and `config`:

```json
{
  "phase": "DEV | GRILL | AWAIT_RATIFY",
  "activeWorker": { "repo": null, "sessionId": null, "startedAt": null },
  "repos": {
    "<owner/repo>": {
      "harnessInstalled": true,
      "wavesToday": 0, "wavesDate": "2026-09-01",
      "lastCycle": { "at": null, "workerSessionId": null, "outcome": null },
      "drained": false
    }
  },
  "decisionBriefIssue": null,
  "config": { "maxConcurrentWorkers": 1, "maxWavesPerRepoPerDay": 6,
              "fleetArgs": { "maxTickets": 3, "maxAttempts": 3 } }
}
```

Dan can edit the config block in the issue; the master re-reads it every wake. The state issue is
the only memory that must survive a master rebirth — keep it current before ending every turn. The
body carries a `## Handoff summary` section alongside the JSON block above (six numbered items,
shape defined under Master rebirth below); heartbeats keep it current, not only at rebirth.

**Cross-repo references and labels (tracker-audit gates).** Every reference to an issue or PR that
lives in another repository is written fully qualified as `owner/repo#N` (e.g.
`surreptakos/aac-bill-intake#562`), never bare `#N` — the state issue lives in
`surreptakos/claude-dotfiles`, so `#562` there resolves against claude-dotfiles and reads to
`tools/tracker-audit.js` as a `dangling-reference`. Every decision brief carries BOTH the
`orchestrator` label AND the `ready-for-human` label — it is the one thing a master hands Dan for a
ruling. A state notebook carries `orchestrator` alone: it is a living document each master rewrites
every heartbeat, with no pending ruling, so it does not belong in the `ready-for-human` queue; the
audit's `untriaged` check counts `orchestrator` as a triage state for this reason. When rewriting
the state body on a heartbeat, keep the cross-repo `owner/repo#N` rule holding and leave
`ready-for-human` off; when opening a decision brief, apply both labels at creation.

## Heartbeat procedure (every Routine wake, and on any message)

1. Read the state issue. Read any new Dan messages in this session — they override everything here.
2. If `activeWorker` is set: check the worker session (`get_session`, `list_events`) and ground
   truth (tracker labels, PR list). Worker finished → record the outcome, archive the worker
   session, clear `activeWorker`. Worker stuck > 3 h with no event progress → interrupt, archive,
   record `outcome: "stalled"`, clear. Worker still working → update state, end turn (never poll
   in-turn; the next heartbeat checks again).
3. Phase dispatch:
   - **DEV** → pick the first repo by priority with actionable work and `wavesToday <
     maxWavesPerRepoPerDay`. Actionable = open issues lacking triage labels, OR open
     `ready-for-agent` tickets with no open blockers, OR fleet PRs awaiting the merge pass. Spawn a
     worker (see below). If no repo is actionable → every repo is drained → enter **GRILL**.
   - **GRILL** → run the grill procedure (below). Ends with the decision brief posted → enter
     **AWAIT_RATIFY**, notify Dan (PushNotification if available; the state issue and this session
     always carry the brief link).
   - **AWAIT_RATIFY** → check the decision brief issue and this session for Dan's rulings. Land
     each ratified ruling on its ticket (comment + relabel per the grill skill). All decisions
     ruled → back to **DEV**. Otherwise end the turn quietly (heartbeats stay cheap).
4. Update the state issue. End the turn. Never sleep-poll; the Routine is the clock.

## Spawning a worker

`create_session` with `source_url` = the repo, `title` = `worker: <repo> cycle <date>`, tags
`["orchestrator-worker"]`, and prompt = the contents of `orchestrator/worker-cycle.md` with the
placeholders filled (repo, default branch, fleet args from config). Record the session id in
`activeWorker`. One worker at a time (`maxConcurrentWorkers: 1`) — serialized cycles keep cost
legible and failures attributable.

**Takeover guard** (every cycle, not just the first): if the repo shows `agent/issue-*` branches or
fleet PRs updated within the last 2 hours that this orchestrator did not create, Dan's PC (or
another runner) is mid-fleet there. Defer that repo — indefinitely, never "proceed anyway" — note
it in the state issue, and if it is still deferred after 3 wakes, ask Dan for an explicit handoff
(a message in this session or a comment on the state issue). Two runners on one repo burn double
usage for the same backlog even when branch names don't collide; that happened on 2026-09-01
(cloud worker + PC fleet on bill-intake, weekly limit exhausted) and must not happen again. The
kill switch for everything is disabling the heartbeat Routine — the master only acts on wakes.

## Merge policy (Dan, 2026-09-01: auto-merge ON)

The merge pass (the worker's in the cloud, the master's own on the PC — not the fleet) merges a fleet
PR when ALL hold: the PR body carries the blind verifier's pass evidence; CI on the head is green,
or the repo has no CI workflow at all; no merge conflict; no human has requested changes. Method:
the repo's documented convention, else squash. After merge, delete the branch, then act on the
ticket by what the PR body says:

- `Closes #N` — confirm the ticket closed; close it manually citing the PR if GitHub did not.
- `Refs #N` with a keep-open note — the deliver stage writes this when the ticket itself says it
  must stay open (a ratification ticket). Do NOT close the ticket. Relabel it `ready-for-human`
  (remove `ready-for-agent`) so the next scout does not re-implement it and the grill phase
  surfaces it to Dan.

A PR that fails the bar stays open and is the next cycle's first work item.

**CI exists but never ran on this head.** A repo that has a CI workflow, and a PR head with zero
check runs — typical when the branch was pushed before the workflow reached the default branch, as
with `surreptakos/aac-contract-builder#158` on 2026-09-02 — satisfies neither "green" nor "no CI".
Such a PR is NOT mergeable until CI has run on that head. Re-fire path, in order of preference:
close and reopen the PR (`gh pr close N` then `gh pr reopen N`; a `pull_request` workflow fires on
`reopened`), or a fresh push to the branch. Never assume a `workflow_dispatch` trigger exists. The
merge pass is allowed to close-and-reopen on its own — it changes no code and no ticket — and
records it in the state issue with the PR number and time. A push to an agent branch is the
implementer's or a human's, never the merge pass's. Then wait: the PR is re-assessed on the next
heartbeat, not polled.

## Harness policy (Dan, 2026-09-01: auto-install ON)

Worker step 1 checks the repo for the tracker vocabulary (`ready-for-agent` / `ready-for-human`
labels, `docs/agents/issue-tracker.md`). Missing → run `/project-harness` from the dotfiles clone
(`agents/skills/project-harness/SKILL.md`) before anything else, and record `harnessInstalled` in
state. Expected for `zoho-source-of-truth`.

## Grill phase

Gather every open `ready-for-human` ticket across the four repos. Follow
`claude/skills/grill-ready-for-human/SKILL.md` from the dotfiles clone — one ticket at a time, no
batch rulings — with one inversion: the master grills **itself** first. Per ticket:

1. Reconstruct the ruling the ticket actually waits on (the skill's per-ticket flow).
2. Hunt evidence: the repo's code, ADRs, MEMORY.md, tracker history, linked PRs.
3. **Determinable from evidence** (the answer is a fact, not a preference — e.g. "does X already
   handle Y?" where the code answers) → land the ruling as a tracker comment (with the AI
   disclaimer prefix), relabel per the skill, done.
4. **Preference-shaped** (risk appetite, money, staffing, product taste, anything where two
   defensible answers exist) → NEVER self-rule. Add to the brief: the question, the context a
   ruling needs, the master's recommendation and why.

Post the brief as one GitHub issue in claude-dotfiles (label `orchestrator`, title "Decision brief
<date>"): self-answered rulings listed first as an FYI with links, then the open decisions each as
a checklist item. Write the brief in plain, direct prose for Dan to read: remove all mannered
prose, no metaphor or flourish where a literal phrase exists; one short paragraph per open
decision. Dan ratifies by replying in the master session or commenting on the issue —
"approved as recommended" on the issue counts for every unchecked item he doesn't override.

## Master rebirth (context hygiene for the master itself)

The master's own window grows slowly, but not never. When wakes start arriving summarized, or
roughly every 100 heartbeats: before rebirth, ensure the state issue body carries a `## Handoff
summary` section with these six numbered items — (1) difficulties/problems and how resolved; (2)
possibilities/options/approaches raised, tried, or set aside, and why; (3) anything asked for,
decided, agreed, ruled out, or established as preference/constraint/boundary, stated exactly; (4)
exactly where things stand now; (5) anything still open/unresolved/promised/expected next; (6)
specific details hard to reconstruct (names, numbers, dates, exact wording, links, issue/PR
numbers, session ids), kept exactly. Weighting rule: keep what Dan said/asked/established close to
his own words; master's own reasoning condensed to conclusions/output. Then `create_session` a
successor with the boot prompt (below), retarget the Routine to it (`update_trigger` with the new
`persistent_session_id`), then archive this session. The successor boots from the state issue and
notices nothing was lost.

## Boot prompt (for the first master and every successor)

> You are the master orchestrator. Clone `surreptakos/claude-dotfiles` (add_repo first if needed),
> read `orchestrator/RUNBOOK.md` on the default branch (fall back to branch
> `claude/apps-script-head-sync-xulnfs` if it is not on the default branch yet) and follow it. Find
> or create the "Master orchestrator state" issue and begin the heartbeat procedure.

## Rails

- Ground truth over self-reports: verify every worker claim against the tracker and PR state.
- Never fleet a repo not in the priority list; never touch `aac-sales-commissions`,
  `aac-message-board`, `aac-task-management`, `aac-routines` without a new ruling from Dan.
- Apps Script deploys stay on their existing path: every AAC script deploys itself from GitHub on a
  merge to its default branch (claude-dotfiles `gas/`). Workers and fleets never move a `deploy/*` ref,
  never run clasp, and never touch production data paths.
- Respect repo CLAUDE.md rails absolutely; a worker that reports a rail conflict parks the ticket
  `ready-for-human` instead of bending the rail.
- Cost: the per-day wave caps are hard. When a cap is hit, the state issue says so and the repo
  waits for tomorrow — or for Dan to raise the cap in the config block.
- Everything Dan must act on goes in the decision brief or this session in plain language — never
  only in a file or a worker transcript (he will not read those).
