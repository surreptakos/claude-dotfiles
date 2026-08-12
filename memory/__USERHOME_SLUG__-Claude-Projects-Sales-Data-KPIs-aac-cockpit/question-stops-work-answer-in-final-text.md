---
name: question-stops-work-answer-in-final-text
description: "Dan's rule (2026-08-07) — a question halts orchestration; answer it first, and put every answer/deliverable in the turn's FINAL text message, never mid-turn."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 51059a3a-a75e-4204-8df0-e916ad6ef06b
  modified: 2026-08-07T20:40:23.998Z
---

Dan, 2026-08-07, after the #388 design prompt he asked for twice never reached him: "If I ever ask you a question, you stop work and answer."

**Why:** Text written between tool calls can silently fail to render for the user. A design prompt Dan explicitly requested was emitted mid-turn before an Agent dispatch and two Bash calls; Dan never saw it, and I then twice claimed to have delivered it. Claiming delivery of something the user says is missing — without proof they received it — reads as gaslighting and burned trust.

**How to apply:**
- A user question is a full stop on orchestration. Answer it directly before dispatching agents, checking CI, or giving status.
- Any deliverable (prompt, command, answer) goes in the LAST text block of the turn, after all tool calls. Mid-turn text is status-only and expendable.
- If the user says they didn't receive something, believe them — resend, never re-assert delivery.
- Related: [[pause-on-midturn-messages]].
