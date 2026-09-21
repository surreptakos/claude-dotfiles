#!/usr/bin/env python3
"""Package every skill in this repo into one uploadable plugin.

Reads aac-skills/, the repo's one hand-edited skill tree (issue 214: the generated
claude/skills and aac-skills mirrors retired, and every skill they carried moved
here, so a branch is the only way a skill changes and merge is the release), rewrites
each SKILL.md so its frontmatter carries only the six keys the claude.ai upload
validator accepts (name, description, allowed-tools, license, metadata,
compatibility), and emits dist/dan-skills/ plus dist/dan-skills.zip ready for
claude.ai -> Customize -> Plugins -> Add -> Upload plugin.

Disallowed keys (disable-model-invocation, argument-hint, hidden, ...) are not
dropped: they move under metadata as strings, the same shape writing-dan used to
pass the validator on 2026-08-27. Claude Code ignores unknown metadata, so the
plugin still loads locally via --plugin-dir for testing -- and so a source gated
with disable-model-invocation is NOT gated in the payload. The payload's own gate
is to leave the skill out: see DEAD_LOAD_DROPPED / DEAD_LOAD_KEPT (issue 530),
which carry a per-skill decision for the skills nobody invokes.

Also emits the same payload unzipped into <repo>/marketplace/dan-skills/ and writes
<repo>/.claude-plugin/marketplace.json, which makes the repo itself an installable Claude
plugin marketplace (claude plugin marketplace add surreptakos/claude-dotfiles). The zip
remains for the claude.ai org-Skills surface, which only takes uploads.

The payload also carries the global rules text (issue 209): the `### Four standing disciplines`
section of the owner's CLAUDE.md, copied -- never hand-duplicated -- to rules/global-rules.md and
injected by hooks/scripts/global-rules.js: in full at SessionStart, one manifest entry per part
because the host's additionalContext cap is per hook output, and as a generated digest
(rules/global-rules-digest.md, under 1,500 bytes) on every prompt. See docs/tickets/209-decision.md
and docs/tickets/533-decision.md.

Every source skill is stamped before it is packaged (tools/skill-stamps.py): four keys under
`metadata:` - modified, previous-modified, revision, content-sha - rotate whenever the skill's
content hash no longer matches the recorded one, and are written back into the SOURCE SKILL.md
(the live tree, or aac-skills/) so the mirror, the package and the file an agent edits all say
the same thing. --no-stamp-write computes them for the package only.

Usage:  python3 tools/build-cloud-plugin.py [--source DIR] [--out DIR] [--no-marketplace]
                                            [--home C:\\Users\\Dan] [--no-stamp-write]
--source defaults to aac-skills/ in this checkout, so the build needs no live ~/.claude tree and
runs the same on the desktop, in a container and in CI. --home names the home the tree is spelled
against and is folded out of every content hash; it defaults to the owner's home (skill-stamps.py
OWNER_HOME), the same default the stamper uses, never the running user's (492).
Exit 0 on success, 1 on any skill that could not be packaged.
"""

import argparse
import importlib.util
import json
import re
import shutil
import sys
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
MANIFEST_REL = ".claude-plugin/plugin.json"
# Stands in until the payload is assembled and resolve_version() can read it (issue 432).
PLACEHOLDER_VERSION = "0.0.0"
# What the rotation report prints as the "from" revision of a skill that had none.
NONE_REVISION = "none"
NL = chr(10)

