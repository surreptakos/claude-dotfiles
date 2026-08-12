---
name: pause-on-midturn-messages
description: A mid-turn message from Dan during a long build is a steering attempt — pause and check before continuing.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 227b0020-f620-483f-846e-6c16c2477b31
  modified: 2026-08-07T06:40:18.443Z
---

During the 2026-08-07 monthly-ops build (plan approved, 6 PRs executed in one stretch), Dan sent a casual
mid-turn message ("so the conversation helped?") intending to open a side conversation and redirect the
work to burn fewer tokens. I answered it inline and kept building; he had to reject a tool call to stop me,
and said "Argh. I tried to stop you with a 'btw' side chat so I can run this differently."

**Why:** an approved plan is authorization for the work, not for ignoring steering. Dan runs long builds
cost-consciously and may want to rebatch or delegate mid-flight.

**How to apply:** when any user message arrives mid-turn during a multi-phase execution, treat it as a
possible redirect — answer it AND ask "keep going, or pause?" before starting the next phase. Cheap
question, expensive mistake.
