---
name: desk-ticket-ids-exceed-2p53
description: Zoho Desk ticket ids are past 2^53 — never let a script coerce one to a JS Number
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2a00f6ee-651c-4223-ba58-ae5ed5d4e0a6
  modified: 2026-08-02T07:27:52.292Z
---

Zoho Desk ticket ids (`1073870000033358316`) exceed `Number.MAX_SAFE_INTEGER`. Any code that
coerces one to a JS `Number` silently rounds it to a **different, valid-looking id** — no error, no
warning. On 2026-08-02 a throwaway `clasp run-function` wrapper did this and enqueued an intake queue
row against `...358300`, a ticket that does not exist; it then failed three times and raised a park
alarm.

**Why:** the failure is invisible at the point it happens. The rounded id is the same shape and
length, so it reads as correct in logs and in the queue, and only the eventual `URL_NOT_FOUND`
reveals it.

**How to apply:** keep Desk ids as strings everywhere — arg parsing, JSON, comparisons. In
`--params` JSON for `clasp run-function`, pass `"1073870000033358316"` quoted, never bare. Same rule
applies to BILL v2/v3 ids, which are alphanumeric and would break far more loudly. Related:
[[clasp-run-autonomy]], [[intake-queue-live]].
