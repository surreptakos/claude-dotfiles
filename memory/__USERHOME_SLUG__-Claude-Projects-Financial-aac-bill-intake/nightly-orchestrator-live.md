---
name: nightly-orchestrator-live
description: Nightly ticket orchestrator KILLED 2026-08-25 (scheduled task Disabled) — fleet runs are manual now; contract/paths below still valid for manual runs
metadata: 
  node_type: memory
  type: project
  originSessionId: 8d9f7456-f33f-446e-b603-7e9e2a4a7b6e
  modified: 2026-08-25T14:15:02.917Z
---

**UPDATE 2026-08-25: the owner killed the nightly run.** `schtasks /query` shows the task
`Status: Disabled, Next Run Time: N/A` (verified 2026-08-25). Ticket-fleet runs are MANUAL now —
see [[next-orchestrator-run-openers]] for what the next manual run executes first. The contract,
worktree layout and log paths below stay valid for those manual runs.

From 2026-08-18 to 2026-08-25 a nightly orchestrator (Windows scheduled task `aac-bill-intake nightly ticket
agent`, daily 02:05, enabled) ran Fable 5 headless against the main checkout and spawns one Opus
4.7 CLI sub-session per `ready-for-agent` issue in a worktree under
`__USERHOME__\.claude\nightly-agents\aac-bill-intake\worktrees\`. Delivery is a PR per ticket —
it never pushes main, never `clasp push`/`deploy`, never writes BILL or Desk. Contract:
`__USERHOME__\.claude\nightly-agents\aac-bill-intake\prompt.md`; runner logs in that dir's
`logs\`; out-of-scope findings append to its `FOLLOW-UPS.md` (Dan feeds to /to-tickets). Token is
shared from `__USERHOME__\.claude\nightly-aac-agent\token.txt`. Morning sessions: expect fresh
overnight PRs and issue comments; check `gh pr list` and FOLLOW-UPS.md before planning.
02:05 chosen: 3h clear of the aac-cockpit agent (23:05) and right after the 02:00 Central
UrlFetch quota reset. See [[urlfetch-quota-is-the-ceiling]].
