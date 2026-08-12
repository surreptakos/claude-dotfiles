---
name: uncertainty-goes-to-inbox
description: "Dan's standing directive — write what the model is unsure about to the Inbox board and let his delete key classify it; do not build the perfect gate."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4e698a6c-aabd-4d8b-ae77-bbdbc50a06f0
  modified: 2026-07-30T06:09:19.001Z
---

Dan, 2026-07-30: *"I'd rather you just write things you're not sure about to inbox
and let me just delete them for a while instead of working on making the perfect
machinery in one shot."*

Shipped as: p3/p4 creates route to the **Inbox** board (`kind='inbox'`,
`hygiene_scope=0`) instead of Work backlog. p3/p4 is the classifier *hedging* — in
run `daily-ad427c4fb4b9`, 78 of 162 creates were p3 and only **4** were p1.

**Why deletion is enough, with no new bookkeeping:**
`triage_actions._CANDIDATE_ROWS_SQL` excludes any item that already has a `create`
action row of **any status**. Once a create is recorded the item is off the
candidate list for good, and `membership.py` stamps a vanished task `removed_at`.
So Dan deleting a task in Todoist is terminal — the ledger that makes "delete it
and it stays deleted" work already existed.

**How to apply:** when a classification is uncertain, route it somewhere Dan can
clear in one pass; do not write doctrine, a threshold, or a confidence gate. A
per-run cap is specifically NOT the answer — it needs a which-first policy and it
trips the recency watermark, so deferred items get bounded out as backfill next
run and "defer" silently means "discard."

Corollary that keeps costing time: **grade the artifact, not the plumbing.** The
2026-07-29 delivery brief had duplicate rows, contradictory recommendations, raw
mailbox local-parts and a nested link to `?ItemID=z` while every store-level check
was green. Read the 36-line delivery file before claiming anything works.

Related: [[chat-items-need-null-priority]], [[milestones-and-usable-test]],
[[live-writes-on-noise-gate-open]], [[verify-inferences-against-the-store]].
