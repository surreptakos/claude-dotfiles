---
name: plain-english-decision-context
description: "When surfacing a decision to Dan (AskUserQuestion, grill turn, ticket ruling ask), assume zero coding context and zero GitHub context — put the plain-English explanation in the question body, not the options."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b2b062f8-bf58-4032-92cd-36308f83639f
  modified: 2026-08-26T15:08:43.763Z
---

When surfacing any decision to Dan — `AskUserQuestion` picker, grill turn, "should I do X?" ask — put plain-English context in the **question body itself**, not in the options. Assume Dan has zero coding context and never opens the GitHub ticket.

**Why:** 2026-08-26 — during `/grill-ready-for-human` on #117 the picker referenced `.agent-*`, `SubagentStop`, `ticket-fleet.js`, issue 91, and `tests/test_scaffolding_cleanup.py` in the option descriptions. Dan dismissed with "these questions are too obscure. I need context explained in plain English. This needs to live in the body of the question. Assume I never go on GitHub, I have no idea what caused ticket 117, I don't know what it says or pertains to at all. Assume I have ZERO context and MINIMAL coding knowledge." Losing that context means the picker is unusable — no answer possible.

**How to apply:** Question body first — plain-English framing of what the decision is and why it matters, translating every code symbol, ticket number, test file name, and jargon term into what it does for Dan in the real world. Options carry the trade-off, still plain English, with the recommended one flagged. Preserve the technical terms only where they name something Dan will touch (a UI label, a Todoist body line he reads); everything internal stays translated. Applies to every AskUserQuestion, every grill turn, every ticket-ruling ask — not just the grill-ready-for-human skill. Related: [[status-questions-not-build-orders]].
