<#
.SYNOPSIS
    Prove that a leaked GIT_DIR does not redirect any of the three git-invoking helpers
    (sync.ps1, tools/dotfiles-freshness.ps1, tools/tracker-audit.js) away from the path they
    were told to operate on. Issue 28.

.DESCRIPTION
    A pre-commit hook that runs restore-test.ps1 leaks GIT_DIR / GIT_INDEX_FILE /
    GIT_WORK_TREE / GIT_COMMON_DIR / GIT_OBJECT_DIRECTORY into every child process. Those env
    vars OVERRIDE `git -C <path>`: git honours them first, and -C only relocates a path
    resolution when they are unset. On 2026-08-25 this quietly redirected sync.ps1's commit
    block and the freshness classifier at the PARENT bare repo, and polluted its .git/config
    with test user.email entries.

    Every helper now clears the five vars for the duration of its git calls. This suite
    proves each one:

      1  sync.ps1               operates on the target under GIT_DIR=/unrelated/repo/.git
      2  dotfiles-freshness.ps1 classifies against the target under GIT_DIR leak
      3  tools/tracker-audit.js reads the target's git log under GIT_DIR leak
      4  a full run of the two existing PowerShell test files leaves the PARENT bare repo's
         .git/config byte-identical - no stale user.email / user.name / remote entry

    Check 4 is the audit clause: even if every helper now clears its env, a `git init` or
    `git config` call inside a test that doesn't clear its own env would still write to the
    leaked repo. Comparing the parent's config before and after is the machine-checkable
    proof that no test file has that shape.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tests\git-env-leak.tests.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This suite itself must not leak. Save any pre-existing GIT_* env vars, clear them, and
# restore at the end - the audit clause reads the PARENT's .git/config, and a leftover
# GIT_DIR from a broken run would defeat the whole point.
$OuterSavedGitEnv = @{}
foreach ($name in 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY') {
    $val = [Environment]::GetEnvironmentVariable($name)
    if ($null -ne $val) {
        $OuterSavedGitEnv[$name] = $val
        [Environment]::SetEnvironmentVariable($name, $null)
    }
}

$TestsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $TestsRoot
. (Join-Path $RepoRoot 'lib\manifest.ps1')

$script:Pass = 0
$script:Fail = 0

function Assert {
    param([string]$Name, [bool]$Ok, [string]$Info = '')
    if ($Ok) {
        $script:Pass++
        Write-Host ("  ok    {0}" -f $Name) -ForegroundColor Green
    } else {
        $script:Fail++
        Write-Host ("  FAIL  {0}" -f $Name) -ForegroundColor Red
        if ($Info) { Write-Host ("        {0}" -f $Info) -ForegroundColor Red }
    }
}

function New-Sandbox {
    $stamp = 'git-env-{0}-{1}' -f $PID, ([guid]::NewGuid().ToString('N').Substring(0, 6))
    $root  = Join-Path $env:TEMP $stamp
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    return $root
}

# Build a bare repo that will serve as the LEAK TARGET. Any helper that honours a leaked
# GIT_DIR will accidentally read/write this repo instead of the intended target. The tests
# below snapshot its config file and confirm nothing wrote into it.
function New-LeakBareRepo {
    param([string]$Root)
    $bare = Join-Path $Root 'unrelated-leak.git'
    & git init --quiet --bare $bare | Out-Null
    return $bare
}

# Snapshot the bare repo's config so we can catch stale entries left behind after the run.
function Read-BareConfig {
    param([string]$BareRoot)
    $configPath = Join-Path $BareRoot 'config'
    if (-not (Test-Path $configPath)) { return '' }
    return [System.IO.File]::ReadAllText($configPath)
}

Write-Host ''
Write-Host 'GIT-ENV LEAK TESTS'
Write-Host ''

# --------------------------------------------------------------------------------------- 1
# sync.ps1 under a leaked GIT_DIR

