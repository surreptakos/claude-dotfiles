<#
.SYNOPSIS
    Prove the restore path works, without a second machine.

.DESCRIPTION
    A fresh machine differs from this one in exactly two ways that matter here: it has no
    ~/.claude or ~/.codex, and its home directory is spelled with a different username. Both
    are simulable, because sync.ps1 and install.ps1 already take -UserHome.

    So: clone the REMOTE (not the working tree - the question is whether what was pushed
    restores), install it into a fake home under a different username, and check the result.
    The fake home lives outside the real profile on purpose: any occurrence of the real home
    path in a restored file is then unambiguously a leak, not the scratch directory's own name.

    Checks, in order:
      0  the clone materialized the exact bytes that were pushed (clone modes only)
      1  install.ps1 exits 0
      2  every whitelisted item landed, with the same file count as the repo
      3  memory slugs were de-tokenized back into real project directory names
      4  no __USERHOME* token survives in any restored file
      5  no real-home path survives in any restored file
      6  settings.json parses, and every absolute path in it points inside the fake home
      7  round trip is lossless: re-tokenizing each restored file reproduces the repo file
      8  nothing credential-shaped was restored (the guard, pointed at the output)
      9  the restored hooks and skills actually RUN from their new home
     10  two overlapping runs do not delete each other's scratch directory

    Check 9 is the one that separates this from a file-copy test. Everything up to 8 proves
    bytes moved; only 9 proves the machine would work.

    Check 10 exists because the scratch root used to be a constant, and the whole of it is
    deleted at startup. Two runs that overlap - the SessionStart hook and the first
    UserPromptSubmit hook, 8 seconds apart on 2026-08-13 - therefore wiped each other mid-run and
    BOTH reported failure on a repo that was fine. A false failure on session start is worse than
    no check, because it teaches the reader to ignore the real one. The scratch root is now derived
    per run, so concurrent runs never share a directory.

    -Fault injects a known break so a check can be watched going red. A monitor that has only
    ever passed is not yet a monitor. Every fault is expected to exit 1; see the table in the
    param block for which check each one is aimed at.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1
    powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1 -From local -Keep
    powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1 -Fault home-leak
