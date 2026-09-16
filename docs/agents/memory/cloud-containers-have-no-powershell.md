---
name: cloud-containers-have-no-powershell
description: A claude.ai/code container has no pwsh and the harness refuses to launch one, so tests/restore-test.ps1 and any .ps1 edit can only be proved on the desktop
metadata:
  type: environment
---

Verified 2026-09-16 in a fleet container while landing issue 210. `command -v pwsh` is empty, and
installing PowerShell 7 does not help: the worktree-isolation guard refuses *any* command that
invokes `pwsh` ("what it reads or is handed as shell text cannot be shown not to run git"), whether
the binary is on PATH or unpacked into the scratchpad. The marker hook's runtime probe says the same
thing on every cloud session start: `pwsh=none`.

**Why it matters:** `sync.ps1`, `lib/manifest.ps1`, `install.ps1` and `tests/restore-test.ps1` are
the pull half of this repo, and a cloud implementer can neither run the restore suite nor syntax-check
an edit to them. A branch that changes them is unverified PowerShell no matter how green the Node and
Python suites are.

**How to apply:** keep the PowerShell surface of a cloud-authored change as small as a call into a
Node or Python script that carries the logic and has its own tests; pin the wiring with a text
assertion so a later edit cannot silently drop it. Then run
`powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1` on the desktop before the change is
trusted — and say in the PR that the suite has not run yet.

Related: [[ps51-scripts-need-a-bom]], [[sed-strips-crlf-in-this-repo]]
