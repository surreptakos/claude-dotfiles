---
name: aac-routines-replaces-aacx
description: "2026-08-05 decision — stop building aacx, imitate the Cowork scheduled tasks in Meta/aac-routines; all AACX automation stays off."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b0f9795-d748-4ce6-a1b2-9fae4b98af30
  modified: 2026-08-10T19:32:06.395Z
---

**The engine in `Meta/task-management` is not the current plan.** On 2026-08-05
Dan decided to stop building it and instead imitate what the Cowork scheduled
tasks did, or he would switch back to Cowork.

The decision lives in **`__USERHOME__\Claude\Projects\Meta\aac-routines`**
(created 2026-08-05, two commits, then stalled). Its README: *"Private
replacement for two jobs Dan wanted from task automation — five independent
Tuesday O3 preparations, and one weekday check for work Dan personally owes but
may have missed in Todoist. This repository does not use AACX, its database, its
sweep, or its automatic task rules."* Rollout step 1: **"Keep every existing
AACX automation off."**

**Why it got lost:** stored in a sibling directory nothing pointed at. Five days
of sessions opened `task-management`, read its AGENTS.md, and kept building —
#116/#117/#118 shipped, #144–#147 filed against the very O3 renderer
`aac-routines` replaces, 53 Todoist projects created, and `live_writes` flipped
ON off the back of a `STATUS: RED` dry run. `task-management/AGENTS.md` now
carries a READ-FIRST banner (PR #151) so it cannot recur.

**State as of 2026-08-10 evening:** every AACX schedule disabled
(`daily-morning-update`, five `weekly-o3-prep-*`, `weekly-wins-and-watches`);
`meta.live_writes = '0'`; `golive-actions` returns 0.

**aac-routines rollout is stalled** at build gate 8 of 8 (live export sync) with
**0 of 8 manual O3 gates ticked**. Nick's `O3 Prep 2026-08-11.docx` pair was
built by it on 08-05 but never signed off — do not cite it as accepted output.

Work goes in `aac-routines` now. Read its `README.md` and `docs/ROLLOUT.md`
first.

Related: [[o3-render-not-at-parity]], [[milestones-and-usable-test]],
[[open-work-must-be-ticketed]].
