---
name: prod-freeze-thursday-promote
description: "Dan's rule (2026-08-10): the board is live — prod deploys Thursdays only, Mon-Wed the board must not change; all pushes go to a TEST deployment."
metadata: 
  node_type: memory
  type: project
  originSessionId: 51059a3a-a75e-4204-8df0-e916ad6ef06b
  modified: 2026-08-10T14:44:40.104Z
---

Dan, 2026-08-10: "This board is now LIVE. Every deploy needs to go to a test deployment from now on. We can deploy to prod on Thursdays. Mon-Wed the board must not change."

**Why:** the sales team reads the report during the week; a mid-week change pulls the ground out from under a reader.

**How to apply:**
- Push-to-main deploys to the TEST deployment only (#408 builds the pipeline; until it lands, do not merge anything that would trigger a prod deploy Mon-Wed).
- Prod promotes Thursday via `promote.yml` (manual + scheduled), with a freeze guard refusing Mon-Wed; an explicit emergency flag overrides it and logs loud.
- Deployed verification during the week runs against the TEST /exec URL, not prod.
- Related: [[verify-deploy-via-exec-fetch]], [[question-stops-work-answer-in-final-text]].
