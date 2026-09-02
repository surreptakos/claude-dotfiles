# Local master orchestrator (PC variant)

The same orchestrator as `RUNBOOK.md`, run as long-lived interactive Claude Code sessions on
Dan's always-on PC instead of a cloud session + Routine. Everything not stated here follows
`RUNBOOK.md`: the phase machine (DEV → GRILL → AWAIT_RATIFY), repo priorities, auto-merge and
auto-harness policies, the grill procedure, the rails, and the state issues as the only durable
memory.

**One master per repo, each rooted in the clone of the repo it serves (Dan's ruling via tickets
#70–#73, 2026-09-02; replaces "exactly one master may exist anywhere, ever").** Four masters run
side by side on this PC, one per target repo, and they are peers, not intruders. Each has its own
state issue in `claude-dotfiles` (registry in issue #44: bill-intake #74, contract-builder #75,
sales-cockpit #76, zoho-source-of-truth #77). Before starting, a master checks ITS OWN state issue:
if it records an active cloud master for that repo, do not start a local one, and vice versa.
Record the venue on boot (`"venue": "local-pc"` in that issue's JSON) and clear it on shutdown.
Two masters on one repo is the double-run that exhausted the weekly limit on 2026-09-01; several
masters on several repos is the intended shape.

**The claude-dotfiles checkout is not a valid root for a master.** Every target repo's
`.claude/workflows/ticket-fleet.js` is cwd-relative throughout: its scout runs `gh issue list`
with no `-R`, its implement stage uses `isolation: 'worktree'`, and its verifier runs `git
worktree add` "in this repo". A Workflow launched from a session rooted in claude-dotfiles resolves
all three against claude-dotfiles, and the run on 2026-09-02 stalled on exactly that (issue #44,
heartbeats 7 and 8). Triage got away with it only because a subagent can `cd` first; the fleet
cannot. The runbooks are read from the dotfiles checkout by absolute path; nothing else about a
master lives there.

## What changes from the cloud runbook

- **No worker sessions.** Each master dispatches everything in-session, from inside its repo's
  clone: `/triage` and `/to-tickets` run via subagents (Agent tool) spawned with
  `run_in_background: true` — the master does not wait on them. While those subagents run, the
  master keeps working: it runs the merge pass over the repo's open fleet PRs (same policy as
  `RUNBOOK.md` — verifier evidence + green CI + no conflict + no human changes-requested, via
  `gh pr merge`; the CI-never-ran clause and the keep-open rule are there too) and performs the
  takeover-guard check. The fleet (Workflow tool on the repo's ORIGINAL
  `.claude/workflows/ticket-fleet.js` — `gh` exists here, no cloud port needed; pass `runId` in
  `args`, minted with `printf %x $(date +%s)`, because the workflow runtime forbids `Date.now()`
  in scripts; launch by `scriptPath`, since a workflow registered by name is a session-start
  snapshot that ignores later edits) is only started AFTER the repo's `/triage` and `/to-tickets`
  subagent results have arrived, because the fleet's scout reads the labels those steps produce.
  The master collects subagent results when their completion notifications arrive rather than
  polling. A master serves ONE repo and never fleets another: the other repos have their own
  masters.
- **Skills are native.** `/triage`, `/to-tickets`, `/project-harness`, `/session-start`,
  `/session-end`, `/grill-ready-for-human` all load from `~/.claude` — invoke them directly instead
  of reading SKILL.md files out of a clone.
- **Pacing.** If the `/loop` skill is available, run under it in dynamic (self-paced) mode: between
  cycles schedule the next wakeup 20–30 min out; while the repo has actionable work, continue
  immediately. If `/loop` is not available, run ONE full pass (serve the repo until nothing is
  actionable or a cap is hit), update the state issue, then STOP and say "pass complete — relaunch
  me for the next pass." Never busy-wait with sleeps.
- **Context hygiene.** Heavy work already lives in subagents and workflow agents. When the master's
  own window grows heavy anyway, checkpoint everything to its state issue and stop: the watchdog
  relaunches a fresh session with the boot prompt within 30 minutes, and it resumes losslessly
  from that issue. Headless `claude -p` is not part of this path — the watchdog launches a normal
  interactive `claude`.
- **Takeover guard, process-based and per repo (Dan, 2026-09-02).** On this PC the 2-hour
  timestamp window is replaced by a live check: another runner is present when either holds, and
  the answer never depends on how old a branch or PR is.
  1. `Get-Process claude` shows a PID this master did not record AND that is not a peer master.
     At boot, record the PIDs it returns (that set is this master's own terminal plus any
     pre-existing sessions) in the `## Handoff summary` of the state issue under item 6. Before
     every fleet launch, run it again. A new PID whose command line (from
     `Get-CimInstance Win32_Process`) carries `--remote-control master-<other-slug>` is a peer
     master serving another repo — expected, never a reason to defer. Any other new PID (another
     terminal, a headless `claude -p`, a desktop scheduled task) is a foreign runner and this
     repo is deferred until it exits. Fleet and Agent-tool agents run inside this process, so the
     master's own work never adds a PID.
  2. `git worktree list` in this repo shows an `agent/issue-*` worktree this master did not
     create. A fleet removes its worktrees when it finishes, so an unexpected one is a fleet
     mid-run from another terminal, or a crashed one that needs `git worktree prune` first.
  Cloud runners leave no process here, so the 2-hour signal from RUNBOOK.md (fleet PRs or
  `agent/issue-*` branches on origin updated within 2 hours that this master did not create) stays
  as the third check. Same response as RUNBOOK.md on any hit: defer indefinitely, escalate to Dan
  for an explicit handoff, never proceed on your own.
- **Kill switch.** Esc / Ctrl+C in a master's terminal stops that repo's master only. The
  watchdog relaunches it on its next 30-minute slot unless the task is disabled
  (`schtasks /Change /Disable /TN "Claude master watchdog"`), which stops every relaunch at once.
  The state issues mean nothing is lost either way.
- **Grill phase & ratification.** Same procedure; the decision brief is still a claude-dotfiles
  issue, but rulings can also land straight from Dan typing in a master's terminal — land each one
  on its ticket before moving on.

## Bypass permissions — what it costs (ticket #71)

The watchdog launches every master with `--dangerously-skip-permissions`. Without it the merge
pass cannot run: on 2026-09-02 the auto-mode permission classifier denied `gh pr merge` twice, the
second a single non-looped invocation, so the command itself was what the harness refused, while
auto-merge is ON by Dan's ruling. The flag makes the harness match the ruling.

Stated plainly: with bypass permissions on, an unattended master can merge, push, delete branches,
edit issues and run any shell command with no prompt and nobody watching. The merge bar in
`RUNBOOK.md` (verifier evidence, green CI or no CI, no conflict, no changes-requested, the
CI-never-ran clause) is the only remaining gate on a merge, and it is enforced by the master's own
discipline, not by the tool. Do not weaken that bar. These rails stay in force and are the reason
the flag is acceptable:

- Never force-push. Never commit directly to `main` (or the repo's default branch); everything
  lands through a PR that passed the bar.
- Workers and fleets never run `clasp` and never touch production data paths; Apps Script deploys
  stay on their existing paths.
- Never fleet a repo outside the priority list; never touch `aac-sales-commissions`,
  `aac-message-board`, `aac-task-management`, `aac-routines` without a new ruling.
- A PR that fails the bar stays open. The master does not "fix it up" to make it pass.

`master-watchdog.ps1 -NoBypass` launches without the flag for debugging; such a master can triage
but cannot merge.

## Boot prompt (what the watchdog passes; paste into a fresh `claude` started INSIDE the repo clone)

> You are the master orchestrator, local variant, serving `<owner/repo>`. This session is rooted in
> that repo's clone; never change directory out of it. Read
> `C:\Users\Dan\Claude\Projects\Meta\claude-dotfiles\orchestrator\LOCAL-RUNBOOK.md` and then
> `...\orchestrator\RUNBOOK.md` — binding, in that order of precedence. Your state issue is
> `surreptakos/claude-dotfiles#<N>`; issue #44 there is the shared registry and config — read it,
> never write to it or to another repo's state issue. Check your state issue for the current state
> and that no other master serves `<owner/repo>`; claim venue local-pc there. Then begin the
> heartbeat procedure under `/loop` dynamic pacing if available, else as single passes. My messages
> in this terminal override everything.

The remote-control session name is `master-<slug>` (`master-bill-intake`, `master-contract-builder`,
`master-sales-cockpit`, `master-zoho`), which is also what the watchdog's alive check and the
takeover guard's peer rule match on.

## Relaunch watchdog (issue 64, per repo since issue 70)

A closed terminal, a reboot, or a crash used to stop the babysitter until Dan noticed.
`orchestrator/master-watchdog.ps1` closes that gap: every 30 minutes (Task Scheduler, "only run
when user is logged on") the script walks the four repos in priority order, decides for each
whether its master is alive, and if not, launches one in a visible console with Remote Control
enabled, rooted in that repo's clone — the window stays on the desktop and the same session shows
up at claude.ai/code and in the Claude mobile app.

**Alive** for repo `<slug>` means EITHER of these holds (checked in this order):

1. A `claude.exe` or `node.exe` process is running with `--remote-control master-<slug>` on its
   command line. The match is per repo on purpose: a bare `master` match would let the first
   master found suppress the launch of every other one.
2. That repo's state issue carries a `**Heartbeat N — YYYY-MM-DD HH:MM UTC**` line newer than 120
   minutes. The heartbeat procedure updates this on every wake, so a fresh line means a master is
   doing work even if its window has migrated to a different PID.

Either check hits → that repo is skipped. Neither hits → `Start-Process cmd.exe /k cd /d "<clone>"
&& claude --dangerously-skip-permissions --remote-control master-<slug> "<boot prompt>"` in a fresh
visible window, then on to the next repo. The launched processes are fully independent of the
watchdog run. `-Only <slug>` restricts the walk; `-WhatIf` prints every decision and launches
nothing; `-Force` skips the checks.

**Legacy guard.** A process whose command line carries the old shape `--remote-control master
"<prompt>"` (bare `master`, rooted in claude-dotfiles) blocks every launch: it would double-run
triage against the per-repo masters. The watchdog prints its PID and the `Stop-Process` line and
exits 0; stop it, and the next slot launches the per-repo masters.

The repo table (slug, `owner/repo`, state issue, clone path) lives at the top of the script.
Adding a repo means adding a row there, creating its state issue, and adding it to the registry in
issue #44 — nothing else.

### Install — two steps, on purpose

Attempt 2 of this ticket left the install as one command that scheduled the task with a first-run
slot one minute out. Someone re-reading the runbook to "just check what the install does" would
have kicked off an unattended master a minute later. Attempt 3 splits the install so that hazard
cannot happen:

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
One task serves all four repos; the per-repo loop is inside the script.

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
relaunch one for that repo on the next 30-minute slot.

**Editing the watchdog on a branch.** The task runs the script at its checkout path, so while the
checkout sits on a feature branch the task runs THAT branch's script every 30 minutes. Disable the
task before editing the script (`schtasks /Change /Disable`), re-enable after the merge lands and
the checkout is back on master. The script is saved with a UTF-8 BOM: Windows PowerShell 5.1 reads
a BOM-less file as ANSI, and an em dash inside a string then breaks the parse (seen 2026-09-02).

### Verified on 2026-09-02 (attempt 2, single master — historical)

The verification below was captured on attempt 2 with the single-master watchdog rooted in the
dotfiles checkout (the `--remote-control master` shape the legacy guard now blocks). It is kept
because the Remote Control and Task Scheduler mechanics it proves are unchanged. Rows marked
`[first-party]` came from Dan's own inspection of the app and the browser; a later independent
reviewer noted they could not reproduce those two rows in their environment, so treat them as
first-party evidence, not third-party confirmation.

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

### Verified on 2026-09-02 (attempt 4, per-repo masters — tickets #70 and #71)

All runs with `-WhatIf`; no process was launched. The fake peer and legacy processes were
`node fake-master.js --remote-control master-zoho` and `node fake-master.js --remote-control
master "You are the master orchestrator, local variant"`, which satisfy the `claude.exe OR
node.exe` filter the real check uses.

- Windows PowerShell 5.1, no masters alive, fresh state issues #74–#77 -> four
  `[<slug>] no heartbeat line found in issue #<N>` lines, then four `NO MASTER ALIVE - would
  launch: cmd.exe /k cd /d "<that repo's clone>" && claude --dangerously-skip-permissions
  --remote-control master-<slug> "You are the master orchestrator, local variant, serving
  <owner/repo>..."` lines, each with the matching state issue number in the prompt, exit 0.
- PowerShell 7.6.5, a fake `master-zoho` process alive -> `[zoho] MASTER ALIVE (process check):
  pid(s)=15428 - no launch` while bill-intake, contract-builder and sales-cockpit still printed
  their launch lines. The per-slug match does not let one master suppress the others.
- PowerShell 7.6.5, a fake legacy `--remote-control master "..."` process alive -> `LEGACY single
  master alive (pid(s)=16944)` plus the `Stop-Process -Id 16944` line, no launch lines, exit 0.
- `-Only bill-intake -NoBypass` -> one launch line, without `--dangerously-skip-permissions`.
- The flag itself: `claude --dangerously-skip-permissions --strict-mcp-config -p "reply with
  exactly: ok" --output-format json` from a neutral cwd returned `is_error: false`,
  `subtype: success`, result `ok`, exit 0 — the flag is accepted by this CLI build.
- Before the BOM was restored, the same script under 5.1 failed with `You cannot call a method on
  a null-valued expression` and `The term 'else' is not recognized` at lines that were plain
  `if/else` — the em dashes in the strings had been read as ANSI. `-WhatIf` as a ShouldProcess
  parameter also printed twelve `What if: Performing the operation "Set Alias"` lines from the
  CimCmdlets import; it is a plain switch now.

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

Same config block, now in each repo's state issue (defaults in issue #44). Costs measured
2026-09-01: a contract-builder cycle ≈ $49, a bill-intake cycle ≈ $22, master overhead ≈ $25/day
at hourly pacing — per master, so four masters idling cost four times the overhead. Set
`maxWavesPerRepoPerDay` accordingly BEFORE the first pass; local execution spends from the same
account-level usage pool as cloud — running here prevents double-running, it does not make tokens
cheaper.
