---
name: owner-rulings-2026-08-12-hold-less
description: "Owner rulings batch 2026-08-12 — \"almost NEVER Data Verify\"; tracked as issues 120-125"
metadata: 
  node_type: memory
  type: project
  originSessionId: c914f9ae-7160-499d-aa89-83cf1c97bc4d
  modified: 2026-08-13T00:41:19.968Z
---

Owner philosophy, verbatim (2026-08-12): "You should almost NEVER have to leave a bill in Data Verify. If you do, you fucked up." The pipeline holds too much; gates should default rather than ask.

Rulings, each tracked as a GitHub issue (all labeled ready-for-agent 2026-08-12):
- issue 120 — read WO-labeled subjects (`wo# 40812`); AP-200/AP-203 false "work order missing" holds
- issue 121 — missing W/O: "Outside labor" assumes SERVICE (Mireya via Services Invoices policy), "ADI" assumes order ("a Steffi bill", Order Invoices policy)
- issue 122 — inspection invoice confirms the Services GL, clears the mixed-coding hold (blocked-by 121, native edge)
- issue 123 — zero-total non-invoice (AP-201 order ack, AP-161 W-9) is NOT-INVOICE, not CREDIT-MEMO
- issue 124 — DUPLICATE verdict auto-rejects the ticket (status Rejected + Rejection Reason "duplicate"); rationale: all AP mail also forwards to BILL, dupes surface there
- issue 125 — split the `needs-verify` hold tag into per-cause tags (no-wo-found, missing-tax, gl-doubt, ...)

Related standing facts: BILL "Services Invoices" policy covers exactly GL "Outside labor" (owner Mireya); "Order Invoices" covers ADI/Hardware/Door Access etc. (owner Stephanie) — data/bill-policies.json. See [[triage-not-solve-midturn-reports]] for how these rulings must be handled.