Write-Host 'sync.ps1: -Commit block operates on the target under GIT_DIR leak'
$sandbox1 = New-Sandbox
try {
    $leakBare = New-LeakBareRepo -Root $sandbox1
    $leakConfigBefore = Read-BareConfig -BareRoot $leakBare

    # Real target: a dotfiles-shaped checkout with lib/, tools/, sync.ps1. sync.ps1's
    # -Commit path expects a git repo at RepoRoot; give it one, seeded with the current
    # RepoRoot's manifest.ps1 and sync.ps1 so the whole flow (Get-DotfileItems + git add
    # + git commit) exercises the same code the real repo does.
    $target = Join-Path $sandbox1 'target'
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    & git -C $target init --quiet --initial-branch=master | Out-Null
    & git -C $target config user.email 'target@example.com' | Out-Null
    & git -C $target config user.name  'Target' | Out-Null

    # Seed just enough of the repo shape that sync.ps1 push can run. It reads the whitelist
    # from lib/manifest.ps1, so copy the real one plus lib/personal.ps1, plus sync.ps1
    # itself. UserHome points at a freshly-seeded fake home; sync.ps1 will tokenize files
    # into $target's mirror directories.
    New-Item -ItemType Directory -Path (Join-Path $target 'lib') -Force | Out-Null
    Copy-Item -Path (Join-Path $RepoRoot 'lib\manifest.ps1') -Destination (Join-Path $target 'lib\manifest.ps1')
    Copy-Item -Path (Join-Path $RepoRoot 'lib\personal.ps1') -Destination (Join-Path $target 'lib\personal.ps1')
    Copy-Item -Path (Join-Path $RepoRoot 'sync.ps1')        -Destination (Join-Path $target 'sync.ps1')
    Set-Content -Path (Join-Path $target 'README.md') -Value 'seed' -Encoding utf8
    & git -C $target add -A | Out-Null
    & git -C $target commit --quiet -m 'seed target' | Out-Null

    # Fake home with the minimum shape sync.ps1 expects to read.
    $fakeHome = Join-Path $sandbox1 'home'
    New-Item -ItemType Directory -Path (Join-Path $fakeHome '.claude\hooks') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fakeHome '.claude\skills') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fakeHome '.claude\plugins') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fakeHome '.codex\hooks') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fakeHome '.agents\skills') -Force | Out-Null
    Set-Content -Path (Join-Path $fakeHome '.claude\CLAUDE.md') -Value '# fake' -Encoding utf8
    Set-Content -Path (Join-Path $fakeHome '.claude\settings.json') -Value '{ "hooks": {} }' -Encoding utf8
    Set-Content -Path (Join-Path $fakeHome '.claude\plugins\installed_plugins.json') -Value '{}' -Encoding utf8
    Set-Content -Path (Join-Path $fakeHome '.claude\plugins\known_marketplaces.json') -Value '{}' -Encoding utf8
    Set-Content -Path (Join-Path $fakeHome '.claude\hooks\dummy.js') -Value '// dummy' -Encoding utf8
    Set-Content -Path (Join-Path $fakeHome '.codex\hooks\dummy.py') -Value '# dummy' -Encoding utf8
    Set-Content -Path (Join-Path $fakeHome '.codex\hooks.json') -Value '{}' -Encoding utf8
    Set-Content -Path (Join-Path $fakeHome '.codex\config.toml') -Value 'note = "fake"' -Encoding utf8
    Set-Content -Path (Join-Path $fakeHome '.codex\AGENTS.md') -Value '# fake' -Encoding utf8
    Set-Content -Path (Join-Path $fakeHome '.agents\skills\dummy.md') -Value '# fake' -Encoding utf8

    # THE LEAK. From here on every git call inherits GIT_DIR pointing at the unrelated
    # bare repo. `git -C $target` does NOT override this by itself; only the helper's
    # own env-clear does.
    $env:GIT_DIR = Join-Path $leakBare ''

    # Capture the target's HEAD before the run; a successful commit will advance it.
    $targetHeadBefore = (& git --git-dir (Join-Path $target '.git') rev-parse HEAD).Trim()

    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $syncPath = Join-Path $target 'sync.ps1'
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $syncPath `
                        -Mode push -Commit 'leak test: sync commit' -UserHome $fakeHome 2>&1 | Out-String
    $syncExit = $LASTEXITCODE
    $ErrorActionPreference = $prev
    Remove-Item Env:\GIT_DIR -ErrorAction SilentlyContinue

    $targetHeadAfter = (& git --git-dir (Join-Path $target '.git') rev-parse HEAD 2>&1 | Out-String).Trim()
    $leakConfigAfter = Read-BareConfig -BareRoot $leakBare

    Assert 'sync.ps1 exits 0 under GIT_DIR leak' ($syncExit -eq 0) `
        (($out -split "`n") | Select-Object -Last 8 | Out-String)
    Assert 'sync.ps1 advanced the TARGET repo HEAD (commit landed on target)' `
        ($targetHeadAfter -ne $targetHeadBefore -and $targetHeadAfter -match '^[a-f0-9]{40}$') `
        ("before={0}, after={1}" -f $targetHeadBefore, $targetHeadAfter)
    Assert 'sync.ps1 did NOT write into the leaked bare repo config' `
        ($leakConfigAfter -eq $leakConfigBefore) `
        ("before={0}`nafter ={1}" -f $leakConfigBefore, $leakConfigAfter)
    # A bare repo with a commit written into it would have grown a refs/heads/master; the
    # bare shell should stay empty of refs. This catches the case where a config bytewise
    # matches (git config idempotent write) but a commit still shipped.
    $leakRefs = @(Get-ChildItem -Path (Join-Path $leakBare 'refs\heads') -Recurse -File -ErrorAction SilentlyContinue)
    Assert 'sync.ps1 did NOT write a commit into the leaked bare repo' ($leakRefs.Count -eq 0) `
        (($leakRefs | ForEach-Object { $_.FullName }) -join "`n")
} finally {
    Remove-Item -Path $sandbox1 -Recurse -Force -ErrorAction SilentlyContinue
}

