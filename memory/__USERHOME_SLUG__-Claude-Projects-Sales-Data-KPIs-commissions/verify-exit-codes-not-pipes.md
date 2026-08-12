---
name: verify-exit-codes-not-pipes
description: "Piping a command into tail/head makes $? the pipe's exit code, so success checks silently pass — cost two false \"verified\" reports in one session"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 37ec1216-f0da-4898-bb5b-34436eec896e
  modified: 2026-07-31T03:42:40.805Z
---

Twice on 2026-07-30 I reported success that had not happened, both from the same mistake:
**checking `$?` or `&&` after piping a command through `tail`/`head`.** The pipeline's exit code is
the LAST command's, so `git push ... | tail -2 && echo PUSHED` prints PUSHED on a rejected push, and
`node suite.js | tail -2; echo "exit=$?"` reports tail's 0 for a failing suite.

Both times the wrong claim reached the user before I caught it — once as "PUSHED" for four repos whose
pushes were all rejected non-fast-forward, once as a test-suite exit code.

**Why:** Verify the thing itself, not a pipeline that happens to contain it. Run the command bare and
capture `$?` on its own line, or check the end state directly (`git rev-parse HEAD` vs
`origin/<branch>`, not push's output).

**How to apply:** When a claim of success depends on an exit code, never let a pipe sit between the
command and the check. Prefer asserting observable end state over trusting a command's own report.

Related trap from the same session: appending a probe to a test file **after** its `process.exit(...)`,
so the probe never ran and the "proof" proved nothing. Verify that a deliberate break actually breaks
before trusting that it passes. See [[unmatched-rep-hardening]].
