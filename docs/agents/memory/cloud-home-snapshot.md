---
name: cloud-home-snapshot
description: "A cloud container's ~/.claude comes from an environment snapshot, so a failed bootstrap is served to later sessions until one re-runs it; a session whose project dir is not a harnessed repo never reaches the repo-anchored hook (2026-09-21, issue 643)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9db8884f-fee5-5e2e-94b2-7e69cca90c7c
  modified: 2026-09-21T18:30:00.000Z
---

Two facts about cloud containers that together hid a two-day outage of the rules, the governance
hooks and the skills, with every gate green (issue 643).

**The home is a snapshot, not a fresh install.** `~/.claude` in a cloud container is restored per
environment, so whatever the last run left is what the next session reads. On 2026-09-21 a
Routine-fired session read `~/.claude/hook-state/aac-bootstrap/state.json` saying
`"failed": true, "stage": "clone", "failed_at": "2026-09-19T14:02:16Z"` — a real bootstrap run
from the day the repo was still private — while the same environment's web sessions bootstrapped
fine. Measured in a healthy session the same hour: marker and `settings.json` both written 17:37,
`copied_this_run: 0` against a payload built at 16:08, which is only possible if a previous
session's home came back. So "the marker says X" answers *what the image carried*, not *what this
session installed*: compare its `installed_at` to the container's boot time before believing it
(`session-check` does this now and warns).

**Delivery cannot ride `$CLAUDE_PROJECT_DIR` alone.** The repo-anchored entry
(`bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"`) runs only when the session's project
dir IS that harnessed repo. A Routine-fired session carrying two repository sources, and an
agent-minted Routine session carrying none (its `session_request.config.sources` is `[]`, issue
226), never reach it — and a Routine created via the claude.ai UI or the HTTP API cannot be fired
by an agent (`fire_trigger` refuses: "agents can only fire routines they created"), so the shape
is hard to reproduce from a session. Harness v31 seats a copy of the hook at
`~/.claude/hooks/aac-bootstrap.sh` in USER settings, which every session in the container runs
whatever its project dir is; one good bootstrap in an environment makes every later session retry.
