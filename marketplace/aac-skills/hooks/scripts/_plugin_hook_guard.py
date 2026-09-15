"""Shared dedup guard for governance hooks that ride in both the plugin payload
and the live-tree ~/.codex/hooks.json (issue 208 criterion 4).

On a PC where the user-settings entries still point at the live-tree copy
(~/.codex/hooks/ask_matt_gate.py), the plugin's own hook entry would fire the
SAME event a second time. This guard makes the plugin copy exit 0 silently when
a live-tree copy is present -- so the hook fires once, from user-settings --
while a container that has no live tree runs the plugin copy unimpeded.

Set PLUGIN_HOOK_GUARD_DISABLE=1 in the env to force the plugin to run anyway.
"""
from __future__ import annotations

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


def _live_tree_twin_exists(caller: Path) -> bool:
    # ask_matt_gate.py lives under ~/.codex/hooks/ on the live tree; every other
    # governance hook is a Node script. We check the codex location and, as a
    # belt-and-braces, ~/.claude/hooks/ with the same basename for any future
    # python hook that gets added.
    home = Path.home()
    codex_home = Path(os.environ.get("CODEX_HOME") or home / ".codex")
    claude_home = Path(os.environ.get("CLAUDE_CONFIG_DIR") or home / ".claude")
    for candidate in (
        codex_home / "hooks" / caller.name,
        claude_home / "hooks" / caller.name,
    ):
        if candidate.is_file():
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
    if not _live_tree_twin_exists(caller):
        return
    sys.exit(0)
