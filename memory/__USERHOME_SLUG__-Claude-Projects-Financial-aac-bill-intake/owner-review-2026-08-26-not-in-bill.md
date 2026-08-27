---
name: owner-review-2026-08-26-not-in-bill
description: "Owner's 2026-08-26 review of the 29 not-in-bill tagged tickets — WO detection misses, missing WO field, credit memos absent, teaching mechanism undocumented, AP-303 site hallucination, AP-326 vendor mis-attribution, overall trust concern"
metadata: 
  node_type: memory
  type: project
  originSessionId: f3b84730-3363-418b-9901-3fd80a60cfba
  modified: 2026-08-26T20:37:20.967Z
---

Owner reviewed the 29 tickets `tagInvoicesNotInBill` tagged on 2026-08-26. Verdict: *"I don't know
if we can get this to a trustworthy state."* Full capture in `HANDOFF.md` top-of-file section
committed `16e1f6e`.

**Why:** owner spot-checks are the trust surface. Every miss in this batch shortens the credit the
system has built up. Nine obvious WO misses across AP-286/298/301/303/325/326/329/332 plus the
pictured Southern Signal monitoring invoice. Two recurring subscriptions whose sales-order suffix
literally names the renewal (`-R1`, `-R2`) — extractor ignoring. AP-303 attributed to a fabricated
Clearbrook Grayslake site that does not appear on the invoice. AP-326 tagged
`vendor-not-in-bill` while two near-identical Openpath invoices on the same layout tagged
`invoice-not-in-bill` — extractor instability likely reading "Now part of AVIGILON ALTA" as vendor.

**How to apply:** the fleet's next block is §A–§F of that HANDOFF entry. Anchor the split on §D
(teaching mechanism — how does the owner add/correct a W/O or GL without a fleet run clobbering
it?) — the others become easier once corrections stick. Do not `to-tickets` §A–§F individually
without the anchor.

Related: [[gl-uncovered-bill-run-pipeline-yourself]] (never park as "owner disposition"),
[[owner-actions-are-tickets]] (this WAS captured as a ticket-adjacent HANDOFF prepend because the
session was near quota), [[triage-not-solve-midturn-reports]] (do not fix inline in the fleet
session — sort via `/triage` first).
