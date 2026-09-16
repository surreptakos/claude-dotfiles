---
name: restore-test-reads-live-skill-copies
description: "tools/claude-md-lint.test.js compares the LIVE ~/.claude/skills copy to tools/, so one worktree's live edit fails the restore test in every other worktree and in /session-end"
metadata: 
  node_type: memory
  type: project
  originSessionId: fc627e2b-5d41-4469-9096-3b9524cf53f4
  modified: 2026-09-11T21:39:16.009Z
---

The claude-md-lint copy test (`tools/claude-md-lint.test.js`, "byte-identical copy of the
linter") reads `~/.claude/skills/claude-md-lint/claude-md-lint.js` from the real home, not from the
clone under test. The restore test runs that suite, so a fleet worker that copies its in-progress
`tools/claude-md-lint.js` onto the live skill (as the test's own failure message tells it to) turns
`RESTORE NOT PROVEN - 1 of 57 checks failed` on in every other worktree and in the session-end
gate, while CI on a clean clone stays green. Seen 2026-09-11: worker wf_911fa64d-102-10 (the
`--warn` flag) held the live copy; this session's landed tree was fine.

**Why:** the STOP looks like a regression in the current tree and is not; chasing it wasted a
restore-test cycle before the md5 match to the worker's worktree explained it.

**How to apply:** when only the claude-md-lint check fails, md5 the live copy against every
worktree's `tools/claude-md-lint.js` first. A match to a fleet worktree means wait for that PR and
the next sync push; never overwrite the live copy with tools/ from another tree. Ticket filed at
that session's end tracks moving the comparison onto the mirror copy only.
