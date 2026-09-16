---
name: verify-before-filing-a-sweep-ticket
description: Re-list open issues immediately before publishing a session-end sweep ticket — a background chip session may have filed and fixed it already.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 062630b3-240b-4bb4-b035-cdfb34f164d2
  modified: 2026-08-13T16:38:23.255Z
---

Re-run `gh issue list --state all` in the same step as publishing a sweep ticket, not earlier. On
2026-08-13 I filed #5 for a restore-test defect after checking the tracker at the start of the sweep;
issue #6 — same defect, same evidence, plus a finished fix on branch `claude/stoic-maxwell-358fb7` —
had been filed six minutes before mine by the background session that took the task chip I spawned.
Cleanup took closing #5, stripping its acceptance boxes so `tools/tracker-audit.js` stopped reporting
`closed-with-open-boxes`, and cross-comments on both.

**Why:** spawning a chip hands the same work to a session that files its own tickets. The gap between
"I checked the tracker" and "I published" is exactly where a duplicate lands, and a duplicate labelled
`ready-for-agent` sends an agent to redo finished work.

**How to apply:** after spawning a task chip, treat that topic as claimed. At publish time re-list
issues, and check `git ls-remote --heads origin` for the other session's branch — its work may be
committed but unpushed, which the issue body will not tell you. See [[state-a-standing-rule-once]].
