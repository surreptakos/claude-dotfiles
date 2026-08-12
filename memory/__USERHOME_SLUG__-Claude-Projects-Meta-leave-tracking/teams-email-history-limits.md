---
name: teams-email-history-limits
description: What the M365 connector can and cannot retrieve for absence/activity audits (Teams history cap vs uncapped email)
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9cddf3e3-b997-4753-8bd7-90d2308275cc
  modified: 2026-07-22T22:37:55.137Z
---

Retrieval limits of the Microsoft 365 connector, learned empirically while auditing absence-day activity. Relevant to any "was X actually working on day Y" check. See [[teams-leave-source]].

**Teams message-level history is capped.** `chat_message_search` with `from:<email>` and NO date filters uses the Graph full-text path: returns the signed-in user's own messages across all chats, newest-first, chronological, paginated by numeric `offset` — but offset maxes at ~1000, so only roughly the most recent 1000 messages are reachable. At ~25-35 msgs/day that is only ~5-6 weeks back. Setting `afterDateTime`/`beforeDateTime` switches to a per-chat scan (each chat's ~50 newest only) which is heavily 429-rate-limited (throttle.aad.ags.50RPM, ~1 heavy call/min) and requires a literal substring query. `read_resource` on `teams:///chats/{id}/messages` returns only one ~20-message page; `$top`/`$skip` are ignored (no pagination). Net: deep Teams history (older than ~6 weeks) is NOT retrievable through this connector.

**Email is uncapped.** `outlook_email_search` with `folderName:"Sent Items"` + `afterDateTime`/`beforeDateTime` + `order:oldest` reaches the full year reliably and returns `totalResultCount`. This is the dependable deep-history activity signal; use it as the backbone, Teams only for the recent window.

**Daniel's normal Teams volume ~30 msgs/day** — useful yardstick for "did they work that day" (64 = ~2x a full day = clearly working; single digits = mostly out).
