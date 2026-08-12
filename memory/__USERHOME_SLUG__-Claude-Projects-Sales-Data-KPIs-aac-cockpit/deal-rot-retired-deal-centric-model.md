---
name: deal-rot-retired-deal-centric-model
description: Deal Health is deal-centric problem tags now; the deal-rot rot level (Healthy/Watch/Rotting/Rotten) is retired — do not reintroduce it
metadata: 
  node_type: memory
  type: reference
  originSessionId: d326bc75-5db2-43c8-933f-10d9ccb976dd
  modified: 2026-07-20T22:14:25.682Z
---

Report-vp-analysis PRD issue 03 (2026-07-20, ADR-0019) retired the deal-rot rot LEVEL engine entirely. Do not reference or rebuild `rotLevel_`, `rotInputs_`, `rotConfig_`, the "Deal rot" card, or the Healthy/Watch/Rotting/Rotten ladder from memory — they are gone from `Signals.html`/`Dashboard_v2.html`/`Code.js`.

Replacement: `dealProblems_` (Signals.html) — a shared, pure function that returns EVERY problem tag a deal has (Slipped, 2+ slips, Downgraded, Neglected, Stalled, Overdue, On hold/no review date, Bad data), each with a since-prior-period status (new/worse/cleared), not one aggregate severity level. Server-side signal extraction is `dealProblemInputs_` (Code.js, replacing `rotInputs_`) — it INCLUDES On Hold deals (the old builder excluded them). Weekly Deal Health renders a deal-centric list (`dealHealthEntries_`/`renderHealth`, one entry per troubled deal, GP-at-stake order) instead of seven per-problem-type cards plus a separate rot card.

Dropped entirely, no replacement: the imminent-close trigger (a deal closing on time isn't a problem) and total deal age as an independent trigger. "No next step" is a deliberately separate tag, not yet built (report-vp-analysis issue 04) — do not add it to `dealProblems_` without that issue's own spec.

The calibrated absolute per-stage day cap (`ROT_STAGE_CAP_DAYS` in Code.js — name unchanged on purpose) is NOT retired; it survives as one of the Stalled tag's two triggers. Only the rot LEVEL system built on top of it is gone.

Full history and the complete before/after symbol list: `docs/adr/0019-deal-centric-problem-tags-retire-deal-rot.md`, `SPEC.md` ("Deal problems"), `GOTCHAS.md` (repudiated list).
