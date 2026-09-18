#!/usr/bin/env python3
"""Tests for tools/build-cloud-plugin.py. Run:  python3 tests/build-cloud-plugin.test.py"""

import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import yaml

REPO = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("build_cloud_plugin", REPO / "tools" / "build-cloud-plugin.py")
bcp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bcp)

CHICAGO = timezone(timedelta(hours=-5))  # CDT, the local offset on 2026-09-11


# plugin_version() is the reading a MOVED payload takes (resolve_version); an unchanged payload
# carries the version it was published under, so nothing below says a rebuild changes the version.
# That contract is VersionFollowsThePayload (issues 432, 484); this class pins only the format and
# the UTC rule of the fresh reading.
class PluginVersion(unittest.TestCase):
    def test_fresh_stamp_for_a_moved_payload_formats_year_month_day_hhmm(self):
        now = datetime(2026, 9, 11, 18, 2, tzinfo=timezone.utc)
        self.assertEqual(bcp.plugin_version(now), "2026.9.111802")

    def test_local_time_is_converted_to_utc(self):
        # The 2026-09-11 regression: a Chicago build at 15:42 must say 20:42 UTC, not 15:42.
        local = datetime(2026, 9, 11, 15, 42, tzinfo=CHICAGO)
        self.assertEqual(bcp.plugin_version(local), "2026.9.112042")

    def test_same_instant_same_version_across_zones(self):
        utc = datetime(2026, 9, 11, 20, 42, tzinfo=timezone.utc)
        self.assertEqual(bcp.plugin_version(utc), bcp.plugin_version(utc.astimezone(CHICAGO)))

    def test_later_local_build_outranks_earlier_cloud_build(self):
        cloud = datetime(2026, 9, 11, 18, 2, tzinfo=timezone.utc)
        local = datetime(2026, 9, 11, 15, 42, tzinfo=CHICAGO)  # 20:42 UTC, after the cloud build
        self.assertGreater(bcp.plugin_version(local), bcp.plugin_version(cloud))

    def test_utc_date_rolls_over_ahead_of_local_date(self):
        # 21:00 Chicago on the 11th is 02:00 UTC on the 12th.
        local = datetime(2026, 9, 11, 21, 0, tzinfo=CHICAGO)
        self.assertEqual(bcp.plugin_version(local), "2026.9.120200")

    def test_no_zero_padding_ahead_of_day(self):
        now = datetime(2026, 1, 5, 0, 7, tzinfo=timezone.utc)
        self.assertEqual(bcp.plugin_version(now), "2026.1.50007")
        self.assertRegex(bcp.plugin_version(now), r"^\d{4}\.\d{1,2}\.[1-9]\d{4}$")

    def test_default_clock_is_utc_now(self):
        before = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        got = bcp.plugin_version()
        after = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        candidates = {bcp.plugin_version(t) for t in (before, after)}
        self.assertIn(got, candidates)
        self.assertRegex(got, re.compile(r"^\d{4}\.\d{1,2}\.\d{5,6}$"))


# Regression guard for issue 45 (cloud sessions can't invoke the session skills). The fix landed
# by including the session skills in the packaged plugin and by teaching each user-invocable one
# to fall back to GitHub MCP tools where `gh` is absent. Once shipped, a silent regression --
# a skill dropped from the build, or its cloud-container section deleted -- would put the ticket
# right back where it started with no test to notice. Assert the shape here so the packager owns
# it too.
SESSION_ENGINE = "session-check"                  # non-invocable; cloud awareness in check.js
SESSION_INVOCABLE = (                             # the five SKILL.md files acceptance-criterion 3 names
    "session-end",
    "session-start",
    "triage",
    "to-tickets",
    "grill-ready-for-human",
)
MARKETPLACE_SKILLS = REPO / "marketplace" / "aac-skills" / "skills"


class SessionSkillsInCloudPlugin(unittest.TestCase):
    def test_engine_and_five_invocable_skills_ship_in_the_plugin(self):
        for name in (SESSION_ENGINE, *SESSION_INVOCABLE):
            skill_md = MARKETPLACE_SKILLS / name / "SKILL.md"
            self.assertTrue(skill_md.is_file(),
                            f"{name}: expected {skill_md.relative_to(REPO)} in the built plugin")

    def test_each_invocable_session_skill_carries_a_cloud_container_section(self):
        for name in SESSION_INVOCABLE:
            body = (MARKETPLACE_SKILLS / name / "SKILL.md").read_text(encoding="utf-8")
            self.assertIn(
                "cloud container", body.lower(),
                f"{name}: SKILL.md lost its 'In a cloud container' fallback section (issue 45)",
            )

    def test_session_check_engine_branches_on_the_cloud_env_var(self):
        # Cloud awareness for the engine lives in check.js, not the SKILL.md (the engine is
        # disable-model-invocation and its SKILL.md exists only to satisfy the skill-shape check).
        body = (MARKETPLACE_SKILLS / SESSION_ENGINE / "check.js").read_text(encoding="utf-8")
        self.assertIn("CLAUDE_CODE_REMOTE_SESSION_ID", body,
                      "session-check/check.js lost its cloud-env-var branch (issue 45)")

    def test_packaged_frontmatter_is_validator_clean(self):
        # The claude.ai upload validator accepts only ALLOWED_KEYS at the top level; every other
        # source key must have been moved under `metadata` by the packager. If a session skill
        # slipped through with a top-level disable-model-invocation (or similar), the plugin
        # would fail to upload and cloud sessions would drop back to "Unknown command".
        for name in (SESSION_ENGINE, *SESSION_INVOCABLE):
            skill_md = MARKETPLACE_SKILLS / name / "SKILL.md"
            text = skill_md.read_text(encoding="utf-8").replace("\r\n", "\n")
            fm_str, _ = bcp.split_frontmatter(text)
            self.assertIsNotNone(fm_str, f"{name}: no frontmatter in packaged SKILL.md")
            fm = yaml.safe_load(fm_str) or {}
            extras = sorted(k for k in fm if k not in bcp.ALLOWED_KEYS)
            self.assertEqual(extras, [],
                             f"{name}: packaged frontmatter carries validator-rejected keys {extras}")


