---
name: surface-in-chat-not-docs
description: Dan never reads OVERNIGHT-REPORT/HANDOFF/ADRs/PRDs and almost never opens GitHub — surface everything he must know or decide in plain-English chat
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f3053660-93ab-4ebd-95d0-7d1440c955b6
  modified: 2026-08-25T12:07:32.737Z
---

Owner statement (2026-08-25, verbatim intent): "I will never read overnight reports, PDRs, ADRs, HANDOFF.md. I almost never go on GitHub. These are all tools for you. I expect you to surface anything I need to know or need to answer in concise, plain english, here in chat."

**Why:** Docs and the tracker are agent-to-agent state. Writing a decision or a must-know fact ONLY there buries it — same failure mode as [[owner-actions-are-tickets]], one level up: the ticket satisfies the tracker, the chat message satisfies the owner. Both are required for owner-facing items.

**How to apply:** Keep writing HANDOFF/FOLLOW-UPS/reports/tickets exactly as the repo rules demand — they are for future agents and the audit. But every owner decision, owner action, or material risk ALSO gets said in chat, concise plain English (see [[ask-questions-in-plain-language]]), in the session where it surfaced. End-of-session wrap-ups should lead with "what you need to know / what you need to decide", not with a list of documents written. Never answer an owner question with "see HANDOFF.md" or a GitHub link alone — links are fine as backup, the substance goes in the message. PR review requests likewise: he won't read the PR page unprompted; summarize the change and ask for the merge decision in chat.
