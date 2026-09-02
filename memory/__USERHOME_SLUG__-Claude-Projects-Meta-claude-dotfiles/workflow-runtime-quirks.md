---
name: workflow-runtime-quirks
description: Workflow tool traps hit 2026-09-01 - named workflows are session-start snapshots (launch edited scripts by scriptPath), and scripts cannot call Date.now()/Math.random() (fleet needs args.runId)
metadata:
  type: project
---

Two Workflow-tool behaviours that cost a fleet launch each on 2026-09-01:

1. **Named workflows snapshot at session start.** `Workflow({name: 'ticket-fleet'})` ran the copy of
   `.claude/workflows/ticket-fleet.js` as it was when the session began, twice, after the file had
   been fixed and merged. Launch an edited script with `scriptPath` pointing at the repo file, or
   start a new session.
2. **Scripts cannot call `Date.now()`, `new Date()` or `Math.random()`.** The runtime throws
   `Date.now() / new Date() are unavailable in workflow scripts (breaks resume)`. A run earlier the
   same day (`wf_5e514967jumm`) still got through, so the ban landed between runs. Both fleet
   scripts now require `args.runId` (PR #55); mint it with `printf %x $(date +%s)`.

**Why:** the `workflow-authoring` skill documents rule 2 and it was dismissed as stale on the strength
of one successful run. A live launch settled it. Rule 1 is documented nowhere.

**How to apply:** after editing any workflow script, launch via `scriptPath`. Every fleet launch
(local, `orchestrator/worker-cycle.md`, `LOCAL-RUNBOOK.md`) passes `runId`. See
[[fable-usage-is-rationed]] for the model pins the fleet keeps.
