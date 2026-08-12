---
name: usable-means-reconciled-against-an-independent-source
description: "There is no outside source to reconcile the AAC report against — the snapshots ARE Zoho — so verified means every figure is explained, not re-fetched."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83ee3ddd-d4d3-450c-bc41-19092153e8f4
  modified: 2026-07-30T06:00:54.258Z
---

Do not ask for the report's numbers to be reconciled against an outside source. **There isn't one.** `takeWeeklySnapshot` captures Zoho rows immutably each week, which is what makes the snapshots the source of record. Comparing them to a fresh Zoho pull compares Zoho to a copy of Zoho, and a pull today cannot match an older snapshot anyway, because the CRM has moved since — so it validates no history at all.

**Why:** On 2026-07-29 Dan asked how he could tell whether the work product was usable. He chose to accept my verification over his own sign-off, and I responded by writing "reconcile against an independent source" into a milestone's exit criteria — first naming the commissions workbook (retired, "old shit"), then Zoho. He struck both the next day: *"the snapshots are literally Zoho data. you don't need to reconcile against anything."* I had conflated an independent **source of data** with an independent **implementation of the arithmetic**. The demand read as rigour and would have blocked a milestone on work that proves nothing.

**How to apply:** What can actually be wrong is the arithmetic over those rows — a wrong field, a wrong period boundary, a double-count, a join that silently drops rows — plus a figure computed correctly that answers the wrong question. Neither is found by fetching data again. So verified means the figure is **explained in writing** (what it is, which rows it came from, why it is that value); where it is worth double-checking, **recompute from the same rows with separate code** and call that an independent *computation*, never a reconciliation; and anything unexplainable is switched to `available:false` rather than left rendering. Say "built, not yet explained" instead of "done". Reserve the word *reconcile* for real internal-consistency checks that already exist, like the pipeline-movement table tying out to the coverage bars. Related: [[verify-before-filing-cite-the-check]], [[broken-join-looks-like-zero-coverage]].
