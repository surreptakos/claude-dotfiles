---
name: session-end-fixes-all-drift
description: "At /session-end every tracker-audit finding is fixed regardless of which session caused it; \"pre-existing, somebody else's\" is not an outcome (Dan, 2026-09-10)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 09db5a64-421a-4918-b4f6-8d81ee05c17c
  modified: 2026-09-10T17:17:50.263Z
---

Dan, 2026-09-10, after a `/session-end` reply reported three dangling cross-repo references as
"pre-existing, owned by ticket 92" and left them: "why are you leaving other drifts alone instead of
fixing them? Doesn't /session-end instruct you to fix everything regardless of where it came from?"

**Why:** the session-end pass is the tracker's housekeeping; a finding deferred to "the session that
caused it" is re-investigated by every later session and never cleared. The older skill text made
pre-existing audit drift optional; that paragraph was rewritten the same day.

**How to apply:** run the audit, fix each finding in place (qualify bare `#N` as `owner/repo#N`,
tick or justify boxes, add the triage label), re-run until only findings needing an owner ruling
remain, and turn those into `ready-for-human` tickets. See [[verify-before-filing-a-sweep-ticket]].
