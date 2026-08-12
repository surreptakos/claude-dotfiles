---
name: co-attribution-build
description: CO attribution + Total Cost GP program (PRD #19, tickets #21-#27, ADRs 0004/0005) — decisions settled 2026-08-12, build not started
metadata:
  type: project
---

Owner decisions settled 2026-08-12 via grill session; recorded in ADR-0004 (Project GP = `Project Sales − Total Cost`, quoted not actual — markup formula cannot express zero-revenue cost, singularity at -100) and ADR-0005 (Deal Owner IS the attribution; every CO earns on parent's lifecycle, parent by shared W/O #; own register rows, parent timing; effective 2026-04-01 = ZOHO_CUTOFF_DATE).

**Why:** Erich Rojek's OSH-Patterson CO1 (missed Axis license, AAC ate cost) paid full quoted GP $2,266.61 — absorbed costs were structurally invisible to commission.

**How to apply:** Six vertical-slice tickets, dependency chain #21→#24→#26→#27, independent #22 #23, all sub-issues of #19. Dan is adding `Total Cost` field to Zoho Deals himself. Balance Adjustments CANNOT reach attainment (`calculatePaymentSchedule` only, src/Core.js:5813) — GP reduction is the only lever that reaches accelerator/kickers. `Final Markup %` is a dead Transactions column (0/98 rows) becoming reporting-only. #25/#28 closed as folded. See [[pay-stub-model]].
