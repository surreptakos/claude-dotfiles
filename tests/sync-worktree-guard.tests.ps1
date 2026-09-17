<#
.SYNOPSIS
    Test that sync.ps1 -Mode push refuses to run from a git worktree (issue 32).

.DESCRIPTION
    Mirrors the worktree-guard test pattern from tests\dotfiles-freshness.tests.ps1
    (push-state2 case, lines ~256-284). Stages a throwaway bare "remote" repo and a
    "local" clone, drops sync.ps1 + lib\ into the clone as tracked files, adds a
    worktree, and exercises three invocations:

      1. push from the MAIN checkout with -DryRun (fake home) - exit 0, guard NOT fired.
      2. push from the WORKTREE with -DryRun (fake home)      - exit 2, guard fired.
      3. push from the WORKTREE with -DryRun -FromWorktree    - exit 0, escape hatch works.

    Pull mode is not gated - proves push-only guard by running a pull from the worktree.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tests\sync-worktree-guard.tests.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# When these tests run under a pre-commit hook (restore-test.ps1 -> here), git may leak
# GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE into every child process. Those env vars beat
# `git -C <path>`, so every `git init` / `git add` / `git commit` against our sandbox
# repos would silently operate on the PARENT bare repo instead. Clear them once, up front.
foreach ($name in 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY') {
    if ($null -ne [Environment]::GetEnvironmentVariable($name)) {
        [Environment]::SetEnvironmentVariable($name, $null)
    }
}

# Issue 122: sandbox identity as environment, never a `git config user.*` write - a stray write
# lands in the parent checkout's .git/config and every later local commit is authored by the
# sandbox. Same shape as tests\dotfiles-freshness.tests.ps1; restore-test.ps1 check 0-pre2 is
# the guard.
$env:GIT_AUTHOR_NAME     = 'Sync WT Test'
$env:GIT_AUTHOR_EMAIL    = 'test@example.com'
$env:GIT_COMMITTER_NAME  = 'Sync WT Test'
$env:GIT_COMMITTER_EMAIL = 'test@example.com'

$TestsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $TestsRoot

# Issue 454: spawn WHICHEVER PowerShell is running this file - powershell.exe under 5.1 on the
# desktop, pwsh under 7 in a Linux container - rather than the literal 'powershell', which exists
# only on Windows. The fallback IS that literal, so the Windows path is unchanged. $env:TEMP is
# Windows-only for the same reason; GetTempPath() returns %TEMP% when it is set.
$Engine   = 'powershell'
try { $Engine = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch { }
$TempRoot = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }

$script:Pass = 0
$script:Fail = 0
$script:Detail = @()

function Assert {
    param([string]$Name, [bool]$Ok, [string]$Info = '')
    if ($Ok) {
        $script:Pass++
        Write-Host ("  ok    {0}" -f $Name) -ForegroundColor Green
    } else {
        $script:Fail++
        Write-Host ("  FAIL  {0}" -f $Name) -ForegroundColor Red
        if ($Info) { Write-Host ("        {0}" -f $Info) -ForegroundColor Red; $script:Detail += $Info }
    }
}

function New-Sandbox {
    $stamp = 'sync-wt-{0}-{1}' -f $PID, ([guid]::NewGuid().ToString('N').Substring(0, 6))
    $root  = Join-Path $TempRoot $stamp
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    return $root
}

