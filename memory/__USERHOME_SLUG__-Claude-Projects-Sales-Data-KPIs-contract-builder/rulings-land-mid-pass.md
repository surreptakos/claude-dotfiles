---
name: rulings-land-mid-pass
description: "Dan's grill sessions land rulings and relabels on contract-builder tickets while a master pass runs; read comments before calling a label change tampering"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 51000f22-04b5-4c86-88e0-659adf3c889b
  modified: 2026-09-10T15:03:05.171Z
---

Dan runs `/grill-ready-for-human` from other sessions (often a claude-dotfiles worktree) while a master pass is live. On 2026-09-10 his rulings landed at 01:55Z mid-pass; the master missed them, called the decisions "still yours", reverted his #188 relabel as fleet tampering and filed a false defect (#211, closed next pass).

**Why:** a same-minute fleet start looked like the cause; the ticket's own comment one second earlier said "Relabelled ready-for-agent."

**How to apply:** before any heartbeat that reports decision status, and before reverting any label, read the ticket's latest comments and timeline together. Attribute a label event from transcripts (`~/.claude/projects/*/…jsonl`, subagent workflow dirs included), not timing. Related: [[wrong-notes-self-perpetuate]], [[decisions-via-question-tool]].
