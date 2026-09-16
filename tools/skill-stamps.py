#!/usr/bin/env python3
"""Modified / previous-modified stamps on every skill, so a silent revision is visible.

Every SKILL.md carries four keys under `metadata:` in its frontmatter:

    metadata:
      modified: "2026-09-11T14:32:05Z"          # when the skill's content last changed (UTC)
      previous-modified: "2026-09-02T19:03:20Z" # the change before that ("none" on the first stamp)
      revision: "3"                              # bumps by one per content change
      content-sha: "1f0c9a2b7e4d"                # sha256 prefix of the skill's content, stamp excluded

`content-sha` is what makes the stamp checkable rather than decorative: it hashes every file in
the skill directory (SKILL.md's own stamp keys stripped, CRLF folded to LF, the owner's home path
folded to the sync tokens so the live tree and the repo mirror hash alike). When the hash on disk
no longer matches the recorded one, the skill was edited after its last stamp. `stamp` then
rotates `modified` into `previous-modified`, sets `modified` from the newest file mtime, bumps the
revision and records the new hash. The rotation is measured from the last COMMITTED stamp, so
stamping the same skill several times before the commit (the documented stamp-then-package flow,
or a second edit) still lands one revision bump with `previous-modified` naming the published
version. `check` only reports, exit 1 on any skill that was edited without a re-stamp or never
stamped.

The packager (tools/build-cloud-plugin.py) stamps every source skill on each build, so a normal
`sync.ps1 -Mode push` keeps the stamps current with no one remembering to. This CLI exists for the
hand-edited aac-skills/ tree on a cloud branch, where no push runs, and for CI.

Usage:
    python3 tools/skill-stamps.py stamp aac-skills agents/skills   # (re)stamp what changed
    python3 tools/skill-stamps.py check aac-skills                 # exit 1 on drift, changes nothing
    python3 tools/skill-stamps.py check aac-skills --json          # machine-readable report

Each positional argument is a directory of skills (each child holding a SKILL.md) or a single
skill directory. `check` is for SOURCE trees only: the packaged copies under marketplace/ carry
the source stamps verbatim but their bodies are rewritten for the cloud, so their hashes differ.

The git history supplies the dates for a skill stamped for the first time: the last commit that
touched it becomes `modified`, the one before that `previous-modified`. A skill with uncommitted
changes, or outside any repo, takes the newest file mtime instead. Nothing here needs PyYAML at
import time except frontmatter parsing, the same dependency the packager already has.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

STAMP_KEYS = ("modified", "previous-modified", "revision", "content-sha")
NONE = "none"
IGNORED_DIRS = {".git", "node_modules", "__pycache__", ".pytest_cache"}
BACKUP_RE = re.compile(r"\.bak(-|\.|$)", re.IGNORECASE)
NOISE_FILES = {".DS_Store", "Thumbs.db"}
SHA_LEN = 12
TS_FMT = "%Y-%m-%dT%H:%M:%SZ"


def is_noise(name):
    return name in IGNORED_DIRS or name in NOISE_FILES or bool(BACKUP_RE.search(name))


# ----------------------------------------------------------------------------- home tokens
# Mirror of Get-HomeForms / ConvertTo-Tokens in lib/manifest.ps1: the same five spellings, the
# same order (JSON first, lowercase last). A hash taken on the live Windows tree must equal one
# taken on the repo mirror, and the mirror is the tokenized form.
def home_forms(home):
    trimmed = str(home).rstrip("\\/")
    if not trimmed:
        return []
    forms = [
        (trimmed.replace("\\", "\\\\"), "__USERHOME_JSON__"),
    ]
    if len(trimmed) >= 2 and trimmed[1] == ":":
        posix = "/" + trimmed[0].lower() + trimmed[2:].replace("\\", "/")
        forms.append((posix, "__USERHOME_POSIX__"))
    forms.append((trimmed.replace("\\", "/"), "__USERHOME_FWD__"))
    forms.append((trimmed, "__USERHOME__"))
    forms.append((trimmed.lower(), "__USERHOME_LC__"))
    # A form identical to an earlier one (a home with no backslash makes Raw == Fwd) must not
    # run twice, or the second pass would find nothing and the order would stop mattering.
    seen, out = set(), []
    for literal, token in forms:
        if literal and literal not in seen:
            seen.add(literal)
            out.append((literal, token))
    return out


def tokenize(text, home):
    for literal, token in home_forms(home) if home else []:
        text = text.replace(literal, token)
    return text


def detokenize(text, home):
    for literal, token in reversed(home_forms(home)) if home else []:
        text = text.replace(token, literal)
    return text


# ----------------------------------------------------------------------------- frontmatter
def split_frontmatter(text):
    """Return (frontmatter_lines, body) with text already LF-normalized, or (None, text)."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return lines[1:i], "\n".join(lines[i + 1:])
    return None, text