# Regression guard for issue 237: a build used to write its rotated stamps into a tempdir copy of
# the source and throw them away when the run ended, so the source SKILL.md kept its stale hash
# and CI's stale check went red. The write-back must land on the real source path.
STALE_SOURCE_SKILL = """---
name: foo
description: A regression fixture for stamp write-back.
metadata:
  modified: "2026-01-01T00:00:00Z"
  previous-modified: "none"
  revision: "1"
  content-sha: "deadbeefdead"
---

# Foo

A body that no longer matches the recorded content-sha above.
"""


class SourceStampWriteBack(unittest.TestCase):
    def _make_fake_repo(self, tmp):
        repo = Path(tmp) / "repo"
        (repo / "aac-skills" / "foo").mkdir(parents=True)
        (repo / "aac-skills" / "foo" / "SKILL.md").write_text(
            STALE_SOURCE_SKILL, encoding="utf-8")
        return repo

    def _run(self, repo, argv):
        with mock.patch.object(bcp, "REPO", repo), mock.patch.object(sys, "argv", ["bcp", *argv]):
            return bcp.main()

    def test_a_build_restamps_the_aac_skills_source_in_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            out = Path(tmp) / "dist"
            source_skill = repo / "aac-skills" / "foo" / "SKILL.md"
            before = source_skill.read_text(encoding="utf-8")

            rc = self._run(repo, [
                "--home", "C:\\Users\\Dan",
                "--out", str(out), "--no-marketplace",
            ])
            self.assertEqual(rc, 0)

            after = source_skill.read_text(encoding="utf-8")
            self.assertNotEqual(after, before,
                                "source SKILL.md should have been restamped on disk")
            fm = yaml.safe_load(bcp.split_frontmatter(after.replace("\r\n", "\n"))[0]) or {}
            meta = fm.get("metadata") or {}
            self.assertNotEqual(meta.get("content-sha"), "deadbeefdead",
                                "content-sha did not rotate; write-back missed the source")
            self.assertEqual(meta.get("previous-modified"), "2026-01-01T00:00:00Z",
                             "previous-modified should carry the pre-restamp modified value")
            self.assertEqual(meta.get("revision"), "2",
                             "revision should bump by one when the hash rotates")

    def test_no_stamp_write_second_rebuild_reproduces_committed_payload(self):
        # After the first rebuild has written the new stamp back to the source, a second rebuild
        # with --no-stamp-write must emit the same plugin payload (CI's determinism check).
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            first_out = Path(tmp) / "dist1"
            second_out = Path(tmp) / "dist2"

            self.assertEqual(self._run(repo, [
                "--home", "C:\\Users\\Dan",
                "--out", str(first_out), "--no-marketplace",
            ]), 0)
            self.assertEqual(self._run(repo, [
                "--home", "C:\\Users\\Dan", "--no-stamp-write",
                "--out", str(second_out), "--no-marketplace",
            ]), 0)

            def payload_bytes(root):
                # Everything under the plugin except plugin.json (its version stamp is time-based).
                return {
                    p.relative_to(root).as_posix(): p.read_bytes()
                    for p in sorted((root / bcp.PLUGIN_NAME).rglob("*")) if p.is_file()
                    and p.relative_to(root).as_posix() != f"{bcp.PLUGIN_NAME}/.claude-plugin/plugin.json"
                }

            self.assertEqual(payload_bytes(first_out), payload_bytes(second_out),
                             "second --no-stamp-write rebuild did not reproduce the payload")


# Issue 432: plugin_version() is a wall clock, so every rebuild of an unchanged source moved
# marketplace/aac-skills/.claude-plugin/plugin.json and .claude-plugin/marketplace.json and nothing
# else - a two-file diff no content movement explained. The version now follows the payload.


