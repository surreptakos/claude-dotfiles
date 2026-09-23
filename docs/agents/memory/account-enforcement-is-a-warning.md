---
name: account-enforcement-is-a-warning
description: "Two Claude accounts share this machine; ~/.claude/accounts.json is the owner map and every check against it warns, never blocks (Dan, 2026-09-09)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9a85a532-a801-4be2-ba5a-31f9c4cf1e7d
  modified: 2026-09-09T19:46:47.845Z
---

Account-to-repo and account-to-routine enforcement is a **warning, never a hard gate** (Dan,
2026-09-09, issue 103). The registry is `~/.claude/accounts.json` (whitelisted, travels with the
dotfiles): Dan-AAC (desktop app) owns claude-dotfiles, aac-routines, aac-message-board,
aac-sales-commissions and the desktop routines the registry's `routines` map lists; Dan (CLI,
mobile, web, Task Scheduler) owns aac-bill-intake, zoho-source-of-truth, aac-sales-cockpit and
aac-contract-builder. Which account the desktop watchdog masters run as is open (issue 714: the CLI
on the PC is signed in as Dan-AAC, and every watchdog tick warns).

**Todoist Triage moved twice.** Ruled Active Alarm's Cowork task `todoist-triage-friday` on
2026-09-10; a claude.ai/code routine from 2026-09-11; since 2026-09-23 the desktop task
`todoist-triage-local` under Dan-AAC/team, weekdays 8:30 AM Central, with the cloud Routine paused
(issue 707). The registry's cloud `todoist-triage` entry was removed 2026-09-23 (issue 526).
History in [[cowork-scheduled-tasks-live-in-session-uploads]].

**Why:** the owner kept losing track of which account did what, and a stale desktop registry had
six routines enabled under the wrong account. A block would fire on every deliberate cross-account
session and get muted; a `!!` line in the session report is read.

**How to apply:** identity comes from disk, never from memory — desktop: the path of the
host-session file under `%APPDATA%\Claude\claude-code-sessions\<account>\<org>\`; CLI: `oauthAccount`
in the profile's `.claude.json`. Cloud, mobile and Cowork have no local identity: say so, do not
guess. When a repo or routine changes hands, edit the registry in the same turn. Related:
[[desktop-scheduled-tasks-are-per-org]].
