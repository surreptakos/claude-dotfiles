---
name: workflow-prompt-needs-allow-rule
description: "The fleet's Workflow prompt offers only Allow once because scriptPath calls carry no rule suggestion; a bare Workflow entry in permissions.allow is what removes it"
metadata:
  node_type: memory
  type: project
  modified: 2026-09-24T01:30:00.000Z
---

The "Allow Claude to run a workflow ticket-fleet?" prompt with only **Allow once** (issue 705)
comes from a cloud session (claude.ai/code) in **auto** mode whose repo settings have no
`Workflow` allow entry. claude-dotfiles was that repo: it is the one repo the harness v32
delivery (`add-cloud-plugin.js`, issue 651) never ran against. Reproduced 2026-09-24 in
`session_01NKDDkFbUaJoVjgZtJAW1bJ` (claude-dotfiles, claude.ai/code, `permissionMode: auto`): 24 s
passed between the fleet's `Workflow` tool_use and its launch. The 2026-09-22 screenshot session is
not proven. The likeliest one is `session_011W8ExSs4SGTRbSZUKemYrd`, the same kind of session
(claude-dotfiles primary, cloud, auto, idle at 21:10, four minutes before the report).

What the Claude Code 2.1.281 binary does with a `Workflow` call:

- `checkPermissions` returns `ask`. It attaches the `Workflow(<name>)` "don't ask again"
  suggestion only for a *named* workflow. A `scriptPath` call, which is how the fleet always runs,
  gets none, so the dialog can offer only Allow once. Clicking it saves nothing.
- A bare `Workflow` rule in `permissions.allow` turns that `ask` into `allow` before any
  mode-specific handling. This works in auto mode too, because auto strips only Bash, PowerShell,
  Agent and Monitor wildcards. bypassPermissions also allows it, which is why desktop masters never
  see the prompt.
- Without the rule, auto mode shows the prompt as the **workflow usage consent**
  (`workflowNeedsUsageConsentPrompt`), not as a classifier review. That lasts until
  `skipWorkflowUsageWarning` is set in user or local settings. Project settings do not count, and a
  fresh container's user settings never have it, so every new cloud session asks again.

So `aac-bill-intake` and `aac-sales-cockpit`, which list `Workflow`, cannot have raised this
prompt. When the prompt appears, check the rooting repo's `.claude/settings.json`, then re-run
`node aac-skills/project-harness/templates/add-cloud-plugin.js <repo>`.
`tools/harness-bootstrap-delivery.test.js` fails if this repo drifts from that delivery.