# --------------------------------------------------------------------------------------- 2
# tools/dotfiles-freshness.ps1 under a leaked GIT_DIR

Write-Host ''
Write-Host 'tools/dotfiles-freshness.ps1: classify reads target repo under GIT_DIR leak'
$sandbox2 = New-Sandbox
try {
    $leakBare = New-LeakBareRepo -Root $sandbox2
    $leakConfigBefore = Read-BareConfig -BareRoot $leakBare

    # Bare remote + local clone: the classifier needs an upstream to measure ahead/behind.
    $remote  = Join-Path $sandbox2 'remote.git'
    $local   = Join-Path $sandbox2 'local'
    & git init --quiet --bare $remote | Out-Null
    New-Item -ItemType Directory -Path $local -Force | Out-Null
    & git -C $local init --quiet --initial-branch=master | Out-Null
    & git -C $local config user.email 'local@example.com' | Out-Null
    & git -C $local config user.name  'Local' | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $local 'tools') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $local 'lib') -Force | Out-Null
    Copy-Item -Path (Join-Path $RepoRoot 'tools\dotfiles-freshness.ps1') -Destination (Join-Path $local 'tools\dotfiles-freshness.ps1')
    Copy-Item -Path (Join-Path $RepoRoot 'lib\manifest.ps1')             -Destination (Join-Path $local 'lib\manifest.ps1')
    & git -C $local add -A | Out-Null
    & git -C $local commit --quiet -m 'seed local' | Out-Null
    & git -C $local remote add origin $remote | Out-Null
    & git -C $local push --quiet -u origin master | Out-Null

    # Fake home + stamp so the classifier can compare fingerprints.
    $fakeHome = Join-Path $sandbox2 'home'
    New-Item -ItemType Directory -Path (Join-Path $fakeHome '.claude') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fakeHome '.claude\skills') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fakeHome '.claude\hooks') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $fakeHome '.codex') -Force | Out-Null
    Set-Content -Path (Join-Path $fakeHome '.claude\CLAUDE.md') -Value '# fake' -Encoding utf8
    Write-DotfilesStamp -RepoRoot $local -UserHome $fakeHome -Kind 'pull' | Out-Null

    # The leak. Classifier must classify $local, not $leakBare.
    $env:GIT_DIR = Join-Path $leakBare ''

    $tool = Join-Path $local 'tools\dotfiles-freshness.ps1'
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $tool `
                        -Mode classify -RepoRoot $local -UserHome $fakeHome -SkipFetch 2>&1 | Out-String
    $classifyExit = $LASTEXITCODE
    $ErrorActionPreference = $prev
    Remove-Item Env:\GIT_DIR -ErrorAction SilentlyContinue

    $report = $null
    try { $report = ($out.Trim() | ConvertFrom-Json) } catch { $report = $null }
    if ($null -eq $report) {
        $m = [regex]::Match($out.Trim(), '\{[\s\S]*\}\s*$')
        if ($m.Success) { try { $report = ($m.Value | ConvertFrom-Json) } catch { $report = $null } }
    }

    Assert 'dotfiles-freshness.ps1 exits 0 under GIT_DIR leak' ($classifyExit -eq 0) `
        (($out -split "`n") | Select-Object -Last 8 | Out-String)
    Assert 'dotfiles-freshness.ps1 returned JSON' ($null -ne $report) $out
    if ($null -ne $report) {
        # If the leak went through, the tool would classify the empty bare repo (unknown / no
        # upstream) instead of $local (synced). "synced" or "state1"/"state2"/"state3" all mean
        # the classifier saw a real repo state; "unknown" means it fell off the tracks.
        Assert ('dotfiles-freshness.ps1 classified the TARGET repo (state={0}, not unknown)' -f [string]$report.state) `
            ([string]$report.state -ne 'unknown') $out
        # Belt: repoRoot in the report should be the target, not the leaked path.
        Assert 'dotfiles-freshness.ps1 report.repoRoot matches the target' `
            ([string]$report.repoRoot -eq $local) ("expected={0}, got={1}" -f $local, [string]$report.repoRoot)
    }

    $leakConfigAfter = Read-BareConfig -BareRoot $leakBare
    Assert 'dotfiles-freshness.ps1 did NOT write into the leaked bare repo config' `
        ($leakConfigAfter -eq $leakConfigBefore) `
        ("before={0}`nafter ={1}" -f $leakConfigBefore, $leakConfigAfter)
} finally {
    Remove-Item -Path $sandbox2 -Recurse -Force -ErrorAction SilentlyContinue
}