def read_frontmatter(text):
    fm_lines, body = split_frontmatter(text)
    if fm_lines is None:
        raise ValueError("no frontmatter")
    fm = yaml.safe_load("\n".join(fm_lines)) or {}
    if not isinstance(fm, dict):
        raise ValueError("frontmatter is not a mapping")
    return fm, fm_lines, body


def read_stamp(fm):
    meta = fm.get("metadata")
    if not isinstance(meta, dict):
        return {}
    return {k: str(meta[k]) for k in STAMP_KEYS if k in meta and meta[k] is not None}


def _yaml_str(value):
    return json.dumps(str(value), ensure_ascii=False)


def write_stamp(text, stamp):
    """Return SKILL.md text (LF) with the stamp keys set under metadata, touching nothing else.

    Textual edit first, so an author's own frontmatter formatting survives (a folded
    `description: >`, quoted names). Falls back to re-dumping the frontmatter only when the
    metadata block is not a plain indented mapping we can extend.
    """
    fm, fm_lines, body = read_frontmatter(text)
    stamp_lines = [f"{k}: {_yaml_str(stamp[k])}" for k in STAMP_KEYS]
    candidate = _textual_stamp(fm_lines, stamp_lines)
    if candidate is not None:
        new_text = "---\n" + "\n".join(candidate) + "\n---\n" + body
        try:
            check_fm, _l, _b = read_frontmatter(new_text)
            if read_stamp(check_fm) == {k: str(stamp[k]) for k in STAMP_KEYS} and _without_stamp(
                check_fm
            ) == _without_stamp(fm):
                return new_text
        except Exception:  # noqa: BLE001 - fall through to the re-dump
            pass
    meta = fm.get("metadata")
    if not isinstance(meta, dict):
        meta = {} if meta in (None, "", {}) else {"original-metadata": str(meta)}
    for k in STAMP_KEYS:
        meta[k] = str(stamp[k])
    fm["metadata"] = meta
    dumped = yaml.safe_dump(fm, sort_keys=False, allow_unicode=True, width=100000).strip()
    return "---\n" + dumped + "\n---\n" + body


def _textual_stamp(fm_lines, stamp_lines):
    lines = list(fm_lines)
    meta_idx = next((i for i, l in enumerate(lines) if re.match(r"^metadata:\s*$", l)), None)
    if meta_idx is None:
        if any(re.match(r"^metadata:", l) for l in lines):
            return None  # inline form (metadata: {...} or a scalar): let the re-dump handle it
        while lines and lines[-1].strip() == "":
            lines.pop()
        return lines + ["metadata:"] + ["  " + s for s in stamp_lines]
    # Extent of the block: every following line that is blank or indented deeper than `metadata:`.
    end = meta_idx + 1
    while end < len(lines) and (lines[end].strip() == "" or lines[end][0] in " \t"):
        end += 1
    block = lines[meta_idx + 1:end]
    indents = [len(l) - len(l.lstrip()) for l in block if l.strip()]
    if any(l.lstrip().startswith("- ") for l in block if l.strip()):
        return None  # metadata is a list, not a mapping
    indent = " " * (indents[0] if indents else 2)
    kept = [l for l in block if not re.match(r"^\s*(" + "|".join(STAMP_KEYS) + r")\s*:", l)]
    while kept and kept[-1].strip() == "":
        kept.pop()
    return lines[:meta_idx + 1] + kept + [indent + s for s in stamp_lines] + lines[end:]


