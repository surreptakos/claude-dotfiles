---
name: gl-uncovered-bill-run-pipeline-yourself
description: "Owner rebuke 2026-08-21 — never park a gl-uncovered bill as \"owner disposition\"; download its invoice from BILL and run the extractor + GL pipeline to propose the GL"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c0ae4cca-d542-4149-a12d-f0cff9455c67
  modified: 2026-08-21T16:43:09.636Z
---

Pye-Barker bill `00n02KBVBPMUKP3pol01` (invoice 8878187, $154.95) sat in the approver sweep as the
one `gl-uncovered` candidate. Agent reported it as "needs owner disposition" and asked for a GL.
Owner: "I don't understand why you couldn't solve this yourself by downloading the invoice and
running it through the very capable system we've been building. Unreal. I fixed it for you."

**Why:** the bill carried its invoice PDF as a BILL document (`documents[]` on the v3 bill;
downloadable via the session). The repo's own pipeline — extractor plus GL matcher plus vendor
history — exists precisely to propose a GL from an invoice. Handing the question to the owner was
the anti-slack failure the YES rules name: advice instead of action, tool neglect.

**How to apply:** when a bill lacks GL coding (sweep `gl-uncovered`, or any diagnostic), fetch the
attached document from BILL, run it through the extraction + GL-match path (same seams
`processDeskTicket_` uses; a diagnostic wrapper is fine), and present the proposed GL with
confidence for the human to confirm — a proposal, not a write. Only genuinely unproposable cases
(no document, extractor confidence below floor) go back to the owner, with the evidence attached.
Related: [[handed-off-work-is-yours]], [[triage-not-solve-midturn-reports]].
