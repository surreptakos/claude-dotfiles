---
name: pre-send-lint-discipline
description: "Every reply must pass the ask_matt_gate.py pre-send lint before sending, and each turn needs a fresh declare-claude nonce — Dan audits misses"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7f42ac53-e796-492b-a075-35bd09d311db
  modified: 2026-08-18T06:32:05.640Z
---

2026-08-18: Dan called out replies sent without the required pre-send lint and turns worked without a fresh flow declaration.

**Why:** Standing directives in ~/.claude/CLAUDE.md. The lint (`py -3 "__USERHOME__\.codex\hooks\ask_matt_gate.py" lint <file> "<session_id>"`) must exit 0 on the final reply text before sending; skipped runs are stamped and reported at Stop. The lint enforces caveman style mechanically: banned filler/hedge words, article density cap 7 per 100 words, 500-word cap.

**How to apply:** Every turn: run `declare-claude` with the turn's fresh nonce first, write the final reply to a scratch file, lint until exit 0, send only the linted text. See [[status-questions-not-build-orders]] for the same session's scope correction.
