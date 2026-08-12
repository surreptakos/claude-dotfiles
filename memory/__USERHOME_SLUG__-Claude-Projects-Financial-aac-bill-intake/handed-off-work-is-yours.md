---
name: handed-off-work-is-yours
description: "Work handed to you (a PR, a branch, a ticket) transfers wholesale — do not ask for rulings on its prior state"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 3fba5f80-137f-4816-826f-f4db0d32829e
  modified: 2026-08-06T15:10:22.327Z
---

When Dan hands over a PR, branch or ticket, ownership transfers wholesale. Do not stop to ask for a
ruling on how it was left — draft status, a stale label, an unticked box, a half-written description.
Fix what blocks the task and proceed.

Concretely: PR #64 (2026-08-06) was a draft. Merging it needed `gh pr ready` first. Running that was
correct and did not need asking; flagging it afterward as needing Dan's ruling was noise.

**Why:** the handoff already carried the decision. Re-surfacing prior state reads as asking
permission for work already authorized, and it costs a round trip on a finished task.

**How to apply:** clear the mechanical blocker and say what you did in one line, without framing it
as an open question. Reserve genuine questions for choices the handoff could not have anticipated.
Distinct from [[ask-questions-in-plain-language]], which governs how to ask once asking is warranted.
