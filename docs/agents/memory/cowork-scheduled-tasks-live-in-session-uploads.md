---
name: cowork-scheduled-tasks-live-in-session-uploads
description: "A Cowork scheduled task is stored as uploads/SKILL.md inside the session that created it, on that machine only; nothing else lists it, and the run record's enqueue line is the only copy of the prompt once it is gone"
metadata: 
  node_type: memory
  type: project
  originSessionId: e01e3089-959f-4ea4-a64a-03ab48ff7887
  modified: 2026-09-10T16:58:47.324Z
---

Cowork scheduled tasks (Desktop app, Cowork tab, "Scheduled") run in the cloud, but are neither
claude.ai Code routines nor desktop Code scheduled tasks, and no tool on this laptop lists them.
Owner ruling 2026-09-10: Todoist Triage is Active Alarm's cloud routine. Verified the same day
while hunting it after it vanished:

- `RemoteTrigger list` (claude.ai/code/routines) returned zero under both the personal and the
  Active Alarm account; the task never lived there.
- The per-org `scheduled-tasks.json` files under
  `%APPDATA%\Claude\local-agent-mode-sessions\<account>\<org>\` stayed empty since August; the
  desktop Code registries under `claude-code-sessions` never carried it either.
- The run record (a `queue-operation` `enqueue` line in the Cowork session jsonl on the work
  laptop) names the definition file: `local-agent-mode-sessions\<account>\<org>\<session>\uploads\SKILL.md`.
  The task is that one file inside its creating session. Delete or purge the session, or let a
  Desktop update replace the VM disk (anthropics/claude-code#38055, closed not planned), and the
  task is gone with no log.
- The enqueue line's `content` field carries the full task prompt verbatim, so the last run
  record is the recovery copy. Decode `\n` and `\"`, strip nothing.

**Why:** two sessions were spent proving a negative across four registries and two accounts
before the run record surfaced the answer.

**How to apply:** when a Cowork scheduled task "disappears", go straight to the creating machine
and grep its Cowork session jsonl files for `<scheduled-task name=`; recreate from the newest
enqueue line. Related: [[desktop-scheduled-tasks-are-per-org]], [[cowork-transcripts-not-local]],
[[account-enforcement-is-a-warning]].
