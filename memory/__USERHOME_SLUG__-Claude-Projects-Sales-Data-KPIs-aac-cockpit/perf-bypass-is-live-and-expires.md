---
name: perf-bypass-is-live-and-expires
description: "The perf bypass of the sign-in gate is GONE (removed 2026-08-02, #129) — the deployed page always gates, and here is what replaced it."
metadata: 
  node_type: memory
  type: project
  originSessionId: 3ef79b06-15a0-4db5-a082-fb32e5b11563
  modified: 2026-08-02T06:38:07.673Z
---

**Removed 2026-08-02 (#129), the same day it shipped.** `/exec` gates every caller again; there is no
`PERF_BYPASS`, no `__AAC_BOOT_SESSION`, and the four Script Properties are deleted (read back with
`clasp run inspectScriptPropertyKeys`). If the deployed page ever serves the report with no login, that is a
real regression now, not this.

**Why it existed, so the idea is not reinvented from scratch:** a page-speed tool cannot type an emailed
6-digit code, so the deployed report could not be measured at all. Dan asked for it, naming the security cost
himself; it defaulted to off and expired on its own after eight hours.

**What replaced it, and neither serves data so neither needs a deadline:** `doGet?probe=1` returns the letter
`x` (time it against the real page to split platform cost from template evaluation), and
`window.__aacTiming` is the page's own timeline, logged and postMessaged out of the sandbox frame.
`docs/switches.md` keeps the retired-switch note.

Related: [[ops-endpoint-measurement-recipe]], [[verify-deploy-via-exec-fetch]], [[milestone-map-2026-08-02]].