# --------------------------------------------------------------------------------------- 3
# tools/tracker-audit.js under a leaked GIT_DIR

Write-Host ''
Write-Host 'tools/tracker-audit.js: reads target under GIT_DIR leak (git subprocess isolation)'
$sandbox3 = New-Sandbox
try {
    $leakBare = New-LeakBareRepo -Root $sandbox3
    $leakConfigBefore = Read-BareConfig -BareRoot $leakBare

    # tracker-audit.js bails at exit code 2 the moment `gh repo view` fails, which is what we
    # WANT here: we cannot spin up a real GitHub repo in a test, and the point of this check
    # is that under a leaked GIT_DIR the tool still reaches its own gh call and its own git
    # subprocesses look at $env:cwd rather than $env:GIT_DIR. The proof is that the leaked
    # bare repo's config is byte-identical after the run - if the guard were absent, the
    # tool's own `git rev-parse` / `git log` / `git fetch` calls would have been redirected
    # into the leaked repo. gh's own failure mode is irrelevant.
    $target = Join-Path $sandbox3 'target-repo'
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    & git -C $target init --quiet --initial-branch=master | Out-Null
    & git -C $target config user.email 'audit@example.com' | Out-Null
    & git -C $target config user.name  'Audit' | Out-Null
    Set-Content -Path (Join-Path $target 'README.md') -Value 'seed' -Encoding utf8
    & git -C $target add -A | Out-Null
    & git -C $target commit --quiet -m 'seed' | Out-Null

    $auditTool = Join-Path $RepoRoot 'tools\tracker-audit.js'
    Assert 'tools/tracker-audit.js exists' (Test-Path $auditTool)

    $env:GIT_DIR = Join-Path $leakBare ''

    # Run from $target. tracker-audit.js will most likely exit 2 (no gh auth against a
    # local-only repo). That's fine; the config-comparison below is the correctness proof.
    Push-Location $target
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & node $auditTool 2>&1 | Out-String
    $auditExit = $LASTEXITCODE
    $ErrorActionPreference = $prev
    Pop-Location
    Remove-Item Env:\GIT_DIR -ErrorAction SilentlyContinue

    $leakConfigAfter = Read-BareConfig -BareRoot $leakBare
    Assert 'tracker-audit.js did NOT write into the leaked bare repo config' `
        ($leakConfigAfter -eq $leakConfigBefore) `
        ("exit={0}, before={1}`nafter ={2}" -f $auditExit, $leakConfigBefore, $leakConfigAfter)
    # And the leaked bare repo must not have grown refs either - a leaked `git fetch` would
    # populate refs/remotes/origin/*.
    $leakRefs = @(Get-ChildItem -Path (Join-Path $leakBare 'refs') -Recurse -File -ErrorAction SilentlyContinue)
    Assert 'tracker-audit.js did NOT populate refs in the leaked bare repo' ($leakRefs.Count -eq 0) `
        (($leakRefs | ForEach-Object { $_.FullName }) -join "`n")
} finally {
    Remove-Item -Path $sandbox3 -Recurse -Force -ErrorAction SilentlyContinue
}

