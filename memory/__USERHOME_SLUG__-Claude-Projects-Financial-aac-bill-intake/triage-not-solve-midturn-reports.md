---
name: triage-not-solve-midturn-reports
description: "Owner correction 2026-08-12 — mid-turn bug reports and rulings go through /triage to GitHub issues, never fixed inline in the session"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c914f9ae-7160-499d-aa89-83cf1c97bc4d
  modified: 2026-08-13T00:49:15.879Z
---

Owner interrupted a session that was implementing fixes for a batch of mid-turn reports (AP-200/201/203/161, dup-handling ruling): "be sure you're not solving these. that's not the workflow. It's /ask-matt".

**Why:** the ask-matt map routes raw incoming issues through `/triage` (tickets on GitHub), then `/implement` per ticket in fresh context. Inline fixes skip review, tracking, and the ticket-set breakdown. A hook also enforces it: the second `gh issue create` in one session is blocked until the /to-tickets step-4 numbered breakdown (with blocking edges) is presented via AskUserQuestion and approved.

**How to apply:** when the owner drops bug reports or rulings mid-turn, gather evidence (tickets, code, logs), then file GitHub issues with the evidence and verbatim rulings — do not edit code. Revert any premature edits (`git checkout --`, park the diff in scratchpad, reference the design in the issue body instead). Direct questions ("what does this flag mean", "why is X stuck") still get direct answers.

Same session, second correction: do not run a catch-up drain (`businessHoursOverride(true)` + `drainIntakeQueue`) while known pipeline flaws are open tickets — "no reason to do it now while your approach is flawed." Backlog waits; fixes land first. The override was reverted minutes after being enabled; remember the override alone is enough to drain (the trigger ticks on its own), so reverting it is part of parking the queue.