# ------------------------------------------------------------- dead-load decisions (issue 530)
# A skill in the payload costs its description on EVERY turn of every session that installs the
# plugin, invoked or not. caveman learn (30-day window, 3594 sessions, 2026-09-16) found no
# invocation of the nine skills named below - about 536 tokens a turn under the sink
# `dead_load:skills`. The live copies under ~/.claude/skills were gated with
# `disable-model-invocation: true` the same day and a desktop session honours that; the payload
# cannot, because transform_skill_md moves the key under `metadata` to pass the claude.ai upload
# validator, so every plugin consumer went on loading all nine descriptions. The only gate the
# payload can enforce is not shipping the skill at all.
#
# So the decision is per skill and it lives HERE, in the code that acts on it - a decision
# recorded only in a ticket is one no rebuild can honour. A name in DEAD_LOAD_DROPPED is left out
# of the payload, in either source tree, zip and marketplace alike, and its reason says why
# nothing needs it there; a name in DEAD_LOAD_KEPT ships despite the reading, and its reason is
# what buys the description back. Re-deciding one is a move between the two tables plus a rebuild;
# the skill itself stays where it is, so nothing is lost by dropping it from the payload.
DEAD_LOAD_DROPPED = {
    "accessibility-review": "WCAG audit prompt, no files but its own; no payload skill, hook or "
                            "test references it and the live copy is gated.",
    "canvas-design": "poster/art prompt carrying 5.6 MB of bundled fonts - the single largest "
                     "thing in the payload, for a skill nothing invoked.",
    "design-critique": "design-feedback prompt, no files but its own; nothing in the payload "
                       "calls it.",
    "design-handoff": "handoff-spec prompt, no files but its own; nothing in the payload calls "
                      "it.",
    "design-system": "design-system audit prompt, no files but its own; the only payload matches "
                     "for the name are prose in vercel-react-native-skills and a keyword row in "
                     "find-skills, neither an invocation.",
    "research-synthesis": "research-synthesis prompt, no files but its own; nothing in the "
                          "payload calls it.",
    "user-research": "research-planning prompt, no files but its own; nothing in the payload "
                     "calls it.",
    "ux-copy": "microcopy prompt, no files but its own; nothing in the payload calls it.",
    # Never shipped: neither had a junction into ~/.claude/skills while the mirrors existed, so no
    # build ever carried them. Kept as sources (issue 214 moved them in with the rest of
    # ~/.agents/skills); to-spec and to-tickets are the pair the flows actually name.
    "to-issues": "superseded by to-tickets; no payload skill, hook or test references it.",
    "to-prd": "superseded by to-spec; no payload skill, hook or test references it.",
}
DEAD_LOAD_KEPT = {
    "claude-md-lint": "the skill dir carries claude-md-lint.js, and the packaged copy is how a "
                      "cloud session in ANOTHER repo runs the linter - tools/claude-md-lint.js "
                      "only reaches this one. Dropping it would take the tool off every other "
                      "checkout, which no token saving is worth.",
}

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
    """The owner's global CLAUDE.md, verbatim and whole.

    It used to be the `### Four standing disciplines` section alone, and the rest of the file --
    the standing response-prefix directive, the environment-claims rules, memory governance, the
    Google access pointer, browser automation -- never reached a container. A cloud session was
    therefore running a different rulebook from a desktop one, which is the parity this payload
    exists to give. The heading is still the contract: a source that lost it has been restructured
    far enough that the digest marks cannot be trusted either, so the build fails loudly rather
    than shipping rules nothing checked.

    Returns None when the heading is absent, which is how a fixture repo with no CLAUDE.md mirror
    produces no rules file.
    """
    body = text.replace("\r\n", "\n")
    if not any(l.startswith(RULES_HEADING) for l in LINE_RE.findall(body)):
        return None
    return body.rstrip() + "\n"


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


