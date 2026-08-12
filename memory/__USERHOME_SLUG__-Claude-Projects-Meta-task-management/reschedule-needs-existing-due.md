---
name: reschedule-needs-existing-due
description: "Todoist reschedule-tasks can't ADD a due date; p2→p1 escalations on undated tasks need update-tasks dueString."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3c5d6753-27f6-449e-a3c0-b9780f8570e5
---

Todoist MCP `reschedule-tasks` **requires an existing due date** — it only moves a date, it cannot add one. Error: "Task ... has no due date. Rescheduling requires an existing due date."

The daily sweep's `priority_deadline_sync` rule emits `kind:"reschedule"` with `due_date=today` for p2→p1 escalations, but many hygiene-board tasks carry only a **deadline**, no due date. For those, `reschedule-tasks` rejects the whole (transactional) batch.

**Fixed in code 2026-07-17** (commit `fix(hygiene): route add/clear-due ...`): `aacx/pipeline/hygiene._split_change_actions` now takes the task's current `due_date` and routes — due set while a due already exists → `reschedule` (move; recurrence-safe); due added (no existing due) or cleared → `update` (dueString); `deadline_date` any change → `update` (deadlineDate); priority/labels/content → `update`. So the daily sweep no longer emits a `reschedule` that reschedule-tasks would reject. Recurring tasks never reach that path (excluded or routed to `propose`), so the update-dueString add is safe — the exact hazard the "never update-tasks for date moves" rule guards is untouched. See [[mcp-text-vs-json]] for the sibling connector/adapter gap.
