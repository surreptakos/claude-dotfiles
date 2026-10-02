---
name: launched-agents-run-on-opus
description: Every agent session started for a Todoist task runs on Opus 5.5, named on the launch command
metadata:
  type: feedback
---

Every agent session launched for an approved Todoist task runs on Opus 5.5 (`--model claude-opus-5-5`),
never Fable. Dan, 2026-10-02: "stop launching them in fable, use opus 5.5".

**Why:** a launch command without `--model` inherits the launching session's model; the triage
session that launched six task agents on 2026-10-02 was Fable, and Fable usage is rationed
([[fable-usage-is-rationed]]).

**How to apply:** task agents open as sidebar sessions from one-time scheduled tasks, which take the
app's default model (Opus 5.5 on the anchor PC); the agent's first step checks its own model and
stops on any other ([[agent-sessions-visible]]). Any command-line launch names `--model` explicitly
(`claude --model claude-opus-5-5 ...`). Launch each task once: an existing `agent-<task id>`
scheduled task means it was started.
