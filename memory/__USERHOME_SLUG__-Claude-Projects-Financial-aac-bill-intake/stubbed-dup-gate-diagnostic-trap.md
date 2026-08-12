---
name: stubbed-dup-gate-diagnostic-trap
description: testGlOverridePrecedenceLive stubs dupSource so its outcome is always CREATE; use dupCheckPairs to ask whether an invoice is already in BILL
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a26cd633-a291-4992-a7ce-6f91258c2b3e
  modified: 2026-08-07T14:29:06.452Z
---

`testGlOverridePrecedenceLive` (gas/DeskIntake.gs) builds its context with
`dupSource: { lookup: function () { return []; } }`. Its `outcome` is therefore **always `CREATE`**
and carries no duplicate information. `dupCheckPairs([[vendorName, invoiceNumber], ...])` (gas/Demo.gs,
PR #81) asks the real gate — `billDupSource` + `dupVerdict` against BILL v2.

**Why:** on 2026-08-07 seven Avigilon past-due invoices were run through the GL helper, all answered
`CREATE`, and that was reported to Dan as a measured finding that ~$10.1k of invoices were missing
from BILL. It drove a "restore all and process" decision. The real gate says 6 of the 7 were already
in BILL. `completeDataVerify` on AP-7 answered `DUPLICATE` and created nothing, so ADR-0004 held —
but the false finding was stated as fact and acted on.

**How to apply:** before treating any diagnostic's `outcome` as a money verdict, read what it stubs.
A helper that fakes `dupSource`, `glOverrideMap`, or the vendor list can still return a full plan
shape. State the data source when reporting a money conclusion, and prefer the function whose name
matches the question being asked. #82 tracks making the helper self-labelling.

See [[trashed-ticket-api-signature]], [[gas-testing-architecture]].
