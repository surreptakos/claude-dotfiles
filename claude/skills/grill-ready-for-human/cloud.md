# Cloud container instruments

Every step in `SKILL.md` still applies in a container; only the tool changes. A `gh` spelling that fails is a cue to use the GitHub MCP equivalent, same shape as the mcp branch of `aac-skills/ticket-fleet/ticket-fleet.js` in claude-dotfiles:

| The step says | In a container use |
| --- | --- |
| `gh repo view --json nameWithOwner` | derive `<owner>/<repo>` from `git remote get-url origin` |
| `gh issue list --label ready-for-human --state open --json ...` | MCP `list_issues` (label: "ready-for-human", state: "open") |
| `gh issue view N --comments` | MCP `issue_read` (body) then its comments method for the thread |
| `gh issue list --search ...` | MCP `search_issues` |
| `gh issue comment N --body-file <path>` | MCP `add_issue_comment` |
| `gh issue edit N --add-label ... --remove-label ...` | MCP `update_issue` (labels) |
| `gh issue close N --reason completed` / `--reason "not planned"` | MCP `update_issue` (state: closed, state_reason: completed / not_planned) |
| `gh issue view N --json labels,state` | MCP `issue_read` (verify labels + state) |

Read-only checks can also go straight to REST — `curl https://api.github.com/repos/<owner>/<repo>/issues?labels=ready-for-human&state=open` — the session's egress proxy authenticates api.github.com, private repos included.

MCP write calls (comment, update, close) may raise a permission prompt; when the user typed `/grill-ready-for-human`, that prompt is the confirmation, not a reason to skip the step.
