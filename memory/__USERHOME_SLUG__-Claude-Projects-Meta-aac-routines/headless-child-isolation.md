---
name: headless-child-isolation
description: "Headless `claude -p` children on this machine inherit Dan's governance and return empty results unless run under an isolated CLAUDE_CONFIG_DIR"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 50158fd2-5927-428d-a294-59902bdf9b37
  modified: 2026-08-17T17:34:05.922Z
---

Measured 2026-08-17: a plain `claude -p "..." --model haiku` child on this machine loads Dan's hooks and global CLAUDE.md governance (pylons, caveman lint, declare-flow), spends ~23 turns trying to comply with every tool denied, and returns `result:""` at ~$0.24 / 3.5 min. `--settings '{"hooks":{}}'` disables hooks but NOT the homedir CLAUDE.md.

Working recipe (1 turn, ~5s, ~$0.03): set `CLAUDE_CONFIG_DIR` to a fresh dir containing a copied `.credentials.json` and `settings.json` = `{}`, then `claude -p "<prompt>" --model haiku --strict-mcp-config --no-session-persistence --output-format json`, parse `.result`, strip a leading ```diff pylons fence (homedir CLAUDE.md still loads). Also: piped stdin (`echo |`) often never reaches `claude -p` here — `no stdin data received in 3s, proceeding without it`; use a positional prompt or `< file` redirect.

Production user: `~/.claude/hooks/state-stash.js` (SessionEnd transcript miner). Related: [[o3-prep-date-discipline]].
