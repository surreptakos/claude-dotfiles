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

The payload also carries the global rules text (issue 209): the `### Four standing disciplines`
section of the owner's CLAUDE.md, copied -- never hand-duplicated -- to rules/global-rules.md and
injected on every prompt by hooks/scripts/global-rules.js, one manifest entry per part because the
host's additionalContext cap is per hook output. See docs/tickets/209-decision.md.

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


# Global rules text (issue 209). The four standing disciplines a PC session reads in
# ~/.claude/CLAUDE.md never reach a container, which has no live tree. The packager COPIES that
# section into the payload -- one source, no hand duplicate -- and hooks/scripts/global-rules.js
# injects it on every prompt. The heading is the contract between the two files; a build whose
# source no longer carries it fails loudly rather than shipping an empty rules file.
RULES_HEADING = "### Four standing disciplines"
# Body bytes per part. Measured cap (2026-09-16, cloud container, headless probe): a hook's
# additionalContext arrives whole at 10,000 bytes and is persisted with a 2KB preview at 10,240.
# The cap is per hook output, so the file rides as one hook entry per part. Must stay in step with
# PART_BYTES in tools/plugin-hook-guards/global-rules.js.
RULES_PART_BYTES = 6000
# JavaScript's split(/(?<=\n)/): lines keep their newline, nothing else counts as a break.
# str.splitlines() would also break on \x0b, \x0c and  , which would desync the two splitters.
LINE_RE = re.compile(r"[^\n]*\n|[^\n]+")


def extract_global_rules(text):
    """The `### Four standing disciplines` section of a global CLAUDE.md, verbatim.

    Ends at the next heading of the same or a higher level. Returns None when the heading is
    absent, which is how a fixture repo with no CLAUDE.md mirror produces no rules file.
    """
    lines = LINE_RE.findall(text.replace("\r\n", "\n"))
    start = next((i for i, l in enumerate(lines) if l.startswith(RULES_HEADING)), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines))
                if lines[i].startswith("### ") or lines[i].startswith("## ")), len(lines))
    return "".join(lines[start:end]).rstrip() + "\n"


