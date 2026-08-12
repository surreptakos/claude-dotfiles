---
name: weekly-payload-has-no-roster-key
description: "payload.attainment.roster exists only on month/quarter payloads, never weekly — read `aes` instead, and check against the deployed envelope"
metadata: 
  node_type: memory
  type: project
  originSessionId: dc30d7b1-b64a-4292-890a-d056919d16ae
  modified: 2026-08-02T06:37:55.643Z
---

`attainmentCumulative_`, the WEEKLY attainment builder, returns `{asOf, monthStart, quarterStart, weekStart,
reps, byRep}` and **no `roster` key**. Only `periodAttainment_` (month/quarter) returns one. That is exactly
why `boardEnvelopeFor_` writes `aes = (roster && roster.aes) || payload.attainment.reps` — the second half is
the live path, the first is dead on weekly.

**Why:** on 2026-08-02 I wrote a `canWrite` rule whose VP branch read `roster.member[rep]`. It answered
`false` for Mark on every report and passed all 101 suites, because no test carried the weekly payload's real
shape. The deployed envelope said otherwise the first time I read it back.

**How to apply:** for anything roster-shaped on a weekly payload, use `aes` (AEs) and remember the Sales-Team
roster is AEs + the VP. And read the deployed envelope before believing a rule is right — a source-shape test
only proves the code says what you wrote. See [[verify-before-filing-cite-the-check]] and
[[backend-only-the-seam-is-the-payload]].
