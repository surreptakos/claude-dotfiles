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

**A new PC can come up without it (AAC-AI, 2026-09-30).** After install and a clean setup check,
a desktop session there was sent to run the route gate from the account's
`rpm\plugin_01GBedA5A59asvhKehjXd3sm\` folder under `%APPDATA%\Claude\local-agent-mode-sessions\`,
and that whole tree did not exist; Dan created it and copied the plugin folder over by hand, and
the gate ran. Why the app had not synced it there is not known. The setup check reads the CLI
plugin under `~/.claude/plugins`, not this copy, so it did not report the gap. A hand copy is not
refreshed by `git pull`; the app's sync is what keeps it current.

Source: https://github.com/surreptakos/claude-dotfiles/issues/943, https://github.com/surreptakos/claude-dotfiles/issues/857, https://github.com/surreptakos/claude-dotfiles/issues/948
