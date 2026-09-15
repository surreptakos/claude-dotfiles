# Local master orchestrator (PC variant) — RETIRED

> **RETIRED 2026-09-15 (issue 217, parent spec #207).** The PC venue is being decommissioned as
> the four per-repo cloud Routines cut over. `RUNBOOK.md` is the live runbook; this file is kept
> for history only — it describes the watchdog + long-lived interactive sessions the cloud
> Routines replaced. Do not launch a new local master from here, do not extend it, and do not
> treat any decision recorded below as still binding unless the current `RUNBOOK.md` restates it.
> The watchdog scheduled task, `master-watchdog.ps1`, `install-watchdog-task.ps1` and the PID
> guard are all part of what is retiring with this venue.

The same orchestrator as `RUNBOOK.md` was, run as long-lived interactive Claude Code sessions on
Dan's always-on PC instead of a cloud session + Routine. Everything not stated here follows
`RUNBOOK.md`: the phase machine (DEV → GRILL → AWAIT_RATIFY), repo priorities, auto-merge and
auto-harness policies, the grill procedure, the rails, and the state issues as the only durable
memory.

**One master per repo, one master at a time (Dan, 2026-09-02; tickets #70 and #79).** Each master
is rooted in the clone of the repo it serves and has its own state issue in `claude-dotfiles`
(registry in issue #44: bill-intake #74, contract-builder #75, sales-cockpit #76,
zoho-source-of-truth #77). They run in series, never side by side: the watchdog launches one, that
master runs ONE pass over its repo and writes a `**Pass complete — YYYY-MM-DD HH:MM UTC**` line
into its state issue, the watchdog closes that window and launches the next repo (never-served
repos first in priority order, then least recently served). Before starting, a master checks ITS
OWN state issue: if it records an active cloud master for that repo, do not start a local one, and
vice versa. Record the venue on boot (`"venue": "local-pc"` in that issue's JSON) and clear it when
the pass completes. Two masters on one repo is the double-run that exhausted the weekly limit on
2026-09-01; two masters on two repos at once was ruled out on 2026-09-02 for the same usage reason.

**The claude-dotfiles checkout is not a valid root for a master.** The plugin-served fleet
(`${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/ticket-fleet.js` in `aac-skills`) is cwd-relative
throughout: its scout runs `gh api` with no `-R`, its implement stage uses
`isolation: 'worktree'`, and its verifier runs `git worktree add` "in this repo". A Workflow
launched from a session rooted in claude-dotfiles resolves all three against claude-dotfiles,
and the run on 2026-09-02 stalled on exactly that (issue #44, heartbeats 7 and 8). Triage got
away with it only because a subagent can `cd` first; the fleet cannot. The runbooks are read
from the dotfiles checkout by absolute path; nothing else about a master lives there.

## What changes from the cloud runbook

- **No worker sessions.** Each master dispatches everything in-session, from inside its repo's
  clone: `/triage` and `/to-tickets` run via subagents (Agent tool) spawned with
  `run_in_background: true` — the master does not wait on them. While those subagents run, the
  master keeps working: it runs the merge pass over the repo's open fleet PRs (same policy as
  `RUNBOOK.md` — verifier evidence + green CI + no conflict + no human changes-requested, via
  `gh pr merge`; the CI-never-ran clause and the keep-open rule are there too) and performs the
  takeover-guard check. The fleet (Workflow tool with
  `scriptPath = ${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/ticket-fleet.js` — the plugin-served
  copy that picks the tracker instrument at run time; `gh` exists here, so it uses REST; pass
  `runId` in `args`, minted with `printf %x $(date +%s)`, because the workflow runtime forbids
  `Date.now()` in scripts) is only started AFTER the repo's `/triage` and `/to-tickets`
  subagent results have arrived, because the fleet's scout reads the labels those steps produce.
  The master collects subagent results when their completion notifications arrive rather than
  polling. A master serves ONE repo and never fleets another: the other repos have their own
  masters.
- **Skills are native.** `/triage`, `/to-tickets`, `/project-harness`, `/session-start`,
  `/session-end`, `/grill-ready-for-human` all load from `~/.claude` — invoke them directly instead
  of reading SKILL.md files out of a clone.
- **Pacing: one pass, then stop. No `/loop`.** Serve the repo until nothing is actionable or a cap
  is hit, heartbeating the state issue as you go. Then clear the venue, write
  `**Pass complete — YYYY-MM-DD HH:MM UTC**` (current UTC) at the top of the heartbeat section of
  the state issue, say "pass complete", and end the turn. The watchdog closes this window once the
  marker is newer than the process start, no Heartbeat line is newer than the marker, and the
  session transcript has been untouched for five minutes; then it launches the next repo's master.
  This repo gets its next pass when its turn comes round again. A master that keeps looping after
  its pass holds the only slot and starves the other three repos. Never busy-wait with sleeps.
- **A message after Pass complete reopens the pass.** Before doing anything else, write a fresh
  `**Heartbeat N — <UTC>**` line above the marker; that is what tells the watchdog the pass is
  live again. On 2026-09-02 22:30 UTC the first serial watchdog closed `master-bill-intake` mid
  fleet launch: its marker was from 22:20, Dan had typed into the window at 22:27, and the kill
  rule only compared the marker with the process start (ticket #82). Finish the reopened work,
  then write Pass complete again.
- **Nobody is at the keyboard (Dan, 2026-09-02, verbatim: "I should not ever be asked to
  approve-tickets. I am not at the computer. This is meant to be a completely autonomous run").**
  Never call `AskUserQuestion`; never wait for a typed approval. Anything that needs Dan becomes a
  `ready-for-human` ticket with the evidence in its body, the heartbeat names it, and the pass
  continues. The watchdog launch sets `AAC_ORCHESTRATOR_AUTONOMOUS=1`, and the ask-matt publish
  gate skips its ticket-set approval step under that variable only (ticket #81); the route
  requirement (`to-tickets` / `triage` / `to-spec` declared) still applies. Review happens after
  the fact: every filed ticket carries its measured evidence and a triage label, and the
  heartbeat lists what was filed.
- **Context hygiene.** Heavy work already lives in subagents and workflow agents. When the master's
  own window grows heavy mid-pass anyway, checkpoint everything to its state issue and end the pass
  early with the `Pass complete` line: the repo comes round again after the others, and the fresh
  session resumes losslessly from that issue. Headless `claude -p` is not part of this path — the
  watchdog launches a normal interactive `claude`.
- **Takeover guard, process-based and per repo (Dan, 2026-09-02).** On this PC the 2-hour
  timestamp window is replaced by a live check: another runner is present when either holds, and
  the answer never depends on how old a branch or PR is.
  1. `Get-Process claude` shows a PID this master did not record AND that is not a peer master.
     At boot, record the PIDs it returns (that set is this master's own terminal plus any
     pre-existing sessions) in the `## Handoff summary` of the state issue under item 6. Before
     every fleet launch, run it again. A new PID whose command line (from
     `Get-CimInstance Win32_Process`) carries `--remote-control master-<other-slug>` is a peer
     master the watchdog has not closed yet (it closes finished masters on its next slot) — not a
     reason to defer, but do not start a fleet until it is gone. Any other new PID (another
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
- **Kill switch.** Esc / Ctrl+C in a master's terminal stops the current pass. With no `Pass
  complete` line the watchdog treats that process as still working while it is alive, and once
  the window is closed it launches the next repo on its next slot. Disabling the task
  (`schtasks /Change /Disable /TN "Claude master watchdog"`) stops every launch at once. The state
  issues mean nothing is lost either way.
- **Stall recycle (Dan's ruling, grill session 2026-09-10, issue 89).** Verbatim:

  > Option 1, recycle. N=2 hours, M=30 minutes. Watchdog stops a master whose latest state-issue
  > marker is older than 2h AND whose transcript has been idle 30min, then launches the next
  > repo.

  This overrides the earlier "possibly stalled; not killed" behavior. A stalled master holding
  the only serial slot starves the other three repos, and 2h with no marker plus 30m with no
  transcript write is the shape of a hang, not a slow live pass. The two-condition rule is
  deliberate: age alone kills interactive sessions mid-work; idleness alone kills a fresh
  master before it heartbeats. The pass-complete close path keeps its five-minute idle guard
  unchanged. Defaults live in `master-watchdog.ps1` as `-MaxHeartbeatAgeMinutes 120` and
  `-StallIdleMinutes 30`.
- **Grill phase & ratification.** Same procedure; the decision brief is still a claude-dotfiles
  issue, but rulings can also land straight from Dan typing in a master's terminal — land each one
  on its ticket before moving on.

## Bypass permissions — what it costs (ticket #71)

The watchdog launches every master with `--dangerously-skip-permissions`. Without it the merge
pass cannot run: on 2026-09-02 the auto-mode permission classifier denied `gh pr merge` twice, the
second a single non-looped invocation, so the command itself was what the harness refused, while
auto-merge is ON by Dan's ruling. The flag makes the harness match the ruling.

**First launch asks for an OK once, then never again.** `claude --dangerously-skip-permissions`
opens a "WARNING: Claude Code running in Bypass Permissions mode" dialog until the user setting
`skipDangerousModePermissionPrompt` is true in `~/.claude/settings.json`; accepting the dialog
writes that key. The first serial master (bill-intake, 2026-09-02 16:50 local) sat on that dialog
for four minutes until Dan clicked "Yes, I accept" (settings.json written 16:54:12, first prompt
processed 16:54:39). The key is now set, so later launches start straight away. If a fresh machine
or profile shows the dialog again, that key is the fix, not a watchdog change. The folder-trust
dialog is a separate, unsolved stall: "Accessing workspace ... This folder pre-approves N tool
permissions in .claude/settings.json and .claude/settings.local.json ... Yes, I trust this folder"
rendered on an interactive launch in the contract-builder clone on 2026-09-02 even though
`hasTrustDialogAccepted` was already true for that path in `~/.claude.json` (reproduced through
winpty, captured verbatim). Until that is fixed a fresh master can sit on it until someone clicks;
the watchdog log shows the launch, the state issue shows no Heartbeat 1.

Stated plainly: with bypass permissions on, an unattended master can merge, push, delete branches,
edit issues and run any shell command with no prompt and nobody watching. The merge bar in
`RUNBOOK.md` (verifier evidence, green CI or no CI, no conflict, no changes-requested, the
CI-never-ran clause) is the only remaining gate on a merge, and it is enforced by the master's own
discipline, not by the tool. Do not weaken that bar. These rails stay in force and are the reason
the flag is acceptable:

- Never force-push. Never commit directly to `main` (or the repo's default branch); everything
  lands through a PR that passed the bar.
- Workers and fleets never move a `deploy/*` ref, never run `clasp`, and never touch production data
  paths; Apps Script deploys happen on the merge, by the script itself (claude-dotfiles `gas/`).
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
> never write to it or to another repo's state issue. **Cross-repo reference rule (issue 92):** your
> state issue lives in claude-dotfiles, so a bare `#N` in its body points to a claude-dotfiles
> issue. Every reference to work in `<owner/repo>` — issues, PRs, heartbeat citations — is written
> `owner/repo#N`, never bare `#N`. The watchdog sweeps all four state issues on every tick and
> again after a pass with `node tools/repair-state-refs.js`, so a bare cross-repo `#N` whose
> paragraph names `<owner/repo>` is auto-qualified within about ten minutes; writing them right the
> first time keeps every heartbeat honest and stops needless issue edits. Check your state issue
> for the current state
> and that no other master serves `<owner/repo>`; claim venue local-pc there. Then run ONE pass, no
> `/loop`: serve this repo until nothing is actionable or a cap is hit, heartbeating as you go. When
> the pass is done, clear the venue, write a line `**Pass complete - YYYY-MM-DD HH:MM UTC**`
> (current UTC) at the top of your state issue's heartbeat section, say pass complete, and stop;
> the watchdog closes this window and starts the next repo. My messages in this terminal override
> everything.

The remote-control session name is `master-<slug>` (`master-bill-intake`, `master-contract-builder`,
`master-sales-cockpit`, `master-zoho`), which is also what the watchdog's alive check and the
takeover guard's peer rule match on.

## Relaunch watchdog (issue 64; per repo since issue 70; serial since issue 79)

A closed terminal, a reboot, or a crash used to stop the babysitter until Dan noticed.
`orchestrator/master-watchdog.ps1` closes that gap and is also the scheduler that hands the single
slot from repo to repo. Every 10 minutes (Task Scheduler, "only run when user is logged on") one
slot does this:

1. **Legacy guard.** A process with the old shape `--remote-control master "<prompt>"` (bare
   `master`, rooted in claude-dotfiles) blocks everything: the watchdog prints its PID and the
   `Stop-Process` line and exits. Stop it; the next slot proceeds.
2. **Alive masters.** Every `claude.exe` or `node.exe` process with `--remote-control
   master-<slug>` on its command line. For each, the watchdog reads that repo's state issue. The
   master is finished only when all three hold: a `**Pass complete — YYYY-MM-DD HH:MM UTC**`
   line newer than the process start; no `Heartbeat` line newer than that marker (a later
   heartbeat means the pass was reopened); and the newest transcript under
   `~/.claude/projects/<clone slug>/` untouched for five minutes (`-IdleMinutes`). Then the
   watchdog stops the `claude` process and its `cmd.exe /k` wrapper window and records that. Any
   other alive master is still working, and the slot ends with no launch. **Stall recycle
   (Dan, grill session 2026-09-10, issue 89):** a master whose latest state-issue marker is
   older than `-MaxHeartbeatAgeMinutes` (default 120, N=2h) AND whose transcript has been idle
   at least `-StallIdleMinutes` (default 30, M=30m) is stopped and the next repo is launched
   on the same slot. Both conditions must hold — age alone would kill a live interactive
   session mid-work, idleness alone would kill a fresh master that has only written one
   Heartbeat. If only the marker is stale but the transcript has been touched inside M, the
   watchdog logs "possibly stalled; not killed" and moves on.
3. **Launch the next repo.** With nothing alive, pick the repo never served yet (priority order:
   bill-intake, contract-builder, sales-cockpit, zoho), else the one whose latest marker is oldest,
   and run `Start-Process cmd.exe /k cd /d "<clone>" && claude --dangerously-skip-permissions
   --remote-control master-<slug> "<boot prompt>"` in a fresh visible window rooted in that clone,
   with `AAC_ORCHESTRATOR_AUTONOMOUS=1` set in that window's environment — the window stays on
   the desktop and the same session shows up at claude.ai/code and in the Claude mobile app.
   Exactly one launch per slot, and only when nothing is alive.

Every decision is appended to `~/.claude/hook-state/master-watchdog/watchdog.log` with a UTC
stamp. A scheduled task's stdout goes nowhere, and the 22:30 kill above had to be reconstructed
from process tables and issue timestamps; read the log first next time.

`-Only <slug>` restricts the candidates; `-WhatIf` prints every decision and neither stops nor
launches anything; `-Force` skips the guards and launches the next repo regardless. The launched
process is fully independent of the watchdog run. A pass that ends between slots leaves the window
open for at most 10 minutes before the watchdog closes it.

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

   Default `-FirstRunMinutes 10` puts the first slot 10 minutes out (one full interval away)
   rather than the +1 minute the earlier script used. If you want the first slot to fire in one
   minute for a live smoke test, pass `-Install -RunNow` — you have to ask for it.

The task registers under the current user via `schtasks.exe /IT /RL LIMITED`. `Register-ScheduledTask`
with the INTERACTIVE principal needed elevation on this machine (2026-09-02); `schtasks /IT` did not.
One task serves all four repos; the serial hand-off is inside the script. The interval dropped
from 30 to 10 minutes with issue 79 so a finished pass does not hold the slot for half an hour;
a watchdog run is four `gh issue view` calls and a process listing.

Run once by hand (only after `-Install`):

```powershell
schtasks /Run /TN "Claude master watchdog"
```

Stop the watchdog for good:

```powershell
schtasks /Delete /TN "Claude master watchdog" /F
```

Disable temporarily (task stays, next slot skipped) with `schtasks /Change /Disable`; re-enable
with `/Enable`. Ctrl+C in a launched master window stops that pass; close the window and the
watchdog moves to the next repo on its next slot.

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

### Verified on 2026-09-02 (attempt 5, one master at a time — ticket #79)

Fake masters were `node fake-master.js --remote-control master-zoho`, which satisfies the
`claude.exe OR node.exe` filter the real check uses. The pass-complete marker was written into
issue #77 for the test and removed right after (body confirmed identical to the original).

- Windows PowerShell 5.1, nothing alive, `-WhatIf` -> four `last served: never` lines, then ONE
  launch line, `[bill-intake] NEXT - would launch: ... --remote-control master-bill-intake ...`,
  exit 0. Priority order decides among never-served repos.
- PowerShell 7.6.5, fake `master-zoho` alive, no marker, `-WhatIf` -> `[zoho] MASTER ALIVE
  pid=28896, no marker yet (booting)` then `one master at a time: 1 alive - exit 0, no launch`.
- `-Only contract-builder,zoho -WhatIf` -> `[contract-builder] NEXT`; the comma-joined `-Only`
  string that `-File` passes is split inside the script.
- Fake `master-zoho` alive, then `**Pass complete — <UTC one minute ahead>**` written into #77:
  `-WhatIf` -> `[zoho] PASS COMPLETE at 2026-09-02 21:38:00Z (master started 2026-09-02
  21:37:40Z) - closing pid=25416`, `-WhatIf: not stopped`, no launch. The real run with `-Only
  bogus` (so nothing could launch) -> `[zoho] stopped claude pid=25416`, then `ERROR: -Only
  matched no repo; nothing launched`, exit 1; the fake process was gone afterwards.

### Verified on 2026-09-02 (attempt 6, reopen and idle guards — ticket #82)

Fake master `node fake-master.js --remote-control master-zoho`, test markers written into issue
#77 and removed afterwards (body confirmed restored), a fake transcript file in the zoho project
folder whose mtime was set by hand.

- Marker one minute ahead of now, transcript just written -> `[zoho] MASTER ALIVE ...: Pass
  complete ... but transcript written 0m ago (< 5m) - still in use, not closed`, then `one master
  at a time: 1 alive - exit 0, no launch`.
- Same marker plus a `Heartbeat 9` two minutes ahead -> `... Pass complete ... superseded by
  Heartbeat ... - pass reopened, working`, no launch.
- Same marker, no newer heartbeat, transcript mtime moved ten minutes back -> `[zoho] PASS
  COMPLETE at ... transcript idle 10m) - closing pid=...`, `-WhatIf: not stopped`; the real run
  with `-Only bogus` then printed `stopped claude pid=...` and the fake process was gone. The
  transcript is matched by creation time after the process start, not last-write time: the
  first cut filtered on last-write and a ten-minute-old transcript vanished from the search,
  which read as "no transcript" and (safely) as in use.
- Nothing alive under Windows PowerShell 5.1 -> one launch line for contract-builder (bill-intake
  now has a marker, so it is no longer first), carrying `set AAC_ORCHESTRATOR_AUTONOMOUS=1 &&`.
- The log file received one stamped line per decision.

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
at hourly pacing. Serial passes mean one master's overhead at a time, not four. Set
`maxWavesPerRepoPerDay` accordingly BEFORE the first pass; local execution spends from the same
account-level usage pool as cloud — running here prevents double-running, it does not make tokens
cheaper.
