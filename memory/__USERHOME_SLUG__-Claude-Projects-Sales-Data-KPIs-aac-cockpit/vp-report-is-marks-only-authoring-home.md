---
name: vp-report-is-marks-only-authoring-home
description: "Dan's rule: everything Mark could author on the Sales Team view must be possible on the VP report — and the team view is now read-only."
metadata: 
  node_type: memory
  type: project
  originSessionId: d88c6a80-cf7d-4928-8418-2b0b7360ecee
  modified: 2026-08-26T13:56:54.005Z
---

Dan's rule, stated 2026-07-27: **"Everything Mark could do on the Sales Team view should be possible on the VP report."** Acted on the same day — the VP report gained Summary/Priority editors and a focus-deal/obstacle nomination block, and the Sales Team authoring view was retired, so the VP report is Mark's only authoring home.

**Why:** Mark had two authoring homes for one weekly report. The team view only ever became his because the weekly redesign dropped his standalone selector (`repOrder_` still omits him) and nothing else was left to hang his authoring on.

**How to apply:** a gap on the VP report is a bug, not a reason to send him back to the Rep surface. Before adding a VP-authored control, check the server first — it already accepted more than the client offered in all three cases (`submitVpAnalysis` took `summary`/`priority`; `authorEligibleDeals_` returns the whole roster's open deals for the VP), so these were client-only changes with no schema or payload-shape bump. And resolve a VP-surface author through the surface-aware choke point (`focusAuthorRep_`, `vpAuthorTargetRep_`), never `state.rep`/`actingRep()` — that confusion has shipped twice.

**The report is the VP's own INDEPENDENT analysis, not rep notes stapled together** (2026-07-20, ADR/Dan). The weekly/monthly/quarterly reports on the Sales Team page read as what Mark would write to Dan even if the reps had entered nothing themselves. Per-rep views and input fields exist only to make it easier for reps to submit the raw material Mark needs — that is data-gathering, not the report. Design cues encoded for this: the yellow "Write this in your own words" box, `VP_SYNTH_REMINDER`, and the deal-health rep note constraint (reps set each deal's next step + deadline, `noteEditable_` owner-only; VP judges whether they are realistic and pushes back, does not set them). When adding a VP-authored control, favour prompts that force his own read; do not add anything that nudges the VP toward copying rep text.

Related: [[verify-deploy-via-exec-fetch]]