# Per-prompt digest (issue 533). The full text rides SessionStart; what every prompt carries is
# this digest -- about 1.2 KB instead of about 12 KB. It is GENERATED, never hand-kept: each entry
# below names a mark the source section already carries (a bold run-in label, a numbered rule, the
# ask-matt paragraph's opening) and the digest is the verbatim span that mark opens. Nothing is
# added to the source to make this work -- profile/claude/CLAUDE.md is the owner's global rules,
# edited for their own sake -- so the marks are the ones the prose already has. A
# source that loses a mark fails the build loudly, the way RULES_HEADING does.
DIGEST_CAP_BYTES = 1500
DIGEST_FILENAME = "global-rules-digest.md"
# The reminder hook dedupes its own pointer against this phrase (issue 533 criterion 3).
DIGEST_POINTER_MARKER = "already in this context"
# global-rules.js substitutes the resolved absolute path for this token when it emits the digest,
# so the one pointer a prompt carries names a file the model can actually open.
DIGEST_RULES_TOKEN = "__RULES_FILE__"
DIGEST_HEADER = (
    "GLOBAL RULES DIGEST — the four standing disciplines in brief. Full text "
    + DIGEST_POINTER_MARKER
    + ": delivered whole at session start as GLOBAL RULES, from "
    + DIGEST_RULES_TOKEN
    + "; re-read it there rather than guessing."
)
# (label, marks). Each mark is matched as a line prefix and must occur exactly once.
DIGEST_SECTIONS = [
    # caveman level + the never-drop list
    ("CAVEMAN", ["- **Ultra:**", "- **Never drop:**"]),
    # the yes-skill trigger sentence + the evidence rule that carries the banned hedges
    ("YES", ["Deliver correct, safe, *verified* results", "1. **Evidence over intuition.**"]),
    # the ask-matt gate sentence
    ("ASK-MATT", ["`/ask-matt` is user-invocable only"]),
    # the ADHD reply shape: open, close, and the no-preamble rule
    ("I-HAVE-ADHD", ["1. **Lead with the next action.**",
                     "3. **End with ONE concrete next action**",
                     "10. **No preamble, no recap, no closing pleasantries.**"]),
]
# A line that opens a new block (heading or list item) at column 0 ends the span before it; so
# does a blank line. Indented lines are the source's own wrapping and fold into the span.
DIGEST_BLOCK_RE = re.compile(r"(?:#{1,6} |[-*+] |\d+\. )")
DIGEST_LEAD_RE = re.compile(r"^(?:[-*+] |\d+\. )")


def _digest_span(lines, mark):
    """The verbatim span the given mark opens, unwrapped to one line."""
    hits = [i for i, l in enumerate(lines) if l.startswith(mark)]
    if len(hits) != 1:
        raise RuntimeError(
            f"the global rules text carries {len(hits)} lines starting {mark!r}; the per-prompt "
            "digest (issue 533) is generated from that mark, so the build cannot guess. Update "
            "DIGEST_SECTIONS in build-cloud-plugin.py if the rules were reworded.")
    start = hits[0]
    span = [lines[start].rstrip()]
    for line in lines[start + 1:]:
        if not line.strip() or DIGEST_BLOCK_RE.match(line):
            break
        span.append(line.strip())
    return DIGEST_LEAD_RE.sub("", " ".join(span))


def build_rules_digest(rules_text, cap=DIGEST_CAP_BYTES):
    """The per-prompt digest, generated from the marks the rules text already carries."""
    lines = rules_text.replace("\r\n", "\n").split("\n")
    body = [f"{label}: " + " ".join(_digest_span(lines, m) for m in marks)
            for label, marks in DIGEST_SECTIONS]
    digest = "\n".join([DIGEST_HEADER] + body) + "\n"
    size = len(digest.encode("utf-8"))
    if size > cap:
        raise RuntimeError(
            f"the generated per-prompt rules digest is {size} bytes, over the {cap}-byte cap "
            "(issue 533). Trim DIGEST_SECTIONS in build-cloud-plugin.py -- do not raise the cap: "
            "the point is that every prompt carries a digest, not the rulebook.")
    return digest


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


