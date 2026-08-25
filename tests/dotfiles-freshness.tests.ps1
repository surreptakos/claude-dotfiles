<#
.SYNOPSIS
    Direct end-to-end tests for tools/dotfiles-freshness.ps1 and the stamp helpers
    in lib/manifest.ps1. Runs without a real git remote by staging two throwaway
    git repos (a "remote" bare repo and a "local" clone).

.DESCRIPTION
    Not driven from restore-test.ps1 - that suite has its own scope. This one
    proves:
      - stamp round-trip: write then read reproduces the same JSON shape and
        fingerprint
      - fingerprint stability under tokenization (same live tree, different
        UserHome, must hash the same)
      - classify -> synced, state1, state2, state3, unknown against a controlled
        remote + fake home
      - install-state1 REFUSES when the classifier is not state1 (auto-pull
        never runs while live drift exists)

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tests\dotfiles-freshness.tests.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# When these tests run under a pre-commit hook (restore-test -> here), the outer git commit
# leaks GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE into every child process. Those env vars beat
# `git -C <path>`, so every `git init` / `git add` / `git commit` against our sandbox repos
# would silently operate on the PARENT bare repo instead - which not only broke state1
# detection on 2026-08-25 but also polluted the parent's config file (user.email=test@example.com
# et al). Clear them once, up front, before any git call in this file.
foreach ($name in 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY') {
    if ($null -ne [Environment]::GetEnvironmentVariable($name)) {
        [Environment]::SetEnvironmentVariable($name, $null)
    }
}

$TestsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $TestsRoot
. (Join-Path $RepoRoot 'lib\manifest.ps1')

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
    $stamp = 'df-fresh-{0}-{1}' -f $PID, ([guid]::NewGuid().ToString('N').Substring(0, 6))
    $root  = Join-Path $env:TEMP $stamp
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    return $root
}

function Seed-Home {
    param([string]$HomePath)
    New-Item -ItemType Directory -Path (Join-Path $HomePath '.claude') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $HomePath '.claude\hooks') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $HomePath '.claude\skills') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $HomePath '.claude\plugins') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $HomePath '.codex') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $HomePath '.codex\hooks') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $HomePath '.agents') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $HomePath '.agents\skills') -Force | Out-Null

    Set-Content -Path (Join-Path $HomePath '.claude\CLAUDE.md') -Value "# fake CLAUDE.md" -Encoding utf8
    $settings = @{ hooks = @{}; note = "fake settings for {0}" -f $HomePath } | ConvertTo-Json
    [System.IO.File]::WriteAllText((Join-Path $HomePath '.claude\settings.json'), $settings, (New-Object System.Text.UTF8Encoding($false)))
    Set-Content -Path (Join-Path $HomePath '.claude\plugins\installed_plugins.json') -Value '{}' -Encoding utf8
    Set-Content -Path (Join-Path $HomePath '.claude\plugins\known_marketplaces.json') -Value '{}' -Encoding utf8
    Set-Content -Path (Join-Path $HomePath '.claude\hooks\dummy.js') -Value "// dummy" -Encoding utf8
    Set-Content -Path (Join-Path $HomePath '.codex\hooks\dummy.py') -Value "# dummy" -Encoding utf8
    Set-Content -Path (Join-Path $HomePath '.codex\hooks.json') -Value '{}' -Encoding utf8
    Set-Content -Path (Join-Path $HomePath '.codex\config.toml') -Value 'note = "fake"' -Encoding utf8
    Set-Content -Path (Join-Path $HomePath '.codex\AGENTS.md') -Value '# fake AGENTS' -Encoding utf8
    Set-Content -Path (Join-Path $HomePath '.agents\skills\dummy.md') -Value '# fake skill' -Encoding utf8
}

function Init-FakeRepo {
    param([string]$LocalRoot, [string]$RemoteRoot)
    # A bare remote we can push into. Two local repos will clone from it so we can control
    # who is "ahead" without a network.
    New-Item -ItemType Directory -Path $RemoteRoot -Force | Out-Null
    & git init --quiet --bare $RemoteRoot | Out-Null

    New-Item -ItemType Directory -Path $LocalRoot -Force | Out-Null
    & git -C $LocalRoot init --quiet --initial-branch=master | Out-Null
    & git -C $LocalRoot config user.email "test@example.com" | Out-Null
    & git -C $LocalRoot config user.name  "Test" | Out-Null
    Set-Content -Path (Join-Path $LocalRoot 'README.md') -Value 'seed' -Encoding utf8
    & git -C $LocalRoot add -A | Out-Null
    & git -C $LocalRoot commit --quiet -m 'seed' | Out-Null
    & git -C $LocalRoot remote add origin $RemoteRoot | Out-Null
    & git -C $LocalRoot push --quiet -u origin master | Out-Null
}

