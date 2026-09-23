---
name: routine-sessions-run-acceptedits
description: "A Routine-fired session runs acceptEdits, not the auto the repo's settings ask for, so an unlisted tool parks it with nobody to answer"
metadata:
  node_type: memory
  type: project
  originSessionId: 8984331b-5b3d-5b1f-bea2-57cd30c426f0
  modified: 2026-09-21T20:35:00.000Z
---

A cloud session started from the claude.ai UI reports `PERMISSION_MODE_AUTO`. A session a
Routine fires reports `PERMISSION_MODE_ACCEPT_EDITS`, even where the served repo's
`.claude/settings.json` sets `permissions.defaultMode: "auto"`. Measured 2026-09-21 on
`session_017968dPwBH7wfqkGY5idGfb` (`master-contract-builder`, `origin: force_run_trigger`).
`create_trigger` has no permission-mode parameter, so nothing in the Routine's own record
chooses this.

What it costs: a tool that is not in `permissions.allow` needs a decision, and an unattended
Routine has nobody to make one. That wake called `Workflow` for `ticket-fleet.js` and stopped at
`SESSION_STATUS_REQUIRES_ACTION` with `pending_action.display_tool_name: "Workflow"`. It held
its venue claim on #75 with no `Pass complete` line for the full 90 minutes, so the next hourly
wake exited too — one parked wake costs two.

The `autoMode.allow` ruling does not help here. That prose answers the classifier's question; it
does not remove the question, and in acceptEdits the question is asked by the permission layer
before the classifier ever sees it. Only a `permissions.allow` entry removes it.

So the allow list has to name every tool an unattended master uses, not just `Bash(*)`, `Edit`,
`Write` and `mcp__github__*`: harness v32 adds `Workflow`, `Agent`, `Task` and
`mcp__Claude_Code_Remote__*`. When a master gains a new instrument, add it to
`add-cloud-plugin.js` and re-run it, or the first unattended wake to reach for it parks.

Read a parked wake from the session record, not from the state issue: the issue shows a venue
claim, which is what a live run looks like too. `get_session` on the `venueSessionId` names the
tool in `pending_action`. See #651.

**2026-09-23:** this is the first of the three blockers ADR 0001
(`docs/adr/0001-orchestrator-masters-run-on-the-desktop.md`) cites for moving the masters back to
the desktop; the four `master-*` Routines are disabled, not deleted.

**2026-09-23:** this is the first of the three blockers ADR 0001
(`docs/adr/0001-orchestrator-masters-run-on-the-desktop.md`) cites for moving the masters back to
the desktop; the four `master-*` Routines are disabled, not deleted.
