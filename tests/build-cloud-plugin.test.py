#!/usr/bin/env python3
"""Tests for tools/build-cloud-plugin.py. Run:  python3 tests/build-cloud-plugin.test.py"""

import importlib.util
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


# Issue 432: plugin_version() is a wall clock, so every rebuild of an unchanged mirror moved
# marketplace/aac-skills/.claude-plugin/plugin.json and .claude-plugin/marketplace.json and nothing
# else - a two-file diff no content movement explained. The version now follows the payload.


class VersionFollowsThePayload(unittest.TestCase):
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

    def _rebuild(self, repo, out):
        with mock.patch.object(bcp, "REPO", repo), mock.patch.object(
                sys, "argv", ["bcp", "--from-mirror", "--home", "C:\\Users\\Dan",
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

    def test_unchanged_mirror_rebuilds_byte_identically(self):
        # The clock moves between the two rebuilds, as it does between two branches on one day.
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            self._rebuild(repo, Path(tmp) / "dist1")
            first = self._tracked(repo)
            with mock.patch.object(bcp, "plugin_version", lambda now=None: "2099.1.29999"):
                self._rebuild(repo, Path(tmp) / "dist2")
            self.assertEqual(first, self._tracked(repo),
                             "a rebuild of an unchanged mirror moved a tracked byte")

    def test_a_moved_payload_takes_a_fresh_clock_stamp(self):
        # The reuse must not outlive the content: a payload that really moved takes the UTC clock
        # reading, which is what keeps versions rising across machines and timezones.
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_fake_repo(tmp)
            self._rebuild(repo, Path(tmp) / "dist1")
            published = self._version(repo)

            skill = repo / "agents" / "skills" / "foo" / "SKILL.md"
            skill.write_text(skill.read_text(encoding="utf-8") + "\nA new paragraph.\n",
                             encoding="utf-8")
            with mock.patch.object(bcp, "plugin_version", lambda now=None: "2099.1.10000"):
                self._rebuild(repo, Path(tmp) / "dist2")
            self.assertNotEqual(published, "2099.1.10000")
            self.assertEqual(self._version(repo), "2099.1.10000",
                             "an edited skill should have taken the fresh clock stamp")


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
# entries are gone (the packager builds this payload from their mirror, and the restore test
# executes them), so a presence check would skip forever and the hook would fire zero times.
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
# runs. The live/mirror copy says ~/.claude/CLAUDE.md, true on the PC; a container has no such
# file, and the rules it summarises ship in this payload at rules/global-rules.md (issue 209). The
# packager retargets the two pointers during the copy, the way session-gate.js's CHECK path is
# retargeted, so the live hook keeps its true text and the payload copy gets its own.
class GovernanceReminderRetarget(unittest.TestCase):
    HOME_POINTER = "~/.claude/CLAUDE.md"
    PLUGIN_ROOT = REPO / "marketplace" / "aac-skills"
    PAYLOAD_SCRIPT = PLUGIN_ROOT / "hooks" / "scripts" / "governance-reminder.js"
    MIRROR_SCRIPT = REPO / "claude" / "hooks" / "governance-reminder.js"

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

    def test_payload_copy_names_the_plugin_rules_file_not_the_home_path(self):
        ctx = self._context(self.PAYLOAD_SCRIPT, self.PLUGIN_ROOT)
        self.assertNotIn(self.HOME_POINTER, ctx,
                         "payload reminder still points a container at ~/.claude/CLAUDE.md")
        rules = self.PLUGIN_ROOT / "rules" / "global-rules.md"
        self.assertTrue(rules.is_file(), "payload lost rules/global-rules.md (issue 209)")
        self.assertEqual(ctx.count(str(rules)), 2,
                         "both pointers (header and ASK-MATT line) should name the payload rules file")
        self.assertIn("GLOBAL RULES", ctx,
                      "reminder should say the rules are already in context (global-rules.js)")

    def test_payload_copy_resolves_the_rules_file_without_plugin_root(self):
        # A bare run of the payload script (no CLAUDE_PLUGIN_ROOT) still names a real file: the
        # rules sit two levels up from hooks/scripts/, the same fallback global-rules.js uses.
        ctx = self._context(self.PAYLOAD_SCRIPT)
        self.assertNotIn(self.HOME_POINTER, ctx)
        self.assertIn(str(self.PLUGIN_ROOT / "rules" / "global-rules.md"), ctx)

    def test_mirror_copy_still_names_the_home_path(self):
        # On the PC ~/.claude/CLAUDE.md is real and is where the rules live; the retarget is
        # confined to the packager's copy.
        ctx = self._context(self.MIRROR_SCRIPT)
        self.assertEqual(ctx.count(self.HOME_POINTER), 2)
        self.assertNotIn("global-rules.md", ctx)

    def test_packager_refuses_a_drifted_source(self):
        # Like the session-gate CHECK marker: if the mirror's pointer text moves, the build must
        # fail loudly rather than ship a payload that silently keeps the home path.
        body = self.MIRROR_SCRIPT.read_text(encoding="utf-8")
        with self.assertRaises(RuntimeError):
            bcp.retarget_governance_reminder(body.replace(self.HOME_POINTER, "~/elsewhere.md"))

    def test_retarget_touches_only_the_two_pointers(self):
        src = self.MIRROR_SCRIPT.read_text(encoding="utf-8")
        out = bcp.retarget_governance_reminder(src)
        # Only the two emitted strings move; the header comment keeps its history.
        self.assertNotIn("full rules in " + self.HOME_POINTER, out)
        self.assertNotIn("see the map in " + self.HOME_POINTER, out)
        self.assertIn("WHY: ~/.claude/CLAUDE.md carries the full rules", out)
        self.assertIn("RULES_FILE", out)


if __name__ == "__main__":
    unittest.main()
