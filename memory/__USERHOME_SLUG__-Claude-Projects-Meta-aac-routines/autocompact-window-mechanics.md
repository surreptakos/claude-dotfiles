---
name: autocompact-window-mechanics
description: autoCompactWindow setting loads at session start; /autocompact command is the only live in-session change path and it also persists to settings.json
metadata: 
  node_type: memory
  type: reference
  originSessionId: 50158fd2-5927-428d-a294-59902bdf9b37
  modified: 2026-08-18T05:57:10.611Z
---

`autoCompactWindow` in `~/.claude/settings.json` (range 100k–1M) is read at session start only — editing the file mid-session does NOT change the running session (verified empirically 2026-08-18: file said 200000, live session reported "150k tokens (from settings)").

Live change path: built-in `/autocompact <tokens>` slash command (accepts `250k`, `250000`, `250`; `auto` resets; bare shows current). It applies immediately to the running session AND persists to userSettings, so future sessions inherit it — no separate file edit needed.

Precedence above the setting: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` env var and `--autocompact` launch flag; the command warns "higher-priority override is active" when one wins. Current value: 250000 (set 2026-08-18).
