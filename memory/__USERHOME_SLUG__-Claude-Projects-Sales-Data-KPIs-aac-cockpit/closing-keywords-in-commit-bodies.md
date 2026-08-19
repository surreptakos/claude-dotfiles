---
name: closing-keywords-in-commit-bodies
description: "GitHub closes issues off commit-body prose — \"closes #482's corruption vector\" auto-closed #482 on push to main"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b05ce032-606c-4afe-b896-95c1ab343b2b
  modified: 2026-08-18T14:28:24.977Z
---

Commit 616ddd1's body said "closes #482's corruption vector" as plain prose; the moment it reached `main`, GitHub's closing-keyword parser closed #482, which was deliberately open for remaining work. Had to reopen with an explanation comment (2026-08-18).

**Why:** GitHub scans commit messages on the default branch for `close/closes/fixes/resolves #N` and acts on them regardless of surrounding grammar. Possessives, subordinate clauses, and "closes the #N vector" phrasings all match.

**How to apply:** never write a closing keyword next to an issue number in a commit body unless the close is intended. Say "shuts #482's corruption vector" / "addresses part of #482" instead. Same hazard in PR bodies.
