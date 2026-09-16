---
name: powershell-gh-jq-output-is-array
description: "In PowerShell, `gh ... --jq .body` returns a string array; editing it as a string collapses newlines (issue body flattened 2026-09-15)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: cf5f597f-5419-455d-88b3-1e2db9b876bf
  modified: 2026-09-16T14:23:21.058Z
---

`$b = gh issue view N --json body --jq .body` in PowerShell yields a string ARRAY (one element per
line). `$b.Replace(...)` then runs per element and `[IO.File]::WriteAllText($f, $n)` joins the array
with spaces, so `gh issue edit N --body-file` writes the whole body back as one line. That flattened
issue #216's body on 2026-09-15 and had to be rebuilt by hand.

**Why:** PowerShell splits native-command stdout on newlines; nothing warns when the array is used
as a scalar.

**How to apply:** for any body/file round-trip through gh in PowerShell, either capture with
`-Raw`-style joining (`($b -join "`n")`), or do the edit in Python with `newline="\n"` and pass
`--body-file`. Verify with a `Select-String "^- \["` style check before moving on. Same trap for
`gh pr view --json body`. See [[pre-send-lint-discipline]] for the general "verify the written
artifact" rule.
