---
name: status-questions-not-build-orders
description: "Dan's \"where are we / I need it working by X\" is a status question plus a deadline, not permission to implement — report first, wait for go"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7f42ac53-e796-492b-a075-35bd09d311db
  modified: 2026-08-18T06:12:44.550Z
---

2026-08-18: Dan asked "Where are we with this project? I need it working for O3's flawlessly and cheaply tomorrow." The session read that as a build order and started editing the prefilter, skill, routine cards, and ADRs. Dan interrupted twice, then said plainly: "I DON'T want you to implement anything right now."

**Why:** A status question with a deadline attached still asks for an assessment. Dan decides when building starts, even under time pressure. Premature edits also left uncommitted worktree changes he then had to adjudicate.

**How to apply:** For "where are we" / "what's the state of" prompts, deliver findings and a proposed plan, then stop. Begin implementation only after an explicit go. Dry-run verification that reads real data is fine; writing to the repo is not. He also audits the standing demands ([[pre-send-lint-discipline]]) and calls out misses.
