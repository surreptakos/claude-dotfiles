#!/usr/bin/env python3
"""Package every active personal skill into one uploadable plugin.

Reads the live ~/.claude/skills tree (junctions resolve to their targets), rewrites
each SKILL.md so its frontmatter carries only the six keys the claude.ai upload
validator accepts (name, description, allowed-tools, license, metadata,
compatibility), and emits dist/dan-skills/ plus dist/dan-skills.zip ready for
claude.ai -> Customize -> Plugins -> Add -> Upload plugin.

Disallowed keys (disable-model-invocation, argument-hint, hidden, ...) are not
dropped: they move under metadata as strings, the same shape writing-dan used to
pass the validator on 2026-08-27. Claude Code ignores unknown metadata, so the
plugin still loads locally via --plugin-dir for testing.

Usage:  py -3 tools/build-cloud-plugin.py [--source DIR] [--out DIR]
Exit 0 on success, 1 on any skill that could not be packaged.
"""

import argparse
import json
import re
import shutil
import sys
import zipfile
from datetime import date
from pathlib import Path

import yaml

ALLOWED_KEYS = {"name", "description", "allowed-tools", "license", "metadata", "compatibility"}
PLUGIN_NAME = "dan-skills"

# Never shipped: editor backups and VCS/tooling noise. session-check/cloud-plugin-sweep.js applies
# the same rule, so a .bak file dropped next to a SKILL.md does not read as a stale cloud plugin.
IGNORED_DIRS = {".git", "node_modules", "__pycache__", ".pytest_cache"}
BACKUP_RE = re.compile(r"\.bak(-|\.|$)", re.IGNORECASE)


def ignore_noise(_dir, names):
    return [n for n in names if n in IGNORED_DIRS or BACKUP_RE.search(n)
            or n in {".DS_Store", "Thumbs.db"}]


# A packaged skill runs in a cloud container, where none of this machine's hooks and none of
# ~/.claude/skills exist. Any command naming those paths fails there, so bodies are retargeted at
# the plugin's own copy through ${CLAUDE_PLUGIN_ROOT}, which is substituted only in plugin skills.
CHECK_JS = "${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js"
PATH_REWRITES = [
    (re.compile(r"~/\.claude/hooks/session-gate\.js report --end"), CHECK_JS + " --end"),
    (re.compile(r"~/\.claude/hooks/session-gate\.js report"), CHECK_JS),
    (re.compile(r"(?:~|\$HOME|\$\{HOME\})/\.claude/skills/"), "${CLAUDE_PLUGIN_ROOT}/skills/"),
]
CLOUD_NOTE = (
    "> **Packaged copy.** A cloud session runs none of this machine's hooks, so the commands below\n"
    "> call the plugin's own bundled scripts. Nothing is cached and `--refresh` does not apply:\n"
    "> every run is fresh.\n"
)


def retarget_paths(body):
    """Point commands at the plugin's copy of the scripts. Returns (new_body, changed)."""
    new = body
    for pattern, replacement in PATH_REWRITES:
        new = pattern.sub(replacement, new)
    if new == body:
        return body, False
    # The note belongs under the first heading, next to the commands, not in a footer nobody reads.
    lines = new.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.startswith("# "):
            lines.insert(i + 1, "\n" + CLOUD_NOTE)
            return "".join(lines), True
    return CLOUD_NOTE + "\n" + new, True


def split_frontmatter(text):
    """Return (frontmatter_str, body) or (None, text) when no frontmatter."""
    if not text.startswith("---"):
        return None, text
    parts = text.split("\n---", 2)
    # parts[0] is "---" plus first line remainder; find the closing fence properly
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return None, text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "".join(lines[1:i]), "".join(lines[i + 1:])
    return None, text


