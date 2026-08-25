---
name: surface-everything-in-chat
description: "Dan never reads OVERNIGHT-REPORT.md, PRDs, ADRs, HANDOFF.md and almost never opens GitHub — those are Claude's tools; anything Dan must know or decide gets said in chat, plain English."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7508774c-1756-41e2-83b1-55db2b23f398
  modified: 2026-08-25T13:46:24.551Z
---

Dan, 2026-08-25: "I will never read overnight reports, PDRs, ADRs, HANDOFF.md. I almost never go on GitHub. These are all tools for you. I expect you to surface anything I need to know or need to answer in concise, plain english, here in chat."

**Why:** written artifacts and the tracker persist context across sessions FOR CLAUDE; Dan's only interface is the conversation. A decision buried in an issue body or a report file is a decision Dan never sees.

**How to apply:** keep writing the files and issues (they are still the durable store — [[nothing-lives-only-in-chat]] stands, for Claude's benefit). But every open decision, risk, or thing-Dan-must-know ALSO gets stated in chat at the moment it exists, and a morning session after an overnight run opens with a plain-English brief of what happened and what needs his answer. Never say "see OVERNIGHT-REPORT.md" or "review the PR" as the delivery mechanism — the chat message IS the delivery; ask direct questions with options when a decision is his. Sharpened 2026-08-25 ("YOU ARE THE ONLY INTERFACE"): a bare issue number is a pointer for Claude, not a delivery — any action that lands on Dan or on Design gets its FULL content stated in chat, and Design ports arrive as one paste-ready block Dan can drop onto the canvas verbatim.
