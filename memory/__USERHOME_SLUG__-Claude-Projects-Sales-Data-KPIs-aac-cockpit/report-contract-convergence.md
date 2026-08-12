---
name: report-contract-convergence
description: The approved report contract (2026-07-28) and the eleven-ticket weekly convergence — where the work lives and the frontier order.
metadata: 
  node_type: memory
  type: project
  originSessionId: d88c6a80-cf7d-4928-8418-2b0b7360ecee
  modified: 2026-07-28T20:53:18.750Z
---

Dan approved **the report contract** on 2026-07-28 after a full grilling session: four questions (Attainment / Pipeline / Deal Health-as-trust / Focus & Obstacles), four principles (derived floor; **no field without a consequence**; publication-not-gates with named blanks; seats-not-people), three layers (derived core / rep evidence / ten-field seat overlay). Everything on any report now fights for survival against it.

**Where it lives:** PRD + SPEC + issues under `.scratch/report-minimum/`; ADR-0023 (scheduled publication with frozen copy — supersedes ADR-0022, which is now marked SUPERSEDED); ADR-0024 (seats, not people); contract terms in CONTEXT.md (Seat, Seat overlay, Gap plan, Input hygiene, Publication, Report of record, Named blank, Week lock).

**Why:** Mark leaves next year; Dan becomes interim VP while still owing the report to the owner. Nothing may depend on VP diligence — the report self-generates, and enforcement is published named blanks, never gates.

**How to apply:** work the ticket frontier under `.scratch/report-minimum/issues/` — **01, 02, 04, 03+05 (merged — the enforcement spine), and 10 (the kills) all shipped 2026-07-28.** Ticket 10 = `535cd34`+`248e204`, net −1400 lines, deployed, verified live (every killed symbol absent from the `/exec` page; `clasp run reopenVpReport` → "Script function not found"; `inspectWeekLedger` unchanged). Reassessed 2026-07-28 (`23ae856`): frontier is now **12 → 07 → 09 → 08 → 06 → 11**. New **ticket 12** is a prefactor blocking 06–09: honor ticket 10's `readFailed` on every READ path (six guards still test `!D.focusBundle`, so a failed read renders an empty week as a clean one) and move the sections into question order once. **06 is the only remaining server work** (the prior-week closed row has no source — needs a second window in `attainmentCumulative_` plus a shape-version bump), so it goes last. **07 shrank** to composition (`dsForecastCategoryMix_`/`dsConcentrationCard_` already read per bucket, team is a real bucket key). **09's kill is two filters**; its real work is manager-support asks + re-gating `vpTeamNominateHtml_`. **08 kept its size** — the evidence (explanation / next step / due date / carry-forward) renders nowhere on the seat report. Each ticket = one fresh-context `/implement`.

**Do NOT run 06–09 in parallel.** Three of them edit adjacent VP section renderers in one file, and all of them edit the ONE `ABSENT` map in `tests/vp_reference_figures_test.js`, which is checked bidirectionally — parallel branches can each be green alone and fail only after merge. Only 06's server half is genuinely disjoint.

**The Wednesday trigger is still NOT installed** — publication only fires once `installTriggers()` is run (it deletes and recreates every trigger, so that is Dan's call, not CI's).

**Killed and must never return** (GOTCHAS has a repudiated entry each): the submit/reopen lifecycle and its completeness bar, the three commentary buckets, wins confirmation, the commitments table, the Rep Input Rollup, and required-field enforcement AS A BLOCKED SAVE (a "required" field now only NAMES a blank). Curation (select-a-card-by-responding) is **ticket 09's** kill, not 10's — 09 owns what replaces it. The owner authors EVERYTHING for troubleshooting, per-deal judgment included (Dan reversed the exclusion 2026-07-28).

Related: [[vp-report-is-marks-only-authoring-home]], [[deal-rot-retired-deal-centric-model]]
