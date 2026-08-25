---
name: capture-dont-build-on-credits
description: "Owner interrupt 2026-08-25 — on usage credits, approval means capture durable tickets, not implement; builds need an explicit \"build/run it\""
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1332abd9-e526-4b21-9c36-5d40bcd6cbc8
  modified: 2026-08-25T15:06:21.722Z
---

2026-08-25: after approving the claims-audit proposal ("yes. I need this and anything related to
this automated as much as possible"), the owner interrupted three implementation-agent spawns:
"whoa I don't want you to build anything. I am using usage credits. Just make everything durable &
ready to run so I can pick it up later."

**Why:** usage credits make token-heavy work (multi-agent fleets, cross-repo implementation) a
cost decision the owner makes, not the agent. An approval of a proposal's SHAPE is not a go on its
EXECUTION.

**How to apply:** when the owner approves a proposal or says "automate this", the default
deliverable is durable capture — a well-specified ready-for-agent ticket, a skill, a runbook —
plus the exact pickup command. Implementation (especially spawning agents or fleets) waits for an
explicit "build it" / "run it" / "go". Related: [[owner-actions-are-tickets]],
[[triage-not-solve-midturn-reports]].
