---
name: cloud-cannot-reach-user-projects
description: "A claude.ai/code session cannot add an issue to a user-owned Projects v2 board: gh project item-add dies on GraphQL 403, and REST /users/{u}/projectsV2 is refused as not repo-scoped (2026-09-30)"
metadata:
  node_type: memory
  type: feedback
  modified: 2026-09-30T15:05:00Z
---

The session's GitHub proxy passes only repository-scoped REST. Measured 2026-09-30 adding
surreptakos/aac-sales-cockpit issue 752 to the AAC Sales Report board (user project 1):

- `gh project item-add 1 --owner surreptakos --url <issue>` exits 1 printing only `unknown owner
  type`. That text hides the cause: `GH_DEBUG=api` shows its first request, `POST
  https://api.github.com/graphql`, answered `403` with "GitHub GraphQL is not available from Claude
  Code sessions".
- The REST fallback `gh api /users/surreptakos/projectsV2/1` is refused `403` with "sessions are
  bound to their configured repositories. Use repository-scoped endpoints".
- The GitHub MCP tools carry no Projects tool.

A user-owned board has no repository-scoped path, so no cloud session can write it. The board's
"Auto-add to project" workflow does the job with no session step, and AAC Sales Report has had it on
since 2026-07-29 (aac-sales-cockpit `docs/agents/issue-tracker.md`, "New issues reach the AAC Sales
Report board automatically"; Dan confirmed 2026-09-30). So a new issue there owes nothing. Manual
`gh project item-add` is desktop-only backfill.

That doc's opening line still said to item-add every new issue, contradicting its own auto-add
section further down. This session read the opening line, missed the section, and sent Dan to
enable a toggle that was already on. Read a tracker doc to the end before reporting a board step as
owed.

The general lesson: a `gh` error string is gh's own summary. Before naming a cause, re-run with
`GH_DEBUG=api` and quote the HTTP status and message of the failing request.

Source: https://github.com/surreptakos/aac-sales-cockpit/issues/752, aac-sales-cockpit docs/agents/issue-tracker.md ("Project board")
