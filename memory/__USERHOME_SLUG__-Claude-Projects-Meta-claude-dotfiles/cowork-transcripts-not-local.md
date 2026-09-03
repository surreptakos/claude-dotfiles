---
name: cowork-transcripts-not-local
description: "Where Claude Desktop keeps Cowork and Claude Code transcripts on this Windows machine, and why Cowork history cannot be crawled from disk"
metadata: 
  node_type: memory
  type: reference
  originSessionId: a7a166dd-0cbf-43ad-b53f-e797c0dd93a7
  modified: 2026-09-03T22:33:37.370Z
---

Verified 2026-09-03 by walking `%APPDATA%\Claude` and both profile dirs.

- **Cowork** runs as a local `claude.exe` (no VM on win32; `cowork_vm_node.log` says `VM not supported`). Each session gets its own dir under `%APPDATA%\Claude\local-agent-mode-sessions\<org>\<user>\local_<id>\`, and its transcript lives inside that dir at `.claude\projects\<slug>\<cliSessionId>.jsonl`. Only the current session dir survives; older ones are gone (one dir on disk, three ids ever seen in `main.log`). Cowork chat history is server-side on claude.ai. The app's IndexedDB and Local Storage hold no message text. To crawl Cowork history, use the claude.ai data export zip.
- **Desktop Claude Code tab sessions** are metadata files at `%APPDATA%\Claude\claude-code-sessions\<org>\<user>\local_<id>.json` with `cliSessionId`, `cwd`, `title`. The transcript is `~/.claude/projects/<cwd-slug>/<cliSessionId>.jsonl` (or under `~/.claude-personal/projects` for the personal profile). About one in ten metadata files has no surviving transcript.
- The desktop session MCP (`ccd_session_mgmt list_sessions`) lists only Claude Code sessions, never Cowork.
- A one-off crawler plus classifier and merge scripts, and the resulting to-do lists, were saved to `__USERHOME__\transcript-exports\forgotten-todos-2026-09-02\` (rerunnable; see the scripts there).

Related: [[desktop-scheduled-tasks-are-per-org]].
