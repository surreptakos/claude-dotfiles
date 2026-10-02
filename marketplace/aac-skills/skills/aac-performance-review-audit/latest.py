#!/usr/bin/env python3
"""Run the review skills from the latest claude-dotfiles master, not from this installed copy.

  python3 latest.py

Prints one line: the folder of THIS skill inside a fresh copy of both review skills
(aac-performance-review-audit and aac-review-self-check) and the house writing standard, side by
side, so the audit's `../aac-review-self-check/standards.md` and `../aac-house-writing-standard/`
still resolve. Run every script and read every
reference file from that folder.

Exit 0: the copy matches master (fetched now, or already cached for master's current commit).
Exit 3: master could not be reached. It prints THIS folder instead and says why on stderr; say in
the output that the bundled copy ran, with its version.

Why: an installed plugin copy is only as new as its last update, and project-scoped installs lag
for weeks (2026-10-02: one machine carried 17 installs from 2026.9.302223 to 2026.10.22118, and a
session audited against a SEER rule replaced twice that day). Dan: the skills point to the repo.

Source, in order:
  AAC_REVIEW_SOURCE=<path to a claude-dotfiles checkout>  read with git (desktop, and the tests);
                                                          ref from AAC_REVIEW_REF, default origin/master
  otherwise                                               GitHub REST plus raw.githubusercontent.com;
                                                          GITHUB_TOKEN or GH_TOKEN is sent when set
Cache: ~/.cache/aac-review-skills/<commit>/ (AAC_REVIEW_CACHE overrides). Standard library only, so
the copy a manager uploads as a .skill runs it with nothing installed.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

REPO = "surreptakos/claude-dotfiles"
BRANCH = "master"
DIRS = ("aac-skills/aac-performance-review-audit/", "aac-skills/aac-review-self-check/",
        "aac-skills/aac-house-writing-standard/")  # the audit lints with ../aac-house-writing-standard
HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.basename(HERE)
TIMEOUT = 15


def _cache_root() -> str:
    return os.environ.get("AAC_REVIEW_CACHE") or os.path.join(os.path.expanduser("~"), ".cache", "aac-review-skills")


def _wanted(path: str) -> bool:
    return path.startswith(DIRS) and "/__pycache__/" not in path


# ---- local git source -------------------------------------------------------------------------
def _git(src: str, *args: str) -> bytes:
    return subprocess.run(["git", "-C", src, *args], check=True, capture_output=True).stdout


def _from_git(src: str):
    ref = os.environ.get("AAC_REVIEW_REF", "origin/" + BRANCH)
    sha = _git(src, "rev-parse", ref).decode().strip()
    paths = [p for p in _git(src, "ls-tree", "-r", "--name-only", sha, "--", *DIRS).decode().splitlines() if _wanted(p)]
    return sha, paths, lambda p: _git(src, "show", f"{sha}:{p}")


# ---- GitHub source ----------------------------------------------------------------------------
API_HOST = "api.github.com"
API_SCHEME = "https"


class _KeepTokenOnApiHost(urllib.request.HTTPRedirectHandler):
    """urllib carries headers across redirects; drop the token when a redirect leaves the API host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and not _is_api(newurl):
            new.remove_header("Authorization")
        return new


_OPENER = urllib.request.build_opener(_KeepTokenOnApiHost)


def _is_api(url: str) -> bool:
    u = urllib.parse.urlparse(url)
    return u.scheme == API_SCHEME and u.netloc == API_HOST


def _get(url: str, accept: str = "application/vnd.github+json") -> bytes:
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "aac-review-skills"})
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token and _is_api(url):
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with _OPENER.open(req, timeout=TIMEOUT) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code != 401 or not req.has_header("Authorization"):
            raise
        req.remove_header("Authorization")  # a stale token; the repo is public, so ask without it
        with _OPENER.open(req, timeout=TIMEOUT) as r:
            return r.read()


def _from_github():
    sha = json.loads(_get(f"https://api.github.com/repos/{REPO}/commits/{BRANCH}"))["sha"]
    tree = json.loads(_get(f"https://api.github.com/repos/{REPO}/git/trees/{sha}?recursive=1"))
    if tree.get("truncated"):
        raise RuntimeError("GitHub returned a truncated tree")
    paths = [e["path"] for e in tree["tree"] if e["type"] == "blob" and _wanted(e["path"])]
    return sha, paths, lambda p: _get(f"https://raw.githubusercontent.com/{REPO}/{sha}/{urllib.parse.quote(p)}", "*/*")


# ---- materialize ------------------------------------------------------------------------------
def fresh_copy() -> str:
    src = os.environ.get("AAC_REVIEW_SOURCE")
    sha, paths, read = _from_git(src) if src else _from_github()
    if not any(p.startswith(DIRS[0]) for p in paths) or not any(p.startswith(DIRS[1]) for p in paths):
        raise RuntimeError(f"commit {sha[:8]} does not carry both review skills")
    root = os.path.join(_cache_root(), sha)
    target = os.path.join(root, "aac-skills", SKILL)
    if os.path.isfile(os.path.join(root, ".complete")):
        return target
    os.makedirs(_cache_root(), exist_ok=True)
    tmp = tempfile.mkdtemp(prefix=sha[:12] + "-", dir=_cache_root())
    try:
        for p in paths:
            out = os.path.join(tmp, *p.split("/"))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "wb") as f:
                f.write(read(p))
        with open(os.path.join(tmp, ".complete"), "w", encoding="utf-8") as f:
            f.write(sha + "\n")
        # Never delete a complete copy: another run may be reading it. Only a folder left by an
        # interrupted run (no .complete) is cleared, and a failed rename means another run won.
        if os.path.isdir(root) and not os.path.isfile(os.path.join(root, ".complete")):
            shutil.rmtree(root, ignore_errors=True)
        try:
            os.replace(tmp, root)
        except OSError:
            shutil.rmtree(tmp, ignore_errors=True)
        if not os.path.isfile(os.path.join(root, ".complete")):
            raise RuntimeError(f"cache folder {root} is incomplete")
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return target


def main() -> int:
    try:
        print(fresh_copy())
        return 0
    except Exception as e:  # any failure falls back to the bundled copy, said out loud
        print(f"latest.py: could not reach {REPO} {BRANCH} ({type(e).__name__}: {e}); "
              f"using the bundled copy in {HERE}", file=sys.stderr)
        print(HERE)
        return 3


if __name__ == "__main__":
    sys.exit(main())
