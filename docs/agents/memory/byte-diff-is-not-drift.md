---
name: byte-diff-is-not-drift
description: "Two copies of a file that differ by bytes and commit date are not drifted until diff --strip-trailing-cr says so; CRLF and stamp metadata made five identical contract-package files read as five edited ones (2026-10-01)"
metadata:
  node_type: memory
  type: feedback
  modified: 2026-10-01T00:00:00.000Z
---

On 2026-10-01 `diff -rq` reported five files differing between the contract-builder copy of
the aac-contract-package skill and the claude-dotfiles copy, and the dotfiles commit was newer.
That was reported to Dan as drift and he ruled on it. `diff --strip-trailing-cr` then showed
every reference file identical; only SKILL.md's four stamp keys differed. The ruling rested on a
false premise.

**Why:** this repo checks out some files CRLF and others LF ([[sed-strips-crlf-in-this-repo]]),
and the packager rewrites the stamp keys, so a byte comparison across repos finds differences
that carry no content. A commit date says when a file was touched, not what changed.

**How to apply:** before calling two copies drifted, run `diff --strip-trailing-cr` (or `git diff
--no-index --ignore-cr-at-eol`) and count content lines, excluding the `metadata:` stamp block of
a SKILL.md. Report the line count and one sample line. See also
[[verify-before-filing-a-sweep-ticket]].
