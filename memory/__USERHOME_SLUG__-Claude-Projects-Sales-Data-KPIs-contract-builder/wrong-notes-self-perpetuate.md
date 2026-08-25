---
name: wrong-notes-self-perpetuate
description: "Dan's recurring complaint: 'X is missing/already implemented' assertions from stale notes — search disk before any existence claim, fix wrong source at discovery"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 97586414-28fe-45df-bb83-0f6587af170c
  modified: 2026-08-25T14:09:16.592Z
---

Dan (2026-08-25, angry, after "copy templates from jobs drive" claim when they'd been in-repo for weeks): "Why does it always seem like you internally drift within seconds of learning something? I'm fucking sick and tired of seeing 'X is already implemented' like the right hand doesn't know what the left hand is doing."

**Why:** Sessions boot from written context (CLAUDE.md, memory files, compaction summaries). A wrong sentence in any of them gets repeated confidently forever — permanence preserves errors as reliably as facts. The templates incident had three reinforcing wrong sources (repo CLAUDE.md line 27 "synthetic fixtures / once landed templates/", memory "synthetic template", hard-rule-3 "fixtures are synthetic" pattern-match) and one correcting source never opened (TEMPLATES-MANIFEST.md). Same class as the earlier clasp-scope note ("drive.file only" — also wrong, also corrected in place).

**How to apply:** (1) Before asserting anything exists/is missing/is implemented, run the cheap check — Glob/Grep/ls takes seconds; notes never outrank a live look. (2) The moment a written source proves wrong, edit THAT source (CLAUDE.md, memory file, doc), not just the answer — an uncorrected note re-arms the mistake for the next session. (3) Read TEMPLATES-MANIFEST.md before any claim about what artifacts this machine holds. Related: [[contract-builder-project-state]].
