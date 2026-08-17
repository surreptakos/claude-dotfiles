---
name: owner-ruling-registry-membership-wo
description: "Owner ruling 2026-08-12 late: W/O detection inverts to registry membership (issue 126); registry-validated subject W/O may waive the tax hold"
metadata: 
  node_type: memory
  type: project
  originSessionId: c914f9ae-7160-499d-aa89-83cf1c97bc4d
  modified: 2026-08-13T03:42:08.255Z
---

Two owner rulings, 2026-08-12 late evening, both tracked on issue 126:

1. **Inversion, verbatim**: "you need to invert that. if you see any number that's one of our work orders, that should be your trigger to zoom out and see the details surrounding it. if you do it your way you are going to miss hundreds of invoices with work orders in unique places." Membership in `PROJECT_JOB_SEED` (gas/JobData.gs, 762 board W/Os, synced by tools/sync-jobs.js) triggers the read; labels stop being required for members. Measured support: 458 of 2,783 bare five-digit PO values in data/bills.csv ARE board W/Os; only 9 of 1,276 five-digit invoice numbers collide.

2. **Tax-gate provenance, verbatim**: "yes, because it is still getting reviewed by a human anyway. I'd rather you err on being overzealous" — a REGISTRY-VALIDATED W/O may waive the sales-tax hold regardless of source (subject included). Supersedes the "subject may never exempt, currently no" line in the repo CLAUDE.md PROVENANCE paragraph (PR 92 hazard now applies only to NON-member text). CLAUDE.md update rides issue 126's branch.

General preference behind both: hold less, err overzealous on reading, humans still review at Work-validate. See [[owner-rulings-2026-08-12-hold-less]].

