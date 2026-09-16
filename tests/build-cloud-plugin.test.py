#!/usr/bin/env python3
"""Tests for tools/build-cloud-plugin.py. Run:  python3 tests/build-cloud-plugin.test.py"""

import importlib.util
import json
import re
import shutil
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


class PluginVersion(unittest.TestCase):
    def test_utc_instant_formats_year_month_day_hhmm(self):
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


# Regression guard for issue 237: --from-mirror wrote its rotated stamps into a tempdir copy of
# the mirror and threw them away when the run ended, so the mirror SKILL.md kept its stale hash
# and CI's stale check went red. The write-back must land on the real mirror path.
STALE_MIRROR_SKILL = """---
name: foo
description: A regression fixture for from-mirror stamp write-back.
metadata:
  modified: "2026-01-01T00:00:00Z"
  previous-modified: "none"
  revision: "1"
  content-sha: "deadbeefdead"
---

# Foo

A body that no longer matches the recorded content-sha above.
"""


class FromMirrorStampWriteBack(unittest.TestCase):
    def _make_fake_repo(self, tmp):
        repo = Path(tmp) / "repo"
        (repo / "agents" / "skills" / "foo").mkdir(parents=True)
        (repo / "claude" / "skills").mkdir(parents=True)
        (repo / "agents" / "skills" / "foo" / "SKILL.md").write_text(
            STALE_MIRROR_SKILL, encoding="utf-8")
        (repo / "claude" / "skill-links.json").write_text(
            json.dumps([{"Name": "foo", "Target": "__USERHOME__\\.agents\\skills\\foo"}]),
            encoding="utf-8")
        return repo

    def _run(self, repo, argv):
        with mock.patch.object(bcp, "REPO", repo), mock.patch.object(sys, "argv", ["bcp", *argv]):
            return bcp.main()

    def test_from_mirror_restamps_agents_skills_mirror_in_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            out = Path(tmp) / "dist"
            mirror_skill = repo / "agents" / "skills" / "foo" / "SKILL.md"
            before = mirror_skill.read_text(encoding="utf-8")

            rc = self._run(repo, [
                "--from-mirror", "--home", "C:\\Users\\Dan",
                "--out", str(out), "--no-marketplace",
            ])
            self.assertEqual(rc, 0)

            after = mirror_skill.read_text(encoding="utf-8")
            self.assertNotEqual(after, before,
                                "mirror SKILL.md should have been restamped on disk")
            fm = yaml.safe_load(bcp.split_frontmatter(after.replace("\r\n", "\n"))[0]) or {}
            meta = fm.get("metadata") or {}
            self.assertNotEqual(meta.get("content-sha"), "deadbeefdead",
                                "content-sha did not rotate; write-back missed the mirror")
            self.assertEqual(meta.get("previous-modified"), "2026-01-01T00:00:00Z",
                             "previous-modified should carry the pre-restamp modified value")
            self.assertEqual(meta.get("revision"), "2",
                             "revision should bump by one when the hash rotates")

    def test_no_stamp_write_second_rebuild_reproduces_committed_payload(self):
        # After the first rebuild has written the new stamp back to the mirror, a second rebuild
        # with --no-stamp-write must emit the same plugin payload (CI's determinism check).
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            first_out = Path(tmp) / "dist1"
            second_out = Path(tmp) / "dist2"

            self.assertEqual(self._run(repo, [
                "--from-mirror", "--home", "C:\\Users\\Dan",
                "--out", str(first_out), "--no-marketplace",
            ]), 0)
            self.assertEqual(self._run(repo, [
                "--from-mirror", "--home", "C:\\Users\\Dan", "--no-stamp-write",
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


# Issue 172: aac-google-access started life as a personal skill, so the only copy of it in this
# repo was the generated claude/ mirror -- which no branch may hand-edit. Moving the source into
# the hand-edited aac-skills/ tree is the only way a cloud branch can revise such a skill, and for
# as long as the owner's personal copy still exists both trees hold the name. That overlap used to
# fail the build outright, so the move could not land in one commit. The team copy must win, and
# exactly one copy must ship.
TEAM_SKILL = """---
name: foo
description: The hand-edited team source, which supersedes the mirrored personal copy.
---

# Foo (team)
"""

PERSONAL_SKILL = """---
name: foo
description: The mirrored personal copy, stale during the migration window.
---

# Foo (personal)
"""


class AacSkillsSupersedesMirroredPersonalCopy(unittest.TestCase):
    def test_team_source_ships_and_the_build_still_succeeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            (repo / "claude" / "skills" / "foo").mkdir(parents=True)
            (repo / "claude" / "skills" / "foo" / "SKILL.md").write_text(
                PERSONAL_SKILL, encoding="utf-8")
            (repo / "aac-skills" / "foo").mkdir(parents=True)
            (repo / "aac-skills" / "foo" / "SKILL.md").write_text(TEAM_SKILL, encoding="utf-8")
            out = Path(tmp) / "dist"

            with mock.patch.object(bcp, "REPO", repo), mock.patch.object(
                    sys, "argv", ["bcp", "--from-mirror", "--home", "C:\\Users\\Dan",
                                  "--out", str(out), "--no-marketplace"]):
                rc = bcp.main()

            self.assertEqual(rc, 0, "the name in both trees must not fail the build")
            body = (out / bcp.PLUGIN_NAME / "skills" / "foo" / "SKILL.md").read_text(
                encoding="utf-8")
            self.assertIn("# Foo (team)", body,
                          "the hand-edited aac-skills/ source must be the copy that ships")
            self.assertNotIn("# Foo (personal)", body)


if __name__ == "__main__":
    unittest.main()
