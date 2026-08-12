---
name: dan-needs-an-editable-week
description: "Dan must always be able to type into a live report to test it — the owner is exempt from the publication lock, and any new gate has to keep that true"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: dc30d7b1-b64a-4292-890a-d056919d16ae
  modified: 2026-08-02T06:56:22.227Z
---

Dan tests the report by **typing into it**. Any change that closes the live week closes his only way to check
the thing works, and he will hit it within the hour.

**Why:** on 2026-08-02 I shipped #106 (publication freezes the week) and #117 (the owner may author any rep's
report) in the same session. #106 locked the current week; #117 became unusable on the only week that exists.
Both tickets were "done", every test passed, and the first thing Dan said was that he could not type. I had
even written the test asserting "a locked week wins over canWrite" without registering what that meant.

**How to apply:** `isOwnerCtx_` bypasses the PUBLICATION lock (`weekLockState_`); nothing bypasses the
SNAPSHOT lock. Before adding any new gate on rep input, ask what it does to the owner on the live week, and
verify by reading the deployed envelope for `dgatsakos@activealarm.com` — `locked` must be false. More
generally: when two tickets touch the same gate, check the interaction before closing the second one.

Related: [[backend-only-the-seam-is-the-payload]], [[verify-before-filing-cite-the-check]].
