---
name: pr-body-quoted-closes-keyword
description: "Quoting \"Closes #N\" anywhere in a PR body (even inside verifier evidence saying it is absent) closes issue N on squash-merge"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a9fdffe7-0cef-49d6-943f-65a0ad4eb1fb
  modified: 2026-09-14T16:52:23.633Z
---

On 2026-09-14 PR #194 in aac-routines auto-closed issue #141 at merge although the body said "Refs #141" on purpose (one acceptance box needed a live run). Cause: the verifier evidence quoted verbatim in the body contained `No 'Closes #141'/'Fixes #141' in commits`, and GitHub's keyword parser matched it. Issue reopened by hand with an explanation.

**Why:** GitHub scans the whole PR body for closing keywords, quotes and negations included; the squash-merge commit inherits the body.

**How to apply:** before opening a fleet or session PR, grep the body for `(close|fix|resolve)[sd]?\s+#\d+` and rewrite any hit that is not an intended close (say "closing keyword" instead of spelling it). After every merge, re-check the state of each issue the PR mentions; the session-end skill already lists this as a thing the script cannot check.