class VersionFollowsThePayload(unittest.TestCase):
    def _make_fake_repo(self, tmp):
        repo = Path(tmp) / "repo"
        (repo / "aac-skills" / "foo").mkdir(parents=True)
        (repo / "aac-skills" / "foo" / "SKILL.md").write_text(
            STALE_SOURCE_SKILL, encoding="utf-8")
        return repo

    def _rebuild(self, repo, out):
        with mock.patch.object(bcp, "REPO", repo), mock.patch.object(
                sys, "argv", ["bcp", "--home", "C:\\Users\\Dan",
                              "--out", str(out)]):
            self.assertEqual(bcp.main(), 0)

    def _tracked(self, repo):
        """Everything a rebuild writes into the checkout: the payload plus marketplace.json."""
        files = {
            f.relative_to(repo).as_posix(): f.read_bytes()
            for f in sorted((repo / "marketplace").rglob("*")) if f.is_file()
        }
        files["marketplace.json"] = (repo / ".claude-plugin" / "marketplace.json").read_bytes()
        return files

    def _version(self, repo):
        return json.loads((repo / "marketplace" / bcp.PLUGIN_NAME / bcp.MANIFEST_REL)
                          .read_text(encoding="utf-8"))["version"]

    def test_an_unchanged_source_rebuilds_byte_identically(self):
        # The clock moves between the two rebuilds, as it does between two branches on one day.
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            self._rebuild(repo, Path(tmp) / "dist1")
            first = self._tracked(repo)
            with mock.patch.object(bcp, "plugin_version", lambda now=None: "2099.1.29999"):
                self._rebuild(repo, Path(tmp) / "dist2")
            self.assertEqual(first, self._tracked(repo),
                             "a rebuild of an unchanged source moved a tracked byte")

    def test_a_moved_payload_takes_a_fresh_clock_stamp(self):
        # The reuse must not outlive the content: a payload that really moved takes the UTC clock
        # reading, which is what keeps versions rising across machines and timezones.
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            self._rebuild(repo, Path(tmp) / "dist1")
            published = self._version(repo)

            skill = repo / "aac-skills" / "foo" / "SKILL.md"
            skill.write_text(skill.read_text(encoding="utf-8") + "\nA new paragraph.\n",
                             encoding="utf-8")
            with mock.patch.object(bcp, "plugin_version", lambda now=None: "2099.1.10000"):
                self._rebuild(repo, Path(tmp) / "dist2")
            self.assertNotEqual(published, "2099.1.10000")
            self.assertEqual(self._version(repo), "2099.1.10000",
                             "an edited skill should have taken the fresh clock stamp")

    # Issue 484: running the plugin's Python hook leaves hooks/scripts/__pycache__/ inside the
    # published tree. It is git-ignored, so the tree reads clean, yet a fingerprint that counted
    # it took a fresh version on every rebuild - the churn issue 432 fixed, back on any tree that
    # had run the hook. Runtime droppings are not payload.
    def test_runtime_pycache_in_the_published_payload_does_not_move_the_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            self._rebuild(repo, Path(tmp) / "dist1")
            first = self._tracked(repo)
            cache = repo / "marketplace" / bcp.PLUGIN_NAME / "hooks" / "scripts" / "__pycache__"
            cache.mkdir(parents=True, exist_ok=True)
            (cache / "ask_matt_gate.cpython-312.pyc").write_bytes(b"\x00runtime")
            with mock.patch.object(bcp, "plugin_version", lambda now=None: "2099.1.29999"):
                self._rebuild(repo, Path(tmp) / "dist2")
            self.assertEqual(first, self._tracked(repo),
                             "a runtime __pycache__ in the published payload moved the version")

    def test_payload_fingerprint_skips_runtime_droppings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "payload"
            (root / "hooks" / "scripts").mkdir(parents=True)
            (root / "hooks" / "scripts" / "hook.py").write_bytes(b"print(1)\n")
            clean = bcp.payload_fingerprint(root)
            (root / "hooks" / "scripts" / "__pycache__").mkdir()
            (root / "hooks" / "scripts" / "__pycache__" / "hook.cpython-312.pyc").write_bytes(b"\x00")
            (root / ".pytest_cache").mkdir()
            (root / ".pytest_cache" / "v").write_bytes(b"x")
            (root / "hooks" / "scripts" / "hook.py.bak").write_bytes(b"old\n")
            self.assertEqual(clean, bcp.payload_fingerprint(root))
            self.assertEqual(sorted(clean), ["hooks/scripts/hook.py"])


# Issue 484: the packager's rotation line named skills whose SKILL.md it had not changed - once
# because it reported compute_stamp's verdict rather than a write, once because a restore of the
# published stamp (a junk content-sha from a stamper run against the wrong home) printed as a
# rotation with nothing to say the revision went back. The line must name exactly the files this
# run wrote with a changed stamp, say where they are, and mark a restore as one.
CURRENT_SKILL = """---
name: bar
description: A skill whose recorded content-sha is already current.
metadata:
  modified: "2026-02-02T00:00:00Z"
  previous-modified: "none"
  revision: "3"
  content-sha: "{sha}"
---

# Bar

Nothing here has moved since it was stamped.
"""


