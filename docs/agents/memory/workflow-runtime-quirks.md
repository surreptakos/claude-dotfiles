---
name: workflow-runtime-quirks
description: Workflow tool traps - named workflows are session-start snapshots (launch by scriptPath), scripts cannot call Date.now()/Math.random() (fleet needs args.runId), scriptPath refuses a CRLF file (2026-09-15), the tool call uses the session's cwd AT CALL TIME, not the served repo (2026-09-23), and each agent's worktree follows the cwd at spawn, so never cd mid-run (2026-09-28)
metadata:
  type: project
---

Two Workflow-tool behaviours that cost a fleet launch each on 2026-09-01:

1. **Named workflows snapshot at session start.** `Workflow({name: 'ticket-fleet'})` ran the copy of
   `.claude/workflows/ticket-fleet.js` as it was when the session began, twice, after the file had
   been fixed and merged. Launch an edited script with `scriptPath` pointing at the repo file, or
   start a new session.
2. **Scripts cannot call `Date.now()`, `new Date()` or `Math.random()`.** The runtime throws
   `Date.now() / new Date() are unavailable in workflow scripts (breaks resume)`. A run earlier the
   same day (`wf_5e514967jumm`) still got through, so the ban landed between runs. Both fleet
   scripts now require `args.runId` (PR #55); mint it with `printf %x $(date +%s)`.

3. **`scriptPath` refuses a CRLF script.** Pointing `scriptPath` at the plugin's
   `ticket-fleet.js` (37 KB, 443 CR bytes, as installed under the desktop plugin cache on
   2026-09-15) fails before launch with `script contains control characters that would be
   hidden in the approval dialog`. Copy the file with `tr -d '\r'` into the scratchpad and pass
   that path; the run itself is unaffected.

4. **The `Workflow` tool call resolves `scriptPath` relative to the harness's cwd at the moment of
   the call, and that cwd is asynchronous** — a background "Primary working directory" update from
   an earlier `Bash` `cd` or environment event can still be `/home/user` when `Workflow` fires, even
   though the served repo's clone sits at `/home/user/<repo>`. Measured 2026-09-23 on an
   `aac-bill-intake` orchestrator pass: `Workflow({scriptPath: '.claude/workflows/ticket-fleet.js'})`
   launched with cwd `/home/user` (not a git repo) failed all 3 implementers identically with
   `Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are
   configured` — 0 delivered, no branches created, nothing to resume. Relaunching with an ABSOLUTE
   `scriptPath` (`/home/user/<repo>/.claude/workflows/ticket-fleet.js`) after confirming
   `git rev-parse --is-inside-work-tree` is `true` at the served repo's path ran clean. Always pass
   an absolute `scriptPath` for a per-repo fleet launch, and verify the repo path is a git worktree
   with a direct `Bash` check immediately before the `Workflow` call — do not trust the
   "Primary working directory" environment line alone, since it can be stale relative to the actual
   call.

5. **Each agent's worktree comes from the session's cwd at the moment that agent spawns, not at
   launch.** Cockpit run 6abac727 (2026-09-28) launched cleanly from the cockpit, then the
   orchestrator ran `cd /home/user/claude-dotfiles && ...` for unrelated work mid-run. The retry
   implementer spawned after that got a claude-dotfiles worktree; it noticed and cloned the cockpit
   itself, so nothing broke, but the launch guard (issue 950) only checks at launch. While a fleet
   runs, never move the session: use `git -C <path>` or a `( cd <path> && ... )` subshell for any
   other repo. Dan declined a per-worker repo check on 2026-09-28, so this discipline is the guard.

**Why:** the `workflow-authoring` skill documents rule 2 and it was dismissed as stale on the strength
of one successful run. A live launch settled it. Rule 1 is documented nowhere. Rule 4 is undocumented
in `orchestrator/RUNBOOK.md`'s dispatch section, which names only a relative
`scriptPath = .claude/workflows/ticket-fleet.js`.

**How to apply:** after editing any workflow script, launch via `scriptPath`, from an LF copy when
the source is CRLF. Every fleet launch
(`orchestrator/LOCAL-RUNBOOK.md`, `orchestrator/RUNBOOK.md`, a hand launch) passes `runId`. See
[[fable-usage-is-rationed]] for the model pins the fleet keeps. For a cloud-Routine master, use an
absolute `scriptPath` and confirm the repo cwd right before the call (rule 4).
