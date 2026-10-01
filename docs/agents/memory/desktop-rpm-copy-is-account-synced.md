---
name: desktop-rpm-copy-is-account-synced
description: "The desktop app's rpm/plugin_<id>/ copy of aac-skills is the claude.ai account-synced install of the claude-dotfiles marketplace, not an organization copy; read rpm/manifest.json before naming where a plugin copy came from"
metadata:
  node_type: memory
  type: project
  modified: 2026-10-01T01:30:00.000Z
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
the gate ran. The setup check now reads this copy too (issue 1149): an ok line per org folder
when `rpm\manifest.json` lists aac-skills and its folder holds `.claude-plugin\plugin.json`, a
STOP otherwise.

**What writes and refreshes it: the app's own plugin sync (found 2026-09-30 on AAC-AI, issue
1149).** The app downloads every plugin the signed-in account has installed into `rpm\`, at
launch and then on a timer, and re-downloads a plugin's folder when a newer version is published.
How it was found, read-only, from timestamps on AAC-AI: the app process started 18:03:33 local;
the server published aac-skills 2026.9.302329 (manifest `updatedAt` 23:42:23Z, 18:42 local); at
19:03:38 local, an hour after launch, the whole `plugin_01GBedA5A59asvhKehjXd3sm\` folder was
re-created with all 419 files written within 1.2 s at version 2026.9.302329, replacing Dan's
hand copy made between 17:05 and 17:19; the manifest was rewritten again at 19:43:37
(`lastUpdated`). The other orgs' plugin folders all date from the first sign-in sync (2026-09-24
12:01). The gap itself came
after the app updated to 2.16120.0 at 15:49 local (`version_first_launch` in
`%APPDATA%\Claude\config.json`): from 16:57 a desktop session ran hooks from that folder before
any sync had written it. So the fix is to let the app sync (account has aac-skills installed,
quit and reopen, leave it open), and a hand copy is only a stopgap the next sync replaces.
Not yet seen: whether a launch alone, with no new version published, writes a missing folder.
`%APPDATA%\Claude\logs` is empty on AAC-AI, so the timestamps are the only record.

Source: https://github.com/surreptakos/claude-dotfiles/issues/943, https://github.com/surreptakos/claude-dotfiles/issues/857, https://github.com/surreptakos/claude-dotfiles/issues/948, https://github.com/surreptakos/claude-dotfiles/issues/1149