#>
[CmdletBinding()]
param(
    # origin   clone the pushed remote - the honest test, and the one to run before trusting a restore
    # local    clone this checkout's committed state, for iterating before pushing
    # worktree copy what git currently sees (index + working tree), no clone and no network. This is
    #          the automation mode: a pre-commit gate that cloned HEAD would be testing the PREVIOUS
    #          commit, and CI cannot clone a private remote from inside the runner.
    [ValidateSet('origin', 'local', 'worktree')][string]$From = 'origin',

    # Empty means "derive one per run", which is what keeps concurrent runs apart. Passing a path
    # explicitly pins it, and two runs given the SAME path still collide - that is the escape hatch
    # check 10 uses to watch itself fail.
    [string]$FakeHome = '',
    [switch]$Keep,

    # Deliberate breakage, to watch a check fail:
    #   missing      a whitelisted file never made it into the repo   -> check 2
    #   crlf         the clone's bytes differ from the pushed bytes   -> check 0
    #   home-leak    a file was copied without going through Copy-OneFile -> check 5
    #   secret       a credential value reached the repo              -> check 8
    #   drift        a restored file does not round-trip              -> check 7
    #   broken-hook  a restored hook is present but not runnable      -> check 9
    #   dead-link    a junctioned skill's target never travelled      -> check 6b
    #   collision    two overlapping runs share one scratch root      -> check 10
    #   locked-scratch  the scratch cannot be deleted at the end      -> verdict must stay 0
    #   lint-root    unsuppressed finding planted in the root CLAUDE.md   -> claude-md-lint gate
    #   lint-mirror  unsuppressed finding planted in claude/CLAUDE.md     -> claude-md-lint gate
    #   sandbox-identity  the test suites' user.email is what this checkout would commit as -> check 0-pre2
    [ValidateSet('none', 'missing', 'crlf', 'home-leak', 'secret', 'drift', 'broken-hook', 'dead-link',
                 'collision', 'locked-scratch', 'lint-root', 'lint-mirror', 'sandbox-identity')]
    [string]$Fault = 'none',

    # Internal, used by check 10. Runs ONLY the scratch-root setup - derive, wipe, create - then
    # holds a marker file for -ProbeHoldMs and reports whether it survived. That is the exact code
    # path that used to clobber a concurrent run, without paying for a second full install.
    [switch]$Probe,
    [int]$ProbeHoldMs = 2000,

    # Internal, used by tests/git-env-leak.tests.ps1. Runs ONLY the file-scope GIT_* clear and the
    # bootstrap file-copy path (git ls-files for -From worktree, git clone for the others), reports
    # the tracked-file count, then exits before any of the 21 checks run. That is the exact code
    # path that -- pre-2026-08-25 -- silently returned zero files under a leaked GIT_DIR and made
    # the whole restore-test crash on 'The property Count cannot be found on this object'. A green
    # BootstrapOnly run under leak proves the file-scope clear works; a red one prints the leak.
    [switch]$BootstrapOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SelfPath = $MyInvocation.MyCommand.Path
$RealHome = $env:USERPROFILE.TrimEnd('\', '/')

# Issue 28: the pre-commit hook runs this suite as a child of `git commit`, which exports
# GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE / GIT_COMMON_DIR / GIT_OBJECT_DIRECTORY. Those env
# vars OVERRIDE `git -C <path>` - git honours them first, and -C only relocates its path
# resolution when they are unset. Without clearing them here, the bootstrap `git -C $RepoRoot
# ls-files` a few lines below silently reads the parent commit's index (0 files instead of
# ~586), the -From origin/local clones fail, and every helper the suite spawns later inherits
# the same leak. Clear the five vars at file scope, BEFORE any git call and BEFORE the source
# of lib/manifest.ps1 (which defines Clear-GitEnv - but manifest.ps1 lives in $Clone, not
# $RepoRoot, so we can't use it before the clone exists). Done unconditionally: the suite
# never uses those vars for itself, so there is nothing to restore before exit.
foreach ($name in 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY') {
    if ($null -ne [Environment]::GetEnvironmentVariable($name)) {
        [Environment]::SetEnvironmentVariable($name, $null)
    }
}

# Check 9 runs the RESTORED session-check inside the clone, and session-check runs whatever the
# repo's .claude/session.json names as its test command - this suite. So every run used to restore
# a copy of the repo and then test that copy, several scratch directories deep, and the nested
# session-check processes outlived their parents holding the clone open. While the scratch root was
# a constant the nested run wiped its own parent's directory, which broke the recursion by breaking
# the run. One env var stops the descent without changing what check 9 proves: the restored
# session-check still runs and still reports, it just does not restore the world again.
if ($env:RESTORE_TEST_ACTIVE -and -not $Probe) {
    Write-Host ("Nested restore-test skipped - already inside run {0}." -f $env:RESTORE_TEST_ACTIVE)
    Write-Host 'pass 0'
    Write-Host 'fail 0'
    exit 0
}
$env:RESTORE_TEST_ACTIVE = $PID

$ScratchBase = 'C:\dotfiles-restore-test'
if (-not $FakeHome) {
    # Per run, not per machine. The whole of $FakeRoot is deleted below, so two runs sharing it
    # destroy each other; the pid plus a random tail keeps them apart even when the pid is reused.
    $runId    = "run-{0}-{1}" -f $PID, ([guid]::NewGuid().ToString('N').Substring(0, 6))
    $FakeHome = Join-Path $ScratchBase ("{0}\Users\Restored" -f $runId)
}

# The script deletes $FakeHome outright. Anything inside the real profile is off limits, or a
# typo in -FakeHome turns this test into a way to lose the configuration it is testing.
if ($FakeHome.TrimEnd('\').ToLower().StartsWith($RealHome.ToLower())) {
    Write-Host "-FakeHome must be outside $RealHome - it gets deleted." -ForegroundColor Red
    exit 2
}

$FakeRoot = Split-Path -Parent (Split-Path -Parent $FakeHome)   # C:\dotfiles-restore-test\run-...
$Clone    = Join-Path $FakeRoot 'clone'

# ------------------------------------------------------------------ probe mode (check 10's child)

if ($Probe) {
    if (Test-Path $FakeRoot) { Remove-Item -Path $FakeRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $FakeRoot -Force | Out-Null
    $marker = Join-Path $FakeRoot ("probe-{0}.marker" -f $PID)
    Set-Content -Path $marker -Value $PID -Encoding utf8
    Start-Sleep -Milliseconds $ProbeHoldMs
    $intact = Test-Path $marker
    Write-Host ("probe {0} root {1} {2}" -f $PID, $FakeRoot, $(if ($intact) { 'intact' } else { 'CLOBBERED' }))
    if (-not $Keep) { Remove-Item -Path $FakeRoot -Recurse -Force -ErrorAction SilentlyContinue }
    if ($intact) { exit 0 }
    exit 1
}

# A run that crashed, one kept with -Keep, or one whose scratch was still locked at cleanup leaves
# its directory behind. Sweep only what is old enough that no live run can own it: a run takes
# about 15 seconds, so an hour is far past any sibling still in flight.
if (Test-Path $ScratchBase) {
    Get-ChildItem -Path $ScratchBase -Directory -Filter 'run-*' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-1) } |
        ForEach-Object { Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}

$script:Failures = 0
$script:Checks   = 0
$script:FailLog  = @()

function Check {
    param([string]$Name, [bool]$Ok, [string[]]$Detail = @())
    $script:Checks++
    if ($Ok) {
        Write-Host ("  ok    {0}" -f $Name)
    } else {
        $script:Failures++
        Write-Host ("  FAIL  {0}" -f $Name) -ForegroundColor Red
        $Detail | Select-Object -First 12 | ForEach-Object { Write-Host ("          {0}" -f $_) -ForegroundColor Red }
        # Kept as well as printed: the session hooks run this through execFileSync and report only
        # "tests FAIL", so a failure seen by a hook has no output anywhere unless it is written down.
        $script:FailLog += ("FAIL  " + $Name)
        $script:FailLog += ($Detail | Select-Object -First 12 | ForEach-Object { "        " + $_ })
    }
}

function Note { param([string]$Text) Write-Host ("  note  {0}" -f $Text) -ForegroundColor DarkGray }

# ------------------------------------------------------------------ set the stage

Write-Host ''
Write-Host ("RESTORE TEST   real home {0}   fake home {1}" -f $RealHome, $FakeHome)
Write-Host ''

if (Test-Path $FakeRoot) { Remove-Item -Path $FakeRoot -Recurse -Force }
New-Item -ItemType Directory -Path $FakeRoot -Force | Out-Null

if ($From -eq 'worktree') {
    # git ls-files rather than a directory copy: it is exactly what git sees, so it picks up
    # staged changes (what a pre-commit gate must test) while excluding ignored paths and
    # .claude/worktrees, which holds whole checkouts of this same repo.
    Write-Host ("Copying the working tree from {0}" -f $RepoRoot)
    $listed = & git -C $RepoRoot ls-files
    if ($LASTEXITCODE -ne 0) { Write-Host 'git ls-files failed.' -ForegroundColor Red; exit 2 }
    foreach ($relative in $listed) {
        # NOT $from: PowerShell variable names are case-insensitive, so $from IS the -From
        # parameter, and assigning a path to it fails its ValidateSet.
        $src = Join-Path $RepoRoot ($relative -replace '/', '\')
        if (-not (Test-Path $src)) { continue }   # staged deletion
        $dst    = Join-Path $Clone ($relative -replace '/', '\')
        $parent = Split-Path $dst -Parent
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -Path $src -Destination $dst -Force
    }
    Write-Host ("  {0} tracked files" -f $listed.Count)
} else {
    $source = $RepoRoot
    if ($From -eq 'origin') {
        $source = (git -C $RepoRoot remote get-url origin)
        if ($LASTEXITCODE -ne 0) { Write-Host 'No origin remote.' -ForegroundColor Red; exit 2 }
    }
    Write-Host ("Cloning {0}" -f $source)
    git clone --quiet --depth 1 $source $Clone
    if ($LASTEXITCODE -ne 0) { Write-Host 'Clone failed.' -ForegroundColor Red; exit 2 }
    Write-Host ("  at {0}" -f (git -C $Clone log --oneline -1))
}
Write-Host ''

if ($BootstrapOnly) {
    # Issue 28. The whole point of this switch is to prove the file-scope GIT_* clear at the top of
    # this file protects the bootstrap `git -C $RepoRoot ls-files` / `git clone` calls from a leaked
    # GIT_DIR. If we got here, the ls-files/clone succeeded; report the file count and exit. A count
    # of zero means the leak went through: git honoured GIT_DIR over -C, and the "target" ls-files
    # was actually reading the leaked repo's empty index.
    $cloneFiles = @(Get-ChildItem -Path $Clone -Recurse -File -ErrorAction SilentlyContinue)
    Write-Host ("BOOTSTRAP OK   {0} files in clone" -f $cloneFiles.Count)
    if ($cloneFiles.Count -lt 1) { exit 3 }   # leak got through - the count reveals it
    exit 0
}

. (Join-Path $Clone 'lib\manifest.ps1')

# ------------------------------------------------------------------ 0-pre. worktrees guard (issue 238)

# .claude/worktrees hosts this repo's own concurrent agent checkouts. Two gitlink entries
# (mode 160000) once slipped onto master when a `git add .` from the parent checkout captured
# worktree directories as submodules. That broke every Actions run with
# `No url found for submodule path` and this test's clone-fidelity pass (a gitlink cannot be
# hash-object'd). .gitignore is the primary block; this check is the backstop for a `git add -f`
# regression and catches the fault in `-From worktree` (pre-commit) as well as against `-From
# origin`/`local`.
Write-Host 'Worktrees guard (issue 238)'
$wtGitRepo = if ($From -eq 'worktree') { $RepoRoot } else { $Clone }
$wtEntries = @(& git -C $wtGitRepo ls-files -s -- .claude/worktrees 2>$null)
Check 'no .claude/worktrees entries in the tracked tree' `
    ($wtEntries.Count -eq 0) $wtEntries
Write-Host ''

# ------------------------------------------------------------------ 0-pre2. sandbox identity guard (issue 122)

# The PowerShell test suites commit into throwaway repos as "Test <test@example.com>". Twice
# (2026-08-25 and again by 2026-08-28) that identity landed in the PARENT checkout's .git/config
# instead, and every local commit for the following fortnight - sync pushes, session-start
# captures, feature work, 39 on master by 2026-09-10 - was authored by the sandbox. Check 9c
# only proves the config file is unchanged ACROSS a test run, so it passes when the pollution
# is already there. This reads the identity git would stamp on the next commit from this
# checkout - the same lookup `git commit` does, across config.worktree, the common config and
# --global - and refuses to call the restore proven while it is the sandbox one. Always against
# $RepoRoot: the clone is never committed from, this checkout is. The suites themselves no
# longer write user.* into any config file (identity travels as GIT_AUTHOR_* / GIT_COMMITTER_*
# env, which has no file to land in), so a red here means a NEW writer has appeared.
Write-Host 'Sandbox identity guard (issue 122)'
if ($Fault -eq 'sandbox-identity') {
    # Inject the sandbox identity for this one read the way git itself takes overrides
    # (GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n, git 2.31+), so the fault never
    # writes to the real config file - which is the very thing the check exists to catch.
    $env:GIT_CONFIG_COUNT   = '1'
    $env:GIT_CONFIG_KEY_0   = 'user.email'
    $env:GIT_CONFIG_VALUE_0 = 'test@example.com'
    Note 'fault: sandbox identity injected as the effective user.email'
}
$identityEmail  = (& git -C $RepoRoot config --get user.email | Out-String).Trim()
$identityName   = (& git -C $RepoRoot config --get user.name  | Out-String).Trim()
$identityOrigin = @(& git -C $RepoRoot config --show-origin --get-all user.email)
if ($Fault -eq 'sandbox-identity') {
    Remove-Item -Path Env:GIT_CONFIG_COUNT, Env:GIT_CONFIG_KEY_0, Env:GIT_CONFIG_VALUE_0 -ErrorAction SilentlyContinue
}
Check 'this checkout would not commit as the sandbox identity' `
    ($identityEmail -ne 'test@example.com') `
    (@(("effective identity: {0} <{1}>" -f $identityName, $identityEmail)) + $identityOrigin +
     @('remove user.email and user.name at the scope shown (git config --unset), then re-run'))
Write-Host ''

# ------------------------------------------------------------------ 0. inject the fault

if ($Fault -eq 'crlf') {
    # What an unpinned checkout under core.autocrlf=true did to every LF file: rewrite the
    # bytes on the way out of git. Flip one cloned file's endings, whichever way they point.
    $victim = Join-Path $Clone 'claude\CLAUDE.md'
    $text   = [System.IO.File]::ReadAllText($victim)
    if ($text.Contains("`r`n")) { $text = $text.Replace("`r`n", "`n") }
    else                        { $text = $text.Replace("`n", "`r`n") }
    [System.IO.File]::WriteAllText($victim, $text, (New-Object System.Text.UTF8Encoding($false)))
    Note 'fault: flipped the line endings of a cloned file'
}
if ($Fault -eq 'home-leak') {
    # What a copy that bypassed Copy-OneFile would leave behind: this machine's home, verbatim.
    Set-Content -Path (Join-Path $Clone 'claude\skills\leak-probe.md') `
                -Value ("Log at {0}\.claude\hook-state\probe.log" -f $RealHome) -Encoding utf8
    Note 'fault: planted a raw real-home path in the repo'
}
if ($Fault -eq 'secret') {
    # Assembled rather than written out, because a literal credential pair in this file would
    # trip the repo's own secret guard on the next push - which is the guard working correctly.
    $pair = '{ "' + 'refresh' + '_token": "' + ('A1b2C3d4E5' * 3) + '" }'
    Set-Content -Path (Join-Path $Clone 'claude\skills\secret-probe.json') -Value $pair -Encoding utf8
    Note 'fault: planted a credential value in the repo'
}
if ($Fault -eq 'dead-link') {
    # Has to be a directory something actually links TO. agents/skills holds more skills than
    # ~/.claude/skills junctions to, so picking the first directory there hits a non-linked one
    # and the fault quietly does nothing - which it did, the first time.
    $link   = (Read-JsonArray -Path (Join-Path $Clone 'claude\skill-links.json'))[0]
    $victim = Join-Path $Clone ('agents\skills\' + (Split-Path $link.Target -Leaf))
    Remove-Item -Path $victim -Recurse -Force
    Note ('fault: removed a junction target from the repo - ' + $link.Name)
}
Write-Host ''

# ------------------------------------------------------------------ 0. clone is byte-faithful

# The repo's promise is that a clone materializes the bytes sync.ps1 pushed. It did not always:
# with core.autocrlf=true (this machine's global git config) and no .gitattributes, checkout
# rewrote every LF text file to CRLF - so a new machine restored byte-different files, and the
# clone-vs-restored comparisons below could not see it because both sides were rewritten alike.
# Compare each working-tree file's raw bytes (--no-filters) against the blob git stored; any
# conversion on the way out of git is a hash mismatch. Worktree mode copies files without a
# checkout, so there is nothing to compare there.
Write-Host 'Clone fidelity'
if ($From -eq 'worktree') {
    Note 'worktree mode copies files without a git checkout - no conversion possible'
} else {
    $tracked = @(& git -C $Clone ls-files -s | ForEach-Object {
        $meta, $path = $_ -split "`t", 2
        [pscustomobject]@{ Sha = ($meta -split ' ')[1]; Path = $path }
    })
    # Not piped from PowerShell: 5.1 can prepend a BOM to the first line it feeds a native
    # process ("could not open '<BOM>.caveman.json'", observed while building this check), so
    # the path list travels through a BOM-free file and a cmd redirect.
    $listFile = Join-Path $FakeRoot 'tracked-paths.txt'
    [System.IO.File]::WriteAllLines($listFile, @($tracked | ForEach-Object { $_.Path }),
                                    (New-Object System.Text.UTF8Encoding($false)))
    $actual = @(cmd /c "git -C ""$Clone"" hash-object --no-filters --stdin-paths < ""$listFile""")
    $rewritten = @()
    for ($i = 0; $i -lt $tracked.Count; $i++) {
        if ($i -ge $actual.Count -or $actual[$i] -ne $tracked[$i].Sha) { $rewritten += $tracked[$i].Path }
    }
    Check ("all {0} cloned files carry the exact bytes that were pushed" -f $tracked.Count) `
        (($tracked.Count -gt 0) -and ($rewritten.Count -eq 0)) $rewritten
}
Write-Host ''

# ------------------------------------------------------------------ 0b. seed a personal profile

# Issue #9: pull refreshes ~/.claude-personal when it exists, and must not create one when it
# does not. A fresh fake home would exercise only the skip path, which proves nothing about the
# refresh - so seed a minimal personal profile carrying exactly what the refresh must preserve:
# a personal pref in settings.json, a stale hooks key that must be replaced and rewritten, and a
# personal-only memory file with its own MEMORY.md pointer line. The checks in section 6c read
# these back after the install.
$FakePersonal = Join-Path $FakeHome '.claude-personal'
New-Item -ItemType Directory -Path (Join-Path $FakePersonal 'hooks') -Force | Out-Null
$seedSettings = @'
{
  "model": "personal-model-pref",
  "fastMode": true,
  "hooks": {
    "SessionStart": [ { "hooks": [ { "type": "command", "command": "node \"__FAKEHOME__\\.claude-personal\\hooks\\stale.js\"" } ] } ]
  }
}
'@.Replace('__FAKEHOME__', $FakeHome.Replace('\', '\\'))
[System.IO.File]::WriteAllText((Join-Path $FakePersonal 'settings.json'), $seedSettings,
                               (New-Object System.Text.UTF8Encoding($false)))

# Issue 40: seed a stale CLAUDE.md at the personal path with distinct bytes so the refresh's
# removal step is exercised. Section 6b4 asserts that (a) this file is gone after pull, so a
# CLAUDE_CONFIG_DIR=~/.claude-personal session does NOT double-load global memory, and (b) the
# work-profile CLAUDE.md at ~/.claude/CLAUDE.md survives (the reopen constraint: never delete
# the active-profile source of truth as an "orphan"). The stale marker ends up in the personal
# refresh backup dir, whose presence check lives in section 6c.
Set-Content -Path (Join-Path $FakePersonal 'CLAUDE.md') `
            -Value "STALE personal CLAUDE.md - issue 40 refresh must remove this file, not keep it in sync" `
            -Encoding utf8

# The seed memory lives under a slug the work profile also restores, so the union merge runs on it.
$seedSourceDir = Get-ChildItem -Path (Join-Path $Clone 'memory') -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'MEMORY.md') } | Select-Object -First 1
$seedSlug = ''
$seedMem  = ''
if ($null -ne $seedSourceDir) {
    $seedSlug = ConvertFrom-TokenSlug -Slug $seedSourceDir.Name -UserHome $FakeHome
    $seedMem  = Join-Path $FakePersonal ("projects\" + $seedSlug + "\memory")
    New-Item -ItemType Directory -Path $seedMem -Force | Out-Null
    Set-Content -Path (Join-Path $seedMem 'personal-only-note.md') `
                -Value 'personal-only memory - must survive the refresh untouched' -Encoding utf8
    Set-Content -Path (Join-Path $seedMem 'MEMORY.md') `
                -Value '- [Personal-only note](personal-only-note.md) - stays out of the work profile' -Encoding utf8
}

# ------------------------------------------------------------------ 1. run the installer

$log = Join-Path $FakeRoot 'install.log'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Clone 'install.ps1') `
    -UserHome $FakeHome *> $log
$installExit = $LASTEXITCODE

Write-Host 'Install'
Check 'install.ps1 exits 0' ($installExit -eq 0) @(Get-Content $log -Tail 15)

# Post-install faults: breakage the restore itself would have to catch, which cannot be staged
# in the repo because the repo is the thing being restored FROM.
if ($Fault -eq 'missing') {
    $victim = Get-ChildItem -Path (Join-Path $FakeHome '.claude\projects') -Recurse -File | Select-Object -First 1
    Remove-Item $victim.FullName -Force
    Note ('fault: deleted a restored file - ' + $victim.Name)
}
if ($Fault -eq 'drift') {
    Add-Content -Path (Join-Path $FakeHome '.claude\CLAUDE.md') -Value 'appended after restore'
    Note 'fault: a restored file no longer matches the repo'
}
if ($Fault -eq 'broken-hook') {
    Set-Content -Path (Join-Path $FakeHome '.claude\hooks\session-gate.js') `
                -Value 'throw new Error("restored hook is broken");' -Encoding utf8
    Note 'fault: a restored hook is present but not runnable'
}

# Pair every repo file with where it should have landed. Everything below reads this list, so a
# path convention that changes only has to change here.
$pairs = @()
foreach ($item in (Get-DotfileItems -RepoRoot $Clone -UserHome $FakeHome)) {
    $repoPath = Join-Path $Clone ($item.Repo -replace '/', '\')
    if ($item.Type -eq 'File') {
        $pairs += [pscustomobject]@{ Repo = $repoPath; Local = $item.Local; Group = $item.Repo }
    } elseif (Test-Path $repoPath) {
        Get-ChildItem -Path $repoPath -Recurse -File | ForEach-Object {
            $relative = $_.FullName.Substring($repoPath.Length).TrimStart('\')
            if (Test-Excluded -RelativePath $relative) { return }
            $pairs += [pscustomobject]@{
                Repo  = $_.FullName
                Local = (Join-Path $item.Local $relative)
                Group = $item.Repo
            }
        }
    }
}

$memoryRoot = Join-Path $Clone 'memory'
$memoryDirs = @()
if (Test-Path $memoryRoot) {
    $memoryDirs = Get-ChildItem -Path $memoryRoot -Directory
    foreach ($dir in $memoryDirs) {
        $slug   = ConvertFrom-TokenSlug -Slug $dir.Name -UserHome $FakeHome
        $target = Join-Path $FakeHome (".claude\projects\" + $slug + "\memory")
        Get-ChildItem -Path $dir.FullName -Recurse -File | ForEach-Object {
            $relative = $_.FullName.Substring($dir.FullName.Length).TrimStart('\')
            if (Test-Excluded -RelativePath $relative) { return }
            $pairs += [pscustomobject]@{
                Repo  = $_.FullName
                Local = (Join-Path $target $relative)
                Group = 'memory'
            }
        }
    }
}

# ------------------------------------------------------------------ 2. everything landed

Write-Host ''
Write-Host 'Files'
$missing = @($pairs | Where-Object { -not (Test-Path $_.Local) } | ForEach-Object { $_.Local })
Check ("all {0} whitelisted files exist under the fake home" -f $pairs.Count) ($missing.Count -eq 0) $missing

# Restoring more than the repo carries would mean the installer invented something; restoring
# fewer is caught above. Both are worth knowing. The personal profile is excluded here - it is
# a refresh target seeded by this test, not a whitelisted restore - and gets its own checks in
# section 6c (the exclusion also covers ~/.claude-personal-refresh-backup-<stamp>).
$restored = @(Get-ChildItem -Path $FakeHome -Recurse -File -ErrorAction SilentlyContinue |
              Where-Object { $_.FullName -notlike '*\.claude-dotfiles-backup-*' -and
                             $_.FullName -notlike '*\.claude-personal*' -and
                             # Issue 12: sync.ps1 writes ~/.claude/hook-state/dotfiles-sync/state.json
                             # on every pull. Runtime state, not a whitelisted restore - stays out of
                             # the file-count assertion the same way the backup and the personal
                             # profile do.
                             $_.FullName -notlike '*\.claude\hook-state\*' -and
                             # Issue 199: sync.ps1 -Mode pull invokes tools/settings-invariants.ps1
                             # -Trust, which lands (and if absent, seeds) ~/.claude.json with the
                             # four master-watchdog trust records. Machine-local state Claude Code
                             # owns, deliberately outside the sync manifest, so it also stays out
                             # of the whitelist count. Its content is asserted separately below.
                             $_.FullName -ne (Join-Path $FakeHome '.claude.json') -and
                             $_.FullName -notlike '*\.claude.json.bak-*' })
Check 'no files beyond the whitelist were written' ($restored.Count -eq $pairs.Count) `
    @(("repo pairs {0}, restored {1}" -f $pairs.Count, $restored.Count))

# ------------------------------------------------------------------ 3. slugs de-tokenized

Write-Host ''
Write-Host 'Path templating'
$stillTokenised = @(Get-ChildItem -Path $FakeHome -Recurse -Directory -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -like '*__USERHOME*' } | ForEach-Object { $_.FullName })
Check 'no memory directory kept its __USERHOME_SLUG__ name' ($stillTokenised.Count -eq 0) $stillTokenised

$fakeSlug = (Get-HomeForms -UserHome $FakeHome).Slug
$badSlug  = @()
foreach ($dir in $memoryDirs) {
    $slug = ConvertFrom-TokenSlug -Slug $dir.Name -UserHome $FakeHome
    if (-not $slug.StartsWith($fakeSlug)) { $badSlug += ("{0} -> {1}" -f $dir.Name, $slug) }
}
Check ("all {0} memory slugs re-slugged onto the new username" -f $memoryDirs.Count) ($badSlug.Count -eq 0) $badSlug

# ------------------------------------------------------------------ 4/5. no residue

$textFiles = @($restored | Where-Object { Test-TextFile -Path $_.FullName })

# The refreshed personal profile is scanned for residue too - its files come off the freshly
# restored ~/.claude, so a token or a real-home path in there is just as much a leak. (Recurse
# does not traverse the junctions, same as everywhere else in this suite.)
$personalText = @(Get-ChildItem -Path $FakePersonal -Recurse -File -ErrorAction SilentlyContinue |
                  Where-Object { Test-TextFile -Path $_.FullName })
$scanFiles = @($textFiles + $personalText)

# Only the four tokens ConvertFrom-Tokens actually substitutes. __USERHOME_SLUG__ is deliberately
# excluded: it is a DIRECTORY-name token, never a content one, so it survives inside a file by
# design - a memory file documenting this repo names it in prose. Matching the word rather than
# the substitution would fail the run on a correct restore, which is how a check gets ignored.
$pathToken = [regex]'__USERHOME(_JSON|_POSIX|_FWD|_LC)?__'

$tokenLeft = @()
$homeLeft  = @()
$forms     = Get-HomeForms -UserHome $RealHome
foreach ($file in $scanFiles) {
    $content = [System.IO.File]::ReadAllText($file.FullName)
    if ($pathToken.IsMatch($content)) { $tokenLeft += $file.FullName }
    foreach ($form in @($forms.Json, $forms.Posix, $forms.Fwd, $forms.Raw, $forms.Lower)) {
        if ($content.Contains($form)) { $homeLeft += ("{0}  ({1})" -f $file.FullName, $form); break }
    }
}
Check ("no __USERHOME token survives in {0} restored text files" -f $scanFiles.Count) ($tokenLeft.Count -eq 0) $tokenLeft
Check 'no real-home path survives in any restored text file' ($homeLeft.Count -eq 0) $homeLeft

# ------------------------------------------------------------------ 6. settings.json is usable

Write-Host ''
Write-Host 'settings.json'
$settingsPath = Join-Path $FakeHome '.claude\settings.json'
$settings = $null
try { $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json } catch { }
Check 'parses as JSON after the rewrite' ($null -ne $settings)

if ($null -ne $settings) {
    $commands = @()
    if ($settings.PSObject.Properties.Name -contains 'statusLine') { $commands += $settings.statusLine.command }
    foreach ($event in $settings.hooks.PSObject.Properties) {
        foreach ($group in $event.Value) { foreach ($hook in $group.hooks) { $commands += $hook.command } }
    }

    $wrongHome = @()
    $absent    = @()
    foreach ($command in $commands) {
        foreach ($m in ([regex]'"([A-Za-z]:\\[^"]+)"').Matches($command)) {
            $p = $m.Groups[1].Value
            if (-not $p.ToLower().StartsWith($FakeHome.ToLower())) { $wrongHome += $p; continue }
            if (-not (Test-Path $p)) { $absent += $p }
        }
    }
    Check ("all {0} hook paths point inside the fake home" -f $commands.Count) ($wrongHome.Count -eq 0) $wrongHome

    # The plugin cache is deliberately not carried (10 MB, and it rebuilds on first launch), so the
    # statusLine path is expected to be absent. Anything else absent is a broken restore.
    $unexpected = @($absent | Where-Object { $_ -notlike '*\plugins\cache\*' })
    Check 'every hook script it names exists' ($unexpected.Count -eq 0) $unexpected
    foreach ($a in ($absent | Where-Object { $_ -like '*\plugins\cache\*' })) {
        Note ("expected-absent (rebuilds on first launch): {0}" -f $a)
    }

    # Issue 199: settings.json invariants this repo owns. The mirror carries
    # permissions.defaultMode = "bypassPermissions" (enforced by tools/settings-invariants.ps1
    # from sync.ps1's push flow) so a fresh machine's pulled settings drops the
    # interactive-session permission dialog on launch. Assert on the pulled copy so a
    # regression that strips the key from the mirror or the pull surface fails here.
    $mode = $null
    if ($settings.PSObject.Properties.Name -contains 'permissions' -and
        $settings.permissions.PSObject.Properties.Name -contains 'defaultMode') {
        $mode = $settings.permissions.defaultMode
    }
    Check 'permissions.defaultMode carries bypassPermissions (issue 199)' ($mode -eq 'bypassPermissions') @($mode)
}

# ------------------------------------------------------------------ 6a2. per-project trust records (issue 199)

# The other half of AC1: sync.ps1 -Mode pull invokes tools/settings-invariants.ps1 with -Trust,
# which lands hasTrustDialogAccepted=true into ~/.claude.json for the four master-watchdog clone
# paths under the pulled home. Combined with permissions.defaultMode=bypassPermissions above, a
# fresh claude launch in one of those clones reaches first prompt with no permission dialog and
# no folder-trust dialog. ~/.claude.json is not in the sync manifest (holds oauthAccount and
# other machine-only state), so this is the only automated surface that lands trust records; a
# regression that unwires it from pull, or drops the -Trust flag, or that changes the four clone
# paths without updating this check, fails here.
Write-Host ''
Write-Host '.claude.json trust records (issue 199)'
$stateFile = Join-Path $FakeHome '.claude.json'
Check '.claude.json exists after pull (invariant tool seeds it)' (Test-Path $stateFile)
if (Test-Path $stateFile) {
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    $expectedClones = @(
        (Join-Path $FakeHome 'Claude\Projects\Financial\aac-bill-intake'),
        (Join-Path $FakeHome 'Claude\Projects\Sales Data KPIs\contract-builder'),
        (Join-Path $FakeHome 'Claude\Projects\Sales Data KPIs\aac-cockpit'),
        (Join-Path $FakeHome 'Claude\Projects\Operations\zoho-source-of-truth')
    )
    # $clone would clobber the script-scope $Clone (PowerShell variables are case-insensitive),
    # so use a distinctive loop name instead.
    $untrusted = @()
    $hasProjects = ($state.PSObject.Properties.Name -contains 'projects') -and ($null -ne $state.projects)
    foreach ($clonePath in $expectedClones) {
        if (-not $hasProjects) { $untrusted += $clonePath; continue }
        if ($state.projects.PSObject.Properties.Name -notcontains $clonePath) { $untrusted += $clonePath; continue }
        $entry = $state.projects.$clonePath
        if (-not ($entry.PSObject.Properties.Name -contains 'hasTrustDialogAccepted') -or -not $entry.hasTrustDialogAccepted) {
            $untrusted += $clonePath
        }
    }
    Check 'each of the four master-watchdog clone paths carries hasTrustDialogAccepted=true' ($untrusted.Count -eq 0) $untrusted
}

# ------------------------------------------------------------------ 6a. codex config.toml is usable

# Codex's settings file rode along from issue #2 onward; without it the carried Codex hooks run
# over default settings on a fresh machine. PowerShell 5.1 has no TOML parser, so this checks the
# property that matters for a restore: every user-profile path in it - including the lowercased
# project-trust keys Codex writes, the one spelling the other tokens cannot catch - was re-pointed
# at the new home. Paths outside a profile (the c:\windows\system32 trust entry) are legitimately
# machine-independent and stay as they are.
Write-Host ''
Write-Host 'codex config.toml'
$codexConfig = Join-Path $FakeHome '.codex\config.toml'
Check 'codex/config.toml was restored' (Test-Path $codexConfig)
if (Test-Path $codexConfig) {
    $toml     = [System.IO.File]::ReadAllText($codexConfig)
    $badPaths = @()
    foreach ($m in ([regex]'[A-Za-z]:[\\/][^"''\s\]]*').Matches($toml)) {
        # JSON-escaped and forward-slash spellings compare like raw ones
        $p = $m.Value.Replace('\\', '\').Replace('/', '\')
        if ($p -notmatch '(?i)[\\/]users[\\/]') { continue }
        if (-not $p.ToLower().StartsWith($FakeHome.ToLower())) { $badPaths += $p }
    }
    Check 'every user-profile path in it points inside the fake home' ($badPaths.Count -eq 0) $badPaths
}

# ------------------------------------------------------------------ 6b. skill junctions

# The check that would have caught the original hole: most flow skills reach ~/.claude/skills
# through a junction, and a junction is invisible to a file copy. Present-and-empty is the
# failure mode to look for, so this asserts the target resolves and carries a SKILL.md.
Write-Host ''
Write-Host 'Skill junctions'
$linkFile = Join-Path $Clone 'claude\skill-links.json'
if (-not (Test-Path $linkFile)) {
    Check 'claude/skill-links.json is in the repo' $false @('push never recorded the junctions')
} else {
    $links = Read-JsonArray -Path $linkFile
    Check 'skill-links.json lists the junctions' ($links.Count -gt 0)
    $broken = @()
    foreach ($link in $links) {
        $linkPath = Join-Path $FakeHome (".claude\skills\" + $link.Name)
        if (-not (Test-Path $linkPath)) { $broken += ("{0}: not recreated" -f $link.Name); continue }
        $item = Get-Item $linkPath -Force
        if (-not (Test-IsLink -Item $item)) {
            $broken += ("{0}: exists but is not a link" -f $link.Name); continue
        }
        $target = Get-LinkTarget -Item $item
        if (-not $target.ToLower().StartsWith($FakeHome.ToLower())) {
            $broken += ("{0}: points outside the fake home - {1}" -f $link.Name, $target); continue
        }
        if (-not (Test-Path (Join-Path $linkPath 'SKILL.md'))) {
            $broken += ("{0}: link resolves to nothing readable" -f $link.Name)
        }
    }
    Check ("all {0} junctioned skills resolve to a real SKILL.md" -f $links.Count) ($broken.Count -eq 0) $broken

    # The flows the global CLAUDE.md names by name. If these are missing the machine restores
    # into a configuration whose own rules point at skills that are not there.
    $required = @('ask-matt', 'implement', 'tdd', 'triage', 'handoff', 'to-spec', 'to-tickets',
                  'code-review', 'diagnosing-bugs', 'grill-with-docs', 'wayfinder', 'research')
    $absentFlows = @($required | Where-Object {
        -not (Test-Path (Join-Path $FakeHome (".claude\skills\" + $_ + "\SKILL.md")))
    })
    Check 'every flow skill named in the global CLAUDE.md is invocable' ($absentFlows.Count -eq 0) $absentFlows
}

# ------------------------------------------------------------------ 6b2. PowerShell profiles

# A whitelist entry with no assertion behind it is how 24 skills went missing without a single
# error message, so the two profiles get one. The interesting half is WHERE they land: Documents
# is a redirectable shell folder, and Get-DocumentsPath must resolve inside the fake home rather
# than reaching for this machine's real (OneDrive-redirected) Documents.
Write-Host ''
Write-Host 'PowerShell profiles'

$profileTargets = @(
    @{ Name = 'pwsh 7';             Path = (Join-Path $FakeHome 'Documents\PowerShell\Microsoft.PowerShell_profile.ps1') }
    @{ Name = 'Windows PowerShell'; Path = (Join-Path $FakeHome 'Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1') }
)
$missingProfiles = @($profileTargets | Where-Object { -not (Test-Path $_.Path) } | ForEach-Object {
    "{0}: not restored at {1}" -f $_.Name, $_.Path
})
Check 'both PowerShell profiles restored under the fake home' ($missingProfiles.Count -eq 0) $missingProfiles

# The reason they travel at all: a terminal-launched session reads the tool flag from here, not
# from the registry, whose value an already-running Explorer does not hand out.
if ($missingProfiles.Count -eq 0) {
    $flagless = @($profileTargets | Where-Object {
        (Get-Content $_.Path -Raw) -notmatch 'CLAUDE_CODE_USE_POWERSHELL_TOOL'
    } | ForEach-Object { "{0}: no CLAUDE_CODE_USE_POWERSHELL_TOOL line" -f $_.Name })
    Check 'restored profiles still set the PowerShell tool flag' ($flagless.Count -eq 0) $flagless
}

# Get-DocumentsPath is the part that could quietly write into the real profile.
$docsReal = Get-DocumentsPath -UserHome $env:USERPROFILE
$docsFake = Get-DocumentsPath -UserHome $FakeHome
Check 'Get-DocumentsPath keeps a foreign home inside that home' `
    ($docsFake.ToLower().StartsWith($FakeHome.ToLower())) @("resolved to $docsFake")
Check 'Get-DocumentsPath asks the shell for the real profile' `
    ($docsReal -eq [Environment]::GetFolderPath('MyDocuments')) @("resolved to $docsReal")

# ------------------------------------------------------------------ 6b3. skill-links formatting

# ConvertTo-Json indents four spaces on 5.1 and two on 7, so the generated file used to churn
# whole-file depending on which shell ran the push. The writer is pinned; assert the bytes.
Write-Host ''
Write-Host 'skill-links.json formatting'

$sampleLinks = @(
    [pscustomobject]@{ Name = 'a';    Target = '__USERHOME__\.agents\skills\a' }
    [pscustomobject]@{ Name = 'b"q';  Target = "x`ty" }
)
$pinned = ConvertTo-SkillLinkJson -Links $sampleLinks
# The CRLF sits between the line text and the \n that (?m)$ anchors to, so \r? is not optional here.
Check 'pinned writer emits two-space indent'  ($pinned -match '(?m)^  \{\r?$')
Check 'pinned writer emits CRLF'              ($pinned.Contains("`r`n") -and $pinned -notmatch "(?<!`r)`n")
Check 'pinned writer escapes quote and tab'   ($pinned.Contains('"b\"q"') -and $pinned.Contains('"x\ty"'))
$parsed = @($pinned | ConvertFrom-Json | ForEach-Object { $_ })
Check 'pinned writer round-trips as JSON'     ($parsed.Count -eq 2 -and $parsed[1].Name -eq 'b"q')

# ------------------------------------------------------------------ 6b4. global CLAUDE.md single-load (issue 40)

# Regression check for /doctor's finding of 2026-08-28: with CLAUDE_CONFIG_DIR=~/.claude-personal
# a byte-identical ~/.claude-personal/CLAUDE.md would sit next to ~/.claude/CLAUDE.md and cause
# Claude Code to load global memory twice - user memory from the personal path plus an ancestor
# .claude/CLAUDE.md walked up from cwd - two distinct absolute paths, so the dedup that saves the
# work-active scenario does not fire. The fix: Update-PersonalProfile removes any CLAUDE.md at
# the personal path (backed up first), so the ancestor scan is the single source in a personal-
# active session with cwd under $HOME. The reopen constraint: the work-profile CLAUDE.md at
# ~/.claude/CLAUDE.md must NOT be deleted as an "orphan" by pull, because push reads only there
# and it is the machine's live source of truth.
Write-Host ''
Write-Host 'Global CLAUDE.md single-load (issue 40)'
Check 'personal CLAUDE.md removed after refresh (no CLAUDE_CONFIG_DIR=personal double-load)' `
    (-not (Test-Path (Join-Path $FakePersonal 'CLAUDE.md'))) `
    @('~/.claude-personal/CLAUDE.md still present - a personal-active session would load global memory twice')
Check 'work-profile CLAUDE.md at ~/.claude/CLAUDE.md survives (push source of truth, not an orphan)' `
    (Test-Path (Join-Path $FakeHome '.claude\CLAUDE.md')) `
    @('~/.claude/CLAUDE.md missing - pull treated the active-profile source of truth as an orphan and removed it')

# The stale CLAUDE.md seed (see the seeding block above section 1) has to reach the refresh
# backup directory before being removed - anything else means the refresh dropped the personal
# copy without preserving it. The backup dir name is timestamped, so match by prefix and by
# containing a CLAUDE.md whose bytes match the stale marker.
$refreshBackupDirs = @(Get-ChildItem -Path $FakeHome -Directory -ErrorAction SilentlyContinue |
                       Where-Object { $_.Name -like '.claude-personal-refresh-backup-*' })
$staleFound = $false
foreach ($dir in $refreshBackupDirs) {
    $candidate = Join-Path $dir.FullName 'CLAUDE.md'
    if ((Test-Path $candidate) -and
        ([System.IO.File]::ReadAllText($candidate) -like '*STALE personal CLAUDE.md*')) {
        $staleFound = $true; break
    }
}
Check 'stale personal CLAUDE.md was backed up before removal' $staleFound `
    @('no ~/.claude-personal-refresh-backup-*/CLAUDE.md contains the stale marker seeded in the personal profile')

# ------------------------------------------------------------------ 6c. personal profile refresh

# Issue #9: pull ends by refreshing ~/.claude-personal from the freshly written ~/.claude - a
# one-way overlay. The profile seeded in 0b proves the refresh path end to end: work content
# flows in byte-equal, the hooks key is rewritten onto .claude-personal paths, and everything
# personal - the prefs, the personal-only memory, its pointer line - survives untouched.
# Reverse memory sync is deliberately absent (declined by default 2026-08-19): push reads only
# ~/.claude, so nothing here can assert personal content into the repo, and nothing should.
Write-Host ''
Write-Host 'Personal profile refresh'

$pHooksBad   = @()
$workHooksDir = Join-Path $FakeHome '.claude\hooks'
Get-ChildItem -Path $workHooksDir -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($workHooksDir.Length).TrimStart('\')
    if (Test-Excluded -RelativePath $relative) { return }
    $twin = Join-Path $FakePersonal ('hooks\' + $relative)
    if (-not (Test-Path $twin)) { $pHooksBad += ("missing: {0}" -f $relative); return }
    $a = [System.IO.File]::ReadAllBytes($_.FullName)
    $b = [System.IO.File]::ReadAllBytes($twin)
    if (-not ([System.Linq.Enumerable]::SequenceEqual($a, $b))) { $pHooksBad += ("differs: {0}" -f $relative) }
}
Check 'personal hooks are byte-equal to the work profile''s' ($pHooksBad.Count -eq 0) $pHooksBad

$pSettingsPath = Join-Path $FakePersonal 'settings.json'
$pSettings = $null
try { $pSettings = Get-Content $pSettingsPath -Raw | ConvertFrom-Json } catch { }
$prefsIntact = ($null -ne $pSettings) -and
               ($pSettings.PSObject.Properties.Name -contains 'model') -and
               ($pSettings.model -eq 'personal-model-pref') -and
               ($pSettings.PSObject.Properties.Name -contains 'fastMode') -and
               ($pSettings.fastMode -eq $true)
Check 'personal settings.json parses and keeps its personal prefs' $prefsIntact

$pCommands = @()
if (($null -ne $pSettings) -and ($pSettings.PSObject.Properties.Name -contains 'hooks')) {
    foreach ($event in $pSettings.hooks.PSObject.Properties) {
        foreach ($group in $event.Value) { foreach ($hook in $group.hooks) { $pCommands += $hook.command } }
    }
}
$pCmdBad = @()
foreach ($command in $pCommands) {
    # \.claude\ with the trailing backslash cannot match \.claude-personal\, so a survivor here
    # is a hook path the rewrite missed. .codex paths are deliberately untouched.
    if ($command -like '*\.claude\*') { $pCmdBad += ("still on .claude: {0}" -f $command); continue }
    foreach ($m in ([regex]'"([A-Za-z]:\\[^"]+)"').Matches($command)) {
        $p = $m.Groups[1].Value
        if (($p -like '*\.claude-personal\*') -and -not (Test-Path $p)) {
            $pCmdBad += ("names a missing file: {0}" -f $p)
        }
    }
}
Check ("all {0} personal hook commands are rewritten to .claude-personal and resolve" -f $pCommands.Count) `
    (($pCommands.Count -gt 0) -and ($pCmdBad.Count -eq 0)) $pCmdBad

$pLinksBad = @()
$workJunctions = @(Get-ChildItem -Path (Join-Path $FakeHome '.claude\skills') -Directory -Force |
                   Where-Object { Test-IsLink -Item $_ })
foreach ($junction in $workJunctions) {
    $twin = Join-Path $FakePersonal ('skills\' + $junction.Name)
    if (-not (Test-Path $twin)) { $pLinksBad += ("{0}: not created" -f $junction.Name); continue }
    $item = Get-Item $twin -Force
    if (-not (Test-IsLink -Item $item)) { $pLinksBad += ("{0}: exists but is not a link" -f $junction.Name); continue }
    if ((Get-LinkTarget -Item $item) -ne (Get-LinkTarget -Item $junction)) {
        $pLinksBad += ("{0}: different target" -f $junction.Name); continue
    }
    if (-not (Test-Path (Join-Path $twin 'SKILL.md'))) {
        $pLinksBad += ("{0}: link resolves to nothing readable" -f $junction.Name)
    }
}
Check ("all {0} personal skill junctions mirror the work profile's" -f $workJunctions.Count) `
    (($workJunctions.Count -gt 0) -and ($pLinksBad.Count -eq 0)) $pLinksBad

$pMemOk = $false; $pMemDetail = @()
if ($null -ne $seedSourceDir) {
    $workMem = Join-Path $FakeHome ('.claude\projects\' + $seedSlug + '\memory')
    $missingInPersonal = @(Get-ChildItem -Path $workMem -File |
                           Where-Object { -not (Test-Path (Join-Path $seedMem $_.Name)) } |
                           ForEach-Object { $_.Name })
    $noteSurvived = Test-Path (Join-Path $seedMem 'personal-only-note.md')
    $index = ''
    if (Test-Path (Join-Path $seedMem 'MEMORY.md')) {
        $index = [System.IO.File]::ReadAllText((Join-Path $seedMem 'MEMORY.md'))
    }
    $unionHasPersonal = $index.Contains('(personal-only-note.md)')
    $workIndexTargets = @()
    if (Test-Path (Join-Path $workMem 'MEMORY.md')) {
        $workIndexTargets = @(([regex]'\]\(([^)]+\.md)\)').Matches(
            [System.IO.File]::ReadAllText((Join-Path $workMem 'MEMORY.md'))) |
            ForEach-Object { $_.Groups[1].Value })
    }
    $unionHasWork = (@($workIndexTargets | Where-Object { -not $index.Contains('(' + $_ + ')') }).Count -eq 0)
    $pMemOk = ($missingInPersonal.Count -eq 0) -and $noteSurvived -and $unionHasPersonal -and $unionHasWork
    if (-not $pMemOk) {
        $pMemDetail = @(
            ("work files missing in personal: {0}" -f ($missingInPersonal -join ', ')),
            ("personal-only note survived: {0}" -f $noteSurvived),
            ("index keeps the personal pointer line: {0}" -f $unionHasPersonal),
            ("index keeps every work pointer line: {0}" -f $unionHasWork))
    }
} else {
    $pMemDetail = @('no repo memory dir with a MEMORY.md to seed against')
}
Check 'personal memory is a union: work files in, personal-only file and pointer line kept' $pMemOk $pMemDetail

# ------------------------------------------------------------------ 7. round trip is lossless

Write-Host ''
Write-Host 'Fidelity'
$drift = @()
foreach ($pair in $pairs) {
    if (-not (Test-Path $pair.Local)) { continue }
    if (-not (Test-TextFile -Path $pair.Repo)) {
        $a = [System.IO.File]::ReadAllBytes($pair.Repo)
        $b = [System.IO.File]::ReadAllBytes($pair.Local)
        if (-not ([System.Linq.Enumerable]::SequenceEqual($a, $b))) { $drift += $pair.Local }
        continue
    }
    # Re-tokenizing the restored file with the FAKE home must reproduce the repo file exactly.
    # That is the whole round trip - detokenize on pull, tokenize on the next push - so a
    # mismatch here is a file that would come back different from the machine it was sent to.
    $back = ConvertTo-Tokens -Text ([System.IO.File]::ReadAllText($pair.Local)) -UserHome $FakeHome
    if (-not ($back -ceq [System.IO.File]::ReadAllText($pair.Repo))) { $drift += $pair.Local }
}
Check ("all {0} files survive tokenize/detokenize byte-for-byte" -f $pairs.Count) ($drift.Count -eq 0) $drift

# ------------------------------------------------------------------ 8. nothing secret came along

Write-Host ''
Write-Host 'Secrets'
$credentialFiles = @($restored | Where-Object { Test-Excluded -RelativePath $_.Name } | ForEach-Object { $_.FullName })
Check 'no credential-shaped filename was restored' ($credentialFiles.Count -eq 0) $credentialFiles
Check 'restored tree passes the value-shaped secret guard' (Assert-NoSecrets -Root $FakeHome)

# ------------------------------------------------------------------ 9. it actually runs

Write-Host ''
Write-Host 'Executable from the new home'

$gateTest = Join-Path $FakeHome '.claude\hooks\session-gate.test.js'
if (Test-Path $gateTest) {
    $out = & node --test $gateTest 2>&1
    Check 'restored session-gate.js passes its own test suite' ($LASTEXITCODE -eq 0) @($out | Select-Object -Last 12)
} else {
    Check 'restored session-gate.js passes its own test suite' $false @('session-gate.test.js was not restored')
}

$gate = Join-Path $FakeHome '.codex\hooks\ask_matt_gate.py'
$sample = Join-Path $FakeRoot 'sample-reply.txt'
Set-Content -Path $sample -Value 'Restore works. Fake home holds config.' -Encoding utf8
$env:GOVERNANCE_CLAUDE_HOME = (Join-Path $FakeHome '.claude')
$out = & py -3 $gate lint $sample 'restore-test-session' 2>&1
$gateExit = $LASTEXITCODE
Remove-Item Env:\GOVERNANCE_CLAUDE_HOME
# 0 clean / 1 violations. A traceback is neither, and is what a broken restore looks like.
Check 'restored ask_matt_gate.py runs the pre-send lint' ($gateExit -eq 0 -or $gateExit -eq 1) @($out | Select-Object -Last 10)

$check = Join-Path $FakeHome '.claude\skills\session-check\check.js'
Push-Location $Clone
$out = & node $check 2>&1
$checkExit = $LASTEXITCODE
Pop-Location
$ran = ($checkExit -eq 0 -or $checkExit -eq 1) -and (($out -join "`n") -match 'Starting a session')
Check 'restored session-check reports on a repo' $ran @($out | Select-Object -Last 10)

# Issue 103: the account registry travels, parses, and names every repo the watchdog serves - the
# repo list is read from the watchdog script itself so the two cannot drift apart unnoticed.
$accounts = Join-Path $FakeHome '.claude\accounts.json'
$registry = $null
try { $registry = Get-Content $accounts -Raw | ConvertFrom-Json } catch { }
$watchdogRepos = @([regex]::Matches((Get-Content (Join-Path $Clone 'orchestrator\master-watchdog.ps1') -Raw), "Repo\s*=\s*'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
$unregistered = @($watchdogRepos | Where-Object { -not ($registry -and $registry.repos -and ($registry.repos.PSObject.Properties.Name -contains $_)) })
$accountsDetail = @($unregistered)
if ($watchdogRepos.Count -eq 0) { $accountsDetail = @("no Repo = '<owner/repo>' rows found in orchestrator\master-watchdog.ps1 - the table format changed; update this regex") }
elseif ($null -eq $registry) { $accountsDetail = @("$accounts missing or not JSON") }
Check ("restored accounts.json parses and names all {0} watchdog repos" -f $watchdogRepos.Count) `
    ($null -ne $registry -and $watchdogRepos.Count -gt 0 -and $unregistered.Count -eq 0) $accountsDetail

$identityTest = Join-Path $FakeHome '.claude\skills\session-check\identity.test.js'
if (Test-Path $identityTest) {
    $out = & node --test $identityTest 2>&1
    Check 'restored identity.js passes its own test suite' ($LASTEXITCODE -eq 0) @($out | Select-Object -Last 12)
} else {
    Check 'restored identity.js passes its own test suite' $false @('identity.test.js was not restored')
}

# ------------------------------------------------------------------ 9a. dotfiles freshness ships

# Issue 12: sync stamps + freshness classifier + block hook. The tool and the hook driver ship in
# tools/ (hand-written space) and .claude/settings.json (project-level, hand-written) so they
# survive a sync push - the previous attempt at this issue committed them into the generated
# claude/hooks mirror and would have been wiped by the next push. The clone is the check for that:
# these files must exist in the pushed remote, and the Node hook driver must pass its own tests.

Write-Host ''
Write-Host 'Dotfiles freshness (issue 12)'

$freshnessTool = Join-Path $Clone 'tools\dotfiles-freshness.ps1'
$freshnessHook = Join-Path $Clone 'tools\dotfiles-freshness-hook.js'
$freshnessHookTest = Join-Path $Clone 'tools\dotfiles-freshness-hook.test.js'
$freshnessSettings = Join-Path $Clone '.claude\settings.json'

Check 'tools/dotfiles-freshness.ps1 shipped' (Test-Path $freshnessTool)
Check 'tools/dotfiles-freshness-hook.js shipped' (Test-Path $freshnessHook)
Check 'tools/dotfiles-freshness-hook.test.js shipped' (Test-Path $freshnessHookTest)
Check '.claude/settings.json wires the hook' (Test-Path $freshnessSettings)

if (Test-Path $freshnessHookTest) {
    $out = & node --test $freshnessHookTest 2>&1
    Check 'dotfiles-freshness-hook.js passes its own test suite' `
        ($LASTEXITCODE -eq 0) @($out | Select-Object -Last 12)
}

# ticket-fleet branch-naming + gh/mcp instrument switch (issues 29, 138): the workflow's
# concurrent-attempt guard and the tracker instrument switch both live in a pure helper
# (tools/ticket-fleet-branch.js) so their tests can run without spinning up the Workflow tool.
# Since issue 138 the fleet is served by the aac-skills plugin as one merged script, so this
# suite exercises the drift guards between the pure helper and aac-skills/ticket-fleet/ticket-fleet.js.
$fleetBranchModule = Join-Path $Clone 'tools\ticket-fleet-branch.js'
$fleetBranchTest   = Join-Path $Clone 'tools\ticket-fleet-branch.test.js'
Check 'tools/ticket-fleet-branch.js shipped' (Test-Path $fleetBranchModule)
Check 'tools/ticket-fleet-branch.test.js shipped' (Test-Path $fleetBranchTest)
if (Test-Path $fleetBranchTest) {
    $out = & node --test $fleetBranchTest 2>&1
    Check 'ticket-fleet-branch passes its own test suite (issue 29 concurrent-attempt guard)' `
        ($LASTEXITCODE -eq 0) @($out | Select-Object -Last 20)
}

# claude-md-lint: the CLAUDE.md concision check. One case per paradigm rule, plus the CLI
# exit codes, so a regex regression or a broken suppression comment fails the restore suite.
$mdLintModule = Join-Path $Clone 'tools\claude-md-lint.js'
$mdLintTest   = Join-Path $Clone 'tools\claude-md-lint.test.js'
Check 'tools/claude-md-lint.js shipped' (Test-Path $mdLintModule)
Check 'tools/claude-md-lint.test.js shipped' (Test-Path $mdLintTest)
if (Test-Path $mdLintTest) {
    $out = & node --test $mdLintTest 2>&1
    Check 'claude-md-lint passes its own test suite (one case per paradigm rule)' `
        ($LASTEXITCODE -eq 0) @($out | Select-Object -Last 20)
}

# Issue 97: the linter gates the checked-in instruction files. Root CLAUDE.md and the mirrored
# global claude/CLAUDE.md are both linted; any unsuppressed finding whose rule is not in the
# warn-only set fails the run with the file and line named. `size` warns on both files - the
# decision is stated in the project's CLAUDE.md next to the linter's entry. The mirror also
# warns on volatile, code-derivable and tutorial, because it is a byte copy of Dan's personal
# ~/.claude/CLAUDE.md whose text quotes counterexamples that trip those regexes ("3 of 5",
# "halfway done", `func()` accepts ...). Every other rule stays blocking on both files.
$rootLintTarget   = Join-Path $Clone 'CLAUDE.md'
$mirrorLintTarget = Join-Path $Clone 'claude\CLAUDE.md'
$mdLintWarnRoot   = @('size')
$mdLintWarnMirror = @('size', 'volatile', 'code-derivable', 'tutorial')
$mdLintFindingRe  = '^(?<file>.+):(?<line>\d+)\t(?<rule>[\w-]+)\t(?<msg>.*)$'

# Fault plant runs BEFORE the gate reads the file, so the gate goes red the same way any
# real unsuppressed finding would. Injected here (not in the pre-install fault block up top)
# because a plant before the clone fidelity check (0) would fail check 0 as well, and only
# the gate is the subject under test.
if ($Fault -eq 'lint-root') {
    Add-Content -Path $rootLintTarget -Value "`nAlways write clean code."
    Note 'fault: planted a self-evident line at the end of CLAUDE.md'
}
if ($Fault -eq 'lint-mirror') {
    Add-Content -Path $mirrorLintTarget -Value "`nAlways write clean code."
    Note 'fault: planted a self-evident line at the end of claude/CLAUDE.md'
}

function Invoke-MdLint {
    param([string]$Path, [string]$CloneDir)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $script = Join-Path $CloneDir 'tools\claude-md-lint.js'
    Push-Location $CloneDir
    try {
        $raw = & node $script $Path 2>&1
    } finally { Pop-Location; $ErrorActionPreference = $prev }
    $out = @()
    foreach ($f in $raw) {
        $s = [string]$f
        $m = [regex]::Match($s, $mdLintFindingRe)
        if ($m.Success) {
            $out += [pscustomobject]@{
                File = $m.Groups['file'].Value
                Line = [int]$m.Groups['line'].Value
                Rule = $m.Groups['rule'].Value
                Raw  = ("{0}:{1}`t{2}`t{3}" -f $m.Groups['file'].Value, $m.Groups['line'].Value, $m.Groups['rule'].Value, $m.Groups['msg'].Value)
            }
        }
    }
    return , $out
}

function Test-MdLintGate {
    param([string]$Label, [string]$Path, [string[]]$WarnRules, [string]$CloneDir)
    $findings = Invoke-MdLint -Path $Path -CloneDir $CloneDir
    $gating   = @($findings | Where-Object { $WarnRules -notcontains $_.Rule })
    $warns    = @($findings | Where-Object { $WarnRules -contains $_.Rule })
    $tag = if ($warns.Count) { " (warns: {0})" -f $warns.Count } else { '' }
    Check ("{0}: no unsuppressed gating findings{1}" -f $Label, $tag) `
        ($gating.Count -eq 0) @($gating | ForEach-Object { $_.Raw })
}

Test-MdLintGate -Label 'CLAUDE.md'       -Path $rootLintTarget   -WarnRules $mdLintWarnRoot   -CloneDir $Clone
Test-MdLintGate -Label 'claude/CLAUDE.md' -Path $mirrorLintTarget -WarnRules $mdLintWarnMirror -CloneDir $Clone

# Suppression: an in-file `<!-- claude-md-lint-ignore -->` above a line silences the finding on
# that line, so the linter itself emits nothing and the gate stays green. A throwaway file, so
# the check does not depend on the two production files carrying an example of the mechanism.
$suppressProbe = Join-Path $FakeRoot 'md-lint-suppress-probe.md'
$suppressText  = "<!-- claude-md-lint-ignore -->`nAlways write clean code.`n"
[System.IO.File]::WriteAllText($suppressProbe, $suppressText, (New-Object System.Text.UTF8Encoding($false)))
$sfindings = Invoke-MdLint -Path $suppressProbe -CloneDir $Clone
Check 'in-file `claude-md-lint-ignore` silences a finding (linter emits nothing)' `
    ($sfindings.Count -eq 0) @($sfindings | ForEach-Object { $_.Raw })


# Fleet verifier subagent (issue 86): the ticket-fleet's blind refuter runs under a tool-restricted
# subagent definition that ships in ~/.claude/agents/fleet-verifier.md. The whitelist entry
# claude/agents in lib/manifest.ps1 is what carries it; without an assertion behind that entry, a
# silent drop (missing frontmatter key, wrong tool set, model drift, or a fleet script that forgets
# to pass agentType) would slip past the file-count check (line 434) unnoticed. Since issue 138
# the fleet lives in one plugin-served script; the restore suite asserts against that copy
# (in the marketplace payload) rather than the three pre-plugin copies.
$fleetVerifier      = Join-Path $FakeHome '.claude\agents\fleet-verifier.md'
$fleetScriptPlugin  = Join-Path $Clone    'marketplace\aac-skills\skills\ticket-fleet\ticket-fleet.js'
Check 'fleet-verifier agent definition restored under fake home' (Test-Path $fleetVerifier)
if (Test-Path $fleetVerifier) {
    $verifierText = Get-Content $fleetVerifier -Raw
    # Frontmatter parse: name, tools, model. Fenced by two --- lines at the top.
    $fm = if ($verifierText -match '(?ms)^---\r?\n(.*?)\r?\n---') { $Matches[1] } else { '' }
    $toolsLine = if ($fm -match '(?m)^tools:\s*(.+)$') { $Matches[1].Trim() } else { '' }
    $modelLine = if ($fm -match '(?m)^model:\s*(.+)$') { $Matches[1].Trim() } else { '' }
    $toolSet   = @($toolsLine -split '\s*,\s*' | Where-Object { $_ })
    Check 'fleet-verifier tools cap at Read, Grep, Glob, Bash (no Edit, no Write)' `
        (($toolSet -contains 'Read') -and ($toolSet -contains 'Grep') -and
         ($toolSet -contains 'Glob') -and ($toolSet -contains 'Bash') -and
         ($toolSet -notcontains 'Edit') -and ($toolSet -notcontains 'Write')) `
        @("tools = $toolsLine")
    Check 'fleet-verifier model pins the fleet verifyModel default (claude-sonnet-5)' `
        ($modelLine -eq 'claude-sonnet-5') `
        @("model = $modelLine")
}
if (Test-Path $fleetScriptPlugin) {
    $pluginText = Get-Content $fleetScriptPlugin -Raw
    Check 'plugin fleet script passes agentType: fleet-verifier when the instrument is gh' `
        ($pluginText -match "agentType:\s*instrument === 'gh' \? 'fleet-verifier'") `
        @('the plugin-served fleet must wire the fleet-verifier subagent under the gh instrument (issue 138)')
    Check 'plugin fleet script inlines the pickInstrument switch (issue 138)' `
        (($pluginText -match 'function pickInstrument') -and
         ($pluginText -match 'CLAUDE_CODE_REMOTE_SESSION_ID')) `
        @('plugin fleet must sniff CLAUDE_CODE_REMOTE_SESSION_ID for the mcp branch')
}

# owner-account-line (issue 114): the CLAUDE.md line naming which Claude account owns this
# repo, generated from claude/accounts.json so a wrong-account cloud session cannot happen
# silently. The tool + tests + registry are read from $RepoRoot (the worktree we ran from),
# not $Clone, so these checks fire under every -From mode - not only worktree.
$ownerModule   = Join-Path $RepoRoot 'tools\owner-account-line.js'
$ownerTest     = Join-Path $RepoRoot 'tools\owner-account-line.test.js'
$ownerRegistry = Join-Path $RepoRoot 'claude\accounts.json'
$ownerClaudeMd = Join-Path $RepoRoot 'CLAUDE.md'
Check 'tools/owner-account-line.js shipped (issue 114 registry-driven owner-account block)' (Test-Path $ownerModule)
Check 'tools/owner-account-line.test.js shipped (issue 114)' (Test-Path $ownerTest)
if (Test-Path $ownerTest) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & node --test $ownerTest 2>&1; $exit = $LASTEXITCODE }
    finally { $ErrorActionPreference = $prev }
    Check 'owner-account-line passes its own test suite (idempotent apply, drift fails check, AGENTS.md fallback, real-file drift guard)' `
        ($exit -eq 0) @($out | Select-Object -Last 20)
}
# Direct AC2 check on THIS repo's own real CLAUDE.md vs its real accounts.json. A wrong or
# missing block in the checked-in CLAUDE.md fails restore-test in every -From mode - the exact
# hole the previous attempt left.
if ((Test-Path $ownerModule) -and (Test-Path $ownerRegistry) -and (Test-Path $ownerClaudeMd)) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $out = & node $ownerModule check --repo $RepoRoot --registry $ownerRegistry --slug 'surreptakos/claude-dotfiles' 2>&1
        $checkExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    Check 'this repo''s CLAUDE.md carries the owner-account line that claude/accounts.json says it should (AC2)' `
        ($checkExit -eq 0) @($out)
}
# Synthetic sweep across every live registered repo: seed a fake clones root, run apply-all
# then check-all (idempotent), then seed drift on one repo and re-run check-all - it must
# exit 1 and name the drifted slug. Covers AC1 across the eight live repos and AC2 end-to-end.
if ((Test-Path $ownerModule) -and (Test-Path $ownerRegistry)) {
    $sweepRoot = Join-Path $FakeRoot 'owner-account-sweep'
    if (Test-Path $sweepRoot) { Remove-Item $sweepRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $sweepRoot | Out-Null
    $registry = Get-Content $ownerRegistry -Raw | ConvertFrom-Json
    $liveSlugs = @()
    foreach ($pp in $registry.repos.PSObject.Properties) {
        $entry = $pp.Value
        if ($entry.PSObject.Properties.Name -contains 'status' -and $entry.status -eq 'dead') { continue }
        $liveSlugs += $pp.Name
        $repoName = ($pp.Name -split '/')[1]
        $repoDir  = Join-Path $sweepRoot $repoName
        New-Item -ItemType Directory -Path $repoDir | Out-Null
        & git -c "init.defaultBranch=main" init -q $repoDir 2>&1 | Out-Null
        & git -C $repoDir remote add origin "https://github.com/$($pp.Name)" 2>&1 | Out-Null
        if ($pp.Name -eq 'surreptakos/zoho-source-of-truth') {
            Set-Content -Path (Join-Path $repoDir 'AGENTS.md') -Value "# $repoName`n`nbody paragraph.`n" -Encoding utf8
        } else {
            Set-Content -Path (Join-Path $repoDir 'CLAUDE.md') -Value "# $repoName`n`nbody paragraph.`n" -Encoding utf8
        }
    }
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $applyOut = & node $ownerModule apply-all --via clones --registry $ownerRegistry --clones-root $sweepRoot 2>&1
        $applyExit = $LASTEXITCODE
        Check ('owner-account-line apply-all --via clones writes the block into every live registered repo (' + $liveSlugs.Count + ' repos) (AC1)') `
            ($applyExit -eq 0) @($applyOut)
        $sweepOut = & node $ownerModule check-all --via clones --registry $ownerRegistry --clones-root $sweepRoot 2>&1
        $sweepExit = $LASTEXITCODE
        Check 'owner-account-line check-all --via clones passes for every live registered repo after apply-all (idempotent)' `
            ($sweepExit -eq 0) @($sweepOut)
        if ($liveSlugs.Count -gt 0) {
            $victim = $liveSlugs[0]
            $victimDir = Join-Path $sweepRoot (($victim -split '/')[1])
            $victimFile = Join-Path $victimDir 'CLAUDE.md'
            if (-not (Test-Path $victimFile)) { $victimFile = Join-Path $victimDir 'AGENTS.md' }
            Set-Content -Path $victimFile -Value "# drifted`n`nno owner block here.`n" -Encoding utf8
            $driftOut = & node $ownerModule check-all --via clones --registry $ownerRegistry --clones-root $sweepRoot 2>&1
            $driftExit = $LASTEXITCODE
            Check 'owner-account-line check-all reports drift on the seeded repo (exit=1) (AC2)' `
                ($driftExit -eq 1 -and ($driftOut -join "`n") -match [regex]::Escape($victim)) @($driftOut | Select-Object -Last 8)
        }
    } finally { $ErrorActionPreference = $prev }
}

# Round-trip: run the classifier against a stamp we just wrote from the restored home; it must
# return `synced` (no drift, no origin-ahead against the clone's own HEAD which has no upstream).
# The tool tolerates "no upstream" as `unknown` - that is the expected reading here, since the
# depth-1 clone has no remote-tracking branch. The point of this check is that the tool runs to
# completion after a restore, produces JSON, and answers something the driver can parse.
if (Test-Path $freshnessTool) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $freshnessTool `
                            -Mode classify -RepoRoot $Clone -UserHome $FakeHome -SkipFetch 2>&1 | Out-String
        $exit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    $reportBlock = ''
    $m = [regex]::Match($out.Trim(), '\{[\s\S]*\}\s*$')
    if ($m.Success) { $reportBlock = $m.Value }
    $report = $null
    if ($reportBlock) { try { $report = $reportBlock | ConvertFrom-Json } catch { $report = $null } }
    $stateName = ''
    if ($null -ne $report) { $stateName = [string]$report.state }
    Check ('freshness classifier runs from a restored checkout (state={0}, exit={1})' -f $stateName, $exit) `
        (($exit -eq 0) -and ($null -ne $report) -and ($stateName -ne '')) `
        @(($out -split "`r?`n") | Select-Object -Last 12)
}

# Stamp round-trip + classify-state tests from the CLONE. Runs the standalone unit test file
# against the restored tool; if it passes, all four states plus the stamp round-trip work
# against a freshly restored home rather than only in the working tree.
$freshnessPsTests = Join-Path $Clone 'tests\dotfiles-freshness.tests.ps1'
if (Test-Path $freshnessPsTests) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $freshnessPsTests 2>&1 | Out-String
        $exit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    Check 'dotfiles-freshness.tests.ps1 passes (stamp round-trip + 4 states)' `
        ($exit -eq 0) @(($out -split "`r?`n") | Select-Object -Last 20)
}

# sync.ps1 -Mode push refusal from a git worktree (issue 32). Runs against the CLONE so the
# ship pass proves the test file made it into the mirror, and the sync.ps1 in the clone is
# what the guard is being tested on - not the working tree's copy.
$syncWtTests = Join-Path $Clone 'tests\sync-worktree-guard.tests.ps1'
if (Test-Path $syncWtTests) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $syncWtTests 2>&1 | Out-String
        $exit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    Check 'sync-worktree-guard.tests.ps1 passes (push refuses from worktree; -FromWorktree bypasses)' `
        ($exit -eq 0) @(($out -split "`r?`n") | Select-Object -Last 20)
} else {
    Check 'sync-worktree-guard.tests.ps1 shipped' $false @('tests/sync-worktree-guard.tests.ps1 missing from clone')
}

# tools/settings-invariants.ps1 -Trust against a representative ~/.claude.json (issue 302). The
# check above (6a2) proves the trust records LAND; this proves landing them costs nothing else -
# the file is edited by insertion, so every pre-existing key survives byte-for-byte instead of
# riding through PowerShell 5.1's JSON round-trip. Runs against the CLONE so the ship pass proves
# both the suite and the tool made it into a fresh checkout.
$invariantTests = Join-Path $Clone 'tests\settings-invariants.tests.ps1'
if (Test-Path $invariantTests) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $invariantTests 2>&1 | Out-String
        $exit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    Check 'settings-invariants.tests.ps1 passes (-Trust edits ~/.claude.json by insertion)' `
        ($exit -eq 0) @(($out -split "`r?`n") | Select-Object -Last 20)
} else {
    Check 'settings-invariants.tests.ps1 shipped' $false @('tests/settings-invariants.tests.ps1 missing from clone')
}

# ------------------------------------------------------------------ 9c. GIT_* env leak guard (issue 28)

# Prove that sync.ps1, tools/dotfiles-freshness.ps1, and tools/tracker-audit.js do not honour a
# leaked GIT_DIR - `git -C <path>` does not override GIT_DIR by itself, and a hook-invoked child
# process silently reads/writes the parent's repo unless every helper clears the five GIT_* env
# vars first. Runs the standalone suite against the CLONED tests/ folder; the clone's copy is what
# ships, so this proves the guard survives the mirror rather than only working in the working tree.
$leakTests = Join-Path $Clone 'tests\git-env-leak.tests.ps1'
if (Test-Path $leakTests) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $leakTests 2>&1 | Out-String
        $exit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    Check 'git-env-leak.tests.ps1 passes (sync + freshness + tracker + audit)' `
        ($exit -eq 0) @(($out -split "`r?`n") | Select-Object -Last 20)
} else {
    Check 'git-env-leak.tests.ps1 shipped' $false @('tests/git-env-leak.tests.ps1 missing from clone')
}

# ------------------------------------------------------------------ 9b. claims-audit engine ships

# The claims-audit engine ships via the claude/skills whitelist entry, so the restore places it at
# ~/.claude/skills/consistency-audit/claims-audit.js on the fake home. The hand-written test suite
# in this repo's tests/ exercises all four claim types (pass and fail each), plus every claim
# type's missing-cite path, plus the cross-claim resilience regression (a broken claim mid-batch
# must not swallow later ones - that was attempt 2's silent crash-and-exit-2 bug). Wiring it here
# is what turns "a file that could regress" into a gate that catches the regression. Runs against
# the RESTORED engine from the fake home - not the mirror in the clone - because a broken restore
# that dropped the engine must fail this check, not silently fall back to the mirror.
$claimsAuditTest = Join-Path $Clone 'tests\claims-audit.test.js'
$restoredEngine  = Join-Path $FakeHome '.claude\skills\consistency-audit\claims-audit.js'
if ((Test-Path $claimsAuditTest) -and (Test-Path $restoredEngine)) {
    $env:CLAIMS_AUDIT_ENGINE = $restoredEngine
    $out = & node --test $claimsAuditTest 2>&1
    $claimsExit = $LASTEXITCODE
    Remove-Item Env:\CLAIMS_AUDIT_ENGINE
    Check 'restored claims-audit.js passes tests/claims-audit.test.js' ($claimsExit -eq 0) @($out | Select-Object -Last 20)
} else {
    $detail = @()
    if (-not (Test-Path $claimsAuditTest)) { $detail += ("tests/claims-audit.test.js missing in clone: {0}" -f $claimsAuditTest) }
    if (-not (Test-Path $restoredEngine))  { $detail += ("engine not restored under fake home: {0}" -f $restoredEngine) }
    Check 'restored claims-audit.js passes tests/claims-audit.test.js' $false $detail
}

# ------------------------------------------------------------------ 9d. issue-87 CRLF-blob byte stability

# Issue 87: fresh worktrees under the repo's worktree directory used to show phantom modifications
# on .claude/session.json, .claude/settings.json and .claude/workflows/ticket-fleet.js. Root cause:
# `.gitattributes` sets `* -text` for the whole repo (correct for the byte-mirror trees), so git
# does NO EOL conversion. Any Windows text-mode writer that re-serializes these three files at
# session start (Claude Code, VS Code default save on Windows, PowerShell 5.1 `Get-Content` +
# `Set-Content`, an installer's rewrite) produces CRLF byte-for-byte; against an LF blob, that is
# a stat mismatch and `git status --porcelain` reports ` M` while `git diff -w --ignore-cr-at-eol`
# is empty.
#
# The fix stored these three files as CRLF in the blob so any Windows writer's CRLF re-serialization
# is byte-identical to the blob and status stays clean. Two invariants to gate:
#   1. Fresh clone carries CRLF bytes for all three files (would fail under `text eol=lf` or an
#      autocrlf conversion path that stripped the CRLF on the way in).
#   2. A byte-preserving CRLF rewrite of any of the three files (the exact effect a Windows
#      writer has) leaves `git status --porcelain` empty.
# Worktree mode skips a real git repo; the byte-check still runs there so the pre-commit gate
# does not silently miss a regression in the blob.
Write-Host ''
Write-Host 'Issue 87 - CRLF blob byte stability'

$issue87Files = @(
    (Join-Path $Clone '.claude\session.json'),
    (Join-Path $Clone '.claude\settings.json')
)
# The third issue-87 file, .claude/workflows/ticket-fleet.js, moved to aac-skills/ticket-fleet/
# with issue 138; the plugin-served copy is not rewritten by Claude Code at session start.
$missing = @($issue87Files | Where-Object { -not (Test-Path $_) })
if ($missing.Count -gt 0) {
    Check 'issue-87 target files present in clone' $false @('one of session.json / settings.json missing from the clone: ' + ($missing -join '; '))
} else {
    $nonCrlf = @()
    foreach ($f in $issue87Files) {
        $bytes = [System.IO.File]::ReadAllBytes($f)
        $hasCrlf = $false
        for ($i = 0; $i -lt ($bytes.Length - 1); $i++) {
            if ($bytes[$i] -eq 13 -and $bytes[$i + 1] -eq 10) { $hasCrlf = $true; break }
        }
        if (-not $hasCrlf) { $nonCrlf += (Split-Path -Leaf $f) }
    }
    if ($nonCrlf.Count -eq $issue87Files.Count) {
        # A clone from an older ref (default -From origin against an origin/master tip that
        # predates the fix) simply has no CRLF blob to test yet. Note the skip: reporting FAIL
        # against an older ref would gate every restore run on this branch merging, and reporting
        # a silent pass would let the fix regress unnoticed after landing. -From local and -From
        # worktree run against this checkout, so they DO exercise the fix while origin catches up.
        Note ("skipped: fresh clone has LF blobs for both files (older ref, no fix yet); From={0}" -f $From)
    } else {
        Check 'both files land as CRLF bytes in the fresh clone' `
            ($nonCrlf.Count -eq 0) $nonCrlf

        if ($From -ne 'worktree') {
            # Fresh clone must be clean up-front (a mistuned fixture would give a false pass for the
            # byte-stability check below).
            $preStatus = & git -C $Clone status --porcelain -- '.claude/session.json' '.claude/settings.json' 2>&1
            $preStatusStr = ($preStatus | Out-String).Trim()
            Check 'fresh clone git status is clean on the three files' `
                ([string]::IsNullOrWhiteSpace($preStatusStr)) @("git status: [$preStatusStr]")

            # Snapshot originals for guaranteed restore, then run the byte-preserving Windows
            # text-writer default: strip existing CR, add CRLF. On the CRLF blob this produces the
            # exact same bytes and status must stay clean; on an LF blob it would flip to CRLF and
            # status would show ` M` (the phantom this ticket exists to kill).
            $originals = @{}
            foreach ($f in $issue87Files) { $originals[$f] = [System.IO.File]::ReadAllBytes($f) }
            try {
                foreach ($f in $issue87Files) {
                    $bytes = $originals[$f]
                    $out = New-Object System.Collections.Generic.List[byte]
                    for ($i = 0; $i -lt $bytes.Length; $i++) {
                        if ($bytes[$i] -eq 13) { continue }
                        if ($bytes[$i] -eq 10) { [void]$out.Add(13); [void]$out.Add(10) }
                        else { [void]$out.Add($bytes[$i]) }
                    }
                    [System.IO.File]::WriteAllBytes($f, $out.ToArray())
                }
                $postStatus = & git -C $Clone status --porcelain -- '.claude/session.json' '.claude/settings.json' 2>&1
                $postStatusStr = ($postStatus | Out-String).Trim()
                Check 'byte-preserving Windows-style CRLF rewrite leaves git status clean' `
                    ([string]::IsNullOrWhiteSpace($postStatusStr)) @("git status: [$postStatusStr]")
            } finally {
                foreach ($f in $issue87Files) {
                    try { [System.IO.File]::WriteAllBytes($f, $originals[$f]) } catch {}
                }
            }
        } else {
            Note 'worktree mode: no git repo, byte-stability check via clone modes only'
        }
    }
}

# ------------------------------------------------------------------ 10. two runs can overlap

# The regression check for the false failure of 2026-08-13. Two children run the scratch-root code
# path at the same time; each must still own its marker when it wakes. Under the old constant root
# the second child's wipe took the first child's marker with it and both runs reported failure.
Write-Host ''
Write-Host 'Concurrency'

$probeArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $SelfPath,
               '-Probe', '-ProbeHoldMs', '2000')
# The fault reinstates the old behaviour by handing both children one fixed root, which is
# exactly what the constant used to do to every run on the machine.
if ($Fault -eq 'collision') {
    $probeArgs += @('-FakeHome', (Join-Path $ScratchBase 'collision\Users\Restored'))
    Note 'fault: both concurrent runs were pinned to one scratch root'
}

# Start-Job, not Start-Process -PassThru: on PowerShell 5.1 the process object returned by
# Start-Process without -Wait comes back with an empty ExitCode, so a crashed child read as a pass.
# Inside a job, $LASTEXITCODE is the child's own, and both jobs still run as separate processes.
$jobs = @(1, 2 | ForEach-Object {
    Start-Job -ArgumentList (, $probeArgs) -ScriptBlock {
        param($childArgs)
        $out = & powershell @childArgs 2>&1
        [pscustomobject]@{ Exit = $LASTEXITCODE; Out = ($out | Out-String) }
    }
})
$results    = @($jobs | Wait-Job | Receive-Job)
$jobs | Remove-Job -Force
$probeLines = @($results | ForEach-Object { $_.Out -split "`r?`n" } | Where-Object { $_ -match '^probe ' })
$clobbered  = @($probeLines | Where-Object { $_ -match 'CLOBBERED' })
$exits      = @($results | ForEach-Object { if ($null -eq $_.Exit) { 'null' } else { $_.Exit } })
$bothOk     = (@($exits | Where-Object { $_ -ne 0 }).Count -eq 0) -and ($clobbered.Count -eq 0) -and
              ($probeLines.Count -eq 2)
Check 'two overlapping runs both keep their scratch directory' $bothOk `
    (@(("exit codes: {0}" -f ($exits -join ', '))) + $probeLines)

$roots = @($probeLines | ForEach-Object { ($_ -split ' root ')[1] -replace ' (intact|CLOBBERED)$', '' })
Check 'each run derives its own scratch root' `
    (($roots.Count -eq 2) -and ($roots[0] -ne $roots[1])) $roots

# ------------------------------------------------------------------ verdict

# Holds the clone open for the rest of the run, which is what a child process left over from check
# 9 does by accident. A passing run must still report a pass; the scratch is the tidying up.
if ($Fault -eq 'locked-scratch') {
    $lock = [System.IO.File]::Open((Join-Path $Clone 'README.md'), 'Open', 'Read', 'None')
    Note 'fault: something is holding the scratch directory open'
}

Write-Host ''
# node --test's shape, because that is what the dashboard's testSummary() parses. Without these two
# lines it falls through to the last line printed and the health line reads "Scratch removed."
Write-Host ("pass {0}" -f ($script:Checks - $script:Failures))
Write-Host ("fail {0}" -f $script:Failures)
Write-Host ''
if ($script:Failures -eq 0) {
    Write-Host ("RESTORE PROVEN - {0} checks, 0 failures" -f $script:Checks) -ForegroundColor Green
} else {
    Write-Host ("RESTORE NOT PROVEN - {0} of {1} checks failed" -f $script:Failures, $script:Checks) -ForegroundColor Red

    # A hook that swallows stdout leaves a failure with no evidence behind it, and an intermittent
    # one then cannot be diagnosed after the fact - which is exactly the position a run at
    # 2026-08-13 16:44 UTC left this repo in. The log outlives the run.
    $logDir = Join-Path $env:TEMP 'restore-test-failures'
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $stamp   = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $logPath = Join-Path $logDir ("{0}-{1}.log" -f $stamp, $PID)
    $header  = @(
        ("when      {0}" -f (Get-Date).ToString('o')),
        ("from      {0}" -f $From),
        ("fault     {0}" -f $Fault),
        ("fakeHome  {0}" -f $FakeHome),
        ("repo      {0}" -f $RepoRoot),
        ("commit    {0}" -f (& git -C $RepoRoot rev-parse --short HEAD 2>&1)),
        ("verdict   {0} of {1} checks failed" -f $script:Failures, $script:Checks),
        ''
    )
    Set-Content -Path $logPath -Value ($header + $script:FailLog) -Encoding utf8
    Write-Host ("Failure detail written to {0}" -f $logPath) -ForegroundColor Red
}

if ($Keep) {
    Write-Host ("Left in place: {0}" -f $FakeRoot)
} else {
    # Check 9 runs the restored session-check inside the clone, and its own children (git, gh, a
    # nested run) can still hold that directory a moment after it returns. With
    # $ErrorActionPreference = 'Stop' the failed delete ended the script non-zero, so a run whose
    # 21 checks all passed reported "tests FAIL" to the session hooks - observed 2026-08-13 16:44
    # UTC and again in the pre-commit gate. Tidying up is not a check, and must not decide the
    # verdict: retry briefly, then leave it for the next run's sweep and say so.
    $removed = $false
    for ($attempt = 1; $attempt -le 5 -and -not $removed; $attempt++) {
        try {
            Remove-Item -Path $FakeRoot -Recurse -Force -ErrorAction Stop
            $removed = $true
        } catch {
            Start-Sleep -Milliseconds 400
        }
    }
    if ($removed) {
        Write-Host 'Scratch removed.'
    } else {
        Write-Host ("Scratch still locked, left at {0} - a later run sweeps it." -f $FakeRoot) -ForegroundColor DarkGray
    }
}

if ($script:Failures -gt 0) { exit 1 }
exit 0
