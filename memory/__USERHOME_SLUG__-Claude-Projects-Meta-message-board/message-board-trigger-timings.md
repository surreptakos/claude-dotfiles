---
name: message-board-trigger-timings
description: "Baseline execution timings for the Message Board triggers — checkBoardsAutorun fires every 5 min and normally takes ~14s, so judge any timeout against that."
metadata: 
  node_type: memory
  type: project
  originSessionId: f12735f2-8212-44f0-8ad6-673821edae36
  modified: 2026-08-01T20:21:12.875Z
---

Measured 2026-08-01 from `processes:listScriptProcesses` — 2,000 executions covering
2026-07-27 to 2026-08-01.

`checkBoardsAutorun` fires **every 5 minutes**, not the 15 that `src/Code.js:383` and the older docs
claim (gap histogram over 1,636 runs: 5 min × 1,634). The installed trigger is the truth; the comment
is stale.

Baseline, `checkBoardsAutorun` (n=1,636): min 5.0s, **median 13.8s**, p95 28.9s, max 130.2s excluding
one timeout. 8 runs over 60s, 2 over 120s — a real heavy tail, but steady state sits ~4% of the
360s ceiling.

Other functions: `onEdit` median 1.4s (n=300), `onOpen` median 0.8s, `dailyMaintenance` ~2.5s (n=6).

Failures in that whole 6-day window: **one** `checkBoardsAutorun` TIMED_OUT at 361.1s
(2026-08-01T17:47:55Z = 12:47 CDT), one `checkBoardsAutorun` FAILED at 35.8s, one `onEdit` FAILED at
150s, one `onEdit` TIMED_OUT at 30.2s (simple triggers cap at 30s).

**Why this matters:** a single 6-minute timeout is a 0.06% tail outlier, not a regression — the runs
on either side of it were 8.0s and 16.1s. Don't diagnose it as structural load without checking this
baseline first. Slow runs (>50s, n=17) coincide with an `onEdit` **0%** of the time versus 11.3% for
fast runs, so human editing contention is ruled out as the cause.

Standing load the board carries regardless: 19,188 formulas, 6,172 with unbounded whole-column refs,
3,960 `COUNTIFS` + 1,050 `SUMIFS`, and 1,214 copies of the WU `ARRAYFORMULA`+`COUNTIF` over
`'WU Review Import'!$A:$ZZ`. `checkMessages` writes the whole `Notified` column on both boards every
run even when nothing changed (`src/Code.js:708`). That explains the heavy tail; it does not explain
a 26× excursion.

Related: [[message-board-google-access]], [[clasp-login-never-hand-write]]
