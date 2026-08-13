---
name: urlfetch-quota-is-the-ceiling
description: Apps Script daily urlfetch quota exhausted 2026-08-13 after a 64-ticket requeue — batch reprocessing burns it; resets midnight Pacific
metadata: 
  node_type: memory
  type: project
  originSessionId: c914f9ae-7160-499d-aa89-83cf1c97bc4d
  modified: 2026-08-13T05:08:20.665Z
---

2026-08-13 ~05:30Z: `Exception: Service invoked too many times for one day: urlfetch` killed `deployCanary` (at `billGet` inside `buildVendors`). Cause: one overnight sweep — 64 ticket re-extractions (each is a Claude call + several BILL + Desk calls), a 13-ticket repair, canaries, and the pollers — exhausted the consumer-account daily UrlFetch quota. The `intake-queue-live` memory called quota the open risk at go-live; this is the day it bit.

**Symptoms it explains:** the every-run 'approver coverage unreadable' flags during the same sweep (intermittent fetch failures under quota pressure), and a post-deploy canary failing with no Log row while the pushed bytes were fine.

**How to apply:**
- A canary/pipeline failure right after heavy batch work: check for this exception FIRST (`clasp run-function deployCanary` shows it verbatim) before diagnosing code.
- Quota resets at midnight Pacific (02:00 Central). Webhook enqueueing survives (SpreadsheetApp needs no fetch); only processing starves and the queue's own retry covers the gap.
- Budget batch requeues: ~60 tickets in one evening ate the whole day's quota alongside normal traffic. Spread big sweeps across days or across the reset boundary, and expect flaky fetch-dependent gates near the ceiling.
