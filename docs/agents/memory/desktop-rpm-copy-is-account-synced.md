---
name: desktop-rpm-copy-is-account-synced
description: "The desktop app's rpm/plugin_<id>/ copy of aac-skills is the claude.ai account-synced install of the claude-dotfiles marketplace, not an organization copy; read rpm/manifest.json before naming where a plugin copy came from"
metadata:
  node_type: memory
  type: project
  modified: 2026-09-28T16:40:00.000Z
---

Desktop Code sessions load aac-skills from
`%APPDATA%\Claude\local-agent-mode-sessions\<account>\<org>\rpm\plugin_<id>\`. On 2026-09-28
(issue 943) a session called that copy "the organization copy" from the folder path and the
#857 inventory's labels, while Dan was signed into the standalone Dan (Max) account. The folder's
own `rpm/manifest.json` said otherwise: `"marketplaceName": "claude-dotfiles"`,
`"installedBy": "user"`. It is claude.ai's account-level install of the same marketplace, synced
down by the app, and it stayed current while the `~/.claude/plugins` marketplace and project
copies were four days stale.

**Why:** a path or a label in someone's inventory is a stand-in for the source. The manifest
names the marketplace and who installed it.

**How to apply:** before saying which copy of a plugin a session runs, or where it came from,
read `rpm/manifest.json` for the plugin id in the session's plugin path. Do not infer
"organization" from the folder layout. See [[cowork-plugin-cache-can-go-stale]] for the same
folder going stale on the Cowork side.
