<#
.SYNOPSIS
    Prove that a leaked GIT_DIR does not redirect any of the git-invoking helpers
    (tools/tracker-audit.js, restore-test.ps1) away from the path they were told to
    operate on. Issue 28.

.DESCRIPTION
    A git hook that runs restore-test.ps1 leaks GIT_DIR / GIT_INDEX_FILE /
    GIT_WORK_TREE / GIT_PREFIX / GIT_COMMON_DIR / GIT_OBJECT_DIRECTORY into every child
    process. Those env
    vars OVERRIDE `git -C <path>`: git honours them first, and -C only relocates a path
    resolution when they are unset. On 2026-08-25 this quietly redirected sync.ps1's commit
    block and the dotfiles freshness classifier at the PARENT bare repo, and polluted its
    .git/config with test user.email entries.

    Every helper now clears the six vars for the duration of its git calls. This suite
    proves each one:

      2  tools/tracker-audit.js reads the target's git log under GIT_DIR leak
      3  restore-test.ps1       bootstraps the target under GIT_DIR leak

    Three checks have retired; the numbering is kept so an old run's output still lines up.
    With the freshness loop (issue 213): the classifier's own check, and the audit clause that
    ran tests/dotfiles-freshness.tests.ps1 under a leak and compared the parent bare repo's
    config before and after. With sync push (issue 214): check 1, which drove `sync.ps1 -Mode
    push -Commit` — the only git call sync.ps1 ever made. Pull writes files and shells out to
    no VCS, so nothing is left of it to redirect; lib/manifest.ps1 keeps Clear-GitEnv for the
    helpers that still need it.

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
foreach ($name in 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY') {
    $val = [Environment]::GetEnvironmentVariable($name)
    if ($null -ne $val) {
        $OuterSavedGitEnv[$name] = $val
        [Environment]::SetEnvironmentVariable($name, $null)
    }
}

$TestsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $TestsRoot
. (Join-Path $RepoRoot 'lib\manifest.ps1')

# Issue 454: spawn WHICHEVER PowerShell is running this file - powershell.exe under 5.1 on the
# desktop, pwsh under 7 in a Linux container - rather than the literal 'powershell', which exists
# only on Windows. The fallback IS that literal, so the Windows path is unchanged. $env:TEMP is
# Windows-only for the same reason; GetTempPath() returns %TEMP% when it is set.
$Engine   = 'powershell'
try { $Engine = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch { }
$TempRoot = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }

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
    $root  = Join-Path $TempRoot $stamp
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

# --------------------------------------------------------------------------------------- 2
# tools/tracker-audit.js under a leaked GIT_DIR