function New-RemoteCommit {
    param([string]$RemoteRoot, [string]$Message)
    # Push a new commit onto the remote from an ephemeral clone so the local repo can
    # see "origin ahead" after a fetch.
    $tmp = Join-Path (Split-Path $RemoteRoot -Parent) ('helper-{0}' -f ([guid]::NewGuid().ToString('N').Substring(0, 4)))
    & git clone --quiet $RemoteRoot $tmp | Out-Null
    & git -C $tmp config user.email "helper@example.com" | Out-Null
    & git -C $tmp config user.name  "Helper" | Out-Null
    Add-Content -Path (Join-Path $tmp 'README.md') -Value ("`n" + $Message)
    & git -C $tmp commit --quiet -am $Message | Out-Null
    & git -C $tmp push --quiet | Out-Null
    Remove-Item -Path $tmp -Recurse -Force
}

function Invoke-Tool {
    param([string]$RepoRoot, [string]$UserHome, [string]$Mode, [switch]$SkipFetch)
    $tool = Join-Path $RepoRoot 'tools\dotfiles-freshness.ps1'
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $tool,
                '-Mode', $Mode, '-RepoRoot', $RepoRoot, '-UserHome', $UserHome)
    if ($SkipFetch) { $psArgs += '-SkipFetch' }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & powershell @psArgs 2>&1 | Out-String
        return @{ Exit = $LASTEXITCODE; Out = $out.Trim() }
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Parse-Report {
    param([string]$Text)
    # PowerShell may prepend a warning line; grab the last {...} block just like the driver does.
    $t = $Text.Trim()
    try { return ($t | ConvertFrom-Json) } catch { }
    $m = [regex]::Match($t, '\{[\s\S]*\}\s*$')
    if ($m.Success) { try { return ($m.Value | ConvertFrom-Json) } catch { } }
    return $null
}

Write-Host ''
Write-Host 'DOTFILES FRESHNESS UNIT TESTS'
Write-Host ''

# --- 1. stamp round-trip -------------------------------------------------------

Write-Host 'Stamp round-trip'
$sandbox = New-Sandbox
try {
    $fakeHome  = Join-Path $sandbox 'HomeA'
    Seed-Home  -Home $fakeHome
    $fakeRepo  = Join-Path $sandbox 'RepoA'
    New-Item -ItemType Directory -Path $fakeRepo -Force | Out-Null
    & git init --quiet $fakeRepo | Out-Null
    & git -C $fakeRepo config user.email "test@example.com" | Out-Null
    & git -C $fakeRepo config user.name  "Test" | Out-Null
    Set-Content -Path (Join-Path $fakeRepo 'README.md') -Value 'x' -Encoding utf8
    & git -C $fakeRepo add -A | Out-Null
    & git -C $fakeRepo commit --quiet -m 'x' | Out-Null

    $stampPath = Write-DotfilesStamp -RepoRoot $fakeRepo -UserHome $fakeHome -Kind 'push'
    Assert 'stamp file written' (Test-Path $stampPath) $stampPath
    $stamp = Read-DotfilesStamp -UserHome $fakeHome
    Assert 'stamp reads back' ($null -ne $stamp)
    Assert 'stamp holds the sync kind' ($stamp.kind -eq 'push')
    Assert 'stamp holds a commit sha' ($stamp.syncedCommit -match '^[a-f0-9]{40}$') $stamp.syncedCommit
    Assert 'stamp holds a fingerprint' ($stamp.liveFingerprint -match '^[a-f0-9]{64}$') $stamp.liveFingerprint

    $recomputed = Get-DotfilesFingerprint -UserHome $fakeHome
    Assert 'fingerprint is deterministic across two calls' ($recomputed -eq $stamp.liveFingerprint)

    # Fingerprint stability across username: the same tree relocated to a different fake home
    # (rewritten paths inside CLAUDE.md notwithstanding) must produce the same hash.
    $fakeHomeB = Join-Path $sandbox 'HomeB'
    Seed-Home  -Home $fakeHomeB
    $fingerA = Get-DotfilesFingerprint -UserHome $fakeHome
    $fingerB = Get-DotfilesFingerprint -UserHome $fakeHomeB
    Assert 'fingerprint is username-invariant' ($fingerA -eq $fingerB) ("A={0}`nB={1}" -f $fingerA, $fingerB)
} finally {
    Remove-Item -Path $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}

