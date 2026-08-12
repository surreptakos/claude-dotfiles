---
name: design-projects-on-the-work-account
description: "Which Claude Design project is live for the boards, which design system is stale, and why DesignSync and the claude_design MCP disagree about what exists."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4d5f5f05-e328-4aa4-88a9-2f1f0153c66e
  modified: 2026-08-12T14:45:46.523Z
---

Dan moved the board work onto **dgatsakos@activealarm.com** on 2026-08-12 by exporting the gmail project
and having me upload it. State after that:

- **LIVE boards: `e7d60a32-b086-4175-bac3-4de83dcf8207`** — "AAC Sales Review — Boards",
  `type: PROJECT_TYPE_PROJECT`, bound to a design system at creation, 129 files. Canvas authoring
  confirmed working by Dan.
- **`fb594320-…`** "AAC Sales Reporting" — design system, and **MONTHS BEHIND**: `tokens/typography.css`
  737 bytes against the live 913, no `guidelines/type-data.html`, every etag one old sync. Vendoring the
  adherence contract from it cost 143 false `unknown-token` violations (`--t-data`, `--n-tile`).
- **`763dc528-…`** — design-SYSTEM-typed upload of the same export; staging only, the server-side copy
  source. **`497dceb2-…`** — work-account original, boards months stale, dormant. **`8eeefa83-…`** —
  gmail's, 404s here.

**TWO DESIGN SYSTEMS EXIST IN ONE PROFILE.** Check which one a token or component came from before
trusting it; `list_design_systems` shows neither of these two, so project `type` is not the same thing as
being a bindable design system.

**The two transports disagree, and only one is trustworthy for existence questions.** `DesignSync
list_projects` filters to design-system projects. The `claude_design` MCP's `list_projects` filters
nothing — 12 rows against DesignSync's 6. An id missing from DesignSync is not missing.

**Only the MCP creates a regular project.** `DesignSync create_project` makes `PROJECT_TYPE_DESIGN_SYSTEM`
and the type is **immutable at creation**, so a board uploaded through it lands in the wrong kind of
project. MCP `create_project` takes `design_system_id` and produces `PROJECT_TYPE_PROJECT`.

**Other mechanics worth not rediscovering:** `CLAUDE.md` is a reserved path — uploads are refused, Dan
pastes it through the UI. MCP `write_files` is inline-data only (`local_path` returns not-implemented), so
upload via DesignSync `localPath` then `copy_files` server-side to avoid pulling bytes through context.
`/design-consent` grants the DesignSync path, NOT MCP OAuth; the MCP needs `claude mcp login <name>` in an
interactive terminal (scopes `user:design:read user:design:write`; the session token gets 401).

Related: [[design-work-goes-to-claude-design]], [[read-the-connector-not-the-local-copy]],
[[verify-before-filing-cite-the-check]].