class RotationReport(unittest.TestCase):
    HOME = "C:\\Users\\Dan"

    def _make_fake_repo(self, tmp):
        repo = Path(tmp) / "repo"
        for name in ("foo", "bar"):
            (repo / "aac-skills" / name).mkdir(parents=True)
        (repo / "aac-skills" / "foo" / "SKILL.md").write_text(
            STALE_SOURCE_SKILL, encoding="utf-8")
        bar = repo / "aac-skills" / "bar" / "SKILL.md"
        bar.write_text(CURRENT_SKILL.format(sha="000000000000"), encoding="utf-8")
        bar.write_text(CURRENT_SKILL.format(
            sha=bcp.skill_stamps.content_sha(bar.parent, self.HOME)), encoding="utf-8")
        return repo

    def _run(self, repo, out, *extra):
        buf = io.StringIO()
        with mock.patch.object(bcp, "REPO", repo), mock.patch.object(
                sys, "argv", ["bcp", "--home", self.HOME, "--out", str(out),
                              "--no-marketplace", *extra]), contextlib.redirect_stdout(buf):
            rc = bcp.main()
        self.assertEqual(rc, 0, buf.getvalue())
        return buf.getvalue().splitlines()

    @staticmethod
    def _report(lines):
        """The rotation headline and the indented lines under it."""
        start = next(i for i, l in enumerate(lines) if l.startswith("stamps rotated"))
        named = []
        for line in lines[start + 1:]:
            if not line.startswith("  "):
                break
            named.append(line.strip())
        return lines[start], named

    def _git(self, repo, *args):
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x",
               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@x"}
        for k in ("GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX",
                  "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"):
            env.pop(k, None)
        return subprocess.run(["git", "-C", str(repo), *args], check=True,
                              capture_output=True, env=env).stdout

    def test_names_exactly_the_skill_whose_bytes_changed_and_where(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            foo = repo / "aac-skills" / "foo" / "SKILL.md"
            bar = repo / "aac-skills" / "bar" / "SKILL.md"
            foo_before, bar_before = foo.read_bytes(), bar.read_bytes()

            headline, named = self._report(self._run(repo, Path(tmp) / "dist1"))
            self.assertEqual(headline, "stamps rotated in 1 skills")
            self.assertEqual(len(named), 1, named)
            self.assertTrue(named[0].startswith("foo (aac-skills/foo/SKILL.md): rev 1 -> 2, "),
                            named[0])
            self.assertNotIn("published", named[0])
            self.assertNotEqual(foo.read_bytes(), foo_before, "foo was reported but not written")
            self.assertEqual(bar.read_bytes(), bar_before, "bar was written though it was current")

    def test_a_no_change_rebuild_reports_zero_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            self._run(repo, Path(tmp) / "dist1")
            sources = {p: p.read_bytes() for p in (repo / "aac-skills").rglob("SKILL.md")}

            headline, named = self._report(self._run(repo, Path(tmp) / "dist2"))
            self.assertEqual(headline, "stamps rotated in 0 skills")
            self.assertEqual(named, [])
            self.assertEqual(sources, {p: p.read_bytes() for p in sources})

    def test_no_stamp_write_says_the_sources_were_left_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            foo = repo / "aac-skills" / "foo" / "SKILL.md"
            before = foo.read_bytes()
            headline, named = self._report(
                self._run(repo, Path(tmp) / "dist1", "--no-stamp-write"))
            self.assertEqual(before, foo.read_bytes())
            self.assertEqual(headline, "stamps rotated in the packaged copies of 1 skills "
                                       "(sources untouched: --no-stamp-write)")
            self.assertEqual(len(named), 1, named)
            self.assertTrue(named[0].startswith("foo: rev 2, "), named[0])

    def test_a_restore_of_the_published_stamp_is_reported_as_one(self):
        # The bullet that filed the issue: a stamper run against the wrong home had junked the
        # content-sha, the packager put HEAD's stamp back, and `git status` showed nothing. The
        # file was written, so it is named - and marked as a restore, revision unchanged.
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            self._run(repo, Path(tmp) / "dist0")  # foo now carries a current stamp (rev 2)
            self._git(repo, "init", "-q")
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-qm", "published")
            foo = repo / "aac-skills" / "foo" / "SKILL.md"
            published = foo.read_bytes()
            foo.write_bytes(re.sub(rb'content-sha: "[0-9a-f]+"', b'content-sha: "badbadbadbad"',
                                   published))
            self.assertNotEqual(foo.read_bytes(), published)

            headline, named = self._report(self._run(repo, Path(tmp) / "dist1"))
            self.assertEqual(headline, "stamps rotated in 1 skills")
            self.assertEqual(len(named), 1, named)
            self.assertTrue(named[0].startswith("foo (aac-skills/foo/SKILL.md): rev 2 -> 2, "),
                            named[0])
            self.assertTrue(named[0].endswith("(back to the published stamp)"), named[0])
            self.assertEqual(foo.read_bytes(), published)
            self.assertEqual(self._git(repo, "status", "--porcelain"), b"")


# Regression guard for issue 208: the plugin's hooks manifest must not name a script that isn't
# in the payload. The eight governance hooks ride inside the plugin so a container that installs
# it is gated the same way as a PC session; if a manifest entry points at a missing script the
# hook fails silently and the gate does not fire.
MARKETPLACE_HOOKS = REPO / "marketplace" / "aac-skills" / "hooks"
_SCRIPT_PATH_RE = re.compile(
    r'"\$\{CLAUDE_PLUGIN_ROOT\}/hooks/scripts/([A-Za-z0-9_.\-]+)"')


def _iter_hook_commands(manifest):
    for event_entries in (manifest.get("hooks") or {}).values():
        for group in event_entries:
            for hook in group.get("hooks", []):
                for key in ("command", "commandWindows"):
                    cmd = hook.get(key)
                    if cmd:
                        yield cmd


class PluginHooksManifest(unittest.TestCase):
    def setUp(self):
        text = (MARKETPLACE_HOOKS / "hooks.json").read_text(encoding="utf-8")
        self.manifest = json.loads(text)
        self.scripts_dir = MARKETPLACE_HOOKS / "scripts"

    def test_manifest_names_only_scripts_that_exist_in_the_payload(self):
        referenced = set()
        for cmd in _iter_hook_commands(self.manifest):
            for m in _SCRIPT_PATH_RE.finditer(cmd):
                referenced.add(m.group(1))
        self.assertTrue(referenced,
                        "manifest names no plugin-root scripts; expected the governance hooks")
        missing = sorted(n for n in referenced if not (self.scripts_dir / n).is_file())
        self.assertEqual(missing, [],
                         f"hooks.json names scripts not shipped in the payload: {missing}")

    def test_eight_governance_hook_entries_are_present(self):
        # Session gate (start + end), state rehydrate, state stash (SessionEnd + PreCompact both
        # invoke the same script), governance reminder, ask-matt gate on prompt / pre-tool /
        # post-tool / stop. Nine hook entries in total -- state-stash rides two events -- across
        # the six lifecycle events the PC settings.json wires today.
        counts = {}
        for event, entries in (self.manifest.get("hooks") or {}).items():
            for group in entries:
                for hook in group.get("hooks", []):
                    cmd = hook.get("command", "")
                    for m in _SCRIPT_PATH_RE.finditer(cmd):
                        counts[m.group(1)] = counts.get(m.group(1), 0) + 1
        # State-stash rides both PreCompact and SessionEnd (two entries).
        self.assertEqual(counts.get("session-gate.js"), 3,
                         "session-gate.js should fire on SessionStart, SessionEnd and UserPromptSubmit")
        self.assertEqual(counts.get("state-rehydrate.js"), 1)
        self.assertEqual(counts.get("state-stash.js"), 2,
                         "state-stash.js rides both PreCompact and SessionEnd")
        self.assertEqual(counts.get("governance-reminder.js"), 1)
        self.assertEqual(counts.get("ask_matt_gate.py"), 4,
                         "ask_matt_gate.py should fire on prompt, pre-tool, post-tool and stop")

    def test_repo_memory_loader_is_a_sessionstart_hook_in_the_payload(self):
        # Issue 210: the loader that injects this repo's committed memory notes rides the same
        # manifest as the governance hooks, in its own SessionStart group (so the gate's 200s
        # group cannot delay or skip it), and the script it names ships in the payload.
        groups = (self.manifest.get("hooks") or {}).get("SessionStart") or []
        loader_groups = [g for g in groups
                         if any("repo-memory-load.js" in h.get("command", "")
                                for h in g.get("hooks", []))]
        self.assertEqual(len(loader_groups), 1,
                         "expected exactly one SessionStart group for repo-memory-load.js")
        self.assertEqual(len(loader_groups[0]["hooks"]), 1,
                         "the memory loader must not share a group with another hook")
        self.assertTrue((self.scripts_dir / "repo-memory-load.js").is_file())

    def test_no_pwsh_only_invocation_in_the_hook_commands(self):
        # Acceptance criterion 3: every script runs on python3 and node only. A pwsh-only branch
        # would need to be guarded and skipped with a printed reason; there is no such branch here,
        # and this guard makes sure a later edit does not slip one in without a paired guard. The
        # marker hook's probe reports `command -v pwsh` -- a which-check that prints `none` when
        # pwsh is absent, not an invocation -- so it is exempt.
        for cmd in _iter_hook_commands(self.manifest):
            if "hooks/scripts/" not in cmd:
                continue
            self.assertNotRegex(cmd, r"\bpwsh\b",
                                f"pwsh-only invocation in hook command: {cmd!r}")

    def test_scripts_reference_plugin_root_not_a_home_path(self):
        for cmd in _iter_hook_commands(self.manifest):
            if "hooks/scripts/" not in cmd:
                continue  # the marker sh-c echo does not name a shipped script
            self.assertNotRegex(cmd, r"(?:~|\$HOME|%USERPROFILE%|__USERHOME__)",
                                f"hook command reaches through a home path: {cmd!r}")


# Regression guard for issue 208 criterion 4 (deduplication of governance hooks between the
# plugin payload and the PC's live-tree ~/.claude/settings.json). Until the settings entries come
# out, the plugin must not make the hooks fire twice on a PC session -- so each plugin-shipped
# governance script self-guards: running as the plugin copy while settings.json still dispatches
# the same script by name, it exits silently and leaves the user-settings entry to fire once.
# The guard keys on the settings ENTRY, not on the live file: the live-tree files stay after the
# entries are gone (the packager builds this payload from profile/claude/hooks/, and pull restores
# them), so a presence check would skip forever and the hook would fire zero times.
class PluginHookDedupGuard(unittest.TestCase):
    scripts_dir = REPO / "marketplace" / "aac-skills" / "hooks" / "scripts"

    JS_FAKE = (
        "#!/usr/bin/env node\n"
        "try { require('./_plugin_hook_guard.js').skipIfLiveTreeWillFire(); } catch (_) {}\n"
        "process.stdout.write('SENTINEL_WROTE');\n"
    )
    PY_FAKE = (
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "from pathlib import Path\n"
        "sys.path.insert(0, str(Path(__file__).resolve().parent))\n"
        "try:\n"
        "    from _plugin_hook_guard import skip_if_live_tree_will_fire\n"
        "    skip_if_live_tree_will_fire(Path(__file__).resolve())\n"
        "except Exception:\n"
        "    pass\n"
        "sys.stdout.write('SENTINEL_WROTE')\n"
    )

    def _plugin(self, root, guard, script_name, body):
        plugin_root = root / "plugin"
        scripts = plugin_root / "hooks" / "scripts"
        scripts.mkdir(parents=True)
        shutil.copy2(self.scripts_dir / guard, scripts / guard)
        script = scripts / script_name
        script.write_text(body, encoding="utf-8")
        return plugin_root, script

    @staticmethod
    def _home(root, *, settings_names=(), live_files=()):
        """A fake home. settings_names: script basenames settings.json dispatches from the live
        tree. live_files: basenames present under ~/.claude/hooks regardless of settings."""
        home = root / "home"
        claude = home / ".claude"
        (claude / "hooks").mkdir(parents=True)
        for name in live_files:
            (claude / "hooks" / name).write_text("// live twin\n", encoding="utf-8")
        if settings_names:
            entries = [{"hooks": [{"type": "command",
                                   "command": f'node "{claude / "hooks" / n}" start'}]}
                       for n in settings_names]
            (claude / "settings.json").write_text(
                json.dumps({"hooks": {"SessionStart": entries}}), encoding="utf-8")
        return home

    @staticmethod
    def _run(argv, plugin_root, home):
        env = {
            **os.environ,
            "CLAUDE_PLUGIN_ROOT": str(plugin_root),
            "CLAUDE_CONFIG_DIR": str(home / ".claude"),
            "HOME": str(home),
            "USERPROFILE": str(home),
            "PLUGIN_HOOK_GUARD_DISABLE": "",
        }
        return subprocess.run(argv, capture_output=True, text=True, env=env, timeout=15)

    def test_guard_helper_files_ship_in_the_payload(self):
        for name in ("_plugin_hook_guard.js", "_plugin_hook_guard.py"):
            self.assertTrue((self.scripts_dir / name).is_file(),
                            f"plugin dedup guard missing: {name}")

    def test_every_governance_script_invokes_the_guard(self):
        js_scripts = ("session-gate.js", "state-rehydrate.js", "state-stash.js",
                      "governance-reminder.js")
        py_scripts = ("ask_matt_gate.py",)
        for name in js_scripts:
            body = (self.scripts_dir / name).read_text(encoding="utf-8")
            self.assertIn("_plugin_hook_guard.js", body,
                          f"{name}: missing the plugin/live-tree dedup guard require()")
            self.assertIn("skipIfLiveTreeWillFire", body,
                          f"{name}: guard require() is present but never invoked")
        for name in py_scripts:
            body = (self.scripts_dir / name).read_text(encoding="utf-8")
            self.assertIn("_plugin_hook_guard", body,
                          f"{name}: missing the plugin/live-tree dedup guard import")
            self.assertIn("skip_if_live_tree_will_fire", body,
                          f"{name}: guard import present but never invoked")

    def test_js_guard_skips_when_settings_still_dispatch_the_script(self):
        # PC before the paired edit: settings.json names fake-gate.js, so the plugin copy yields.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin_root, script = self._plugin(root, "_plugin_hook_guard.js", "fake-gate.js",
                                               self.JS_FAKE)
            home = self._home(root, settings_names=("fake-gate.js",), live_files=("fake-gate.js",))
            proc = self._run(["node", str(script)], plugin_root, home)
            self.assertEqual(proc.returncode, 0, msg=f"stderr: {proc.stderr!r}")
            self.assertEqual(proc.stdout, "",
                             "plugin script should have been skipped by the guard, but ran")

    def test_js_guard_runs_when_no_live_tree_exists(self):
        # Container: no settings.json at all. The guard must NOT skip.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin_root, script = self._plugin(root, "_plugin_hook_guard.js", "fake-gate.js",
                                               self.JS_FAKE)
            home = root / "home"
            home.mkdir()
            proc = self._run(["node", str(script)], plugin_root, home)
            self.assertEqual(proc.returncode, 0, msg=f"stderr: {proc.stderr!r}")
            self.assertEqual(proc.stdout, "SENTINEL_WROTE",
                             "container has no live tree; plugin script should have run")

    def test_js_guard_runs_when_live_file_exists_but_settings_no_longer_name_it(self):
        # PC after the paired edit: the live file is still on disk (packager source, restore-test
        # subject) but settings.json no longer dispatches it. The plugin copy is now the only
        # copy, so it must run -- a presence check here would make the hook fire zero times.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin_root, script = self._plugin(root, "_plugin_hook_guard.js", "fake-gate.js",
                                               self.JS_FAKE)
            home = self._home(root, settings_names=("some-other-hook.js",),
                              live_files=("fake-gate.js",))
            proc = self._run(["node", str(script)], plugin_root, home)
            self.assertEqual(proc.returncode, 0, msg=f"stderr: {proc.stderr!r}")
            self.assertEqual(proc.stdout, "SENTINEL_WROTE",
                             "settings no longer name the script; plugin copy must run")

    def test_py_guard_skips_when_settings_still_dispatch_the_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin_root, script = self._plugin(root, "_plugin_hook_guard.py", "fake_gate.py",
                                               self.PY_FAKE)
            home = self._home(root, settings_names=("fake_gate.py",))
            proc = self._run([sys.executable, str(script)], plugin_root, home)
            self.assertEqual(proc.returncode, 0, msg=f"stderr: {proc.stderr!r}")
            self.assertEqual(proc.stdout, "",
                             "plugin script should have been skipped by the guard, but ran")

    def test_py_guard_runs_when_live_file_exists_but_settings_no_longer_name_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin_root, script = self._plugin(root, "_plugin_hook_guard.py", "fake_gate.py",
                                               self.PY_FAKE)
            home = self._home(root, settings_names=("some-other-hook.js",),
                              live_files=("fake_gate.py",))
            proc = self._run([sys.executable, str(script)], plugin_root, home)
            self.assertEqual(proc.returncode, 0, msg=f"stderr: {proc.stderr!r}")
            self.assertEqual(proc.stdout, "SENTINEL_WROTE",
                             "settings no longer name the script; plugin copy must run")

    def test_guard_is_inert_outside_a_plugin_invocation(self):
        # No CLAUDE_PLUGIN_ROOT: the live-tree copy itself, or a bare run. Never skips.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin_root, script = self._plugin(root, "_plugin_hook_guard.js", "fake-gate.js",
                                               self.JS_FAKE)
            home = self._home(root, settings_names=("fake-gate.js",))
            env = {**os.environ, "CLAUDE_CONFIG_DIR": str(home / ".claude"),
                   "HOME": str(home), "USERPROFILE": str(home)}
            env.pop("CLAUDE_PLUGIN_ROOT", None)
            proc = subprocess.run(["node", str(script)], capture_output=True, text=True,
                                  env=env, timeout=15)
            self.assertEqual(proc.stdout, "SENTINEL_WROTE")


