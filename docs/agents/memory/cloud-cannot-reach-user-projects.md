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

A user-owned board has no repository-scoped path, so no cloud session can write it. The routes
that work: the board's built-in "Auto-add to project" workflow (owner toggle, Settings then
Workflows, filtered to the repo), or a desktop session's `gh`. A repo doc that tells an agent to run
`gh project item-add` at issue creation is a desktop-only step; a container reports it as owed, it
does not retry it.

The general lesson: a `gh` error string is gh's own summary. Before naming a cause, re-run with
`GH_DEBUG=api` and quote the HTTP status and message of the failing request.

Source: https://github.com/surreptakos/aac-sales-cockpit/issues/752, aac-sales-cockpit docs/agents/issue-tracker.md ("Project board")
