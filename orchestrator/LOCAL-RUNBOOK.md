# Local master orchestrator (PC variant)

The same orchestrator as `RUNBOOK.md`, run as ONE long-lived interactive Claude Code session on
Dan's always-on PC instead of a cloud session + Routine. Everything not stated here follows
`RUNBOOK.md`: the phase machine (DEV → GRILL → AWAIT_RATIFY), repo priorities, auto-merge and
auto-harness policies, the grill procedure, the rails, and the state issue
(`claude-dotfiles` issue #44) as the only durable memory.

**Exactly one master may exist anywhere, ever.** Before starting, check issue #44: if it records an
active cloud master (a live session + enabled heartbeat Routine), do not start a local one, and vice
versa. Record the venue in the state issue on boot (`"venue": "local-pc"` in the JSON) and clear it
on shutdown.

## What changes from the cloud runbook

- **No worker sessions.** The master dispatches everything in-session: `/triage` and `/to-tickets`
  run via subagents (Agent tool) spawned with `run_in_background: true` — the master does not wait
  on them. While those subagents run, the master keeps working: it runs the merge pass over open
  fleet PRs (same policy as `RUNBOOK.md` — verifier evidence + green CI + no conflict + no human
  changes-requested, via `gh pr merge`) and performs the takeover-guard check for the next repo in
  priority order. The fleet (Workflow tool on the ORIGINAL `.claude/workflows/ticket-fleet.js` —
  `gh` exists here, no cloud port needed; pass `runId` in `args`, minted with
  `printf %x $(date +%s)`, because the workflow runtime forbids `Date.now()` in scripts; and
  launch by `scriptPath`, since a workflow registered by name is a session-start snapshot that
  ignores later edits) is only started for a repo AFTER that repo's `/triage`
  and `/to-tickets` subagent results have arrived, because the fleet's scout reads the labels those
  steps produce. The master collects subagent results when their completion notifications arrive
  rather than polling.
- **Skills are native.** `/triage`, `/to-tickets`, `/project-harness`, `/session-start`,
  `/session-end`, `/grill-ready-for-human` all load from `~/.claude` — invoke them directly instead
  of reading SKILL.md files out of a clone.
- **Pacing.** If the `/loop` skill is available, run under it in dynamic (self-paced) mode: between
  cycles schedule the next wakeup 20–30 min out; while a repo has actionable work, continue
  immediately. If `/loop` is not available, run ONE full pass (serve every repo until nothing is
  actionable or a cap is hit), update the state issue, then STOP and say "pass complete — relaunch
  me for the next pass." Never busy-wait with sleeps.
- **Context hygiene.** Heavy work already lives in subagents and workflow agents. When the master's
  own window grows heavy anyway, checkpoint everything to issue #44 and restart: a fresh session
  launched with the boot prompt below resumes losslessly. Whether the restart can be automated
  depends on whether headless `claude -p` currently works on this machine — VERIFY at setup time
  (`claude -p "say ok"`), never assume from memory in either direction. If it works, a relauncher
  (Task Scheduler or a watchdog script re-running the boot prompt via `claude -p`) makes the local
  master self-healing and erases most of the durability gap vs the cloud Routine; if it doesn't,
  the human relaunch is the rebirth, and fixing headless auth is worth a ticket.
- **Takeover guard, process-based (Dan, 2026-09-02).** On this PC the 2-hour timestamp window is
  replaced by a live check: another runner is present when either holds, and the answer never
  depends on how old a branch or PR is.
  1. `Get-Process claude` shows a PID this master did not record. At boot, record the PIDs it
     returns (that set is this master's own terminal plus any pre-existing sessions) in the
     `## Handoff summary` of issue #44 under item 6. Before every fleet launch, run it again: any
     PID not in the boot set is a foreign runner (another terminal, a headless `claude -p`, a
     desktop scheduled task) and every repo is deferred until it exits. Fleet and Agent-tool
     agents run inside this process, so the master's own work never adds a PID.
  2. `git worktree list` in the target repo shows an `agent/issue-*` worktree this master did not
     create. A fleet removes its worktrees when it finishes, so an unexpected one is a fleet
     mid-run from another terminal, or a crashed one that needs `git worktree prune` first.
  Cloud runners leave no process here, so the 2-hour signal from RUNBOOK.md (fleet PRs or
  `agent/issue-*` branches on origin updated within 2 hours that this master did not create) stays
  as the third check. Same response as RUNBOOK.md on any hit: defer indefinitely, escalate to Dan
  for an explicit handoff, never proceed on your own.
- **Kill switch.** Esc / Ctrl+C in the terminal. Nothing revives the loop afterward — closing the
  terminal is a real stop, and the state issue means nothing is lost.
- **Grill phase & ratification.** Same procedure; the decision brief is still a claude-dotfiles
  issue, but rulings can also land straight from Dan typing in this terminal — land each one on its
  ticket before moving on.

## Boot prompt (paste into a fresh `claude` session in the claude-dotfiles checkout)

> You are the master orchestrator, local variant. Read `orchestrator/LOCAL-RUNBOOK.md` and
> `orchestrator/RUNBOOK.md` in this repo — binding, in that order of precedence. Check issue #44
> for the current state and that no other master (cloud or local) is active; claim
> `"venue": "local-pc"`. Then begin the heartbeat procedure under `/loop` dynamic pacing if
> available, else as single passes. My messages in this terminal override everything.

## Caps

Same config block in issue #44. Costs measured 2026-09-01: a contract-builder cycle ≈ $49, a
bill-intake cycle ≈ $22, master overhead ≈ $25/day at hourly pacing. Set `maxWavesPerRepoPerDay`
accordingly BEFORE the first pass; local execution spends from the same account-level usage pool as
cloud — running here prevents double-running, it does not make tokens cheaper.
