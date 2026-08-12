---
name: run-early-dont-wait-for-the-trigger
description: "Run a new forward-only capture by hand the day it ships, because the first live run is where the real bugs are and a failed scheduled run costs unrecoverable history."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83ee3ddd-d4d3-450c-bc41-19092153e8f4
  modified: 2026-07-29T22:27:47.506Z
---

When a new forward-only capture lands, run it by hand immediately (`clasp run <fn>`) instead of waiting for its trigger. Verify the rows on the sheet, then measure whether the data can actually feed the metric that consumes it.

**Why:** On 2026-07-29 `captureLeadSnapshot` and `captureActivityLog` were armed and run the same day. The activity pull failed on the first attempt with Zoho `DISCRETE_PAGINATION_LIMIT_EXCEEDED` — Calls was the first module past the 2000-record offset ceiling, so `fetchRecords_` had been wrong for Activities since it was written. Waiting for the Monday trigger would have lost the week, and forward-only means unrecoverable. Reading the resulting 9,344 rows then exposed three more defects that no file-level test could see, all of which produced confident zeros rather than errors.

**How to apply:** Ship, run by hand, read the sheet, then run the consuming metric and check its verdict is one the data can support. A green test suite says the code matches its fixtures; only live data says the fixtures match reality. Add a read-only `inspect*` entry point when the function returns nothing — a `clasp run` that prints "No response." and exits 0 is indistinguishable from a silent no-op. See [[verify-before-filing-cite-the-check]] and [[live-workbook-id-sa-readable]].