def _without_stamp(fm):
    """The frontmatter as content: stamp keys gone, string values without trailing whitespace.

    A folded `description: >` that ends the frontmatter parses without a final newline; the same
    block followed by `metadata:` parses with one. That is formatting, not a change to the skill.
    """
    fm = json.loads(json.dumps(fm, default=str))
    meta = fm.get("metadata")
    if isinstance(meta, dict):
        for k in STAMP_KEYS:
            meta.pop(k, None)
        if not meta:
            fm.pop("metadata")
    return _rstrip_strings(fm)


def _rstrip_strings(value):
    if isinstance(value, str):
        return value.rstrip()
    if isinstance(value, dict):
        return {k: _rstrip_strings(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_rstrip_strings(v) for v in value]
    return value


# ----------------------------------------------------------------------------- hashing
def iter_files(skill_dir):
    skill_dir = Path(skill_dir)
    out = []
    for root, dirs, files in os.walk(skill_dir):
        dirs[:] = sorted(d for d in dirs if not is_noise(d))
        for name in sorted(files):
            if not is_noise(name):
                out.append(Path(root) / name)
    return sorted(out, key=lambda p: p.relative_to(skill_dir).as_posix())


def content_sha(skill_dir, home=None):
    """Hash of the skill's content with the stamp itself, line endings and home path factored out."""
    skill_dir = Path(skill_dir)
    h = hashlib.sha256()
    for f in iter_files(skill_dir):
        rel = f.relative_to(skill_dir).as_posix()
        raw = f.read_bytes()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            h.update(f"{rel}\0bin\0".encode()); h.update(raw); h.update(b"\0")
            continue
        text = tokenize(text.replace("\r\n", "\n"), home)
        if rel == "SKILL.md":
            try:
                fm, _l, body = read_frontmatter(text)
                text = json.dumps(_without_stamp(fm), sort_keys=True, ensure_ascii=False) + "\n---\n" + body
            except Exception:  # noqa: BLE001 - unparseable frontmatter hashes as plain text
                pass
        h.update(f"{rel}\0txt\0".encode()); h.update(text.encode("utf-8")); h.update(b"\0")
    return h.hexdigest()[:SHA_LEN]


# ----------------------------------------------------------------------------- dates
def _utc(dt):
    return dt.astimezone(timezone.utc).strftime(TS_FMT)


def newest_mtime(skill_dir):
    files = iter_files(skill_dir)
    if not files:
        return None
    return _utc(datetime.fromtimestamp(max(f.stat().st_mtime for f in files), tz=timezone.utc))


def _git(repo, *args):
    env = {k: v for k, v in os.environ.items()
           if k not in {"GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"}}
    try:
        res = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True,
                             env=env, check=False)
    except OSError:
        return None
    return res.stdout if res.returncode == 0 else None


_shallow_warned = set()


def git_dates(repo, rel_paths, count=2):
    """Last `count` distinct commit dates (UTC strings, newest first) touching any of rel_paths."""
    if not repo or not rel_paths:
        return []
    # A shallow clone (cloud containers, CI without fetch-depth: 0) reports its oldest visible
    # commit as the first change to everything. Those dates are wrong, and they are committed.
    if str(repo) not in _shallow_warned:
        _shallow_warned.add(str(repo))
        if (_git(repo, "rev-parse", "--is-shallow-repository") or "").strip() == "true":
            print(f"WARNING: {repo} is a shallow clone; first-stamp dates would be truncated. "
                  "Run `git fetch --unshallow` first.", file=sys.stderr)
    out = _git(repo, "log", f"-{count * 4}", "--format=%cI", "--", *rel_paths)
    if not out:
        return []
    dates = []
    for line in out.split():
        try:
            stamp = _utc(datetime.fromisoformat(line))
        except ValueError:
            continue
        if stamp not in dates:
            dates.append(stamp)
    return dates[:count]


