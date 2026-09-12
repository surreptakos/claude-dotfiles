#!/usr/bin/env python3
"""Tests for tools/build-cloud-plugin.py. Run:  python3 tests/build-cloud-plugin.test.py"""

import importlib.util
import re
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
