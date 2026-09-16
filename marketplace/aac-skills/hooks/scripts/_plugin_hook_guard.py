"""Shared dedup guard for governance hooks that ride in both the plugin payload
and the live-tree ~/.claude/settings.json (issue 208 criterion 4).

On a PC where the user-settings entries still point at the live-tree copy
(~/.codex/hooks/ask_matt_gate.py), the plugin's own hook entry would fire the
SAME event a second time. This guard makes the plugin copy exit 0 silently when
user settings still dispatch this script -- so the hook fires once, from
user-settings -- while a container that has no such entry runs the plugin copy
unimpeded.

The test is "does settings.json name this script", NOT "does the live file
exist": the live-tree files stay after the paired edit lands (they are the
packager's source for this very payload and the restore test executes them),
so a presence check would keep skipping forever and the hook would fire zero
times. Only Claude Code's settings.json is consulted: ~/.codex/hooks.json
dispatches Codex sessions, which never load this plugin.

Set PLUGIN_HOOK_GUARD_DISABLE=1 in the env to force the plugin to run anyway.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _caller_path(script_path: Path) -> Path:
    try:
        return script_path.resolve()
    except OSError:
        return script_path


def _plugin_root_canonical() -> Path | None:
    raw = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if not raw:
        return None
    try:
        return Path(raw).resolve()
    except OSError:
        return Path(raw)


def _is_plugin_copy(caller: Path, plugin_root: Path) -> bool:
    try:
        caller.relative_to(plugin_root)
    except ValueError:
        return False
    return True


def _user_settings_dispatch(caller: Path) -> bool:
    """True when ~/.claude/settings.json carries a hook command naming this script's basename.

    Plugin-root commands never appear there, so a match is the live-tree entry and the live copy
    is the one that fires."""
    claude_home = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    try:
        settings = json.loads((claude_home / "settings.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    events = settings.get("hooks") if isinstance(settings, dict) else None
    if not isinstance(events, dict):
        return False
    name = caller.name
    for groups in events.values():
        if not isinstance(groups, list):
            continue
        for group in groups:
            hooks = group.get("hooks") if isinstance(group, dict) else None
            for hook in hooks or []:
                if not isinstance(hook, dict):
                    continue
                for key in ("command", "commandWindows"):
                    cmd = hook.get(key)
                    if isinstance(cmd, str) and name in cmd:
                        return True
    return False


def skip_if_live_tree_will_fire(script_path: Path) -> None:
    if os.environ.get("PLUGIN_HOOK_GUARD_DISABLE") == "1":
        return
    plugin_root = _plugin_root_canonical()
    if plugin_root is None:
        return  # not a plugin invocation
    caller = _caller_path(script_path)
    if not _is_plugin_copy(caller, plugin_root):
        return
    if not _user_settings_dispatch(caller):
        return
    sys.exit(0)