# governance-reminder.js (issue 495). The per-turn reminder tells the model twice where the full
# rules are: "~/.claude/CLAUDE.md", true on the PC and false in a container, which has no live
# tree. What a container does have is the payload's own rules/global-rules.md (issue 209),
# injected every prompt by global-rules.js as "GLOBAL RULES (part N of M ...)". The packaged copy
# is retargeted at that file during the copy -- the live hook keeps its true text -- through a
# RULES_FILE resolved at run time, so the reminder names an absolute path the model can open,
# not a "${CLAUDE_PLUGIN_ROOT}" it cannot expand. Same shape as the session-gate CHECK rewire:
# the marker strings are the mirror's exact text, and a build whose source drifted fails loudly.
GOV_REMINDER_ANCHOR = "const os = require('os');\n"
GOV_REMINDER_RULES_FILE = (
    "\n"
    "// Packaged copy (issue 495): a container has no ~/.claude/CLAUDE.md. The rules this reminder\n"
    "// summarises ship in the plugin at rules/global-rules.md, two levels up from hooks/scripts/,\n"
    "// and global-rules.js injects them at session start -- so the pointers below name that file.\n"
    "const RULES_FILE = process.env.CLAUDE_PLUGIN_ROOT\n"
    "  ? path.join(process.env.CLAUDE_PLUGIN_ROOT, 'rules', 'global-rules.md')\n"
    "  : path.resolve(__dirname, '..', '..', 'rules', 'global-rules.md');\n"
    "\n"
    "// Digest dedupe (issue 533): where the payload carries the per-prompt digest, that digest\n"
    "// already opens with this reminder's pointer -- the full rules are in context, and where the\n"
    "// file is. Repeating it here would put the same sentence in every prompt twice, so the\n"
    "// pointer drops out of both lines below and the digest is the one that carries it. A payload\n"
    "// without the digest (an older build) keeps the pointers.\n"
    "const DIGEST_FILE = path.join(path.dirname(RULES_FILE), '" + DIGEST_FILENAME + "');\n"
    "const DIGEST_CARRIES_POINTER = (() => {\n"
    "  try {\n"
    "    return fs.readFileSync(DIGEST_FILE, 'utf8').includes('" + DIGEST_POINTER_MARKER + "');\n"
    "  } catch (_) {\n"
    "    return false;\n"
    "  }\n"
    "})();\n")
GOV_REMINDER_REWRITES = [
    ("  'GOVERNANCE (always on — full rules in ~/.claude/CLAUDE.md):',\n",
     "  'GOVERNANCE (always on' + (DIGEST_CARRIES_POINTER ? '' :\n"
     "    ' — full rules already in this context as GLOBAL RULES, from ' + RULES_FILE) + '):',\n"),
    ("  '3. ASK-MATT: name which flow applies before starting work (see the map in ~/.claude/CLAUDE.md).',\n",
     "  '3. ASK-MATT: name which flow applies before starting work' + (DIGEST_CARRIES_POINTER ? '.' :\n"
     "    ' (see the map in the GLOBAL RULES already in this context, from ' + RULES_FILE + ').'),\n"),
]