def git_dirty(repo, rel_paths):
    out = _git(repo, "status", "--porcelain", "--", *rel_paths)
    return out is None or out.strip() != ""


def _baseline_paths(skill_dir, repo, history_paths):
    """Where to look for the committed copy: this very directory first, then the callers' paths.

    The packager stamps the live `~/.claude/skills/<name>` (outside the repo), and names its
    mirror in `history_paths`; the CLI stamps a directory that is itself in the repo.
    """
    own = [Path(skill_dir).resolve().relative_to(Path(repo).resolve()).as_posix()] if (
        repo and _inside(skill_dir, repo)) else []
    return own + [p for p in (history_paths or []) if p not in own]


def published_stamp(repo, rel_paths):
    """The stamp in the last committed SKILL.md for this skill, or {} when there is none.

    HEAD is the published version, so a rotation is rebased on it: every re-stamp between two
    commits collapses into one revision bump and `previous-modified` keeps naming the version
    that was last published rather than an intermediate stamp minutes old (issue 363).
    """
    if not repo:
        return {}
    for rel in rel_paths or []:
        out = _git(repo, "show", f"HEAD:{str(rel).replace(os.sep, '/')}/SKILL.md")
        if out is None:
            continue
        try:
            fm, _l, _b = read_frontmatter(out.replace("\r\n", "\n"))
        except Exception:  # noqa: BLE001 - an unparseable committed copy is simply no baseline
            continue
        stamp = read_stamp(fm)
        if all(k in stamp for k in STAMP_KEYS):
            return stamp
    return {}


# ----------------------------------------------------------------------------- stamping
def compute_stamp(skill_dir, *, home=None, repo=None, history_paths=None, mirror_dir=None, now=None):
    """Return (stamp_dict, changed). `changed` is False when the recorded hash still matches."""
    skill_dir = Path(skill_dir)
    text = (skill_dir / "SKILL.md").read_bytes().decode("utf-8").replace("\r\n", "\n")
    fm, _l, _b = read_frontmatter(text)
    old = read_stamp(fm)
    sha = content_sha(skill_dir, home)
    if old.get("content-sha") == sha and all(k in old for k in STAMP_KEYS):
        return old, False
    now = now or newest_mtime(skill_dir) or _utc(datetime.now(timezone.utc))
    if old.get("content-sha"):
        # Rotate away from the last COMMITTED stamp, not from whatever the working tree holds:
        # the documented stamp-then-package flow (and any second edit before the commit) stamps
        # the same file twice, and rotating twice leaves `previous-modified` naming a stamp
        # seconds old instead of the published version (issue 363).
        base = published_stamp(repo, _baseline_paths(skill_dir, repo, history_paths))
        if base.get("content-sha") == sha:
            return base, base != old  # content is back at the published version: its stamp holds
        src = base or old
        modified, previous = now, src.get("modified", NONE)
        revision = _next_revision(src.get("revision"))
    else:
        # First stamp: let the git history say when it really changed, unless the tree has moved
        # on since the last commit (or the mirror no longer matches the live copy).
        dates = git_dates(repo, history_paths) if repo and history_paths else []
        committed = dates and not git_dirty(repo, history_paths) and (
            mirror_dir is None or not Path(mirror_dir).is_dir()
            or content_sha(mirror_dir, home) == sha)
        if committed:
            modified = dates[0]
            previous = dates[1] if len(dates) > 1 else NONE
        else:
            modified = now
            previous = dates[0] if dates else NONE
        revision = "1"
    return {"modified": modified, "previous-modified": previous,
            "revision": revision, "content-sha": sha}, True