Write-Host ''
Write-Host 'tools/tracker-audit.js: reads target under GIT_DIR leak (git subprocess isolation)'
$sandbox2 = New-Sandbox
try {
    $leakBare = New-LeakBareRepo -Root $sandbox2
    $leakConfigBefore = Read-BareConfig -BareRoot $leakBare

    # The earlier version of this block asserted only that the leaked bare stayed byte-identical
    # after tracker-audit ran. That was insufficient: tracker-audit exits at code 2 the moment
    # its first gh call fails, and a fake target with no GitHub remote makes it fail. So the tool
    # never reaches the git subprocesses the guard exists to protect, and deleting CHILD_ENV
    # from tracker-audit.js still passes the block. Reviewer proved that (issue 28 attempt3).
    #
    # This version stubs `gh` on PATH so tracker-audit runs to completion, gives the target repo
    # a commit whose body says `Fixes #999`, and stubs the REST /issues endpoint to return #999
    # as an open issue. tracker-audit's landed-but-open check then emits a finding for #999 IFF
    # `git log` ran against the target repo. Under a leaked GIT_DIR without the guard, git log
    # would run against the empty leaked bare and NEITHER the finding nor the target's repo name
    # would appear in output. That is the positive assertion.
    #
    # tracker-audit reads owner/repo from `git remote get-url origin` (REST port, issue 130), so
    # the target repo gets a fake `origin` matching the shim's chosen slug.
    $target = Join-Path $sandbox2 'target-repo'
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    & git -C $target init --quiet --initial-branch=master | Out-Null
    & git -C $target config user.email 'audit@example.com' | Out-Null
    & git -C $target config user.name  'Audit' | Out-Null
    Set-Content -Path (Join-Path $target 'README.md') -Value 'seed' -Encoding utf8
    & git -C $target add -A | Out-Null
    # Body carries the closing keyword; tracker-audit's CLOSING regex reads the whole message.
    & git -C $target commit --quiet -m 'seed' -m 'Fixes #999' | Out-Null

    # A gh shim on PATH. tracker-audit calls `gh api repos/OWNER/REPO`, then pages by hand
    # (`&page=N`, no --paginate: the cloud proxy 403s the numeric-ID next-page URL) through
    # `repos/OWNER/REPO/issues`, `repos/OWNER/REPO/pulls` and `repos/OWNER/REPO/issues/comments`,
    # plus `gh api graphql` (projectItems supplemental — allowed to degrade) and
    # `gh api ... /dependencies/blocked_by`. All get a canned answer here; one short page ends
    # each walk.
    $shimDir = Join-Path $sandbox2 'gh-shim'
    New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
    $shimRepoName = 'tracker-audit-probe/target-{0}' -f ([guid]::NewGuid().ToString('N').Substring(0, 8))
    # Give the target an `origin` remote pointing at the shim's chosen slug; parseGithubSlug
    # reads owner/name off that. A cd-into-target then `git remote get-url origin` returns it.
    & git -C $target remote add origin ("https://github.com/{0}.git" -f $shimRepoName) | Out-Null
    $shimJs = @'
'use strict';
const args = process.argv.slice(2);
// The paged calls carry `--include` since issue 230: tracker-audit splits headers from body on
// the first blank line and reads Link. Answer with the header block real gh prints, or the
// parse sees bare JSON, throws "malformed HTTP response", and the audit exits 2 before #999.
const include = args.includes('--include');
function out(s) {
  process.stdout.write(include ? 'HTTP/2.0 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n\r\n' + s : s);
  process.exit(0);
}
if (args[0] === '--version') out('gh version 0.0.0-shim\n');
if (args[0] === 'api') {
  // First non-flag operand is the REST path (or `graphql`). --paginate / --jq / -f / -F are
  // flags that may sit in front of it. Skip any leading `-`-prefixed args and any values that
  // follow the flags that take one (`-f`, `-F`, `--jq`).
  const flagsWithValue = new Set(['-f', '-F', '--jq', '--header', '-H']);
  let i = 1, apiPath = '';
  while (i < args.length) {
    if (args[i].startsWith('-')) {
      if (flagsWithValue.has(args[i])) i += 2; else i += 1;
    } else { apiPath = args[i]; break; }
  }
  if (apiPath === 'graphql') {
    // projectItems supplemental — return an empty issues page. The audit treats that as "no board
    // data", boardUnavailable stays false, and the two board checks are skipped for lack of cards.
    out(JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } }));
  }
  const repo = process.env.SHIM_REPO_NAME;
  if (apiPath === 'repos/' + repo) {
    out(JSON.stringify({ full_name: repo, default_branch: 'master' }));
  }
  if (apiPath.startsWith('repos/' + repo + '/issues?')) {
    out(JSON.stringify([{
      number: 999,
      title: 'landed-but-open probe',
      state: 'open',
      body: 'probe body',
      labels: [{ name: 'ready-for-agent' }],
      html_url: 'https://example.test/issues/999',
      milestone: { title: 'probe-milestone' },
    }]));
  }
  if (apiPath.startsWith('repos/' + repo + '/pulls')) out('[]');
  if (apiPath.startsWith('repos/' + repo + '/issues/comments')) out('[]');
  if (apiPath.indexOf('/dependencies/blocked_by') !== -1) out('');
}
out('{}');
'@
    Set-Content -Path (Join-Path $shimDir 'gh-shim.js') -Value $shimJs -Encoding utf8
    # cmd shim so `gh` on PATH resolves before the real gh.exe. execSync spawns through cmd.exe
    # on Windows, which picks up `.cmd` ahead of `.exe` when PATHEXT is default.
    $ghCmd = '@echo off' + "`r`n" + 'node "%~dp0gh-shim.js" %*'
    Set-Content -Path (Join-Path $shimDir 'gh.cmd') -Value $ghCmd -Encoding ascii

    $auditTool = Join-Path $RepoRoot 'tools\tracker-audit.js'
    Assert 'tools/tracker-audit.js exists' (Test-Path $auditTool)

    $env:GIT_DIR = Join-Path $leakBare ''
    $savedPath = $env:PATH
    $env:PATH = $shimDir + [IO.Path]::PathSeparator + $env:PATH
    $env:SHIM_REPO_NAME = $shimRepoName

    Push-Location $target
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & node $auditTool 2>&1 | Out-String
    $auditExit = $LASTEXITCODE
    $ErrorActionPreference = $prev
    Pop-Location

    Remove-Item Env:\GIT_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:\SHIM_REPO_NAME -ErrorAction SilentlyContinue
    $env:PATH = $savedPath

    # Positive: the header line names the shim's repo. If the guard failed, `gh repo view` still
    # returns the shim's name (env is fine), so this check on its own does not prove target-git.
    # It proves tracker-audit actually ran instead of exiting 2 early.
    Assert 'tracker-audit.js reached its own gh chain (header names shim repo)' `
        ($out -match [regex]::Escape($shimRepoName)) `
        ("exit={0}`nout={1}" -f $auditExit, $out)
    # Positive: landed-but-open ONLY fires when `git log` on the target returned the seeded
    # commit whose body says `Fixes #999`. A leaked GIT_DIR points at the empty bare — git log
    # there returns nothing, no CLOSING regex hit, no finding. This is the guard-proving check.
    Assert 'tracker-audit.js emitted landed-but-open #999 (git log read the TARGET repo)' `
        ($out -match 'landed-but-open' -and $out -match '#999') `
        ("exit={0}`nout={1}" -f $auditExit, $out)

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
    Remove-Item -Path $sandbox2 -Recurse -Force -ErrorAction SilentlyContinue
}

