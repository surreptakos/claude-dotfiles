# plugin-hook-guards

Source for the two files the packager copies into
`marketplace/aac-skills/hooks/scripts/` alongside the governance scripts:
`_plugin_hook_guard.js` and `_plugin_hook_guard.py`.

Why they exist — issue 208 criterion 4. The eight governance hooks ride in
the `aac-skills` plugin payload, so a cloud container that installs the plugin
is gated. On a PC the same hooks were also wired in `~/.claude/settings.json`,
pointing at the live-tree copies under `~/.claude/hooks/` and
`~/.codex/hooks/`. Without a guard, installing the plugin on a PC whose
settings still carry those entries fires each hook **twice** per event — once
from user settings, once from the plugin.

The guard asks one question: **does `~/.claude/settings.json` (or
`CLAUDE_CONFIG_DIR/settings.json`) carry a hook command that names this
script's basename?** Plugin-root commands never appear there, so a match is
the live-tree entry, and the plugin copy exits 0 silently to let it fire once.

- **Container** (no settings.json, or none naming the script): the plugin
  script runs as normal.
- **PC with the settings entries still present**: guard finds the entry,
  exits 0 silently; the user-settings entry fires the live-tree copy once.
- **PC after the entries are removed**: guard finds nothing; the plugin copy
  runs. One fire per event.

It deliberately does **not** key on the live *file* existing. The live-tree
files stay after the entries come out: `codex/hooks/` and `claude/hooks/` are
the mirror the packager builds this very payload from, and the restore test
executes them from a fresh home. A presence check would keep skipping forever
and the hook would fire zero times.

Only Claude Code's `settings.json` is consulted. `~/.codex/hooks.json`
dispatches Codex sessions, which never load this plugin, so it cannot cause a
double fire and is not read.

Override: set `PLUGIN_HOOK_GUARD_DISABLE=1` to force the plugin copy to run
even when settings still name the script (useful for local end-to-end tests).

The packager (`tools/build-cloud-plugin.py`) copies the two files into the
plugin payload and prepends a one-line invocation to every governance script
during copy. Never invoke the guard from the live-tree hook scripts
(`~/.claude/hooks/*`, `~/.codex/hooks/*`) — those are the copy that should
always run when user settings dispatches them.