# Git writes non-error informational text to stderr ("Cloned an empty repository",
# line-ending normalisation, hint blocks). Under $ErrorActionPreference = 'Stop' those
# become NativeCommandError terminating exceptions - the same trap sync.ps1 itself works
# around inside its commit block. Route every git call in this file through here so the
# stderr text is captured and the shell only cares about the exit code.
function Invoke-Git {
    param([Parameter(Mandatory = $true)][string[]]$GitArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git @GitArgs 2>&1 | Out-String
        return @{ Exit = $LASTEXITCODE; Out = $out }
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Invoke-Sync {
    param(
        [Parameter(Mandatory = $true)][string]$SyncPath,
        [Parameter(Mandatory = $true)][string]$UserHome,
        [Parameter(Mandatory = $true)][ValidateSet('push', 'pull')][string]$Mode,
        [switch]$FromWorktree
    )
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $SyncPath,
              '-Mode', $Mode, '-DryRun', '-UserHome', $UserHome)
    if ($FromWorktree) { $args += '-FromWorktree' }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Engine @args 2>&1 | Out-String
        $exit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    return [pscustomobject]@{ Out = $out; Exit = $exit }
}

$sandbox = New-Sandbox
try {
    $remote  = Join-Path $sandbox 'remote.git'
    $local   = Join-Path $sandbox 'local'
    $wt      = Join-Path $sandbox 'worktree'
    $home1   = Join-Path $sandbox 'home-main'
    $home2   = Join-Path $sandbox 'home-wt'

    # Bare "remote" and a working clone.
    Invoke-Git @('init', '--quiet', '--bare', $remote)             | Out-Null
    Invoke-Git @('clone', '--quiet', $remote, $local)              | Out-Null

    # Drop the current sync.ps1 + lib\ into the clone as tracked files. Both must be
    # committed so `git worktree add` checks them out into the new working tree.
    Copy-Item -Path (Join-Path $RepoRoot 'sync.ps1') -Destination (Join-Path $local 'sync.ps1') -Force
    Copy-Item -Path (Join-Path $RepoRoot 'lib')      -Destination (Join-Path $local 'lib') -Recurse -Force
    Invoke-Git @('-C', $local, 'add', 'sync.ps1', 'lib')           | Out-Null
    Invoke-Git @('-C', $local, 'commit', '--quiet', '-m', 'seed sync.ps1 + lib') | Out-Null
    Invoke-Git @('-C', $local, 'push', '--quiet', '-u', 'origin', 'HEAD') | Out-Null

    # Fresh HEAD branch name (main vs master varies with git config); read it back.
    $baseBranch = (Invoke-Git @('-C', $local, 'rev-parse', '--abbrev-ref', 'HEAD')).Out.Trim()

    # Add a worktree on a fresh feature branch (branched from base). Push its upstream so
    # any later git commands from that worktree work like a real feature branch.
    Invoke-Git @('-C', $local, 'worktree', 'add', '--quiet', '-b', 'feature/sync-wt-guard', $wt) | Out-Null
    Invoke-Git @('-C', $wt, 'push', '--quiet', '-u', 'origin', 'feature/sync-wt-guard') | Out-Null

    # Seed two throwaway home dirs. Get-DotfileItems returns items relative to UserHome;
    # DryRun push tolerates the sources being missing (Copy-Tree returns 0, Copy-OneFile
    # prints "skip missing"), so an empty home is sufficient to reach the guard and past
    # it. -Force just for idempotency; sandbox root is guaranteed fresh.
    foreach ($h in @($home1, $home2)) { New-Item -ItemType Directory -Path $h -Force | Out-Null }

    Assert 'fixture: sync.ps1 checked out in main clone'   (Test-Path (Join-Path $local 'sync.ps1')) $local
    Assert 'fixture: sync.ps1 checked out in worktree'     (Test-Path (Join-Path $wt    'sync.ps1')) $wt
    Assert 'fixture: base branch resolved'                 (-not [string]::IsNullOrWhiteSpace($baseBranch)) $baseBranch

    # ---- (1) push from the MAIN checkout: guard MUST NOT fire ------------------------
    # DryRun push from a plain checkout is the ordinary happy path. The worktree guard
    # must let this through untouched. We do not assert on the entire output, only that
    # exit=0 and the refusal string is absent - Get-DotfileItems, Save-SkillLinks and the
    # copy loops all fire against an empty home and should still exit clean.
    $r = Invoke-Sync -SyncPath (Join-Path $local 'sync.ps1') -UserHome $home1 -Mode 'push'
    Assert 'push -DryRun from main checkout exits 0' ($r.Exit -eq 0) ("exit={0}`n{1}" -f $r.Exit, $r.Out)
    Assert 'push -DryRun from main checkout does NOT emit the worktree refusal' `
        ($r.Out -notmatch 'refuses to run from a git worktree') $r.Out

    # ---- (2) push from the WORKTREE: guard MUST fire ---------------------------------
    # This is the case issue 32 refuses. Assertions: nonzero exit AND the refusal message
    # names both the RepoRoot and the git-dir suffix under /worktrees/, so an operator can
    # see WHY it was refused.
    $r = Invoke-Sync -SyncPath (Join-Path $wt 'sync.ps1') -UserHome $home2 -Mode 'push'
    Assert 'push -DryRun from worktree exits nonzero'                  ($r.Exit -ne 0)                             ("exit={0}`n{1}" -f $r.Exit, $r.Out)
    Assert 'push -DryRun from worktree emits the worktree refusal'     ($r.Out -match 'refuses to run from a git worktree') $r.Out
    Assert 'push -DryRun from worktree refusal names the git-dir path' ($r.Out -match 'worktrees')                 $r.Out
    Assert 'push -DryRun from worktree does NOT proceed to files line' ($r.Out -notmatch 'files staged in the repo') $r.Out

    # ---- (3) push from the WORKTREE with -FromWorktree: escape hatch works ----------
    # The deliberate-manual-use path. Guard MUST let this through, so exit=0 and the
    # refusal string is absent. Everything else - the mirror clear and copy loops - runs
    # in DryRun so no real side effects.
    $r = Invoke-Sync -SyncPath (Join-Path $wt 'sync.ps1') -UserHome $home2 -Mode 'push' -FromWorktree
    Assert 'push -DryRun -FromWorktree from worktree exits 0'                ($r.Exit -eq 0) ("exit={0}`n{1}" -f $r.Exit, $r.Out)
    Assert 'push -DryRun -FromWorktree from worktree bypasses the refusal'   ($r.Out -notmatch 'refuses to run from a git worktree') $r.Out

    # ---- (4) pull mode from the WORKTREE: NOT gated ---------------------------------
    # The guard is push-only by design (the ruling in issue 32 was scoped to push). Pull
    # from a worktree must not emit the refusal - the guard's own `if ($Mode -eq 'push')`
    # scope proves that, but this asserts it from the outside. Exit code is not asserted:
    # pull hits an unrelated Strict-mode bug in Restore-SkillLinks against a sandbox
    # missing skill-links.json (see discovery), and that is not what this ticket owns.
    $r = Invoke-Sync -SyncPath (Join-Path $wt 'sync.ps1') -UserHome $home2 -Mode 'pull'
    Assert 'pull -DryRun from worktree does NOT emit the worktree refusal' `
        ($r.Out -notmatch 'refuses to run from a git worktree') $r.Out

    # Tear the worktree down BEFORE the outer cleanup - git tracks it under .git/worktrees/
    # and leaves an orphaned pointer if the directory is removed out from under it.
    Invoke-Git @('-C', $local, 'worktree', 'remove', '--force', $wt) | Out-Null

} finally {
    if (Test-Path $sandbox) {
        # A left-over powershell child from a preceding assert can hold the sandbox open
        # briefly; do NOT let a cleanup lock decide the verdict.
        try { Remove-Item -Path $sandbox -Recurse -Force -ErrorAction Stop } catch {}
    }
}

Write-Host ''
Write-Host ("pass {0}  fail {1}" -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
