---
name: bill-note-voice-approved
description: Dan-approved wording for BILL notes the pipeline posts under his name (2026-07-30)
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 55cb3d8e-f518-4690-87c6-30424b1dc2a0
  modified: 2026-07-30T01:27:25.699Z
---

Dan approved this created-bill note verbatim:

> Created automatically from the vendor's email. Invoice 80133, $1,125.00, PDF attached. The GL coding
> is a suggestion, so please check it before approving. Zoho ticket #55527: <link>

And these ask-note templates (his edits folded in):

- QuickBooks: `@AP Administrator This bill is $0 and already in QuickBooks. Can you confirm whether the QuickBooks side needs to be voided? Once you do, I'll archive it here.`
- Vendor revision: `@Services Invoices This one is still open at $0 while we wait for the revised invoice. Do you want me to archive it in the meantime, or leave it open?`
- No approver: `@AP Administrator This bill has no approver assigned, so it can't move. Please assign an approver.`
- Reassign: `@AP Administrator Can you reassign this one to Palm? It's still assigned to Services Invoices.`

Two earlier drafts he rejected: a ~250-char one ("too verbose") and a telegraphic one
("Auto-created by AP intake from vendor email. Inv 80133, $1125.00, PDF attached. Machine-coded —
human approval needed.") which he said still wasn't right.

**Why:** BILL posts notes under Dan's own name to his two-person AP team, so telegraphese reads wrong
coming from him. Length was never the real problem; voice was. He also cut the pipeline's own flag
line ("Heads up: ⚠ GL confidence 0.62") as meaningless to an approver, and asked for the Zoho ticket
as a working link rather than a bare number.

**How to apply:** human-facing text in this project goes through stop-slop AND write-like-dan, both,
not one. Concretely: plain sentences with contractions, no em dashes, no telegraphese, no "Flagged:",
one `please` in the ask, amounts as `$1,125.00`, and one specific question per note. Guarded by tests
around `core.billCreatedNote` in `gas/core.test.js`. Get it right first time: no API call can edit or
delete a posted note (only a person in the BILL web UI can). See [[bill-notes-api-facts]] and
[[ask-questions-in-plain-language]].
