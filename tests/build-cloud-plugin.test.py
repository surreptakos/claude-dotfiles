#!/usr/bin/env python3
"""Tests for tools/build-cloud-plugin.py. Run:  python3 tests/build-cloud-plugin.test.py"""

import importlib.util
import re
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