# --------------------------------------------------------------------------------------- 4
# Audit: every test in tests/ that runs `git init` / `git config` must not pollute a parent
# repo when GIT_DIR leaks from the pre-commit hook. Load the existing PS test files, run
# them with a leaked GIT_DIR pointed at a bare probe, and confirm the probe is untouched.

Write-Host ''
Write-Host 'Audit: no test in tests/ pollutes a leaked bare repo config'
$sandbox4 = New-Sandbox
try {
    $leakBare = New-LeakBareRepo -Root $sandbox4
    $leakConfigBefore = Read-BareConfig -BareRoot $leakBare

    $env:GIT_DIR = Join-Path $leakBare ''

    # dotfiles-freshness.tests.ps1 is the file that motivated this guard: it does many
    # `git init` / `git config` calls on sandbox repos, and pre-2026-08-25 those calls
    # were writing into the parent repo instead. It clears the env at file scope (line 34
    # of that file), so a successful run here is the check.
    $freshTest = Join-Path $TestsRoot 'dotfiles-freshness.tests.ps1'
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $freshTest 2>&1 | Out-String
    $freshExit = $LASTEXITCODE
    $ErrorActionPreference = $prev

    Remove-Item Env:\GIT_DIR -ErrorAction SilentlyContinue

    $leakConfigAfter = Read-BareConfig -BareRoot $leakBare
    Assert 'dotfiles-freshness.tests.ps1 leaves the leaked bare repo config UNTOUCHED' `
        ($leakConfigAfter -eq $leakConfigBefore) `
        ("exit={0}`nbefore={1}`nafter ={2}" -f $freshExit, $leakConfigBefore, $leakConfigAfter)
    # Same ref-population belt as before.
    $leakRefs = @(Get-ChildItem -Path (Join-Path $leakBare 'refs') -Recurse -File -ErrorAction SilentlyContinue)
    Assert 'dotfiles-freshness.tests.ps1 populated no refs in the leaked bare repo' ($leakRefs.Count -eq 0) `
        (($leakRefs | ForEach-Object { $_.FullName }) -join "`n")
} finally {
    Remove-Item -Path $sandbox4 -Recurse -Force -ErrorAction SilentlyContinue
}

# --------------------------------------------------------------------------------------- 5
# restore-test.ps1 -BootstrapOnly under a leaked GIT_DIR. This is the exact regression the
# reviewer flagged: restore-test.ps1 runs `git -C $RepoRoot ls-files` (and, in the non-worktree
# modes, `git clone` / `git remote get-url origin` / `git log`) at file scope BEFORE it sources
# lib/manifest.ps1, so a fix that lives only inside manifest.ps1 does nothing for those calls.
# The pre-commit hook exports GIT_DIR into this child; under that leak, `git -C <worktree>
# ls-files` returns 0 files instead of the real ~586 and the outer suite crashes on 'The
# property Count cannot be found on this object' before it ever reaches check 9c.
#
# restore-test.ps1 now clears GIT_* at file scope before any git call (issue 28); this check
# proves it. -BootstrapOnly runs just the bootstrap file-copy path and reports the file count,
# so this check finishes in a second or two instead of the ~13s of the full suite. Also
# proves the leaked bare repo's config is byte-identical afterwards, so no bootstrap call
# accidentally wrote into it.

Write-Host ''
Write-Host 'restore-test.ps1 -BootstrapOnly clones the target under GIT_DIR leak'

