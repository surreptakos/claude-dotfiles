---
name: user-scope-plugin-wins-over-project-scope
description: A user-scope plugin install loads even in a repo that holds an older project-scope install of the same plugin; stale project-scope entries do not shadow it
metadata: 
  node_type: memory
  type: project
  originSessionId: d63cc1a3-d619-4b3c-b0ab-2aae89792af1
  modified: 2026-09-16T20:06:37.729Z
---

Verified 2026-09-16 while landing issue 208: `aac-skills@claude-dotfiles` was 2026.9.161952 at user
scope and 2026.9.91004 at project scope for the claude-dotfiles checkout. A headless `claude -p
--debug-file` run from that checkout fired the ask-matt gate from
`plugins\cache\claude-dotfiles\aac-skills\2026.9.161952\hooks\scripts\`, the user-scope payload.

**Why:** `installed_plugins.json` carries a project-scope entry for every worktree and repo a
session ever installed into, most at old versions. Chasing each one before trusting a plugin change
is wasted work.

**How to apply:** after `claude plugin update aac-skills@claude-dotfiles` at user scope, the new
payload (hooks included) is what every session on the PC loads. Prove it with the debug-file probe
rather than updating project scopes one by one.
