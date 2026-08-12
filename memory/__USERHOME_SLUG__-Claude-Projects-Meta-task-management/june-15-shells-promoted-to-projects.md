---
name: june-15-shells-promoted-to-projects
description: "The 2026-06-15 [AAC]/[Home] task shells are now 53 real Todoist projects; both backlogs dropped far under the item cap."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b0f9795-d748-4ce6-a1b2-9fae4b98af30
  modified: 2026-08-10T16:17:21.877Z
---

Claude wrote 245 tasks on 2026-06-15 — 55 top-level, 190 subtasks. 53 of the
parents carried an `[AAC]` (20) or `[Home]` (33) prefix and 2–6 subtasks each:
project shells written as tasks, with ROI and cost data in the description.

Promoted 2026-08-10 on Dan's instruction. Project name = parent content minus
the prefix; project description = the parent's description; subtasks moved in;
**the 53 parent tasks were deleted**. `[AAC]` nest under `Work project backlog`
(`6JV2JWc2Q97GVGpG`), `[Home]` under `Personal Project Backlog`
(`6XMPRhr52F77prfj`).

Two 2026-06-15 tasks were deliberately left alone — no prefix, no subtasks:
`6grj85vMvGGMqVvJ` (back light) and `6grq7fGWrhw7jmJr` (Hippo renewal).

Machine readback: 53 projects present and nested right, 53 of 53 task counts
match, 0 former parents still listed, board counts **Work 303 → 211** and
**Personal 219 → 68**.

That satisfies #118's capacity criteria without pruning. #118 stays open on its
durable half: no capacity check in `triage._create_board`, a 403 surfaces
nowhere a human reads, the retry is unbounded, and `error_code: 49` is not a
routing signal. Action 1970 still needs reconciling.

Backup of every field of all 243 affected tasks:
`data/promote-projects-backup-20260810.json` (gitignored, local only). Script:
the session scratchpad's `promote_projects.py`.

Todoist returns **200 with `is_deleted: true`** for a deleted task, never 404 —
a 404 check reads as "nothing was deleted" and is wrong.

Related: [[live-writes-on-noise-gate-open]], [[sweep-manages-priority-not-dates]].
