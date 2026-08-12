---
name: gh-output-is-utf8
description: "Reading `gh` output with Python subprocess text=True on this machine decodes as cp1252 and mangles em dashes; always pass encoding=\"utf-8\"."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b4f991fd-51b7-41ac-944d-56e0f4b073c3
  modified: 2026-08-01T20:21:25.555Z
---

`gh issue view --json body` emits UTF-8, but Python `subprocess.run(..., text=True)`
on this Windows box decodes with cp1252. Every `—` comes back as `â€”`. Writing that
string back with `gh issue edit --body-file` **corrupts the issue body**.

Hit on 2026-08-01: a script that ticked acceptance boxes on 14 issues mojibake'd
every em dash in all 14 bodies. Repaired with `body.encode("cp1252").decode("utf-8")`.

**Why:** the damage is silent — the script exits 0, the boxes tick correctly, and
the corruption is only visible on the rendered issue.

**How to apply:** any `subprocess.run` around `gh` (or any tool emitting UTF-8) gets
`encoding="utf-8", errors="replace"`. Before writing a fetched body back, assert
`"â€" not in body`. PowerShell `Get-Content`/console rendering shows the same
mojibake for files that are actually fine on disk — verify with Python on the bytes
before "fixing" a file. Related: [[tracker-audit-tool]].
