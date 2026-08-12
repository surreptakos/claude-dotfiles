---
name: enrich-owner-is-actor-not-referent
description: "enrich owner_id must be who DOES the task, not a direct merely named in it — else plan auto-delegates Dan's own tasks off his board."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f1f29b8d-a5d4-4a36-8f49-8c6357011f21
  modified: 2026-07-23T17:48:54.701Z
---

When classifying an item in `enrich --apply`, `owner_id` is the person who OWNS/does the task, NOT a direct who happens to be referenced. On 2026-07-23's first live run I set `owner_id: mark` on "Review Mark's Proposal SOP comments + give him the go-ahead" and `owner_id: rob` on "Decide the Transit van dent repair (with John + Rob, route via Rob)". Both are Dan's own action (a review Dan owes Mark; a decision Dan makes) — but a direct `owner_id` made `plan`'s `hygiene.rule_finish_assign_delegation` emit **auto** `move`+`assign` actions to move those tasks onto the direct's Shared board and assign them. On flag-ON that would have wrongly delegated Dan's tasks.

**How to apply:** "review X's doc", "give X the go-ahead", "decide with X", "route via X" → owner_id is **dan** (X is the counterparty/comms path, not the owner). Only set owner_id to a direct when the task is genuinely theirs to execute. See [[stale-pending-actions-persist]] for the cleanup when this is caught mid-run.
