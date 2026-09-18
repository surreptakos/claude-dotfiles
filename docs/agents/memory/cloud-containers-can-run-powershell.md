---
name: cloud-containers-can-run-powershell
description: A claude.ai/code container runs the PowerShell 7.4.6 linux-x64 tarball, so this repo's .ps1 work is provable from the cloud, and the windows-latest job proves tests/restore-test.ps1 under real 5.1
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
`tests/settings-invariants.tests.ps1` — it reaches `fail 0`, exit 0 — and parse-check the rest with
`[System.Management.Automation.Language.Parser]::ParseFile`. (Issue 213 deleted the other two
suites that ran green here, `dotfiles-freshness.tests.ps1` and `sync-worktree-guard.tests.ps1`,
with the freshness loop.) Porting the logic to Node or Python to reason about it, which three
passes before issue 302 did, is no longer the move.

**What still needs the desktop:** `tests/restore-test.ps1` reads `$env:USERPROFILE` and makes
directory junctions, so it is Windows-only for reasons that have nothing to do with the engine, and
`tests/git-env-leak.tests.ps1` / `tests/settings-defaultmode.tests.ps1` stop partway for the same
reason (they spawn it, and `sync.ps1`). Say which suites ran — and do not stop at "ask the PC":
`.github/workflows/windows-restore-test.yml` runs that exact command on `windows-latest` under real
5.1 for any branch, on a pull request, a push or a dispatch, so the Windows verdict is a
`gh run view` away. The
desktop is only needed when the restore has to land over a live `~/.claude`.

Related: [[ps51-scripts-need-a-bom]], [[sed-strips-crlf-in-this-repo]],
[[cloud-only-criteria-stall-the-desktop-fleet]]
