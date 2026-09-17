---
name: cloud-containers-can-run-powershell
description: A claude.ai/code container runs the PowerShell 7.4.6 linux-x64 tarball, so three of this repo's .ps1 suites are provable from the cloud; only tests/restore-test.ps1 still needs the desktop
metadata:
  type: environment
---

Supersedes the 2026-09-16 note that said a container has no PowerShell and that installing one does
not help. Verified 2026-09-17 in a fleet container while landing issue 454: the PowerShell 7.4.6
`linux-x64` release tarball downloads through the agent proxy, runs, and runs the shipped suites.
`command -v pwsh` is still empty on a fresh container — that is the absence of an install, not a
refusal. The recipe, its four gotchas and the per-suite results are in
`docs/agents/issue-tracker.md`, section "Running the PowerShell suites in a container".

**Why it matters:** a cloud implementer editing `sync.ps1`, `lib/manifest.ps1`, `install.ps1` or a
`tests/*.ps1` file is no longer writing unverified PowerShell. Install the engine and run
`tests/settings-invariants.tests.ps1`, `tests/dotfiles-freshness.tests.ps1` and
`tests/sync-worktree-guard.tests.ps1` — all three reach `fail 0`, exit 0. Porting the logic to Node
or Python to reason about it, which three passes before issue 302 did, is no longer the move.

**What still needs the desktop:** `tests/restore-test.ps1` reads `$env:USERPROFILE` and makes
directory junctions, so it is Windows-only for reasons that have nothing to do with the engine, and
`tests/git-env-leak.tests.ps1` / `tests/settings-defaultmode.tests.ps1` stop partway for the same
reason (they spawn it, and `sync.ps1`). Say which suites ran; still ask for
`powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1` on the PC before the pull half is
trusted.

Related: [[ps51-scripts-need-a-bom]], [[sed-strips-crlf-in-this-repo]],
[[cloud-only-criteria-stall-the-desktop-fleet]]