def transform_skill_md(path):
    """Rewrite one SKILL.md's frontmatter. Returns (new_text, moved_keys)."""
    text = path.read_text(encoding="utf-8")
    fm_str, body = split_frontmatter(text)
    if fm_str is None:
        raise ValueError(f"{path}: no frontmatter")
    fm = yaml.safe_load(fm_str) or {}
    if not isinstance(fm, dict):
        raise ValueError(f"{path}: frontmatter is not a mapping")

    moved = {}
    for key in [k for k in fm if k not in ALLOWED_KEYS]:
        moved[key] = fm.pop(key)
    if moved:
        meta = fm.get("metadata") or {}
        if not isinstance(meta, dict):
            meta = {"original-metadata": str(meta)}
        for k, v in moved.items():
            meta.setdefault(k, v if isinstance(v, str) else json.dumps(v))
        fm["metadata"] = meta

    fm.setdefault("name", path.parent.name)
    if "description" not in fm:
        raise ValueError(f"{path}: missing description")
    # The claude.ai validator rejects descriptions containing XML tags, e.g.
    # "<ViewTransition>". Drop the angle brackets, keep the tag name.
    fm["description"] = re.sub(r"</?([A-Za-z][\w.:-]*)\s*/?>", r"\1", str(fm["description"]))

    body, retargeted = retarget_paths(body)

    new_fm = yaml.safe_dump(fm, sort_keys=False, allow_unicode=True, width=100000).strip()
    return f"---\n{new_fm}\n---\n{body}", sorted(moved), retargeted


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=str(Path.home() / ".claude" / "skills"))
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "dist"))
    args = ap.parse_args()

    src = Path(args.source)
    out = Path(args.out)
    plugin_root = out / PLUGIN_NAME
    if plugin_root.exists():
        shutil.rmtree(plugin_root)
    (plugin_root / ".claude-plugin").mkdir(parents=True)

    version = date.today().strftime("%Y.%m.%d")
    (plugin_root / ".claude-plugin" / "plugin.json").write_text(
        json.dumps(
            {
                "name": PLUGIN_NAME,
                "version": version,
                "description": "Dan's personal Claude Code skills, packaged for claude.ai "
                "account sync so every Cowork and cloud session loads them. Built by "
                "tools/build-cloud-plugin.py from ~/.claude/skills.",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    fallback = Path.home() / ".agents" / "skills"
    packaged, failures = [], []
    for entry in sorted(src.iterdir()):
        if not entry.is_dir():
            continue  # stray files like PROVENANCE-design-skills.md
        skill_md = entry / "SKILL.md"
        if not skill_md.is_file():
            # dead junction: the live dir reads empty but the junction target has content
            alt = fallback / entry.name
            if (alt / "SKILL.md").is_file():
                entry, skill_md = alt, alt / "SKILL.md"
            else:
                failures.append(f"{entry.name}: no SKILL.md")
                continue
        dest = plugin_root / "skills" / entry.name
        try:
            new_text, moved, retargeted = transform_skill_md(skill_md)
        except Exception as exc:  # noqa: BLE001 - report and keep packaging the rest
            failures.append(f"{entry.name}: {exc}")
            continue
        shutil.copytree(entry, dest, ignore=ignore_noise)
        (dest / "SKILL.md").write_text(new_text, encoding="utf-8")
        packaged.append((entry.name, moved, retargeted))

    zip_path = out / f"{PLUGIN_NAME}.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(plugin_root.rglob("*")):
            if f.is_file():
                zf.write(f, f.relative_to(plugin_root))

    moved_count = sum(1 for _n, m, _r in packaged if m)
    retargeted = [n for n, _m, r in packaged if r]
    print(f"packaged {len(packaged)} skills -> {zip_path} "
          f"({zip_path.stat().st_size // 1024} KB), version {version}")
    print(f"frontmatter keys moved under metadata in {moved_count} skills")
    for name, moved, _r in packaged:
        if moved:
            print(f"  {name}: {', '.join(moved)}")
    print(f"local paths retargeted at the plugin in {len(retargeted)} skills"
          + (f": {', '.join(retargeted)}" if retargeted else ""))
    if failures:
        print("FAILURES:")
        for f in failures:
            print(f"  {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