# --- 2. classify: synced / state1 / state2 / state3 / unknown -----------------

Write-Host ''
Write-Host 'Classify states'
$sandbox2 = New-Sandbox
try {
    $home2  = Join-Path $sandbox2 'Home'
    Seed-Home -Home $home2

    # Build a mini dotfiles repo whose tools/ and lib/ point at OUR real tools. Instead of
    # copying the real repo (slow, and the tests then depend on which files got written), we
    # create a fresh "checkout" whose tools/dotfiles-freshness.ps1 is a symbolic COPY of ours
    # and whose lib/manifest.ps1 is likewise copied. The tool dot-sources lib/manifest.ps1
    # from its RepoRoot, so copying both preserves that contract.
    $remote  = Join-Path $sandbox2 'remote.git'
    $local   = Join-Path $sandbox2 'local'
    Init-FakeRepo -LocalRoot $local -RemoteRoot $remote

    # Drop our real tools and lib into the local checkout so the tool has something to run.
    New-Item -ItemType Directory -Path (Join-Path $local 'tools') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $local 'lib') -Force | Out-Null
    Copy-Item -Path (Join-Path $RepoRoot 'tools\dotfiles-freshness.ps1') -Destination (Join-Path $local 'tools\dotfiles-freshness.ps1') -Force
    Copy-Item -Path (Join-Path $RepoRoot 'lib\manifest.ps1')             -Destination (Join-Path $local 'lib\manifest.ps1')             -Force
    # personal.ps1 is dot-sourced by sync.ps1 (not the tool) but easier to carry the pair.
    if (Test-Path (Join-Path $RepoRoot 'lib\personal.ps1')) {
        Copy-Item -Path (Join-Path $RepoRoot 'lib\personal.ps1') -Destination (Join-Path $local 'lib\personal.ps1') -Force
    }
    & git -C $local add -A | Out-Null
    & git -C $local commit --quiet -m 'tools' | Out-Null
    & git -C $local push --quiet | Out-Null

    # SYNCED: stamp now, no remote drift, no live drift.
    Write-DotfilesStamp -RepoRoot $local -UserHome $home2 -Kind 'pull' | Out-Null
    $r = Invoke-Tool -RepoRoot $local -UserHome $home2 -Mode 'classify'
    $report = Parse-Report $r.Out
    Assert 'classify: synced reports state=synced' (($null -ne $report) -and ($report.state -eq 'synced')) $r.Out

    # STATE2 (live drift only): touch a live file, do NOT push a new remote commit.
    Add-Content -Path (Join-Path $home2 '.claude\CLAUDE.md') -Value "`nlocal edit"
    $r = Invoke-Tool -RepoRoot $local -UserHome $home2 -Mode 'classify'
    $report = Parse-Report $r.Out
    Assert 'classify: live drift only reports state=state2' (($null -ne $report) -and ($report.state -eq 'state2') -and $report.liveDrift) $r.Out

    # STATE3 (both diverged): keep the live edit, add a remote commit.
    New-RemoteCommit -RemoteRoot $remote -Message 'incoming'
    $r = Invoke-Tool -RepoRoot $local -UserHome $home2 -Mode 'classify'
    $report = Parse-Report $r.Out
    Assert 'classify: both diverged reports state=state3' (($null -ne $report) -and ($report.state -eq 'state3') -and $report.liveDrift) $r.Out

    # install-state1 MUST refuse in state3 (auto-pull guard).
    $r = Invoke-Tool -RepoRoot $local -UserHome $home2 -Mode 'install-state1'
    $installReport = Parse-Report $r.Out
    Assert 'install-state1 refuses in state3' (($null -ne $installReport) -and ($installReport.ok -eq $false)) $r.Out
    Assert 'install-state1 refusal names the state' (($null -ne $installReport) -and ($installReport.state -eq 'state3')) $r.Out
    Assert 'install-state1 refusal exits nonzero' ($r.Exit -ne 0) ("exit={0}" -f $r.Exit)

    # STATE1 (origin ahead, live clean): revert live edit, re-stamp, then re-run classify.
    Set-Content -Path (Join-Path $home2 '.claude\CLAUDE.md') -Value "# fake CLAUDE.md" -Encoding utf8
    Write-DotfilesStamp -RepoRoot $local -UserHome $home2 -Kind 'pull' | Out-Null
    # The re-stamp captures the current HEAD (still 2 commits behind after the incoming push
    # since we have not pulled). Fetch is done by the tool itself; ahead/behind is measured
    # against the freshly-fetched origin. So state1 requires stamping BEFORE the next remote
    # commit and BEFORE the next fetch reveals it - which is exactly the scenario we want.
    New-RemoteCommit -RemoteRoot $remote -Message 'another incoming'
    $r = Invoke-Tool -RepoRoot $local -UserHome $home2 -Mode 'classify'
    $report = Parse-Report $r.Out
    Assert 'classify: origin ahead + live clean reports state=state1' (($null -ne $report) -and ($report.state -eq 'state1') -and (-not $report.liveDrift)) $r.Out
    # If state=state1 the resolution list is set by literal; empty means the JSON round-trip lost
    # array shape - dump the raw output to help diagnose next time it happens.
    $stateOneOut = $r.Out
    Assert 'state1 lists incoming commits' (($null -ne $report) -and ($report.incomingCommits.Count -gt 0)) ("count={0}`nout={1}" -f $report.incomingCommits.Count, $stateOneOut)
    Assert 'state1 resolution names the ff-only pull first' (($null -ne $report) -and (($report.resolution -join '|') -match 'git pull --ff-only')) ("res={0}`nout={1}" -f ($report.resolution -join '|'), $stateOneOut)

} finally {
    Remove-Item -Path $sandbox2 -Recurse -Force -ErrorAction SilentlyContinue
}

