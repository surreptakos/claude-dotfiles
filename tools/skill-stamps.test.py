#!/usr/bin/env python3
"""Tests for tools/skill-stamps.py. Run:  python3 tools/skill-stamps.test.py"""

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("skill_stamps", HERE / "skill-stamps.py")
ss = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ss)

HOME = r"C:\Users\Dan"
FOLDED = (
    "---\n"
    "name: demo\n"
    "description: >\n"
    "  Folded line one\n"
    "  folded line two.\n"
    "---\n"
    "\n# Demo\n\nBody.\n"
)


def make_skill(root, name="demo", skill_md=FOLDED, extra=None, mtime=None):
    d = Path(root) / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_bytes(skill_md.encode())
    for rel, content in (extra or {}).items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content if isinstance(content, bytes) else content.encode())
    if mtime is not None:
        for f in ss.iter_files(d):
            os.utime(f, (mtime, mtime))
    return d


class HomeForms(unittest.TestCase):
    def test_tokenize_matches_manifest_forms(self):
        text = r"C:\\Users\\Dan|/c/Users/Dan|C:/Users/Dan|C:\Users\Dan|c:\users\dan"
        self.assertEqual(
            ss.tokenize(text, HOME),
            "__USERHOME_JSON__|__USERHOME_POSIX__|__USERHOME_FWD__|__USERHOME__|__USERHOME_LC__")

    def test_detokenize_roundtrip(self):
        text = r'node "C:/Users/Dan/x.js" and C:\Users\Dan\y'
        self.assertEqual(ss.detokenize(ss.tokenize(text, HOME), HOME), text)

    def test_no_home_is_identity(self):
        self.assertEqual(ss.tokenize("C:/Users/Dan", None), "C:/Users/Dan")


class Hashing(unittest.TestCase):
    def test_eol_and_home_do_not_change_the_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = make_skill(tmp, "a", FOLDED, {"ref.md": "see C:/Users/Dan/x\n"})
            b = make_skill(tmp, "b", FOLDED.replace("\n", "\r\n"),
                           {"ref.md": "see __USERHOME_FWD__/x\r\n"})
            self.assertEqual(ss.content_sha(a, HOME), ss.content_sha(b, HOME))

    def test_stamp_keys_do_not_change_the_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = make_skill(tmp, "a")
            before = ss.content_sha(a)
            ss.stamp_skill(a)
            self.assertEqual(before, ss.content_sha(a))

    def test_body_edit_changes_the_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = make_skill(tmp, "a")
            before = ss.content_sha(a)
            (a / "SKILL.md").write_bytes(FOLDED.replace("Body.", "Body!").encode())
            self.assertNotEqual(before, ss.content_sha(a))

    def test_binary_and_noise_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = make_skill(tmp, "a", extra={"bin.docx": b"\x00\xff\xfe"})
            before = ss.content_sha(a)
            (a / "SKILL.md.bak").write_bytes(b"junk")
            (a / "__pycache__").mkdir()
            (a / "__pycache__" / "x.pyc").write_bytes(b"junk")
            self.assertEqual(before, ss.content_sha(a))
            (a / "bin.docx").write_bytes(b"\x00\xff\xfd")
            self.assertNotEqual(before, ss.content_sha(a))


