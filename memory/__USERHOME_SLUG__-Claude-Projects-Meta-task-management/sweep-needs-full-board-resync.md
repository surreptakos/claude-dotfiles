---
name: sweep-needs-full-board-resync
description: A sweep on a store that lags a manually-curated board computes spurious auto-escalations; full board re-sync is a hard pre-req before live_writes.
metadata: 
  node_type: memory
  type: project
  originSessionId: 241056fa-0d29-40f0-bf09-04b35ba704b1
  modified: 2026-07-23T15:28:48.859Z
---

First authenticated end-to-end sweep ran 2026-07-23 (live_writes OFF, zero board
writes). The store was a ~7/20 snapshot; Dan had since curated the live board
(completed ~34 tasks, moved ~30 out of Current Work, cleared the old +7 deadline
batch, added `no-sweep` labels). Running `plan` against the stale store computed
**23 spurious auto p2→p1 escalations**: 20 backlog tasks Dan had moved to Work
backlog with their 7/24 deadlines cleared (the store still had CW + deadline
7/24, which fell inside the <7-day escalation window as time passed — the
"+7 parked batch" problem), and 3 tasks Dan `no-sweep`-labeled on the live board
whose labels the store lacked (the contract/schedule-review regex then fired).

**Why:** the aacx pipeline is purely additive/upsert (INSERT OR IGNORE on
raw_events keyed by content_hash; normalize takes newest per external_id). It has
NO board-membership/deletion reconciliation — a task that MOVED self-heals only
if its new board is fetched; a DELETED task (found one: `6gvWG7x2874crM8J`) never
heals; cleared deadlines/added labels only land if that board is re-fetched.
`find-tasks` has no incremental filter, so "refresh" means re-fetching whole
boards. `fetch-object` returned STALE data for the deleted task — trust the
`find-tasks` list queries and the `overdue`/label filters, not `fetch-object`.

**UPDATE 2026-07-23 — the reconciliation gap is now CLOSED in code.**
`aacx reconcile-membership` (module `aacx/pipeline/membership.py`) + a
`todoist_tasks.removed_at` marker: pipe it a full per-board open-task snapshot
(`{"boards": {"<board_id>": ["<todoist_id>",...]}}`, the `find-tasks` id lists) and
it heals moves, un-removes reappearances, and marks departed tasks `removed_at`
(store-only, NEVER a Todoist delete; excluded from every task-set like
`duplicate_of`; self-healing). Wired as daily-sweep step 4a. Live DB migrated
(backup `data/aac.db.pre-membership-bak`). Still pass the FULL board set (removal
is scoped to snapshotted boards; a move to an unfetched board is temporarily
mis-flagged, self-heals next run). 291 tests green. So the re-sync is now a
tool-driven step, not hand-surgery on the store.

**First re-sync run same day:** live find-tasks confirmed Current Work = 19
(curated) vs store 27. The 8 stale CW rows resolved — 5 were real tasks Dan moved
to Work backlog (re-homed), 3 were gone (marked removed_at). golive-report GREEN
(past-due 0, p1 22, actions []). Backlogs deferred but proven gate-neutral (0
past-due, 0 escalation-window p2). `find-tasks` returns the FULL open membership
per board (no incremental filter) so it IS the authoritative snapshot; use
responsibleUserFiltering:"all" for shared boards. Backup data/aac.db.pre-resync-bak.

**How to apply:** before flipping `live_writes` ON, fully re-sync the store to the
live board — fetch ALL hygiene boards (Current Work, Work backlog, Current
Personal, Personal backlog) + completed + current labels — or a naive first live
sweep would re-escalate backlog items Dan just demoted and escalate no-sweep
tasks (the explosion [[step3-stage-backfill-explosion]] / [[hygiene-contract-regex-overmatch]] warned about). After full reconciliation the live board
yields **0 auto changes / GREEN** (past-due 0, golive-actions []), matching the
HANDOFF prediction. Shortcuts that worked: `find-tasks filter:overdue` and
`labels:[park|no-sweep]` give authoritative gate ground-truth cheaply without
transcribing the ~950-task board. See also [[sweep-manages-priority-not-dates]],
[[p1-escalation-boundary]].
