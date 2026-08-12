---
name: project-harness-skill
description: "Dan's reusable /project-harness skill installs the aac-cockpit organization harness into any repo"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 83ee3ddd-d4d3-450c-bc41-19092153e8f4
  modified: 2026-07-28T23:35:29.699Z
---

`~/.claude/skills/project-harness/` (built 2026-07-28) bolts the organization harness onto any repo, new or existing: five triage labels + prd/chore, issue forms that label `needs-triage` on arrival, a generated `DASHBOARD.md` (`scripts/build-dashboard.js` with a per-repo `CONFIG` block: testCommand / adrDir / deployWorkflow) refreshed by `dashboard.yml` on every push + issue event + daily tick, a `.githooks/pre-commit` test gate via `core.hooksPath`, ADR `**Status:**` line stamping, and an optional Projects v2 board. Idempotent; reference implementation is aac-cockpit itself. Backlog migration rule inside: classify legacy tickets against code before filing — never bulk-import (aac-cockpit's ~90 stale tickets reduced to 4 real issues). Related: [[report-contract-convergence]].
