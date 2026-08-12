---
name: sweep-manages-priority-not-dates
description: "Dan's rule: the daily sweep manages PRIORITY only, never due_date/deadline. Escalation raises p2->p1 but leaves both dates exactly as Dan set them."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 139aab06-0c78-41ac-9748-31d76f57fa8d
  modified: 2026-07-23T01:12:43.948Z
---

The daily sweep **manages priority, Dan manages dates.** Decided 2026-07-22 when
Dan caught that the old `p1 ⟹ due=deadline=today` invariant would yank a p2's
due AND deadline to today the moment its deadline crossed the 7-day line.

**Why:** a Todoist *deadline* is a hard/immovable date and a *due date* is when
he plans to work it — the sweep forcing both to today destroyed real dates he
set on purpose (it would have rewritten all 22 of his curated p1s' 7/24–7/29
deadlines to today).

**How to apply — the principle now holds across ALL of `aacx/pipeline/hygiene.py`; no rule changes a date:**
- `rule_priority_deadline_sync` (commit `e2db193`): escalation (contract→p1,
  deadline-today→p1, p2-with-deadline-within-7-days→p1) emits ONLY a `priority`
  change (+`claude` label); never touches due/deadline.
- `rule_stale_downgrade` (commit `9c90919`): downgrades a stale p1→p2 by priority
  only; no longer clears the due date.
- `rule_zero_past_due` (commit `9c90919`): now fully propose-only — a non-p1
  routine past-due task is SURFACED as a `mode='propose'` reschedule, never
  auto-moved. (The dead `_split_change_actions` helper was removed as a result.)

Branch `claude/task-management-orchestration-9bd37f`, 283 tests green.
Consequences to remember: no rule auto-fixes a **past-due p1**'s date anymore
(Dan's to manage), so "past-due → 0" is no longer a sweep guarantee; and the
`past_due_cleared` run_log metric now always reads 0 (kept for metrics_json
shape stability, no auto past-due clears happen). See [[one-brain-plan]].
