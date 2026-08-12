---
name: board-logic-source-uses-unicode-escapes
description: "board-logic.js is CRLF and writes non-ASCII as \\uXXXX escapes in code but literal chars in comments, so Edit's old_string matching fails on those lines."
metadata: 
  node_type: memory
  type: project
  originSessionId: 528157ce-5d6d-466a-bc41-357d6727bc18
  modified: 2026-08-02T18:33:53.398Z
---

`board-logic.js` writes non-ASCII **inside string literals as `×` / `·` / `→` escapes**, but the
same characters appear **literally** in the comments right above them. Any `old_string` spanning both forms
fails to match — Edit's escape/literal auto-swap converts all-or-nothing, so a mixed block never matches.
The file is also entirely CRLF.

For a multi-line block rewrite there: write the replacement to the scratchpad, then splice by line index with a
node script that `split('\r\n')`, asserts the boundary lines first, and rejoins with `'\r\n'`. Back the file up
by copying it to the scratchpad first — see [[mutation-test-backup-not-git-checkout]], `git checkout --` is
wrong on a dirty file.

Single-line edits anchored on ASCII-only text work fine with Edit. Related: [[one-owner-per-file]].
