---
name: live-board-seed-primary
description: Since issue 334 (deployed 2026-08-28) the project W/O seed loads LIVE from the Message Board; JobData.gs is fallback only
metadata: 
  node_type: memory
  type: project
  originSessionId: b2c0c2ca-93b5-4d6e-a2c9-2b71c734cec4
  modified: 2026-08-28T14:29:08.294Z
---

Issue 334 (PR 337, merged + deployed 2026-08-28): `loadProjectJobSeed` in `gas/Code.gs` reads the
Message Board sheet (`1dBhSYwk1lHXAosMtbdQ4qI73Rb60BBiB4S6h42ruUQg`, tab `Leads / Jobs`) live via
SpreadsheetApp — no UrlFetch quota — memoized ~30 min in CacheService. Gitignored static
`gas/JobData.gs` (written by `tools/sync-jobs.js --emit`) is the FAIL-SOFT FALLBACK, not the
primary. Both paths go through `core.projectSeedFromBoardRows`, so they cannot drift on shape.

**Why:** deployed static seed went stale (2026-08-19 / 834 W/Os vs board's 842) and caused two of
the owner's 2026-08-26 review misses (42168, 42196 — on the board, not in the seed). Verified live
post-deploy: `clasp run-function serviceWoRouteDiag 42168` / `42196` report `boardMember: true`.

**How to apply:** a W/O "missing from the registry" is now a live-board question first — check the
board row, then `serviceWoRouteDiag`, before suspecting code. Keep JobData.gs fresh anyway (issue
339, ready-for-human, tracks the refresh cadence) so an outage doesn't degrade to a months-old
list. Related: [[owner-ruling-registry-membership-wo]].
