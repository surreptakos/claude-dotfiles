---
name: workflow-runtime-quirks
description: Workflow tool traps - named workflows are session-start snapshots (launch by scriptPath), scripts cannot call Date.now()/Math.random() (fleet needs args.runId), and scriptPath refuses a CRLF file (2026-09-15)
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

3. **`scriptPath` refuses a CRLF script.** Pointing `scriptPath` at the plugin's
   `ticket-fleet.js` (37 KB, 443 CR bytes, as installed under the desktop plugin cache on
   2026-09-15) fails before launch with `script contains control characters that would be
   hidden in the approval dialog`. Copy the file with `tr -d ''` into the scratchpad and pass
   that path; the run itself is unaffected.

**Why:** the `workflow-authoring` skill documents rule 2 and it was dismissed as stale on the strength
of one successful run. A live launch settled it. Rule 1 is documented nowhere.

**How to apply:** after editing any workflow script, launch via `scriptPath`, from an LF copy when
the source is CRLF. Every fleet launch
(local, `orchestrator/worker-cycle.md`, `LOCAL-RUNBOOK.md`) passes `runId`. See
[[fable-usage-is-rationed]] for the model pins the fleet keeps.
