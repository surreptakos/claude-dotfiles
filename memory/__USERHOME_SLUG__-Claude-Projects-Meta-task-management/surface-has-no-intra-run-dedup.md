---
name: surface-has-no-intra-run-dedup
description: "Nothing compares a run's creates to each other — semantic dedup is post-create, so surface can mint the same matter 3x in one batch."
metadata: 
  node_type: memory
  type: project
  originSessionId: 1590605e-3ec6-4274-8d87-158d22da6b92
  modified: 2026-07-31T21:00:42.550Z
---

There is no seam anywhere that compares the creates within a single `golive-actions` batch. `enrich --list-dedup` operates on **open tasks with a topic-mate** — board rows, not pending creates — so it only sees a duplicate the run *after* it lands, and then only writes a `propose` merge. `triage.find_exact_duplicate` runs pre-create but only against existing open tasks, never against the batch's other rows.

Measured 2026-07-31 (#114): nine duplicate rows in one 148-row set — WO 357082366 minted three times from three separate commitments, four other work orders twice each, plus two identical `Reply to …` pairs. Ticketed as #117.

**Why it matters:** a `triage` duplicate lands on Inbox where Dan deletes in one pass, but a `surface` duplicate lands on **Open Loops**, the surface ADR 0007 makes authoritative — he checks one off and the identical siblings stay open.

**How to apply:** don't reach for the dedup stage when duplicate creates show up; it structurally cannot help. Don't blame a dedup outage either — see [[enrich-starves-dedup-on-credit]]. Related: [[three-queues-not-colours]], [[closure-authority-pivot]].

**FIXED 2026-08-10 (#117, PR #148).** `aacx/pipeline/surfacer.batch_key` collapses within a batch: case/wo/po/ticket identifier if the loop text carries one, else the rendered task title normalized, `direction` in both. Losers get a counted `skipped_batch_duplicate`. The `wo` pattern also had to widen 3-6 to 3-10 digits - ServiceChannel work orders are 9, so it had matched 1 of 966 commitments.
