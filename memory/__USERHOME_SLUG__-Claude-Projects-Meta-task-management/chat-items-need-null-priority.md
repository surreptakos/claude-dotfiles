---
name: chat-items-need-null-priority
description: triage treats ANY non-null priority_suggested as actionable — Teams/chat chatter must be enriched with priority_suggested=null or it spawns one task per fragment.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f1f29b8d-a5d4-4a36-8f49-8c6357011f21
  modified: 2026-07-30T00:29:08.758Z
---

`triage.create_decision` treats *any* non-null `priority_suggested` on a comms item as "actionable → create a task." So classifying 1:1 chat/Teams fragments with a low priority (p3/p4) to mean "minor" **backfires**: on 2026-07-23, enriching 115 ingested Teams messages at p3/p4 produced **96 spurious `create` decisions** — one task per fragment ("lol", "office", "Approved!", Dan's own outgoing lines). With `live_writes` ON these would have executed into 96 garbage tasks.

**Confirmed working, with a magnitude (2026-07-29):** the store holds **985 enrichments with both
`priority_suggested` and `owner_id` null** — 368 Teams messages, 295 inbox emails, 114 of Dan's own sent
mail, plus the shared mailboxes. That is the rule above doing its job, and it is *supposed* to be large:
most chat and most email is not a task. Do not read a big null-priority population as a defect. The
number that means "actionable but unassigned" is priority-not-null-and-owner-null, which was **17** on the
same date (and 6 of those were notification noise per issue #44).

**How to apply:** the correct "nothing actionable" signal for chatter/banter/acknowledgments is **`priority_suggested: null`** (not p3/p4). Reserve a real priority only for items that genuinely warrant a task. When bulk-enriching chat, default to null and only elevate the few substantive asks. If a low-priority pass already wrote spurious pending `create` rows, neutralize them to `status='skipped'` before they execute — see [[stale-pending-actions-persist]]. Related first-wired-run explosion: [[step3-stage-backfill-explosion]].
