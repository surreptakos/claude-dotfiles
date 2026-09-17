---
name: aacx-record-corrections
description: "Two facts the aac-routines docs get wrong about the old task-management engine; the 08-05 stop decision has no transcript, and the 53 projects were deliberate"
metadata: 
  node_type: memory
  type: project
  originSessionId: d1a0f4fb-01c4-43c3-b5e6-7cf5abe3d300
  modified: 2026-09-17T06:16:40.705Z
---

Verified 2026-09-17 against task-management transcripts, memory notes and `data/aac.db`:

- The "53 auto-created projects" cited in `run_ledger.py`'s docstring were June 15 task shells promoted to projects on 2026-08-10 on Dan's instruction, with a backup and readback. The real runaway was pending creates (103 on 2026-07-29, 484 on 2026-08-07, three `void_*.py` scripts). The ledger guardrail is sound; the cited event is wrong. Correction posted on #446.
- The 2026-08-05 "stop building aacx, imitate Cowork" decision appears only in agent-written notes (task-management memory, its AGENTS.md banner). No transcript in that project holds Dan saying it; sessions 08-04 to 08-18 are interrupted scheduled runs.
- `task-management/scripts/todoist_sync.py` had script-side full-board fetch, 429 retry with `Retry-After`, and record-outcome-before-next-write, live-accepted 2026-07-24. Prior art for the Sync transport tickets (#444, #445, #447).
- The 2026-08-03 transcript `6677c665-0fbf-4f0a-9942-2b71812e379f.jsonl` holds a plaintext Anthropic API key Dan pasted; flagged to Dan 2026-09-17.

**Why:** the rebuild-versus-tweak question came up on 2026-09-17 and the written rationale did not survive a check against the record.

**How to apply:** cite the pending-create floods, not the 53 projects, when explaining the ledger rule; point Todoist transport work at the old script before designing from scratch. See [[status-questions-not-build-orders]].
