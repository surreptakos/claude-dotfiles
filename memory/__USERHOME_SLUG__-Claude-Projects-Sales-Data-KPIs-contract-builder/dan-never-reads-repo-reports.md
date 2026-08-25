---
name: dan-never-reads-repo-reports
description: "Dan never reads repo reports (OVERNIGHT-REPORT, ADRs, PRDs, HANDOFF.md) or GitHub — surface everything in chat"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 97586414-28fe-45df-bb83-0f6587af170c
  modified: 2026-08-25T12:06:06.892Z
---

Dan (2026-08-25): "I will never read overnight reports, PDRs, ADRs, HANDOFF.md. I never go on GitHub. These are all tools for you. I expect you to surface anything I need to know in concise, plain english here in chat."

**Why:** Repo documents and GitHub issues are agent-to-agent infrastructure. Writing a decision request into an issue or report and considering it "surfaced" means Dan never sees it.

**How to apply:** Keep writing reports/tickets/ADRs for agent workflow and tracker hygiene, but anything Dan must know or decide gets said in chat, plain English, at the moment it matters. ready-for-human tickets still get filed (tracker truth), but their content is relayed in chat too — the ticket is bookkeeping, the chat message is the delivery. Related: [[decisions-via-question-tool]].
