---
name: desktop-scheduled-tasks-are-per-org
description: Claude desktop scheduled tasks register per account+organization in %APPDATA%\Claude\claude-code-sessions\<account>\<org>\scheduled-tasks.json; SKILL.md prompts are shared; an org switch kills every running session of the old org and catch-up fires one slot only
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2bfa36c5-6256-41a2-b711-d3f508c2f1f3
  modified: 2026-09-02T17:21:42.128Z
---

Claude desktop keeps one scheduled-task registry per signed-in account-and-organization pair at
`%APPDATA%\Claude\claude-code-sessions\<accountUuid>\<orgUuid>\scheduled-tasks.json` (top-level key `scheduledTasks`, an array; fields:
`id`, `cronExpression`/`fireAt`, `enabled`, `filePath`, `cwd`, `model`, `permissionMode`,
`approvedPermissions`, `lastRunAt`, `lastScheduledFor`). The prompt itself is only the
`SKILL.md` under `~/.claude/scheduled-tasks/<id>/`, shared by every account, read at spawn.
`list_scheduled_tasks` shows only the org the app is signed into; an empty list with 20+ dirs
on disk means "wrong org", not "nothing scheduled". Dan's three: work account
`b138160d` with org `4f58f937` (work side, where the live routines were registered) and org
`171309ff` (personal side, team plan), and gmail account `a5782f9f` / org `65b7921c`. On
2026-09-02 the live set was cloned into all three so routines fire whichever side is active;
on 2026-09-09 that was reversed: the owner's account map puts the six routines under Dan-AAC
only, the app itself had already emptied the `4f58f937` registry (rewritten 2026-09-09 10:51,
so the app DOES rewrite registries), and the `a5782f9f/65b7921c` copies were set
`enabled: false` (backup beside the file, `.bak-account-registry-*`). The owner map lives in
`~/.claude/accounts.json`; the session check audits every registry against it from
claude-dotfiles (see [[account-enforcement-is-a-warning]]).

**Why it matters:** switching organization tears down every session of the old org within
seconds (`main.log`: "Query closed before response received", `hadFirstResponse=false`) and the
registry stamps `lastRunAt` at spawn, so a killed run counts as done for the day. Catch-up after
a gap spawns one run for the most recent missed slot only, never one per missed day. The app
reads each registry at org init, so file edits take effect on the next switch or restart. aac-routines `scripts/run_stamp.py` is the cross-org guard
(check before work, mark after summary).

**How to apply:** diagnose "my routine did not run" by checking `[CCDScheduledTasks]` lines in
`%LOCALAPPDATA%\Claude\Logs\main.log` and the org-specific registry, not the SKILL.md dirs. See
[[fable-usage-is-rationed]] for why routines pin `claude-opus-4-7`.