class Stamping(unittest.TestCase):
    def test_first_stamp_outside_git_uses_newest_mtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = make_skill(tmp, "a", mtime=1_800_000_000)
            stamp, changed = ss.stamp_skill(a)
            self.assertTrue(changed)
            self.assertEqual(stamp["modified"], "2027-01-15T08:00:00Z")
            self.assertEqual(stamp["previous-modified"], ss.NONE)
            self.assertEqual(stamp["revision"], "1")
            self.assertEqual(ss.check_skill(a)[0], "ok")
            self.assertFalse(ss.stamp_skill(a)[1], "a second stamp must be a no-op")

    def test_textual_insert_keeps_folded_description(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = make_skill(tmp, "a")
            ss.stamp_skill(a, now="2026-09-11T00:00:00Z")
            text = (a / "SKILL.md").read_text()
            self.assertIn("description: >\n  Folded line one\n", text)
            self.assertIn('metadata:\n  modified: "2026-09-11T00:00:00Z"\n', text)
            self.assertTrue(text.endswith("\n# Demo\n\nBody.\n"))

    def test_edit_rotates_dates_and_bumps_revision(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = make_skill(tmp, "a")
            ss.stamp_skill(a, now="2026-09-01T00:00:00Z")
            (a / "SKILL.md").write_bytes((a / "SKILL.md").read_bytes().replace(b"Body.", b"Body!"))
            self.assertEqual(ss.check_skill(a)[0], "changed")
            stamp, changed = ss.stamp_skill(a, now="2026-09-11T00:00:00Z")
            self.assertTrue(changed)
            self.assertEqual(stamp["modified"], "2026-09-11T00:00:00Z")
            self.assertEqual(stamp["previous-modified"], "2026-09-01T00:00:00Z")
            self.assertEqual(stamp["revision"], "2")
            self.assertEqual(ss.check_skill(a)[0], "ok")

    def test_existing_metadata_block_is_extended_not_replaced(self):
        md = FOLDED.replace("---\n\n# Demo", "metadata:\n  argument-hint: <file>\n---\n\n# Demo")
        with tempfile.TemporaryDirectory() as tmp:
            a = make_skill(tmp, "a", md)
            ss.stamp_skill(a, now="2026-09-11T00:00:00Z")
            text = (a / "SKILL.md").read_text()
            self.assertIn("metadata:\n  argument-hint: <file>\n  modified:", text)
            fm, _l, _b = ss.read_frontmatter(text)
            self.assertEqual(fm["metadata"]["argument-hint"], "<file>")

    def test_inline_metadata_falls_back_to_redump(self):
        md = FOLDED.replace("---\n\n# Demo", "metadata: {origin: vendored}\n---\n\n# Demo")
        with tempfile.TemporaryDirectory() as tmp:
            a = make_skill(tmp, "a", md)
            ss.stamp_skill(a, now="2026-09-11T00:00:00Z")
            fm, _l, body = ss.read_frontmatter((a / "SKILL.md").read_text())
            self.assertEqual(fm["metadata"]["origin"], "vendored")
            self.assertEqual(fm["metadata"]["revision"], "1")
            self.assertEqual(fm["description"].strip(), "Folded line one folded line two.")
            self.assertEqual(body, "\n# Demo\n\nBody.\n")

    def test_crlf_source_stays_crlf(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = make_skill(tmp, "a", FOLDED.replace("\n", "\r\n"))
            ss.stamp_skill(a)
            raw = (a / "SKILL.md").read_bytes()
            self.assertNotIn(b"\r\r\n", raw)
            self.assertEqual(raw.count(b"\r\n"), raw.count(b"\n"))
            self.assertIn(b'  revision: "1"\r\n', raw)

    def test_write_false_changes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = make_skill(tmp, "a")
            before = (a / "SKILL.md").read_bytes()
            stamp, changed = ss.stamp_skill(a, write=False)
            self.assertTrue(changed)
            self.assertEqual(before, (a / "SKILL.md").read_bytes())
            self.assertEqual(ss.check_skill(a)[0], "unstamped")


class GitDates(unittest.TestCase):
    def _git(self, repo, *args, date=None):
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "t",
               "GIT_COMMITTER_EMAIL": "t@x"}
        for k in ("GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"):
            env.pop(k, None)
        if date:
            env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = date
        subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, env=env)

    def test_first_stamp_in_a_clean_repo_takes_the_last_two_commit_dates(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            self._git(repo, "init", "-q")
            a = make_skill(repo / "skills", "a")
            self._git(repo, "add", "."); self._git(repo, "commit", "-qm", "one", date="2026-09-01T10:00:00-05:00")
            (a / "SKILL.md").write_bytes(FOLDED.replace("Body.", "Body!").encode())
            self._git(repo, "add", "."); self._git(repo, "commit", "-qm", "two", date="2026-09-05T10:00:00-05:00")
            stamp, _c = ss.stamp_skill(a, repo=repo, history_paths=["skills/a"])
            self.assertEqual(stamp["modified"], "2026-09-05T15:00:00Z")
            self.assertEqual(stamp["previous-modified"], "2026-09-01T15:00:00Z")

    def test_first_stamp_with_uncommitted_edits_takes_mtime_and_last_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            self._git(repo, "init", "-q")
            a = make_skill(repo / "skills", "a")
            self._git(repo, "add", "."); self._git(repo, "commit", "-qm", "one", date="2026-09-01T10:00:00-05:00")
            (a / "SKILL.md").write_bytes(FOLDED.replace("Body.", "Body!").encode())
            os.utime(a / "SKILL.md", (1_800_000_000, 1_800_000_000))
            stamp, _c = ss.stamp_skill(a, repo=repo, history_paths=["skills/a"])
            self.assertEqual(stamp["modified"], "2027-01-15T08:00:00Z")
            self.assertEqual(stamp["previous-modified"], "2026-09-01T15:00:00Z")


class Cli(unittest.TestCase):
    def test_check_exits_1_until_stamped(self):
        with tempfile.TemporaryDirectory() as tmp:
            make_skill(Path(tmp) / "skills", "a")
            make_skill(Path(tmp) / "skills", "b")
            with open(os.devnull, "w") as devnull:
                real = sys.stdout, sys.stderr
                sys.stdout = sys.stderr = devnull
                try:
                    self.assertEqual(ss.main(["check", str(Path(tmp) / "skills")]), 1)
                    self.assertEqual(ss.main(["stamp", str(Path(tmp) / "skills")]), 0)
                    self.assertEqual(ss.main(["check", str(Path(tmp) / "skills")]), 0)
                finally:
                    sys.stdout, sys.stderr = real


if __name__ == "__main__":
    unittest.main(verbosity=1)
