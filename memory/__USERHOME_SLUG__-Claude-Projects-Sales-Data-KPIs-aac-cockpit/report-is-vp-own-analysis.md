---
name: report-is-vp-own-analysis
description: "The weekly/monthly/quarterly sales report is the VP's own independent report to Dan; rep views/inputs are only raw material."
metadata: 
  node_type: memory
  type: project
  originSessionId: dad6e62d-8bc9-4217-af66-63a5179ffa66
  modified: 2026-07-20T17:30:20.657Z
---

The AAC Sales Report is the VP of Sales' (Mark's) own report to Dan (owner). The weekly/monthly/quarterly reports on the **Sales Team page** are what Mark sends up; they should read as the same report he would write even if the reps had never entered anything themselves.

**Why:** The per-rep views and input fields were added only to make it easier for reps to submit the raw information Mark needs. That is data-gathering, not the report. Regurgitating what the reps wrote is not sufficient — Dan does not need to see each rep's individual entries. The design already assumes this: the yellow "Write this in your own words" box and the `VP_SYNTH_REMINDER` ([[.]]) exist specifically to stop the report becoming "the reps' notes stapled together," which would let reps self-narrate their misses and let the VP hide behind rep inputs (Dashboard_v2.html:1058).

**How to apply:** Treat the VP's Sales Team page authoring surface as his independent synthesis. Numbers are computed for him; his job throughout is to answer, in his own words: what happened this week, why, and what he is doing about it. On Deal Health the reps set each deal's next step + deadline (owner-only, `noteEditable_`); the VP's job there is to judge whether those explanations/plans are realistic and honest and to push back, not to set them. When building or changing report features, don't add anything that nudges the VP toward copying rep text; favor prompts that force his own read.
