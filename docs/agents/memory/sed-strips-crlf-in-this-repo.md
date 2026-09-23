---
name: sed-strips-crlf-in-this-repo
description: Git Bash sed -i rewrites whole-file line endings LF on this repo's CRLF files (sync.ps1 etc.) - use PowerShell string replace instead
metadata:
  type: feedback
---

Git Bash `sed -i` on a CRLF file in this repo rewrites every line ending to LF: a one-word edit to `sync.ps1` produced a 250/250-line diff (commit `a5edfdb`, fixed in `1ceae42`, 2026-08-31).

**Why:** `.gitattributes` pins `* -text`, so git converts nothing: the CRLF bytes on disk are exactly what gets committed, and sed emits LF.

**How to apply:** edit CRLF files (`.ps1`, generated JSON) with PowerShell `.Replace()` + `[System.IO.File]::WriteAllText`, or the Edit tool - never `sed -i`. After any scripted edit, check `git diff --stat`: a full-file line count means endings churned. Related: [[powershell-7-is-the-tool-engine]].
