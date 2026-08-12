---
name: vp-report-is-marks-only-authoring-home
description: "Dan's rule: everything Mark could author on the Sales Team view must be possible on the VP report — and the team view is now read-only."
metadata: 
  node_type: memory
  type: project
  originSessionId: d88c6a80-cf7d-4928-8418-2b0b7360ecee
  modified: 2026-07-28T00:21:45.485Z
---

Dan's rule, stated 2026-07-27: **"Everything Mark could do on the Sales Team view should be possible on the VP report."** Acted on the same day — the VP report gained Summary/Priority editors and a focus-deal/obstacle nomination block, and the Sales Team authoring view was retired, so the VP report is Mark's only authoring home.

**Why:** Mark had two authoring homes for one weekly report. The team view only ever became his because the weekly redesign dropped his standalone selector (`repOrder_` still omits him) and nothing else was left to hang his authoring on.

**How to apply:** a gap on the VP report is a bug, not a reason to send him back to the Rep surface. Before adding a VP-authored control, check the server first — it already accepted more than the client offered in all three cases (`submitVpAnalysis` took `summary`/`priority`; `authorEligibleDeals_` returns the whole roster's open deals for the VP), so these were client-only changes with no schema or payload-shape bump. And resolve a VP-surface author through the surface-aware choke point (`focusAuthorRep_`, `vpAuthorTargetRep_`), never `state.rep`/`actingRep()` — that confusion has shipped twice.

Related: [[verify-deploy-via-exec-fetch]]
