---
name: commandwindows-is-a-codex-field
description: "commandWindows is a Codex hooks.json field (Windows-only command override); Claude Code has no such field, so the aac-skills plugin hooks run the one python3/node command on every surface (2026-10-01)"
metadata:
  node_type: memory
  type: project
  modified: 2026-10-01T00:00:00.000Z
---

`commandWindows` belongs to Codex: its hooks documentation lists it as an optional Windows-only
command override beside `command`, `timeout`, `statusMessage`, `additionalContextLimit` and `async`,
so `profile/codex/hooks.json` carries it on purpose. Claude Code's command-hook schema has no
Windows-specific field (`type, command, args, async, asyncRewake, shell, if, timeout,
statusMessage, once`), and `cli.js` 2.1.287 contains no occurrence of the string. The aac-skills
plugin manifest carried the key from 2026-09-15 to 2026-10-01 (PR 1230 removed it): claude.ai's
plugin manager logged `Field 'commandWindows' ... is not a recognized hook field in this server's
schema and was not stored` for every hook, and the `py -3` spelling never ran anywhere. The plain
`command` (`python3`, `node`) is what runs on a Windows desktop, through Git Bash.

**Why:** the key was lifted from the Codex half of the profile into the Claude plugin generator and
read as a Claude Code feature for two weeks; the plugins window was the only place that said
otherwise.

**How to apply:** a Claude Code hook gets one `command`, written so it resolves on Linux and on
Windows Git Bash alike (`python3`, `node`, `${CLAUDE_PLUGIN_ROOT}` paths). A Windows-only variant
is a Codex concern and lives only under `profile/codex/`. `tests/build-cloud-plugin.test.py`
rejects any undocumented hook field. Related: [[windowsapps-python-hides-appdata-npm]],
[[marketplace-is-the-distribution-spine]].
