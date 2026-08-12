---
name: three-queues-not-colours
description: "ADR 0008 — flags are ASSIGN/DO/CHASE queues, not colours; and the queues are a view, never board state."
metadata: 
  node_type: memory
  type: project
  originSessionId: 4e698a6c-aabd-4d8b-ae77-bbdbc50a06f0
  modified: 2026-07-30T00:28:40.857Z
---

ADR 0008 (accepted 2026-07-29): the deliverables flag work as **three action queues, not five
colours**. ASSIGN (ball on nobody — assign or kill) · DO (ball on me — do or delegate, capped at 10
with ranked overflow) · CHASE (ball on them — nudge, not work). Plus MOVING and PARKED, both never
displayed. Colour is shading *within* a queue; Todoist priority sorts within a queue and never routes
into one.

**Why:** Dan's two tests. *"Any flag that needs my judgment to set can't be computed by a scraper"* and
*"every flag maps to exactly one verb — if I can't name the verb, delete the flag."* A front colour
fails both. PRD #87 (front traffic lights) is closed not-planned; PRD #90 replaces it.

**The structural half a future agent will otherwise get wrong:** the queues are a **rendered view,
recomputed each run, never written onto a task.** Forced by ADR 0007 and the surfacer's one-way
contract — queues as board mutations would put the engine back to re-touching tasks Dan owns. Chronic
bouncing is observed in a transition log, never by relocating a task.

Consequence signals (money/customer/compliance/payroll) are **out of scope** — money and customer are
judgment, which would put the classifier on the critical path of half the escalation rules. Note
"a person is blocked waiting" survives without them: ball-on-me plus a named counterparty is scrapeable.

Accepted cost: `projects.front` stays populated and read by nothing. Department health belongs in the
dashboards that already exist.

Tickets: #93 ASSIGN (frontier, no blockers) → #94 DO, #95 CHASE, #96 PARKED → #97 external-vs-internal
dates → #98 transition log. Related: [[closure-authority-pivot]], [[legacy-onedrive-folder-mined]].