# Regression guard for issue 495: the per-turn reminder must point at rules that exist where it
# runs. The source copy says ~/.claude/CLAUDE.md, true on the PC; a container has no such
# file, and the rules it summarises ship in this payload at rules/global-rules.md (issue 209). The
# packager retargets the two pointers during the copy, the way session-gate.js's CHECK path is
# retargeted, so the live hook keeps its true text and the payload copy gets its own.
class GovernanceReminderRetarget(unittest.TestCase):
    HOME_POINTER = "~/.claude/CLAUDE.md"
    PLUGIN_ROOT = REPO / "marketplace" / "aac-skills"
    PAYLOAD_SCRIPT = PLUGIN_ROOT / "hooks" / "scripts" / "governance-reminder.js"
    SOURCE_SCRIPT = REPO / "profile" / "claude" / "hooks" / "governance-reminder.js"

    @staticmethod
    def _context(script, plugin_root=None):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"     # no settings.json: the dedup guard never skips
            home.mkdir()
            env = {**os.environ, "HOME": str(home), "USERPROFILE": str(home),
                   "CLAUDE_CONFIG_DIR": str(home / ".claude"), "PLUGIN_HOOK_GUARD_DISABLE": ""}
            if plugin_root is None:
                env.pop("CLAUDE_PLUGIN_ROOT", None)
            else:
                env["CLAUDE_PLUGIN_ROOT"] = str(plugin_root)
            proc = subprocess.run(["node", str(script)], input="{}", capture_output=True,
                                  text=True, env=env, timeout=15)
        assert proc.returncode == 0, f"stderr: {proc.stderr!r}"
        return json.loads(proc.stdout)["hookSpecificOutput"]["additionalContext"]

    @staticmethod
    def _payload_without_digest(dest):
        """A copy of the payload's hook scripts and rules with the digest file removed.

        An older build -- or any payload that does not carry the per-prompt digest -- must keep
        the issue 495 pointers, because then nothing else tells a container where the rules are.
        """
        shutil.copytree(GovernanceReminderRetarget.PLUGIN_ROOT / "hooks", dest / "hooks")
        shutil.copytree(GovernanceReminderRetarget.PLUGIN_ROOT / "rules", dest / "rules")
        (dest / "rules" / bcp.DIGEST_FILENAME).unlink()
        return dest

    def test_payload_copy_names_the_plugin_rules_file_where_nothing_else_does(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self._payload_without_digest(Path(tmp) / "payload")
            ctx = self._context(root / "hooks" / "scripts" / "governance-reminder.js", root)
        self.assertNotIn(self.HOME_POINTER, ctx,
                         "payload reminder still points a container at ~/.claude/CLAUDE.md")
        self.assertEqual(ctx.count(str(root / "rules" / "global-rules.md")), 2,
                         "both pointers (header and ASK-MATT line) should name the payload rules file")
        self.assertIn("GLOBAL RULES", ctx,
                      "reminder should say the rules are already in context (global-rules.js)")

    def test_payload_copy_drops_the_pointer_the_digest_already_carries(self):
        # Issue 533 criterion 3. The digest opens every prompt with "full text already in this
        # context, from <path>"; the reminder saying it twice more is the same sentence three
        # times a turn. With the digest in the payload, the reminder carries none of it.
        digest = (self.PLUGIN_ROOT / "rules" / bcp.DIGEST_FILENAME)
        self.assertTrue(digest.is_file(), "payload lost the per-prompt digest (issue 533)")
        self.assertIn(bcp.DIGEST_POINTER_MARKER, digest.read_text(encoding="utf-8"))
        ctx = self._context(self.PAYLOAD_SCRIPT, self.PLUGIN_ROOT)
        self.assertNotIn(self.HOME_POINTER, ctx)
        self.assertEqual(ctx.count(str(self.PLUGIN_ROOT / "rules" / "global-rules.md")), 0,
                         "the reminder repeats a pointer the digest already carries every prompt")
        self.assertIn("GOVERNANCE (always on):", ctx)
        self.assertIn("3. ASK-MATT: name which flow applies before starting work.", ctx)

    def test_payload_copy_resolves_the_rules_file_without_plugin_root(self):
        # A bare run of the payload script (no CLAUDE_PLUGIN_ROOT) still names a real file: the
        # rules sit two levels up from hooks/scripts/, the same fallback global-rules.js uses.
        with tempfile.TemporaryDirectory() as tmp:
            root = self._payload_without_digest(Path(tmp) / "payload")
            ctx = self._context(root / "hooks" / "scripts" / "governance-reminder.js")
        self.assertNotIn(self.HOME_POINTER, ctx)
        self.assertIn(str(root / "rules" / "global-rules.md"), ctx)

    def test_source_copy_still_names_the_home_path(self):
        # On the PC ~/.claude/CLAUDE.md is real and is where the rules live; the retarget is
        # confined to the packager's copy.
        ctx = self._context(self.SOURCE_SCRIPT)
        self.assertEqual(ctx.count(self.HOME_POINTER), 2)
        self.assertNotIn("global-rules.md", ctx)

    def test_packager_refuses_a_drifted_source(self):
        # Like the session-gate CHECK marker: if the source's pointer text moves, the build must
        # fail loudly rather than ship a payload that silently keeps the home path.
        body = self.SOURCE_SCRIPT.read_text(encoding="utf-8")
        with self.assertRaises(RuntimeError):
            bcp.retarget_governance_reminder(body.replace(self.HOME_POINTER, "~/elsewhere.md"))

    def test_retarget_touches_only_the_two_pointers(self):
        src = self.SOURCE_SCRIPT.read_text(encoding="utf-8")
        out = bcp.retarget_governance_reminder(src)
        # Only the two emitted strings move; the header comment keeps its history.
        self.assertNotIn("full rules in " + self.HOME_POINTER, out)
        self.assertNotIn("see the map in " + self.HOME_POINTER, out)
        self.assertIn("WHY: ~/.claude/CLAUDE.md carries the full rules", out)
        self.assertIn("RULES_FILE", out)


# Issue 533: the rulebook rides SessionStart; every PROMPT carries a digest of it instead. The
# digest is GENERATED from marks the rules section already carries -- bold run-in labels, numbered
# rules, the ask-matt paragraph's opening line -- because the source is profile/claude/CLAUDE.md,
# the owner's global rules, edited for their own sake. Nothing was added to it to make this
# work, and nothing here is a hand-kept copy of the rules: the shipped file has to be exactly what
# a rebuild produces from the shipped rules text.
class RulesDigest(unittest.TestCase):
    PLUGIN_ROOT = REPO / "marketplace" / "aac-skills"
    RULES = PLUGIN_ROOT / "rules" / "global-rules.md"
    # Acceptance criterion 2's list: caveman level + never-drop, the ADHD reply shape, the
    # ask-matt gate sentence, the yes-skill trigger sentence, and the pointer at the full text.
    REQUIRED = [
        "**Ultra:** minimum words",
        "**Never drop:**",
        "**Lead with the next action.**",
        "No preamble, no recap, no closing pleasantries.",
        "`/ask-matt` is user-invocable only",
        "Deliver correct, safe, *verified* results",
    ]

    def digest(self):
        return (self.PLUGIN_ROOT / "rules" / bcp.DIGEST_FILENAME).read_text(encoding="utf-8")

    def test_the_shipped_digest_is_what_a_rebuild_generates_from_the_shipped_rules(self):
        rules = self.RULES.read_text(encoding="utf-8")
        self.assertEqual(self.digest(), bcp.build_rules_digest(rules),
                         "rules/global-rules-digest.md is not what the packager generates from "
                         "rules/global-rules.md -- a hand-kept digest, or a stale payload")

    def test_the_digest_carries_the_required_content_verbatim_from_the_rules(self):
        digest, rules = self.digest(), " ".join(self.RULES.read_text(encoding="utf-8").split())
        self.assertIn(bcp.DIGEST_POINTER_MARKER, digest, "no pointer at the full rules")
        self.assertIn(bcp.DIGEST_RULES_TOKEN, digest,
                      "the pointer must carry the token global-rules.js resolves to a real path")
        for required in self.REQUIRED:
            self.assertIn(required, digest, f"the digest dropped: {required}")
            self.assertIn(required, rules, f"not verbatim from the rules text: {required}")

    def test_a_digest_over_the_cap_fails_the_build(self):
        # The cap is the point: a prompt carries a digest, not the rulebook. Raising it silently
        # would undo the change, so the packager refuses instead.
        with self.assertRaises(RuntimeError) as caught:
            bcp.build_rules_digest(self.RULES.read_text(encoding="utf-8"), cap=200)
        self.assertIn("over the 200-byte cap", str(caught.exception))

    def test_a_reworded_source_fails_the_build_rather_than_shipping_a_gap(self):
        # Same contract as RULES_HEADING: the marks are the source's own prose, so a rewording
        # must break the build loudly rather than quietly drop a discipline from every prompt.
        rules = self.RULES.read_text(encoding="utf-8").replace("**Never drop:**", "**Keep:**")
        with self.assertRaises(RuntimeError) as caught:
            bcp.build_rules_digest(rules)
        self.assertIn("Never drop", str(caught.exception))


# Issue 530: caveman learn (30-day window, 3594 sessions) found nine skills nobody invoked, whose
# descriptions cost ~536 tokens on every turn. Their live copies were gated with
# `disable-model-invocation: true`, but the packager moves that key under `metadata` to pass the
# claude.ai validator, so the payload went on loading all nine. The payload's gate is to leave the
# skill out, and the decision per skill lives in the packager's two tables.
DEAD_LOAD_NAMED_IN_530 = (
    "accessibility-review", "canvas-design", "claude-md-lint", "design-critique", "design-handoff",
    "design-system", "research-synthesis", "user-research", "ux-copy",
)

DROPPED_SKILL = """---
name: ux-copy
disable-model-invocation: true
description: A fixture standing in for a skill decided out of the payload.
---

# ux-copy
"""


class DeadLoadSkillDecisions(unittest.TestCase):
    def test_every_skill_the_ticket_named_carries_exactly_one_decision_with_a_reason(self):
        for name in DEAD_LOAD_NAMED_IN_530:
            decisions = [t for t in (bcp.DEAD_LOAD_DROPPED, bcp.DEAD_LOAD_KEPT) if name in t]
            self.assertEqual(len(decisions), 1,
                             f"{name}: needs exactly one drop/keep decision in the packager")
            self.assertTrue(decisions[0][name].strip(),
                            f"{name}: the decision must record a reason, not an empty string")

    def test_a_dropped_skill_is_not_packaged(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            (repo / "aac-skills" / "ux-copy").mkdir(parents=True)
            (repo / "aac-skills" / "ux-copy" / "SKILL.md").write_text(
                DROPPED_SKILL, encoding="utf-8")
            out = Path(tmp) / "dist"
            with mock.patch.object(bcp, "REPO", repo), mock.patch.object(
                    sys, "argv", ["bcp", "--home", "C:\\Users\\Dan",
                                  "--out", str(out), "--no-marketplace"]):
                rc = bcp.main()
            self.assertEqual(rc, 0)
            self.assertFalse((out / bcp.PLUGIN_NAME / "skills" / "ux-copy").exists(),
                             "a skill in DEAD_LOAD_DROPPED must not reach the payload")

    def test_the_committed_payload_matches_the_decisions(self):
        for name in bcp.DEAD_LOAD_DROPPED:
            self.assertFalse((MARKETPLACE_SKILLS / name).exists(),
                             f"{name}: decided out of the payload but still committed under "
                             "marketplace/ - rebuild the plugin")
        for name in bcp.DEAD_LOAD_KEPT:
            self.assertTrue((MARKETPLACE_SKILLS / name / "SKILL.md").is_file(),
                            f"{name}: decided to keep but missing from the committed payload")


if __name__ == "__main__":
    unittest.main()
