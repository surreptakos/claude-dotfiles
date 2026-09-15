# plugin-hook-guards

Source for the two files the packager copies into
`marketplace/aac-skills/hooks/scripts/` alongside the governance scripts:
`_plugin_hook_guard.js` and `_plugin_hook_guard.py`.

Why they exist — issue 208 criterion 4. The eight governance hooks now ride in
the `aac-skills` plugin payload, so a cloud container that installs the plugin
is gated. On a PC the same hooks are also wired in `~/.claude/settings.json`
and `~/.codex/hooks.json`, pointing at the live-tree copies under
`~/.claude/hooks/` and `~/.codex/hooks/`. Without a guard, installing the
plugin on the PC would fire each hook **twice** per event — once from user
settings, once from the plugin.

The clean fix is to remove the user-settings entries and let the plugin own
them, but that edit lands in the live tree and the mirror together via
`sync.ps1 -Mode push`, which is not something an isolated worktree agent can
do (live-tree hard rail). The guard makes the plugin hooks work correctly
regardless of whether that paired edit has landed yet:

- **Container** (no live tree): `_plugin_hook_guard` finds no live twin at
  `~/.claude/hooks/<name>` or `~/.codex/hooks/<name>`, and returns without
  exiting — the plugin script runs as normal.
- **PC before the paired edit lands**: guard finds a live twin, exits 0
  silently, and the user-settings entry fires the live-tree copy once.
- **PC after the paired edit lands** (Dan removes the live-tree hook files
  along with the settings entries, then `sync.ps1 -Mode push`): guard finds
  no live twin, plugin script runs. One fire per event.

Override: set `PLUGIN_HOOK_GUARD_DISABLE=1` to force the plugin copy to run
even when a live twin exists (useful for local end-to-end plugin tests).

The packager (`tools/build-cloud-plugin.py`) copies the two files into the
plugin payload and prepends a one-line invocation to every governance script
during copy. Never invoke the guard from the live-tree hook scripts
(`~/.claude/hooks/*`, `~/.codex/hooks/*`) — those are the copy that should
always run when user settings dispatches them.