# --------------------------------------------------------------------------------------- 3
# restore-test.ps1 -BootstrapOnly under a leaked GIT_DIR. This is the exact regression the
# reviewer flagged: restore-test.ps1 runs `git -C $RepoRoot ls-files` (and, in the non-worktree
# modes, `git clone` / `git remote get-url origin` / `git log`) at file scope BEFORE it sources
# lib/manifest.ps1, so a fix that lives only inside manifest.ps1 does nothing for those calls.
# A git hook exports GIT_DIR into this child; under that leak, `git -C <worktree>
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
    $sandbox3 = $null
} else { $sandbox3 = New-Sandbox }
if ($null -ne $sandbox3) {
try {
    $leakBare = New-LeakBareRepo -Root $sandbox3
    $leakConfigBefore = Read-BareConfig -BareRoot $leakBare

    # Fresh fake home outside real profile - restore-test.ps1 refuses -FakeHome under $HOME.
    $fakeHome = Join-Path $sandbox3 'home\Restored'
    New-Item -ItemType Directory -Path (Split-Path -Parent $fakeHome) -Force | Out-Null

    # THE LEAK.
    $env:GIT_DIR = Join-Path $leakBare ''

    $script = Join-Path $RepoRoot 'tests\restore-test.ps1'
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    # RESTORE_TEST_ACTIVE stops the nested-suite recursion in the outer test's flow, but this
    # check is a first-level invocation, so it must NOT inherit that guard - clear it in the
    # child. -From worktree is the mode the automation runs and the one that broke.
    $childCmd = ('$env:RESTORE_TEST_ACTIVE = $null; ' +
                 '& "' + $script + '" -From worktree -BootstrapOnly')
    $out = & $Engine -NoProfile -ExecutionPolicy Bypass -Command $childCmd 2>&1 | Out-String
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
    Remove-Item -Path $sandbox3 -Recurse -Force -ErrorAction SilentlyContinue
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
