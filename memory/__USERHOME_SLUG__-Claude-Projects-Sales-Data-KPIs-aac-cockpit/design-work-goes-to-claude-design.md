---
name: design-work-goes-to-claude-design
description: "Claude Design owns the frontend, Claude Code owns the backend — and here is the exact MCP + project id for pulling the latest board myself."
metadata:
  node_type: memory
  type: feedback
  originSessionId: a6ed8c90-20ee-4d6f-8130-e73aba68b846
  modified: 2026-08-01T23:58:50.139Z
---

**The split, as Dan stated it on 2026-08-01:** Claude Design owns the FRONTEND. Claude Code owns the BACKEND.

Frontend means markup, CSS, layout, colour, spacing, a label's placement, and **any visual mechanism** — how a tooltip is drawn, what a status cue looks like, what a table row looks like. Backend means server logic, the injected payload, data, the copy the logic class emits, Apps Script, tests, tooling, docs, the tracker. **The seam is the payload.**

**Pulling the latest board is MY job, not something to ask for.** MCP `claude_design` at `https://api.anthropic.com/v1/design/mcp`, auth via `/design-login`. Project **`497dceb2-621c-4fdd-a09a-3dee7c5a27d8`** — "Sales report interactive webpage". File **`AAC Weekly Sales Review.dc.html`**, plus the `support.js` and `Matrix.dc.html` it imports. Full URL: `https://claude.ai/design/p/497dceb2-621c-4fdd-a09a-3dee7c5a27d8?file=AAC+Weekly+Sales+Review.dc.html`

The `DesignSync` tool reads it directly by `projectId`. **`DesignSync list_projects` does NOT list it** — that call filters to design-*system* projects, and on 2026-08-01 I read its output as complete and concluded the board "does not round-trip", which was wrong and wasted a whole exchange. The design-system project "AAC Sales Reporting" is a separate thing holding components, tokens and guidelines; the served board is not in it.

**The board file has two owners and no boundary** — roughly its first 560 lines are Design's markup, the rest is the repo's logic class. A pull is a MERGE, never a drop-over, or it reverts the logic. Verified 2026-08-01: Design's copy was 1,233 lines and still carried `Pace calls for`, `Too much in one deal` and `confirmed as-is`, while the repo's was 1,280 with all of that fixed. Tracked as issue #123. The Design project's own `github.md` records a `## Last sync` date — read it, and update it after a sync.

**How to apply:** if a task is "make this look right", hand it over with the diagnosis and the data ready, and say plainly what is decided (the payload shape) and what is not (how it looks). Never invent markup, CSS, or a label's words to finish a fix. Every issue gets `frontend` or `backend`, exactly one, by who acts next — `tools/tracker-audit.js` fails on an unlabelled one.

Related: [[backend-only-the-seam-is-the-payload]] (the five places I crossed the line and what it cost), [[read-the-connector-not-the-local-copy]], [[verify-before-filing-cite-the-check]].
