---
name: decisions-via-question-tool
description: "Dan wants owner decisions asked in-session via AskUserQuestion, never parked as ready-for-human tickets"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bcfba49a-e634-44f3-a785-ce8e76cfeb0f
  modified: 2026-08-22T00:32:38.289Z
---

Dan (2026-08-21): when something needs his decision, ask him directly in session with AskUserQuestion tool. Do not create ready-for-human tickets for pending owner decisions.

**Why:** ready-for-human tickets sit unseen; in-session question gets immediate ruling.

**How to apply:** at session-end sweeps and mid-work decision points, batch open owner decisions into AskUserQuestion calls instead of filing/leaving ready-for-human tickets. Ticket only what he defers explicitly.