def split_rules_parts(text, limit=RULES_PART_BYTES):
    """Greedy line packing -- the same rule global-rules.js applies when it emits part k."""
    parts, cur = [], ""
    for line in LINE_RE.findall(text):
        if cur and len((cur + line).encode("utf-8")) > limit:
            parts.append(cur)
            cur = line
        else:
            cur += line
    if cur:
        parts.append(cur)
    return parts


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
    aac_names = {p.name for p in (REPO / "aac-skills").iterdir()
                 if (p / "SKILL.md").is_file()} if (REPO / "aac-skills").is_dir() else set()
    packaged, failures, restamped, superseded = [], [], [], []
    for entry in sorted(src.iterdir()):
        if not entry.is_dir():
            continue  # stray files like PROVENANCE-design-skills.md
        if entry.name in aac_names:
            # Migration window (issue 172): a skill's hand-edited source has moved to aac-skills/
            # while the owner's personal copy is still in ~/.claude/skills, and so in the claude/
            # mirror -- which is generated and which no branch may hand-edit. The team tree wins:
            # it is the copy this repo can actually revise, so it is the one that ships, and the
            # aac-skills loop below packages it. This used to be a hard failure ("name collides
            # with a personal skill"), which made the move impossible to land in one commit: the
            # branch could not delete the mirror and could not keep it either. The window closes
            # when the owner deletes ~/.claude/skills/<name> and runs sync.ps1 -Mode push.
            superseded.append(entry.name)
            continue
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
    # Governance hooks (issue 208): the eight hook entries a PC session runs today ship inside the
    # plugin payload, so a container that installs the plugin is gated the same way. Scripts are
    # copied from the repo mirror (claude/hooks/, codex/hooks/) into hooks/scripts/ and each hook
    # command names its script through ${CLAUDE_PLUGIN_ROOT}, never through a home path. Every
    # script runs on `node` or `python3` (Linux/cloud container) with a `commandWindows` counterpart
    # that uses `py -3`; nothing here requires pwsh, and no pwsh-only invocation is emitted -- a
    # branch that wanted one would print a reason and skip. The caveman hook is delivered by the
    # separate caveman@caveman plugin (already declared in the mirror's settings.json under
    # enabledPlugins) and its statusLine is not re-vendored here. session-gate.js needs to find the
    # session-check engine, which ships in this same payload under skills/session-check/; a small
    # substitution in the copied script rewires its default CHECK path to the plugin root when
    # CLAUDE_PLUGIN_ROOT is set, so no environment plumbing is needed in the manifest.
    scripts_dir = hooks_dir / "scripts"
    scripts_dir.mkdir()
    GOV_JS = ("governance-reminder.js", "session-gate.js",
              "state-rehydrate.js", "state-stash.js")
    GOV_PY = ("ask_matt_gate.py",)
    # If any source is missing (e.g. a fake-repo test fixture with no hooks mirror), emit only the
    # marker hook, matching the pre-issue-208 behaviour. Every-or-nothing avoids a half-populated
    # manifest that names a script the payload does not carry.
    gov_sources_present = (
        all((REPO / "claude" / "hooks" / n).is_file() for n in GOV_JS)
        and all((REPO / "codex" / "hooks" / n).is_file() for n in GOV_PY))
    # Ship the plugin/live-tree dedup guard (issue 208 criterion 4) alongside the governance
    # scripts. Sources live under tools/plugin-hook-guards/ so they are trackable and not
    # mistaken for generated mirror content; the packager copies them in and prepends a one-line
    # invocation to each governance script during copy. See tools/plugin-hook-guards/README.
    guard_src_dir = REPO / "tools" / "plugin-hook-guards"
    guard_js_name = "_plugin_hook_guard.js"
    guard_py_name = "_plugin_hook_guard.py"
    guard_js_src = guard_src_dir / guard_js_name
    guard_py_src = guard_src_dir / guard_py_name

    # Global rules text (issue 209). ONE source: the owner's global CLAUDE.md. A live build reads
    # it next to --source (~/.claude/skills -> ~/.claude/CLAUDE.md); a --from-mirror build (cloud,
    # CI) reads this repo's generated mirror claude/CLAUDE.md, de-tokenized with --home so both
    # routes emit the same bytes. Nothing here is hand-written into the payload.
    rules_src = None
    if not args.from_mirror:
        live_md = Path(args.source).resolve().parent / "CLAUDE.md"
        if live_md.is_file():
            rules_src = live_md
    if rules_src is None and (REPO / "claude" / "CLAUDE.md").is_file():
        rules_src = REPO / "claude" / "CLAUDE.md"
    rules_text = None
    if rules_src is not None:
        raw = rules_src.read_text(encoding="utf-8")
        if "__USERHOME" in raw and home:
            raw = skill_stamps.detokenize(raw, home)
        rules_text = extract_global_rules(raw)
        if rules_text is None:
            raise RuntimeError(
                f"{rules_src} carries no '{RULES_HEADING}' heading; the plugin can no longer copy "
                "the global rules text (issue 209). Update RULES_HEADING in build-cloud-plugin.py "
                "if the section was renamed.")
    rules_parts = split_rules_parts(rules_text) if rules_text else []
    if rules_text:
        (plugin_root / "rules").mkdir()
        (plugin_root / "rules" / "global-rules.md").write_bytes(rules_text.encode("utf-8"))
        # Payload-only hook script: there is no live-tree twin to dedup against, so it carries its
        # own no-doubling guard (it stays silent where a global CLAUDE.md already has the text).
        (scripts_dir / "global-rules.js").write_bytes(
            (guard_src_dir / "global-rules.js").read_text(encoding="utf-8")
            .replace("\r\n", "\n").encode("utf-8"))
    if gov_sources_present:
        if not guard_js_src.is_file() or not guard_py_src.is_file():
            raise RuntimeError(
                "plugin hook guard sources missing under tools/plugin-hook-guards/; "
                "issue 208 dedup requires _plugin_hook_guard.js and _plugin_hook_guard.py there.")
        (scripts_dir / guard_js_name).write_bytes(
            guard_js_src.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8"))
        (scripts_dir / guard_py_name).write_bytes(
            guard_py_src.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8"))

    js_guard_call = (
        "// issue 208: plugin/live-tree dedup -- see _plugin_hook_guard.js.\n"
        "try { require('./_plugin_hook_guard.js').skipIfLiveTreeWillFire(); } catch (_) {}\n")
    py_guard_call = (
        "# issue 208: plugin/live-tree dedup -- see _plugin_hook_guard.py.\n"
        "try:\n"
        "    import sys as _pp_sys\n"
        "    from pathlib import Path as _pp_Path\n"
        "    _pp_sys.path.insert(0, str(_pp_Path(__file__).resolve().parent))\n"
        "    from _plugin_hook_guard import skip_if_live_tree_will_fire as _pp_dedup\n"
        "    _pp_dedup(_pp_Path(__file__).resolve())\n"
        "except Exception:\n"
        "    pass\n")

    def _insert_after_shebang_js(text, block):
        # Keep the shebang on line 1 (the OS interpreter dispatch depends on it) and insert the
        # guard right after. Node accepts a bare statement block anywhere at the top.
        if text.startswith("#!"):
            newline = text.find("\n")
            if newline < 0:
                return text + "\n" + block
            return text[: newline + 1] + block + text[newline + 1 :]
        return block + text

    def _insert_after_python_prelude(text, block):
        # Python is strict: `from __future__` imports must come before every non-comment,
        # non-string statement. The insertion has to land AFTER the shebang, an optional module
        # docstring, and every `from __future__` line, so a guard we splice in above them does
        # not turn the docstring into an expression that pushes __future__ into a syntax error.
        import ast, tokenize, io
        try:
            tree = ast.parse(text)
        except SyntaxError:
            # Cannot analyse: fall back to shebang-only insertion (may not be safe, but the
            # packager catches broken payloads at load time so a bad script will show up loud).
            return _insert_after_shebang_js(text, block)
        # Find the line after the last __future__ import, or after the docstring, or after the
        # shebang, in that priority.
        last_prelude_end = 0
        for node in tree.body:
            if isinstance(node, ast.ImportFrom) and node.module == "__future__":
                last_prelude_end = max(last_prelude_end, node.end_lineno)
                continue
            if (last_prelude_end == 0 and isinstance(node, ast.Expr)
                    and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)):
                # Module docstring only counts as prelude when it is the very first statement.
                last_prelude_end = max(last_prelude_end, node.end_lineno)
                continue
            break
        lines = text.splitlines(keepends=True)
        insert_at = last_prelude_end  # 1-based line number of the last prelude line
        if insert_at == 0 and text.startswith("#!"):
            insert_at = 1
        # Splice `block` between line `insert_at` and the next. Add a leading blank if the
        # following line is not already blank, for readability.
        prefix = "".join(lines[:insert_at])
        suffix = "".join(lines[insert_at:])
        sep = "" if prefix.endswith("\n\n") or suffix.startswith("\n") else "\n"
        return prefix + sep + block + suffix

    for name in GOV_JS:
        src_file = REPO / "claude" / "hooks" / name
        if not gov_sources_present:
            break
        text = src_file.read_text(encoding="utf-8")
        if name == "session-gate.js":
            # Point the default CHECK path at the plugin's own session-check when the hook is
            # running under a plugin (CLAUDE_PLUGIN_ROOT is set by Claude Code for plugin hooks).
            marker_line = ("const CHECK = process.env.SESSION_GATE_CHECK\n"
                           "  || path.join(CONFIG_DIR, 'skills', 'session-check', 'check.js');")
            plugin_line = (
                "const CHECK = process.env.SESSION_GATE_CHECK\n"
                "  || (process.env.CLAUDE_PLUGIN_ROOT\n"
                "      && path.join(process.env.CLAUDE_PLUGIN_ROOT, 'skills', 'session-check', 'check.js'))\n"
                "  || path.join(CONFIG_DIR, 'skills', 'session-check', 'check.js');")
            if marker_line not in text:
                raise RuntimeError(
                    "session-gate.js CHECK default block has drifted; the plugin packager can no "
                    "longer rewire it to CLAUDE_PLUGIN_ROOT. Update the marker in build-cloud-plugin.py.")
            text = text.replace(marker_line, plugin_line)
        text = _insert_after_shebang_js(text.replace("\r\n", "\n"), js_guard_call)
        # write_bytes with a fixed newline: the payload must not depend on the building OS's newline.
        (scripts_dir / name).write_bytes(text.encode("utf-8"))
    for name in GOV_PY:
        src_file = REPO / "codex" / "hooks" / name
        if not gov_sources_present:
            break
        text = src_file.read_text(encoding="utf-8").replace("\r\n", "\n")
        text = _insert_after_python_prelude(text, py_guard_call)
        (scripts_dir / name).write_bytes(text.encode("utf-8"))

    def _cmd(runner_unix, runner_win, script_name, argv):
        """Two spellings of the same command: Linux (command) and Windows (commandWindows)."""
        argv_str = (" " + " ".join(argv)) if argv else ""
        base = "\"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/" + script_name + "\""
        return (runner_unix + " " + base + argv_str,
                runner_win + " " + base + argv_str)

    def _hook(runner_unix, runner_win, script, argv, timeout, status, extra=None):
        cmd_unix, cmd_win = _cmd(runner_unix, runner_win, script, argv)
        entry = {
            "type": "command",
            "command": cmd_unix,
            "commandWindows": cmd_win,
            "timeout": timeout,
            "statusMessage": status,
        }
        if extra:
            entry.update(extra)
        return entry

    marker_hook = {
        "type": "command",
        "command": "sh -c 'echo \"" + marker_json + "\"'",
        "timeout": 5,
    }

    if not gov_sources_present:
        # Pre-issue-208 shape: marker only. Emitted so a fake-repo test fixture without a hooks
        # mirror still produces a valid manifest; a real build always populates the mirror.
        governance_hooks = {"SessionStart": [{"hooks": [marker_hook]}]}
    else:
     governance_hooks = {
        "SessionStart": [
            {"hooks": [
                _hook("node", "node", "session-gate.js", ["start"], 200,
                      "Running session-start checks..."),
                _hook("node", "node", "state-rehydrate.js", [], 15,
                      "Rehydrating stashed state..."),
            ]},
            {"hooks": [marker_hook]},
        ],
        "PreCompact": [
            {"hooks": [
                _hook("node", "node", "state-stash.js", [], 30,
                      "Stashing durable state before compaction..."),
            ]},
        ],
        "SessionEnd": [
            {"hooks": [
                _hook("node", "node", "session-gate.js", ["end"], 200,
                      "Recording session-end checks..."),
                _hook("node", "node", "state-stash.js", [], 120,
                      "Stashing durable state at session end..."),
            ]},
        ],
        "UserPromptSubmit": [
            {"hooks": [
                _hook("node", "node", "governance-reminder.js", [], 5,
                      "Asserting governance..."),
                _hook("python3", "py -3", "ask_matt_gate.py", ["claude-prompt"], 5,
                      "Locking Ask Matt, Yes, and caveman ultra..."),
                _hook("node", "node", "session-gate.js", ["prompt"], 200,
                      "Checking session gate..."),
            ]},
        ],
        "PreToolUse": [
            {"hooks": [
                _hook("python3", "py -3", "ask_matt_gate.py", ["claude-pre-tool"], 5,
                      "Checking governance gate..."),
            ]},
        ],
        "PostToolUse": [
            {"matcher": "Bash|PowerShell", "hooks": [
                _hook("python3", "py -3", "ask_matt_gate.py", ["claude-post-tool"], 5,
                      "Counting failures for the YES escalation ladder..."),
            ]},
        ],
        "Stop": [
            {"hooks": [
                _hook("python3", "py -3", "ask_matt_gate.py", ["claude-stop"], 5,
                      "Verifying governance gate..."),
            ]},
        ],
    }

    # One UserPromptSubmit entry per part of the rules text (issue 209). Separate entries, not one
    # big one: the measured cap is per hook output, so N parts under it deliver the file in full
    # every prompt. Independent of gov_sources_present -- the rules ride even where the governance
    # scripts have no mirror to be copied from.
    if rules_parts:
        governance_hooks.setdefault("UserPromptSubmit", []).append({"hooks": [
            _hook("node", "node", "global-rules.js", [str(i)], 10,
                  f"Delivering global rules ({i}/{len(rules_parts)})...")
            for i in range(1, len(rules_parts) + 1)
        ]})

    (hooks_dir / "hooks.json").write_bytes((
        json.dumps({"hooks": governance_hooks}, indent=2) + "\n").encode("utf-8")
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
    if superseded:
        print("personal copy superseded by the aac-skills/ source (delete ~/.claude/skills/<name> "
              "and push to close the window): " + ", ".join(superseded))
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