def retarget_governance_reminder(text):
    """Point the packaged governance-reminder.js at the plugin's rules file (issue 495).

    `text` is the mirror script with LF newlines. Raises RuntimeError when any marker is
    missing, so a drifted source breaks the build instead of shipping the home path."""
    if text.count(GOV_REMINDER_ANCHOR) != 1:
        raise RuntimeError(
            "governance-reminder.js no longer has a single `const os = require('os');` line; the "
            "plugin packager cannot place RULES_FILE. Update GOV_REMINDER_ANCHOR in "
            "build-cloud-plugin.py.")
    for marker, _ in GOV_REMINDER_REWRITES:
        if text.count(marker) != 1:
            raise RuntimeError(
                "governance-reminder.js pointer text has drifted; the plugin packager can no "
                f"longer retarget it at the payload rules file (issue 495). Missing: {marker!r}. "
                "Update GOV_REMINDER_REWRITES in build-cloud-plugin.py.")
    text = text.replace(GOV_REMINDER_ANCHOR, GOV_REMINDER_ANCHOR + GOV_REMINDER_RULES_FILE)
    for marker, replacement in GOV_REMINDER_REWRITES:
        text = text.replace(marker, replacement)
    return text


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
    """Refresh the stamp of one source skill. Returns (stamp, changed, report).

    `changed` is compute_stamp's verdict: the packaged copy carries a fresh stamp. `report` is
    what the rotation line may say about the SOURCE, and it is measured, not inferred: None when
    the bytes of `entry`/SKILL.md are the same after this call as before (nothing written, or
    --no-stamp-write), otherwise a dict naming the path written, the revision it held and holds,
    and whether the write put the published stamp back rather than rotating past it (content
    that returned to HEAD's version, see skill_stamps.compute_stamp). A line that named a file
    the packager did not write made the real rotations harder to trust (issue 484).
    """
    path = Path(entry) / "SKILL.md"
    before = path.read_bytes()
    try:
        old = skill_stamps.read_stamp(
            skill_stamps.read_frontmatter(before.decode("utf-8").replace("\r\n", "\n"))[0])
    except Exception:  # noqa: BLE001 - an unreadable old stamp only blanks the "from" revision
        old = {}
    stamp, changed = skill_stamps.stamp_skill(entry, write=write, home=home, repo=REPO,
                                              history_paths=history_paths, mirror_dir=mirror_dir)
    if not write or not changed or path.read_bytes() == before:
        return stamp, changed, None
    try:
        rel = [path.parent.resolve().relative_to(REPO.resolve()).as_posix()]
    except ValueError:
        rel = []
    published = skill_stamps.published_stamp(
        REPO, rel + [p for p in (history_paths or []) if p not in rel])
    return stamp, changed, {
        "path": rel[0] + "/SKILL.md" if rel else str(path),
        "from": old.get("revision", NONE_REVISION),
        "restored": bool(published) and stamp == published,
    }


def plugin_version(now=None):
    """Version string for plugin.json: YYYY.M.DHHMM in UTC.

    Patch segment = day followed by HHMM, so several builds on one day carry distinct, increasing
    versions. Five builds on 2026-09-03 all said 2026.9.3 and a Cowork plugin update saw nothing
    new. Never zero-padded at the front (day >= 1), so it stays valid semver.

    Always UTC: cloud CI builds in UTC and a local Windows build in America/Chicago, so with local
    time a later local build produced a LOWER version than an earlier cloud one (2026-09-11: cloud
    2026.9.111802, local 2026.9.111542). One clock keeps versions monotonic across machines.

    Read this only through resolve_version(), which is what a build calls: a payload that has not
    moved keeps the stamp it published under rather than taking a new reading here (issue 432).
    """
    now = now.astimezone(timezone.utc) if now is not None else datetime.now(timezone.utc)
    return f"{now.year}.{now.month}.{now.day}{now:%H%M}"


def plugin_manifest(version):
    """plugin.json's bytes.

    write_bytes, not write_text: the payload must not depend on the building OS's newline.
    """
    return (
        json.dumps(
            {
                "name": PLUGIN_NAME,
                "version": version,
                "author": {"name": "Dan Gatsakos"},
                "description": "AAC Skills - Dan's Claude Code skills plus the Active Alarm "
                "Company team skills from the repo's aac-skills/ tree. Built by "
                "tools/build-cloud-plugin.py from aac-skills/.",
            },
            indent=2,
        )
        + "\n").encode("utf-8")


