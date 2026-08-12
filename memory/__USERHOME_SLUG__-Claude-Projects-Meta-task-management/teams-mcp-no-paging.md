---
name: teams-mcp-no-paging
description: "Teams read_resource collection URI returns only ~20 newest messages, no paging, ignores since/$top — old-watermark chats have unreachable gaps."
metadata: 
  node_type: memory
  type: reference
  originSessionId: f1f29b8d-a5d4-4a36-8f49-8c6357011f21
  modified: 2026-07-23T19:15:26.272Z
---

The M365/Teams MCP (server d905df72) `read_resource` on the bare collection URI `teams:///chats/{chatId}/messages` **works** for Teams ingest and returns a fixed most-recent page of ~19-20 messages, newest-first. But it has **no server-side pagination and silently ignores `$top`/`since` query params** (both return the identical page). ingest's INSERT-OR-IGNORE + cursor-advance handles overlap/dedup fine.

**Consequence:** for a chat whose stored watermark is more than ~1-1.5 days old and that has heavy traffic, messages between the old watermark and the page's oldest message are **unreachable** via this connector and get skipped (cursor still jumps to newest). Observed 2026-07-23: nick (wm 07-17) and mark (wm 07-20) had gaps; rob/lynne/steffi/chris_g/john pages reached past their watermarks. `chat_message_search`/`find_person` are the alternative but cause 429s (avoid). **How to apply:** run Teams ingest at least daily so watermarks never fall >1 day behind; when a chat has been stale for days, accept the gap is lossy for that window and note it. See [[mcp-text-vs-json]].
