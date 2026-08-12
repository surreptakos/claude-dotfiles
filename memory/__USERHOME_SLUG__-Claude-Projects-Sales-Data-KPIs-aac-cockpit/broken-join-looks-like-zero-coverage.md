---
name: broken-join-looks-like-zero-coverage
description: "A metric whose join resolves nothing looks identical to a real zero, so a seam must prove its join worked before it is allowed to report a verdict."
metadata: 
  node_type: memory
  type: project
  originSessionId: 83ee3ddd-d4d3-450c-bc41-19092153e8f4
  modified: 2026-07-29T22:27:59.864Z
---

Any derived metric that joins two hand-maintained surfaces must be able to distinguish "the answer is zero" from "I could not resolve anything", and must refuse to grade in the second case. Both produce the same zeros on the page and neither errors.

**Why:** Account Coverage joins `Activity_Log` to `Account_Register` through account names. On its first live run (2026-07-29) the register held `"1396 - Epstein, Mike & Jackie"` (CSV quotes plus a duplicated customer number) while Zoho held the plain name — zero overlap out of 73 accounts — and the page graded every tier "short". A weaker first guard (refuse only when nothing at all resolved) was defeated by a single accidental match: `2026-Q2` joined 1 touch of 33 and then reported 0% across 347 accounts.

**How to apply:** Make the refusal condition **provable**, never a guessed percentage — a made-up threshold is the fabrication `GOTCHAS.md` exists to prevent. The two used here: nothing resolved though contact demonstrably happened, and any row that is structurally unmatchable (an account-attached touch with no account name, since the register carries no Zoho account id to fall back on). Return `available:false` with a plain-language `reason` the renderer shows verbatim. Grading then resumes on its own once the data can support it. Test fixtures must carry the live format on both sides — a fixture tidied into agreement passes while production resolves nothing. Read the live verdict with `clasp run inspectCoveragePlan`. Related: [[run-early-dont-wait-for-the-trigger]], [[tier-touch-cadence-never-ratified]].
