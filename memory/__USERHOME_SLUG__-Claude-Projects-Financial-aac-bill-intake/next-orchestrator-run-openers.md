---
name: next-orchestrator-run-openers
description: Next orchestrator session runs issues 317 and 275 live halves itself from the MAIN checkout before fleeting; owner go-ahead recorded 2026-08-25
metadata: 
  node_type: memory
  type: project
  originSessionId: f3053660-93ab-4ebd-95d0-7d1440c955b6
  modified: 2026-08-25T12:18:32.426Z
---

Owner instruction 2026-08-25: "I already told you to go ahead on enrichment & the GL Gas rename. Next time we do ticket fleet just run those."

**What it means:** the ORCHESTRATOR session (main checkout, live-write-capable) executes the live halves of issue 317 (vendor email enrichment: sandbox probe of `PATCH /v3/vendors/{id}` `{email}`, merge salvage branch origin/agent/issue-317-attempt1, release gates, clasp push, dry-run plan, cap-5 apply, re-run issue 267 diagnostics) and issue 275 (GL "Gas" rename: sandbox-probe `coaRenameById`, merge origin/agent/issue-275-attempt1 — but NOT its HANDOFF.md text, it lies about a capture ticket — gates, push, prod rename, `previewProposedGlChoices` verify) BEFORE running the fleet. Runbooks live in each ticket's 2026-08-25 comments.

**Why not the fleet:** fleet worktrees never clasp push/deploy (repo rule), so these tickets stay labelled ready-for-human — the scout skips them by label, and the orchestrator picks them up by the go-ahead comments. Do not relabel them ready-for-agent; a fleet agent would burn both attempts parking them again.

Related: [[owner-actions-are-tickets]], [[surface-in-chat-not-docs]]. Ruling on issue 323 (closed 2026-08-25): RELAY keeps park-and-wait; AP-Administrator fallback stays sweep-only.
