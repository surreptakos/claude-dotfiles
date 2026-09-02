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

## Relaunch watchdog (issue 64)

A closed terminal, a reboot, or a crash used to stop the babysitter until Dan noticed.
`orchestrator/master-watchdog.ps1` closes that gap: every 30 minutes (Task Scheduler, "only run
when user is logged on") the script decides whether a master is alive, and if not, launches one in
a visible console with Remote Control enabled — the window stays on the desktop and the same
session shows up at claude.ai/code and in the Claude mobile app.

**Alive** means EITHER of these holds (checked in this order):

1. A `claude.exe` or `node.exe` process is running with `--remote-control` and `master` on its
   command line. That is the launch shape below; matching on it catches any master this watchdog
   ever started, plus any that Dan started by hand with the same command.
2. Issue #44 carries a `**Heartbeat N — YYYY-MM-DD HH:MM UTC**` line newer than 120 minutes.
   The runbook's heartbeat procedure updates this on every wake, so a fresh line means a master
   is doing work even if its window has migrated to a different PID (e.g. a rebirth handoff).

Either check hits → exit 0, no launch. Neither hits → `Start-Process cmd.exe /k ... claude
--remote-control master "<boot prompt>"` in a fresh visible window rooted at the claude-dotfiles
checkout, then exit 0. The launched process is fully independent of the watchdog run.

### Install — two steps, on purpose

Attempt 2 of this ticket left the install as one command that scheduled the task with a first-run
slot one minute out. Someone re-reading the runbook to "just check what the install does" would
have kicked off an unattended `claude --remote-control master` a minute later. Attempt 3 splits
the install so that hazard cannot happen:

1. **Preview** — always run this first. It touches nothing, prints the exact schtasks command it
   would run and how long until the first slot fires:

   ```powershell
   powershell -ExecutionPolicy Bypass -File orchestrator\install-watchdog-task.ps1
   ```

   Read the printed schtasks line. If anything looks off (wrong script path, wrong interval,
   wrong first-slot offset), stop and pass overrides (`-IntervalMinutes`, `-FirstRunMinutes`,
   `-WatchdogPs1`) rather than editing the script.

2. **Install** — only after you have read the preview, add `-Install`:

   ```powershell
   powershell -ExecutionPolicy Bypass -File orchestrator\install-watchdog-task.ps1 -Install
   ```

   Default `-FirstRunMinutes 30` puts the first slot 30 minutes out (one full interval away)
   rather than the +1 minute the earlier script used. If you want the first slot to fire in one
   minute for a live smoke test, pass `-Install -RunNow` — you have to ask for it.

The task registers under the current user via `schtasks.exe /IT /RL LIMITED`. `Register-ScheduledTask`
with the INTERACTIVE principal needed elevation on this machine (2026-09-02); `schtasks /IT` did not.

Run once by hand (only after `-Install`):

```powershell
schtasks /Run /TN "Claude master watchdog"
```

Stop the watchdog for good:

```powershell
schtasks /Delete /TN "Claude master watchdog" /F
```

Disable temporarily (task stays, next slot skipped) with `schtasks /Change /Disable`; re-enable
with `/Enable`. Ctrl+C in a launched master window still stops that master; the watchdog will
relaunch one on the next 30-minute slot.

### Verified on 2026-09-02 (attempt 2)

The verification below was captured on attempt 2 with the earlier install script (+1 min start
slot). The watchdog itself and the schtasks output are unchanged in attempt 3 — only the
install-time UX changed. Rows marked `[first-party]` came from Dan's own inspection of the app
and the browser; a later independent reviewer noted they could not reproduce those two rows in
their environment, so treat them as first-party evidence, not third-party confirmation.

- Watchdog run with a heartbeat cutoff of 999999 min against #44's `Heartbeat 5 - 2026-09-01
  15:56 UTC` line -> `MASTER ALIVE (heartbeat check): latest=2026-09-01 15:56:00Z  age=1623m <
  999999m` and exit 0, no launch (heartbeat branch).
- Watchdog run with the default 120-minute cutoff and no matching `--remote-control master`
  process -> `heartbeat stale: latest=2026-09-01 15:56:00Z  age=1623m` then `NO MASTER ALIVE
  - would launch: cmd.exe /k cd /d "C:\Users\Dan\Claude\Projects\Meta\claude-dotfiles" &&
  claude --remote-control master "You are the master..."` and exit 0 (proven with `-WhatIf`).
- `schtasks /Run /TN "Claude master watchdog"` fired the registered task; `schtasks /Query /V`
  reported `Last Result: 0`, `Logon Mode: Interactive only`, `Repeat: Every 0 Hour(s), 30
  Minute(s)`. A visible cmd.exe window opened running `claude --remote-control master "You are
  the master orchestrator, local variant. Read orchestrator/LOCAL-RUNBOOK.md..."`. Both the cmd
  wrapper (pid 27340) and its `claude.exe` child (pid 8640, parent 27340) were observed in
  `Get-CimInstance Win32_Process` with that command line.
- `[first-party]` **claude.ai/code under the work account (Dan Gatsakos / Active Alarm)**:
  the just-launched session was listed under the `claude-dotfiles` section, id
  `session_01NftwcwpEUMkdi3EQCZ9Mkx`, title `master`. The prior `--remote-control
  watchdog-verify-64` sanity launch appeared at `session_01PyfAAQ31xeiW6BSPqwN56f`, title
  `exit handling`. `--remote-control` is the mechanism that surfaces a local session to the
  cloud roster.
- `[first-party]` **Desktop Claude app lists Remote Control sessions**: the desktop app
  (`C:\Users\Dan\AppData\Local\AnthropicClaude\app-1.40609.1\claude.exe`) is an Electron
  shell whose renderer origin is `https://claude.ai` (verified by the store path
  `AppData\Roaming\Claude\IndexedDB\https_claude.ai_0.indexeddb.leveldb` and the
  `app.asar` payload matching `https://claude.ai` and `https://claude.ai/desktop/callback`
  as its only navigation targets). Its session picker sidebar is the same claude.ai/code sidebar
  above - a session launched with `--remote-control master` shows up in the desktop app under
  `claude-dotfiles` alongside the same `session_01…` id on claude.ai/code. Same origin, same
  list.

## The three relaunch options (Dan's ruling, 2026-09-02)

| Option | Where the timer lives | Auth model at launch | Durability | Steerable how |
| --- | --- | --- | --- | --- |
| Cloud Routine | Anthropic server-side, bound to a persistent session | Runs inside the routine's org | Survives Dan's PC being off | claude.ai/code and mobile |
| **Task Scheduler + Remote Control** (chosen) | Windows Task Scheduler on Dan's PC | Interactive Windows user, no headless `claude -p` needed — the launch is a normal `claude` invocation | Only while Dan is logged on | Visible desktop window PLUS claude.ai/code and mobile via `--remote-control` |
| Desktop app scheduled task | Inside the desktop Claude app, per signed-in org | The signed-in desktop-app account | Only while the desktop app is running; catches up on next launch after a miss | Desktop app UI and (if the app publishes them) claude.ai/code |

Task Scheduler + Remote Control won 2026-09-02 for two reasons: (1) it avoids the headless
`claude -p` login path entirely — this PC's headless auth has been flaky before and reinstalling
it whenever the relauncher needed to run was not worth the fragility. Interactive `claude` uses
the already-live credential store instead. (2) The launched session inherits the interactive
window (Dan can Ctrl+C it) while ALSO appearing on claude.ai/code and in the mobile app, which
matches how Dan already runs the local master — everything the cloud Routine gives up (server-
side timer, works with the PC off) is offset by the visible-and-steerable window here.

Cloud Routine and the desktop-app scheduled task remain valid fallbacks: pick the cloud Routine
if Dan wants a master running when the PC is off; pick the desktop-app scheduled task if the
account only exists in the desktop app.

## Caps

Same config block in issue #44. Costs measured 2026-09-01: a contract-builder cycle ≈ $49, a
bill-intake cycle ≈ $22, master overhead ≈ $25/day at hourly pacing. Set `maxWavesPerRepoPerDay`
accordingly BEFORE the first pass; local execution spends from the same account-level usage pool as
cloud — running here prevents double-running, it does not make tokens cheaper.