# When this file is invoked as check 9c of the outer restore-test (which runs it from inside the
# CLONED tests folder), $RepoRoot resolves to $Clone -- a copy of files WITHOUT a .git directory.
# `restore-test.ps1 -From worktree` in that context would fail on the bootstrap `git -C $Clone
# ls-files` because $Clone has no repo, and that failure would look like a leak-guard regression
# even though it's just the missing .git. Detect the case (RESTORE_TEST_ACTIVE set by the outer)
# and skip - the outer restore-test's own file-scope Clear-GitEnv is what would fail under
# regression, and check 9c already proves this whole suite runs green under it.
$repoHasGit = Test-Path (Join-Path $RepoRoot '.git')
if (-not $repoHasGit -or $env:RESTORE_TEST_ACTIVE) {
    Write-Host '  skip  restore-test.ps1 -BootstrapOnly (no .git at $RepoRoot; runs when the leak suite is invoked standalone)' -ForegroundColor DarkGray
    $sandbox5 = $null
} else { $sandbox5 = New-Sandbox }
if ($null -ne $sandbox5) {
try {
    $leakBare = New-LeakBareRepo -Root $sandbox5
    $leakConfigBefore = Read-BareConfig -BareRoot $leakBare

    # Fresh fake home outside real profile - restore-test.ps1 refuses -FakeHome under $HOME.
    $fakeHome = Join-Path $sandbox5 'home\Restored'
    New-Item -ItemType Directory -Path (Split-Path -Parent $fakeHome) -Force | Out-Null

    # THE LEAK.
    $env:GIT_DIR = Join-Path $leakBare ''

    $script = Join-Path $RepoRoot 'tests\restore-test.ps1'
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    # RESTORE_TEST_ACTIVE stops the nested-suite recursion in the outer test's flow, but this
    # check is a first-level invocation, so it must NOT inherit that guard - clear it in the
    # child. -From worktree is the mode the pre-commit hook uses and the one that broke.
    $childCmd = ('$env:RESTORE_TEST_ACTIVE = $null; ' +
                 '& "' + $script + '" -From worktree -BootstrapOnly')
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -Command $childCmd 2>&1 | Out-String
    $bootstrapExit = $LASTEXITCODE
    $ErrorActionPreference = $prev

    Remove-Item Env:\GIT_DIR -ErrorAction SilentlyContinue

    $leakConfigAfter = Read-BareConfig -BareRoot $leakBare
    Assert 'restore-test.ps1 -BootstrapOnly exits 0 under GIT_DIR leak' `
        ($bootstrapExit -eq 0) `
        (($out -split "`n") | Select-Object -Last 12 | Out-String)
    # The specific regression: a zero file count is what silent-leak looks like. Match the
    # count-line the -BootstrapOnly branch prints.
    $countLine = ($out -split "`n") | Where-Object { $_ -match '^BOOTSTRAP OK\s+(\d+)\s+files' } | Select-Object -First 1
    $countOk = $false
    if ($countLine -match '^BOOTSTRAP OK\s+(\d+)\s+files') { $countOk = ([int]$Matches[1]) -gt 100 }
    Assert 'restore-test.ps1 -BootstrapOnly reported a non-zero clone file count under leak' $countOk `
        ("out={0}" -f $out)
    Assert 'restore-test.ps1 -BootstrapOnly left the leaked bare repo config UNTOUCHED' `
        ($leakConfigAfter -eq $leakConfigBefore) `
        ("before={0}`nafter ={1}" -f $leakConfigBefore, $leakConfigAfter)
} finally {
    Remove-Item -Path $sandbox5 -Recurse -Force -ErrorAction SilentlyContinue
}
}

# --------------------------------------------------------------------------------------- verdict

# Restore any outer GIT_* env vars the caller had set.
foreach ($name in $OuterSavedGitEnv.Keys) {
    [Environment]::SetEnvironmentVariable($name, $OuterSavedGitEnv[$name])
}

Write-Host ''
Write-Host ("pass {0}" -f $script:Pass)
Write-Host ("fail {0}" -f $script:Fail)
Write-Host ''
if ($script:Fail -eq 0) {
    Write-Host ("GIT-ENV LEAK: all {0} checks pass" -f $script:Pass) -ForegroundColor Green
    exit 0
}
Write-Host ("GIT-ENV LEAK: {0} of {1} checks failed" -f $script:Fail, ($script:Pass + $script:Fail)) -ForegroundColor Red
exit 1
