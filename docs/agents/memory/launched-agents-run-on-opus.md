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

**How to apply:** name the model on every `claude --bg` or `--cloud` launch. `claude --cloud`
also refuses a non-interactive terminal, so unattended launches use `claude --bg`
(aac-routines `agent_launcher.py`). Launch each task once: an unread start outcome counts as
started until a listing proves otherwise.