def _next_revision(value):
    try:
        return str(int(str(value)) + 1)
    except (TypeError, ValueError):
        return "1"


def stamp_skill(skill_dir, *, write=True, **kw):
    """Stamp one skill in place. Returns (stamp, changed). With write=False nothing is written."""
    skill_dir = Path(skill_dir)
    stamp, changed = compute_stamp(skill_dir, **kw)
    if changed and write:
        path = skill_dir / "SKILL.md"
        raw = path.read_bytes().decode("utf-8")
        eol = "\r\n" if "\r\n" in raw else "\n"
        new_text = write_stamp(raw.replace("\r\n", "\n"), stamp)
        path.write_bytes(new_text.replace("\n", eol).encode("utf-8"))
    return stamp, changed


def check_skill(skill_dir, home=None):
    """Return (state, stamp): state is 'ok', 'changed' or 'unstamped'."""
    skill_dir = Path(skill_dir)
    text = (skill_dir / "SKILL.md").read_bytes().decode("utf-8").replace("\r\n", "\n")
    fm, _l, _b = read_frontmatter(text)
    old = read_stamp(fm)
    if not old.get("content-sha"):
        return "unstamped", old
    if old["content-sha"] != content_sha(skill_dir, home):
        return "changed", old
    return "ok", old


# ----------------------------------------------------------------------------- CLI
def skill_dirs(paths):
    for p in paths:
        p = Path(p)
        if (p / "SKILL.md").is_file():
            yield p
            continue
        if not p.is_dir():
            print(f"not a directory: {p}", file=sys.stderr)
            continue
        for child in sorted(p.iterdir()):
            if child.is_dir() and not is_noise(child.name) and (child / "SKILL.md").is_file():
                yield child


def find_repo(start):
    out = _git(start, "rev-parse", "--show-toplevel")
    return Path(out.strip()) if out else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("mode", choices=["stamp", "check"])
    ap.add_argument("paths", nargs="+", help="skill directories, or directories of skills")
    ap.add_argument("--home", default=None,
                    help="owner's home path to fold into sync tokens before hashing "
                         "(default: this user's home)")
    ap.add_argument("--json", action="store_true", help="machine-readable report")
    args = ap.parse_args(argv)
    home = args.home if args.home is not None else str(Path.home())

    report, bad = [], 0
    for d in skill_dirs(args.paths):
        repo = find_repo(d)
        rel = [str(d.resolve().relative_to(repo))] if repo and _inside(d, repo) else None
        try:
            if args.mode == "stamp":
                stamp, changed = stamp_skill(d, home=home, repo=repo, history_paths=rel)
                state = "stamped" if changed else "ok"
            else:
                state, stamp = check_skill(d, home)
                if state != "ok":
                    bad += 1
        except Exception as exc:  # noqa: BLE001 - one bad skill must not hide the rest
            state, stamp = "error", {"error": str(exc)}
            bad += 1
        report.append({"skill": d.name, "path": str(d), "state": state, **stamp})

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        for r in report:
            line = f"{r['state']:<9} {r['skill']:<32}"
            if "revision" in r:
                line += f" rev {r['revision']:>3}  modified {r['modified']}  previous {r['previous-modified']}"
            if "error" in r:
                line += f" {r['error']}"
            print(line)
        if args.mode == "check" and bad:
            print(f"\n{bad} skill(s) edited without a re-stamp or never stamped. Run:"
                  f"\n  python3 tools/skill-stamps.py stamp {' '.join(args.paths)}"
                  f"\nA skill edited on a branch needs every tree that carries it stamped and the"
                  f" plugin rebuilt - see CLAUDE.md, \"Skill stamps\".", file=sys.stderr)
    return 1 if bad else 0


def _inside(path, repo):
    try:
        Path(path).resolve().relative_to(Path(repo).resolve())
        return True
    except ValueError:
        return False


if __name__ == "__main__":
    sys.exit(main())
