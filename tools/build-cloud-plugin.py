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

Also emits the same payload unzipped into <repo>/marketplace/dan-skills/ and writes
<repo>/.claude-plugin/marketplace.json, which makes the repo itself an installable Claude
plugin marketplace (claude plugin marketplace add surreptakos/claude-dotfiles). The zip
remains for the claude.ai org-Skills surface, which only takes uploads.

Every source skill is stamped before it is packaged (tools/skill-stamps.py): four keys under
`metadata:` - modified, previous-modified, revision, content-sha - rotate whenever the skill's
content hash no longer matches the recorded one, and are written back into the SOURCE SKILL.md
(the live tree, or aac-skills/) so the mirror, the package and the file an agent edits all say
the same thing. --no-stamp-write computes them for the package only.

Usage:  py -3 tools/build-cloud-plugin.py [--source DIR] [--out DIR] [--no-marketplace]
                                          [--from-mirror [--home C:\\Users\\Dan]] [--no-stamp-write]
--from-mirror builds from this repo's generated mirror (claude/skills, agents/skills via
claude/skill-links.json, plus the previous build's dead-junction skills) instead of ~/.claude/skills,
so a cloud session with no live tree can still republish. --home de-tokenizes __USERHOME__ back to
the owner's path so the package matches one built on that machine.
Exit 0 on success, 1 on any skill that could not be packaged.
"""

import argparse
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("skill_stamps", Path(__file__).with_name("skill-stamps.py"))
skill_stamps = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(skill_stamps)

ALLOWED_KEYS = {"name", "description", "allowed-tools", "license", "metadata", "compatibility"}
PLUGIN_NAME = "aac-skills"
NL = chr(10)

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


def transform_skill_md(path, stamp=None):
    """Rewrite one SKILL.md's frontmatter. Returns (new_text, moved_keys, retargeted).

    `stamp` (from tools/skill-stamps.py) is merged under metadata so the packaged copy carries
    it even when the source was not written back (--no-stamp-write).

    The source's own line ending is kept: the mirror is a byte copy of the live tree, so a build
    from either produces the same package, on Windows or Linux.
    """
    raw = path.read_bytes().decode("utf-8")
    eol = "\r\n" if "\r\n" in raw else "\n"
    text = raw.replace("\r\n", "\n")
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

    if stamp:
        meta = fm.get("metadata")
        if not isinstance(meta, dict):
            meta = {} if meta in (None, "", {}) else {"original-metadata": str(meta)}
        # Stamp keys go last, after anything moved under metadata above, whichever order the
        # source held them in: a build with write-back and one without must emit the same bytes.
        for k in stamp:
            meta.pop(k, None)
        meta.update({k: str(v) for k, v in stamp.items()})
        fm["metadata"] = meta

    fm.setdefault("name", path.parent.name)
    if "description" not in fm:
        raise ValueError(f"{path}: missing description")
    # The claude.ai validator rejects descriptions containing XML tags, e.g.
    # "<ViewTransition>". Drop the angle brackets, keep the tag name.
    fm["description"] = re.sub(r"</?([A-Za-z][\w.:-]*)\s*/?>", r"\1", str(fm["description"]))

    body, retargeted = retarget_paths(body)

    new_fm = yaml.safe_dump(fm, sort_keys=False, allow_unicode=True, width=100000).strip()
    return f"---\n{new_fm}\n---\n{body}".replace("\n", eol), sorted(moved), retargeted


def stamp_source(entry, history_paths, mirror_dir, home, write):
    """Refresh the modified/previous-modified stamp of one source skill. Returns (stamp, changed)."""
    return skill_stamps.stamp_skill(entry, write=write, home=home, repo=REPO,
                                    history_paths=history_paths, mirror_dir=mirror_dir)


def source_from_mirror(repo, home, tmp):
    """Assemble what ~/.claude/skills holds on the owner's machine from the repo's generated mirror.

    Real skill dirs live in claude/skills; junctions are recorded in claude/skill-links.json and
    resolve to agents/skills. A dead junction (its target reads empty on the owner's machine, so
    the packager falls back to ~/.agents/skills) is in neither list - the previous build's skill
    set names those. Text files get the owner's home path back when --home is given.
    """
    src = Path(tmp) / "skills"
    src.mkdir()
    names = {}
    for entry in sorted((repo / "claude" / "skills").iterdir()):
        if entry.is_dir():
            names[entry.name] = entry
    links_file = repo / "claude" / "skill-links.json"
    if links_file.is_file():
        for link in json.loads(links_file.read_text(encoding="utf-8-sig")):
            names.setdefault(link["Name"], repo / "agents" / "skills" / link["Name"])
    aac = {p.name for p in (repo / "aac-skills").iterdir()} if (repo / "aac-skills").is_dir() else set()
    prev = repo / "marketplace" / PLUGIN_NAME / "skills"
    if prev.is_dir():
        for entry in sorted(prev.iterdir()):
            if entry.name in names or entry.name in aac:
                continue
            cand = repo / "agents" / "skills" / entry.name
            if (cand / "SKILL.md").is_file():
                names[entry.name] = cand
    for name, path in names.items():
        if (path / "SKILL.md").is_file():
            shutil.copytree(path, src / name, ignore=ignore_noise)
    if home:
        for f in src.rglob("*"):
            if not f.is_file():
                continue
            raw = f.read_bytes()
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                continue
            if "__USERHOME" in text:
                f.write_bytes(skill_stamps.detokenize(text, home).encode("utf-8"))
    return src


def plugin_version(now=None):
    """Version string for plugin.json: YYYY.M.DHHMM in UTC.

    Patch segment = day followed by HHMM, so several builds on one day carry distinct, increasing
    versions. Five builds on 2026-09-03 all said 2026.9.3 and a Cowork plugin update saw nothing
    new. Never zero-padded at the front (day >= 1), so it stays valid semver.

    Always UTC: cloud CI builds in UTC and a local Windows build in America/Chicago, so with local
    time a later local build produced a LOWER version than an earlier cloud one (2026-09-11: cloud
    2026.9.111802, local 2026.9.111542). One clock keeps versions monotonic across machines.
    """
    now = now.astimezone(timezone.utc) if now is not None else datetime.now(timezone.utc)
    return f"{now.year}.{now.month}.{now.day}{now:%H%M}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=str(Path.home() / ".claude" / "skills"))
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "dist"))
    ap.add_argument("--no-marketplace", action="store_true",
                    help="skip refreshing <repo>/marketplace and marketplace.json")
    ap.add_argument("--from-mirror", action="store_true",
                    help="build from this repo's generated mirror instead of --source")
    ap.add_argument("--home", default=None,
                    help="the owner's home path (C:\\Users\\Dan): de-tokenizes the mirror with "
                         "--from-mirror and is folded out of every content hash. Default: this user's home")
    ap.add_argument("--no-stamp-write", action="store_true",
                    help="stamp the packaged copies only; leave every source SKILL.md untouched")
    args = ap.parse_args()

    home = args.home if args.home is not None else str(Path.home())
    stamp_write = not args.no_stamp_write
    tmp = None
    if args.from_mirror:
        tmp = tempfile.TemporaryDirectory()
        src = source_from_mirror(REPO, args.home, tmp.name)
        if not args.home:
            print("--from-mirror without --home: packaged copies keep the __USERHOME__ tokens")
    else:
        src = Path(args.source)
    out = Path(args.out)
    plugin_root = out / PLUGIN_NAME
    if plugin_root.exists():
        shutil.rmtree(plugin_root)
    (plugin_root / ".claude-plugin").mkdir(parents=True)

    version = plugin_version()
    # write_bytes, not write_text: the payload must not depend on the building OS's newline.
    (plugin_root / ".claude-plugin" / "plugin.json").write_bytes((
        json.dumps(
            {
                "name": PLUGIN_NAME,
                "version": version,
                "author": {"name": "Dan Gatsakos"},
                "description": "AAC Skills - Dan's Claude Code skills plus the Active Alarm "
                "Company team skills from the repo's aac-skills/ tree. Built by "
                "tools/build-cloud-plugin.py from ~/.claude/skills and aac-skills/.",
            },
            indent=2,
        )
        + "\n").encode("utf-8")
    )

    fallback = Path.home() / ".agents" / "skills"
    packaged, failures, restamped = [], [], []
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
        mirror = next((REPO / t / entry.name for t in ("claude/skills", "agents/skills")
                       if (REPO / t / entry.name / "SKILL.md").is_file()), None)
        # In --from-mirror mode `entry` is a tempdir copy that vanishes at the end of the run, so
        # a stamp written back there is lost. Stamp the actual mirror (claude/skills or
        # agents/skills) instead, matching how the aac-skills loop stamps aac-skills/<name>.
        stamp_target = mirror if args.from_mirror and mirror is not None else entry
        try:
            stamp, changed = stamp_source(
                stamp_target, [f"claude/skills/{entry.name}", f"agents/skills/{entry.name}"],
                mirror, home, stamp_write)
            new_text, moved, retargeted = transform_skill_md(skill_md, stamp)
        except Exception as exc:  # noqa: BLE001 - report and keep packaging the rest
            failures.append(f"{entry.name}: {exc}")
            continue
        if changed:
            restamped.append((entry.name, stamp))
        shutil.copytree(entry, dest, ignore=ignore_noise)
        (dest / "SKILL.md").write_bytes(new_text.encode("utf-8"))
        packaged.append((entry.name, moved, retargeted))

    # Marker hook (Dan, 2026-09-03): the docs are silent on whether a plugin's hooks execute in
    # Cowork or cloud sessions. This SessionStart hook is the experiment: plain POSIX echo, no
    # runtime beyond a shell, one line of context per session. If a Cowork session can quote the
    # marker text, plugin hooks run there and the governance gate can follow the same road.
    hooks_dir = plugin_root / "hooks"
    hooks_dir.mkdir()
    # One hook, one JSON additionalContext (the shape a Cowork session quoted on 2026-09-03). The
    # runtime probe rides inside the same sentence: values computed at session start (host, UTC
    # time, interpreter paths) that no file contains, so a quoted line proves the hook RAN rather
    # than that the model read this file. No apostrophes anywhere: the shell wraps it in quotes.
    marker_text = (
        "AAC-SKILLS HOOK MARKER: plugin hooks execute on this surface. Quote this sentence "
        "verbatim if asked whether the marker is present. RUNTIME PROBE:"
        " os=$(uname -s 2>/dev/null || echo unknown)"
        " python3=$(command -v python3 || echo none)"
        " node=$(command -v node || echo none)"
        " pwsh=$(command -v pwsh || echo none)"
        " home=$HOME"
        " host=$(hostname 2>/dev/null || echo unknown)"
        " at=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
    )
    marker_json = (
        '{\\"hookSpecificOutput\\":{\\"hookEventName\\":\\"SessionStart\\",'
        '\\"additionalContext\\":\\"' + marker_text + '\\"}}'
    )
    (hooks_dir / "hooks.json").write_bytes((
        json.dumps(
            {
                "hooks": {
                    "SessionStart": [
                        {
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "sh -c 'echo \"" + marker_json + "\"'",
                                    "timeout": 5,
                                },
                            ]
                        }
                    ]
                }
            },
            indent=2,
        )
        + "\n").encode("utf-8")
    )

    zip_path = out / f"{PLUGIN_NAME}.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(plugin_root.rglob("*")):
            if f.is_file():
                zf.write(f, f.relative_to(plugin_root))

    # ---------------------------------------------------------------- AAC team skills
    # The org-published skills live in the hand-edited aac-skills/ tree in this repo, not in
    # ~/.claude/skills. They ride the same single plugin: one package, every surface, one name.
    # aac-skills/yes is a vendored copy of sstklen/yes.md's English skill (MIT, LICENSE alongside);
    # the plugin's three hooks are not carried - this package ships skills only.
    aac_src = REPO / "aac-skills"
    if aac_src.is_dir():
        for entry in sorted(aac_src.iterdir()):
            if not entry.is_dir() or not (entry / "SKILL.md").is_file():
                continue
            dest = plugin_root / "skills" / entry.name
            if dest.exists():
                failures.append(f"aac/{entry.name}: name collides with a personal skill")
                continue
            try:
                stamp, changed = stamp_source(
                    entry, [f"aac-skills/{entry.name}"], None, home, stamp_write)
                new_text, moved, retargeted = transform_skill_md(entry / "SKILL.md", stamp)
            except Exception as exc:  # noqa: BLE001
                failures.append(f"aac/{entry.name}: {exc}")
                continue
            if changed:
                restamped.append((entry.name, stamp))
            shutil.copytree(entry, dest, ignore=ignore_noise)
            (dest / "SKILL.md").write_bytes(new_text.encode("utf-8"))
            packaged.append((entry.name, moved, retargeted))

    # ------------------------------------------------------------------ repo marketplace
    # The tracked copy every surface installs from. dist/ is git-ignored scratch; this is not.
    if not args.no_marketplace:
        mkt_payload = REPO / "marketplace" / PLUGIN_NAME
        if mkt_payload.exists():
            shutil.rmtree(mkt_payload)
        shutil.copytree(plugin_root, mkt_payload)
        stale = REPO / "marketplace" / "dan-skills"
        if stale.exists():
            shutil.rmtree(stale)
        mkt_dir = REPO / ".claude-plugin"
        mkt_dir.mkdir(exist_ok=True)
        (mkt_dir / "marketplace.json").write_bytes((
            json.dumps(
                {
                    "name": "claude-dotfiles",
                    "description": "Dan Gatsakos's personal skill marketplace, generated from "
                    "the live ~/.claude/skills tree by tools/build-cloud-plugin.py.",
                    "owner": {"name": "Dan Gatsakos"},
                    "plugins": [
                        {
                            "name": PLUGIN_NAME,
                            "source": "./marketplace/" + PLUGIN_NAME,
                            "description": "AAC Skills - Dan's full skill set plus the Active "
                            "Alarm Company team skills, one package for every surface.",
                            "version": version,
                        }
                    ],
                },
                indent=2,
            )
            + NL).encode("utf-8")
        )
        print(f"marketplace payload refreshed -> {mkt_payload} + .claude-plugin/marketplace.json")

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
    print(f"stamps rotated in {len(restamped)} skills"
          + ("" if stamp_write else " (not written back: --no-stamp-write)"))
    for name, stamp in restamped:
        print(f"  {name}: rev {stamp['revision']}, modified {stamp['modified']}, "
              f"previous {stamp['previous-modified']}")
    if tmp:
        tmp.cleanup()
    if failures:
        print("FAILURES:")
        for f in failures:
            print(f"  {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
