---
name: agent-sessions-visible
description: Dan wants every launched task agent to run as a session he can see, not a hidden background job
metadata:
  type: feedback
---

Dan, 2026-10-02, after six task agents ran as `claude --bg` jobs: "why do you need to start
non-interactive sessions? I'd rather do a session I can see running."

**Why:** a `claude --bg` job never shows in the desktop app's sidebar; it is reachable only by
`claude attach <id>` from a terminal, so Dan cannot watch or steer it. The same day a duplicate
session ran unseen for the same task.

**How to apply:** start task agents where Dan sees them (a desktop-app session in the sidebar, or a
terminal tab he can watch), named after the task, pinned to Opus 5.5 per
[[launched-agents-run-on-opus]]. Built 2026-10-02: the agent-launcher routine opens each task as a
one-time scheduled task `agent-<task id>`, a titled sidebar session (todoist-triage agent-sweep.md
§ Launch). Use `claude --bg` only when he asks for it.
