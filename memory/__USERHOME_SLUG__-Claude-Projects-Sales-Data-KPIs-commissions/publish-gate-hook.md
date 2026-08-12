---
name: publish-gate-hook
description: ask_matt_gate.py now denies gh issue create outside ticket flows + requires AskUserQuestion before a 2nd issue; heredoc/quote-aware matching
metadata:
  type: feedback
---

2026-08-12 Dan asked why hooks didn't force /to-tickets step 4 (approve breakdown before publishing). Root cause: `_claude_pre_tool` validated only that A flow was declared, never route-vs-behavior.

**Why:** declared `triage`, published 8 tickets unchallenged, skipped user approval.

**How to apply:** `_publish_gate` in `~/.codex/hooks/ask_matt_gate.py` denies `gh issue create` / `gh api POST .../issues` unless flow ∈ {to-tickets, to-spec, triage}; 2nd+ issue per session requires `AskUserQuestion` in transcript. Matching strips heredoc bodies and quoted strings, anchors segment heads — it self-blocked twice before those fixes (mentioning `gh issue create` in a heredoc reply tripped it). Backup `ask_matt_gate.py.bak-pre-publish-gate`. Counter file `<session>--published.json` survives turns. Dan wants gates GENERAL (policy table or skill frontmatter), not per-failure patches — proposed, undecided. On Fable 5: trim triple governance injection to one (over-prescription reduces quality per migration guide), keep lint. Sync via [[claude-dotfiles]].
