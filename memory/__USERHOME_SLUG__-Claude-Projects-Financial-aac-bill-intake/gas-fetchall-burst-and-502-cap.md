---
name: gas-fetchall-burst-and-502-cap
description: fetchAll >100 requests trips the urlfetch short-term rate limit (chunk 20/burst); a scripts.run 502 can be the 6-minute cap with PARTIAL completion — re-measure before re-running
metadata: 
  node_type: memory
  type: project
  originSessionId: 60c8fab0-4c41-42c2-b944-99f8760aba7c
  modified: 2026-08-24T23:09:58.981Z
---

Two Apps Script execution facts measured live 2026-08-24 during the issue 310 Drive migration:

1. `UrlFetchApp.fetchAll` with 100+ requests throws `Service invoked too many times in a short
   time: urlfetch. Try Utilities.sleep(1000) between calls.` — a burst limit, separate from the
   daily quota. 20 per burst with a 1s gap between bursts passes. `driveFetchAllChunked_`
   (gas/DeskIntake.gs) is the shared helper.
2. A `clasp run-function` / `scripts.run` call that answers a Google **HTML 502** page can mean the
   function hit the 6-minute consumer execution cap — and the run may have PARTIALLY completed
   (the migration processed 321 of 487 files before its 502). Never read 502 as "nothing
   happened": re-measure state (a dry-run counter) before re-running, and build such batch
   functions idempotent so a re-run continues instead of double-acting.

**Why:** both were hit on the first live run of `previewMigrateRootLitter`; the 502 especially
invites a wrong "it failed, run something else" diagnosis.

**How to apply:** any bulk Drive/HTTP fan-out in gas chunks through `driveFetchAllChunked_`;
any long batch function returns progress counts and tolerates re-runs.

See [[urlfetch-quota-is-the-ceiling]] (the DAILY quota fact — this is the burst limit).
