---
name: stop-slop-gate-installed
description: Global stop-slop lint gate installed in Claude Code (PostToolUse + Stop hooks) on 2026-07-15
metadata: 
  node_type: memory
  type: project
  originSessionId: d3e81e4f-f264-4415-926d-d5eb0c7fdddf
---

A deterministic stop-slop linter gates prose globally in Claude Code for this user.

- Linter: `__USERHOME_FWD__/.claude/tools/stopslop.py` (regex rules; ERROR severity fails, WARN is advisory).
- PostToolUse hook `stopslop-write.py` lints every `.md` / `.txt` / `.markdown` file Claude writes; ERROR findings return exit 2 so Claude rewrites.
- Stop hook `stopslop-stop.py` lints Claude's final message each turn via `last_assistant_message`, with a transcript fallback; guarded by `stop_hook_active`.
- Registered under `hooks` in `__USERHOME_FWD__/.claude/settings.json`. Backup of the prior file: `__USERHOME_FWD__/.claude/backups/settings.json.bak-before-stopslop-hooks`.

Off switch: set `"disableAllHooks": true` in settings, or delete the `Stop` block to keep only the file gate. The Stop gate is strict: it flags filler adverbs and em dashes, so it fires on many ordinary replies by design. See [[windows-claude-code-hooks]].