def payload_fingerprint(root):
    """Every byte the payload ships, keyed by path, with the version stamp neutralized.

    The version is the one field a rebuild may carry over, so plugin.json is compared with that
    key removed and every other key of it still counted: change the description and the payload
    has moved.

    Files a hook run drops into the published tree at runtime are not payload: running the
    plugin's Python hook leaves hooks/scripts/__pycache__/ behind, git-ignored so the tree still
    reads clean, and counting it made every rebuild on such a tree take a fresh version for a
    payload that had not moved (issue 484). One rule, the packager's own noise list, and CI's
    diff excludes the same directories.
    """
    files = {}
    for f in sorted(root.rglob("*")):
        if not f.is_file():
            continue
        if any(skill_stamps.is_noise(part) for part in f.relative_to(root).parts):
            continue
        rel = f.relative_to(root).as_posix()
        if rel == MANIFEST_REL:
            try:
                manifest = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                manifest = None
            if isinstance(manifest, dict):
                manifest.pop("version", None)
            files[rel] = json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8")
        else:
            files[rel] = f.read_bytes()
    return files


def resolve_version(payload_root, published_root, now=None):
    """The version an assembled payload ships: the published one when nothing moved.

    plugin_version() is a wall clock, so stamping it on every build made every rebuild of an
    unchanged mirror a two-file diff - plugin.json and marketplace.json - that no content movement
    explained (issue 432). A rebuild whose payload reproduces the published one byte for byte
    keeps the published version; only a payload that really moved takes a fresh stamp.

    Versions still never go backwards across machines, which is the whole point of the clock
    (see plugin_version): every value returned here is either a fresh UTC reading, which outranks
    every earlier one whatever timezone the building machine sits in, or the stamp the identical
    payload already carries - reuse cannot invent a version older than the content it names.
    """
    try:
        carried = json.loads(
            (published_root / MANIFEST_REL).read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError, AttributeError):
        carried = None
    if carried and payload_fingerprint(payload_root) == payload_fingerprint(published_root):
        return carried
    return plugin_version(now)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=str(REPO / "aac-skills"),
                    help="the skill tree to package (default: this repo's aac-skills/)")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "dist"))
    ap.add_argument("--no-marketplace", action="store_true",
                    help="skip refreshing <repo>/marketplace and marketplace.json")
    ap.add_argument("--home", default=None,
                    help="the owner's home path, folded out of every content hash. "
                         f"Default: {skill_stamps.OWNER_HOME} "
                         "(skill-stamps.py OWNER_HOME, the spelling CI checks with - never the "
                         "running user's home, issue 492)")
    ap.add_argument("--no-stamp-write", action="store_true",
                    help="stamp the packaged copies only; leave every source SKILL.md untouched")
    args = ap.parse_args()

    home = skill_stamps.cli_home(args.home)
    stamp_write = not args.no_stamp_write
    src = Path(args.source)
    out = Path(args.out)
    plugin_root = out / PLUGIN_NAME
    if plugin_root.exists():
        shutil.rmtree(plugin_root)
    (plugin_root / ".claude-plugin").mkdir(parents=True)

    # The version is resolved once the payload is assembled, so an unchanged payload can carry the
    # published stamp forward instead of churning on the clock (issue 432).
    (plugin_root / MANIFEST_REL).write_bytes(plugin_manifest(PLACEHOLDER_VERSION))

    packaged, failures, restamped = [], [], []
    dropped = []
    for entry in sorted(src.iterdir()):
        if not entry.is_dir():
            continue  # stray files like PROVENANCE-design-skills.md
        if entry.name in DEAD_LOAD_DROPPED:
            # Decided out of the payload (issue 530); the reason is in the table. Skipped before
            # stamping too: a skill the payload does not carry has no packaged copy to keep in
            # step, and `skill-stamps.py stamp aac-skills` still rotates the source.
            dropped.append(entry.name)
            continue
        skill_md = entry / "SKILL.md"
        if not skill_md.is_file():
            failures.append(f"{entry.name}: no SKILL.md")
            continue
        dest = plugin_root / "skills" / entry.name
        try:
            # The retired mirror paths ride as extra history (issue 214): a skill that moved out
            # of claude/skills or aac-skills keeps its dates when it is stamped for the first
            # time under its new path.
            stamp, changed, report = stamp_source(
                entry,
                [f"aac-skills/{entry.name}",
                 f"aac-skills/{entry.name}", f"aac-skills/{entry.name}"],
                None, home, stamp_write)
            new_text, moved, retargeted = transform_skill_md(skill_md, stamp)
        except Exception as exc:  # noqa: BLE001 - report and keep packaging the rest
            failures.append(f"{entry.name}: {exc}")
            continue
        if changed:
            restamped.append((entry.name, stamp, report))
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
    # copied from the repo profile (profile/claude/hooks/, profile/codex/hooks/) into
    # hooks/scripts/ and each hook
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
        all((REPO / "profile" / "claude" / "hooks" / n).is_file() for n in GOV_JS)
        and all((REPO / "profile" / "codex" / "hooks" / n).is_file() for n in GOV_PY))
    # Ship the plugin/live-tree dedup guard (issue 208 criterion 4) alongside the governance
    # scripts. Sources live under tools/plugin-hook-guards/ so they are trackable and not
    # mistaken for generated mirror content; the packager copies them in and prepends a one-line
    # invocation to each governance script during copy. See tools/plugin-hook-guards/README.
    guard_src_dir = REPO / "tools" / "plugin-hook-guards"
    guard_js_name = "_plugin_hook_guard.js"
    guard_py_name = "_plugin_hook_guard.py"
    guard_js_src = guard_src_dir / guard_js_name
    guard_py_src = guard_src_dir / guard_py_name

    # Global rules text (issue 209). ONE source: profile/claude/CLAUDE.md, the consumer profile's
    # copy of the owner's global CLAUDE.md, de-tokenized with --home. Every build - desktop,
    # container, CI - reads the same file, so all three emit the same bytes (issue 214 retired the
    # live-tree route with sync push). Nothing here is hand-written into the payload.
    rules_src = REPO / "profile" / "claude" / "CLAUDE.md"
    if not rules_src.is_file():
        rules_src = None
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
        # The per-prompt digest (issue 533), generated from the marks the section already carries.
        (plugin_root / "rules" / DIGEST_FILENAME).write_bytes(
            build_rules_digest(rules_text).encode("utf-8"))
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
        src_file = REPO / "profile" / "claude" / "hooks" / name
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
        elif name == "governance-reminder.js":
            # Point the two "full rules in ~/.claude/CLAUDE.md" pointers at the payload's own
            # rules file (issue 495); the live hook keeps the home path, which is true there.
            text = retarget_governance_reminder(text.replace("\r\n", "\n"))
        text = _insert_after_shebang_js(text.replace("\r\n", "\n"), js_guard_call)
        # write_bytes with a fixed newline: the payload must not depend on the building OS's newline.
        (scripts_dir / name).write_bytes(text.encode("utf-8"))
    for name in GOV_PY:
        src_file = REPO / "profile" / "codex" / "hooks" / name
        if not gov_sources_present:
            break
        text = src_file.read_text(encoding="utf-8").replace("\r\n", "\n")
        text = _insert_after_python_prelude(text, py_guard_call)
        (scripts_dir / name).write_bytes(text.encode("utf-8"))

    # Repo memory loader (issue 210). Unlike the governance scripts this one has NO live-tree twin:
    # its source is tools/repo-memory-load.js in this repo, it is not mirrored into ~/.claude, and
    # nothing in settings.json dispatches it -- so it ships without the dedup guard and fires from
    # the plugin on every surface. It reads the CURRENT repo's docs/agents/memory/MEMORY.md, so the
    # notes a session sees follow the checkout it opened, not the machine it runs on.
    MEMORY_LOADER = "repo-memory-load.js"
    memory_loader_src = REPO / "tools" / MEMORY_LOADER
    memory_loader_present = memory_loader_src.is_file()
    if memory_loader_present:
        (scripts_dir / MEMORY_LOADER).write_bytes(
            memory_loader_src.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8"))

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

    if memory_loader_present:
        # Its own SessionStart group: the memory injection must not wait on (or be skipped with)
        # the session gate's 200s group, and a repo with no index makes it a no-op.
        governance_hooks.setdefault("SessionStart", []).append({"hooks": [
            _hook("node", "node", MEMORY_LOADER, [], 10,
                  "Loading this repo's memory notes..."),
        ]})

    # The rules text rides SessionStart in full, one entry per part (issue 533; the split is
    # issue 209's, and the measured cap is per hook output, so N parts under it deliver the file
    # whole). NO MATCHER on the group: every SessionStart source -- startup, resume, clear and
    # compact -- gets it, so a compacted session has the rulebook back rather than a summary of it.
    # Every PROMPT carries the digest instead: one entry, about a tenth of the bytes, for text the
    # session already has. Independent of gov_sources_present -- the rules ride even where the
    # governance scripts have no mirror to be copied from.
    if rules_parts:
        governance_hooks.setdefault("SessionStart", []).append({"hooks": [
            _hook("node", "node", "global-rules.js", ["start", str(i)], 10,
                  f"Delivering global rules ({i}/{len(rules_parts)})...")
            for i in range(1, len(rules_parts) + 1)
        ]})
        governance_hooks.setdefault("UserPromptSubmit", []).append({"hooks": [
            _hook("node", "node", "global-rules.js", ["digest"], 10,
                  "Recalling the global rules digest..."),
        ]})

    (hooks_dir / "hooks.json").write_bytes((
        json.dumps({"hooks": governance_hooks}, indent=2) + "\n").encode("utf-8")
    )

    # ------------------------------------------------------------------------ version
    # Last, because it is a fact about the assembled payload. The zip follows it (and the team
    # skills above), so every surface ships the same bytes under the same version.
    version = resolve_version(plugin_root, REPO / "marketplace" / PLUGIN_NAME)
    (plugin_root / MANIFEST_REL).write_bytes(plugin_manifest(version))

    zip_path = out / f"{PLUGIN_NAME}.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(plugin_root.rglob("*")):
            if f.is_file():
                zf.write(f, f.relative_to(plugin_root))

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
                    "the repo's aac-skills/ tree by tools/build-cloud-plugin.py.",
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
    # The gate the payload can actually enforce (issue 530): say what it left out, every build.
    packaged_names = {n for n, _m, _r in packaged}
    dropped = sorted(set(dropped))  # a name present in both source trees is one dropped skill
    print(f"dead-load skills left out of the payload: {len(dropped)}"
          + (": " + ", ".join(dropped) if dropped else ""))
    for name in sorted(n for n in DEAD_LOAD_KEPT if n in packaged_names):
        print(f"  kept anyway: {name} - {DEAD_LOAD_KEPT[name]}")
    print(f"local paths retargeted at the plugin in {len(retargeted)} skills"
          + (f": {', '.join(retargeted)}" if retargeted else ""))
    # The rotation report names exactly the source files this run wrote with a changed stamp
    # (issue 484). With --no-stamp-write only the packaged copies moved, and the line says so.
    if stamp_write:
        written = [(n, s, r) for n, s, r in restamped if r]
        print(f"stamps rotated in {len(written)} skills")
        for name, stamp, report in written:
            print(f"  {name} ({report['path']}): rev {report['from']} -> {stamp['revision']}, "
                  f"modified {stamp['modified']}, previous {stamp['previous-modified']}"
                  + (" (back to the published stamp)" if report["restored"] else ""))
    else:
        print(f"stamps rotated in the packaged copies of {len(restamped)} skills "
              "(sources untouched: --no-stamp-write)")
        for name, stamp, _r in restamped:
            print(f"  {name}: rev {stamp['revision']}, modified {stamp['modified']}, "
                  f"previous {stamp['previous-modified']}")
    if failures:
        print("FAILURES:")
        for f in failures:
            print(f"  {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