# --- 3. classify: unknown (no stamp) ------------------------------------------

Write-Host ''
Write-Host 'Classify: no stamp (unknown, silent)'
$sandbox3 = New-Sandbox
try {
    $home3 = Join-Path $sandbox3 'Home'
    Seed-Home -Home $home3

    $remote  = Join-Path $sandbox3 'remote.git'
    $local   = Join-Path $sandbox3 'local'
    Init-FakeRepo -LocalRoot $local -RemoteRoot $remote
    New-Item -ItemType Directory -Path (Join-Path $local 'tools') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $local 'lib') -Force | Out-Null
    Copy-Item -Path (Join-Path $RepoRoot 'tools\dotfiles-freshness.ps1') -Destination (Join-Path $local 'tools\dotfiles-freshness.ps1') -Force
    Copy-Item -Path (Join-Path $RepoRoot 'lib\manifest.ps1')             -Destination (Join-Path $local 'lib\manifest.ps1')             -Force

    $r = Invoke-Tool -RepoRoot $local -UserHome $home3 -Mode 'classify'
    $report = Parse-Report $r.Out
    Assert 'no stamp reports state=unknown' (($null -ne $report) -and ($report.state -eq 'unknown')) $r.Out

    # install-state1 MUST refuse in unknown too (never auto-pull without a known baseline).
    $r = Invoke-Tool -RepoRoot $local -UserHome $home3 -Mode 'install-state1'
    $inst = Parse-Report $r.Out
    Assert 'install-state1 refuses without a stamp' (($null -ne $inst) -and ($inst.ok -eq $false)) $r.Out
} finally {
    Remove-Item -Path $sandbox3 -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("pass {0}" -f $script:Pass)
Write-Host ("fail {0}" -f $script:Fail)
Write-Host ''
if ($script:Fail -eq 0) {
    Write-Host ("DOTFILES FRESHNESS: all {0} checks pass" -f $script:Pass) -ForegroundColor Green
    exit 0
}
Write-Host ("DOTFILES FRESHNESS: {0} of {1} checks failed" -f $script:Fail, $script:Pass) -ForegroundColor Red
exit 1
