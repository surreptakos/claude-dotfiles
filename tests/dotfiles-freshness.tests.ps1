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

# Issue 122: the sandbox identity travels as environment, never as a `git config user.*` write.
# The env clear above is a defence, not a proof - and a config write that goes astray under any
# leaked pointer lands in the PARENT checkout's .git/config, after which every local commit is
# authored "Test <test@example.com>" (39 on master between 2026-08-28 and 2026-09-10). Env
# identity has no file to land in: git reads GIT_AUTHOR_* / GIT_COMMITTER_* before any config
# scope, child processes (the tool, sync.ps1) inherit it, and the sandbox repos commit fine.
# restore-test.ps1 check 0-pre2 fails the suite if the sandbox identity ever becomes effective.
$env:GIT_AUTHOR_NAME     = 'Test'
$env:GIT_AUTHOR_EMAIL    = 'test@example.com'
$env:GIT_COMMITTER_NAME  = 'Test'
$env:GIT_COMMITTER_EMAIL = 'test@example.com'

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
    Add-Content -Path (Join-Path $tmp 'README.md') -Value ("`n" + $Message)
    # A distinct actor for the "someone else pushed" commits; -c is per-invocation, no config write.
    & git -C $tmp -c user.name=Helper -c user.email=helper@example.com commit --quiet -am $Message | Out-Null
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

    # push-state2 MUST refuse in state3 (auto-push guard - same principle as install-state1).
    # Live drift is present, but so is an incoming commit; pushing here would leave origin
    # ahead of local and the operator still owes a manual pull.
    $r = Invoke-Tool -RepoRoot $local -UserHome $home2 -Mode 'push-state2'
    $pushReport = Parse-Report $r.Out
    Assert 'push-state2 refuses in state3' (($null -ne $pushReport) -and ($pushReport.ok -eq $false)) $r.Out
    Assert 'push-state2 refusal names the state' (($null -ne $pushReport) -and ($pushReport.state -eq 'state3')) $r.Out
    Assert 'push-state2 refusal exits nonzero' ($r.Exit -ne 0) ("exit={0}" -f $r.Exit)

    # push-state2 MUST refuse when invoked inside a worktree - this repo runs many concurrent
    # agent worktrees, each on its own feature branch, and auto-pushing "chore: session-start
    # capture" onto a feature branch would pollute the ticket's diff. Matches install-state1's
    # `-not $repo.isWorktree` clause. Set up: revert the live drift so classify returns
    # state1-eligible on master; `git worktree add` off `feature/push-state2-guard` (branched
    # from master) and push its upstream so the classifier can measure ahead/behind at all;
    # then re-drift live and run push-state2 pointed at the worktree. Refusal is the pass
    # condition; the reason string names the worktree flag so the operator can see WHY.
    Set-Content -Path (Join-Path $home2 '.claude\CLAUDE.md') -Value "# fake CLAUDE.md" -Encoding utf8
    $worktreePath = Join-Path $sandbox2 'worktree'
    & git -C $local worktree add --quiet -b feature/push-state2-guard $worktreePath 2>&1 | Out-Null
    # A brand-new branch has no upstream; without one the classifier returns state=unknown
    # and the guard cannot see the worktree flag. Push once so `rev-parse @{u}` succeeds.
    & git -C $worktreePath push --quiet -u origin feature/push-state2-guard 2>&1 | Out-Null
    # Worktree shares tools/ and lib/ with the checkout by nature; still confirm.
    Assert 'worktree carries the tool' (Test-Path (Join-Path $worktreePath 'tools\dotfiles-freshness.ps1')) $worktreePath
    # Stamp against the worktree so live and stamp agree, then drift live to produce the
    # state2 shape (drift + no incoming) with isWorktree=true.
    Write-DotfilesStamp -RepoRoot $worktreePath -UserHome $home2 -Kind 'pull' | Out-Null
    Add-Content -Path (Join-Path $home2 '.claude\CLAUDE.md') -Value "`nlocal edit for worktree test"
    # push-state2 pointed at the worktree must refuse. The classifier reports state2 with
    # isWorktree=true; the guard sees isWorktree and rejects even though the drift-shape would
    # otherwise be eligible. Assertion is on ok:false + isWorktree:true, not on the state
    # (though state=state2 is what actually flows through here).
    $r = Invoke-Tool -RepoRoot $worktreePath -UserHome $home2 -Mode 'push-state2'
    $pushReport = Parse-Report $r.Out
    Assert 'push-state2 refuses in a worktree' (($null -ne $pushReport) -and ($pushReport.ok -eq $false)) $r.Out
    Assert 'push-state2 refusal names the worktree flag' (($null -ne $pushReport) -and ($pushReport.isWorktree -eq $true)) $r.Out
    Assert 'push-state2 worktree refusal exits nonzero' ($r.Exit -ne 0) ("exit={0}" -f $r.Exit)

    # resolve-state3 (issue 18) MUST refuse when invoked inside a worktree. Same rationale as
    # push-state2: this repo runs many concurrent agent worktrees, and an auto-resolve there
    # would sync-push + git-push a "chore: capture live edits before pulling" commit onto the
    # ticket's feature branch - exactly the pollution the previous attempt of this issue was
    # caught doing on verification. Set-up: push an incoming commit onto the worktree branch's
    # remote so the classifier sees state3 (behind>0 AND liveDrift), then invoke resolve-state3
    # pointed at the worktree. Refusal is the pass condition, and the reason string must name
    # BOTH the state and the worktree flag.
    $branchHelper = Join-Path $sandbox2 ('branchhelper-{0}' -f ([guid]::NewGuid().ToString('N').Substring(0, 4)))
    & git clone --quiet -b feature/push-state2-guard $remote $branchHelper 2>&1 | Out-Null
    Add-Content -Path (Join-Path $branchHelper 'README.md') -Value "`nincoming for worktree"
    & git -C $branchHelper -c user.name=Helper -c user.email=helper@example.com commit --quiet -am 'incoming for worktree state3 test' | Out-Null
    & git -C $branchHelper push --quiet 2>&1 | Out-Null
    Remove-Item -Path $branchHelper -Recurse -Force
    # Confirm classify sees state3 (drift + incoming) inside the worktree.
    $r = Invoke-Tool -RepoRoot $worktreePath -UserHome $home2 -Mode 'classify'
    $classifyWt = Parse-Report $r.Out
    Assert 'classify inside worktree with drift+incoming reports state3' `
        (($null -ne $classifyWt) -and ($classifyWt.state -eq 'state3') -and $classifyWt.liveDrift) $r.Out
    # And confirm the classifier also flagged isWorktree=true - the guard reads this field.
    $classifyWtIsWorktree = $false
    if ($null -ne $classifyWt -and ($classifyWt.PSObject.Properties.Name -contains 'repo') -and ($null -ne $classifyWt.repo)) {
        if ($classifyWt.repo.PSObject.Properties.Name -contains 'isWorktree') {
            $classifyWtIsWorktree = [bool]$classifyWt.repo.isWorktree
        }
    }
    Assert 'classify reports isWorktree=true inside worktree' $classifyWtIsWorktree $r.Out
    # Capture the worktree branch's remote HEAD BEFORE calling resolve-state3. If the guard is
    # broken and the auto-resolve runs to completion, the remote HEAD will move; comparing the
    # after-value against this before-value is the only proof that nothing shipped that survives
    # a partial-run bug (a broken guard that ran only steps 1-3 before failing step 4 would
    # STILL have polluted origin).
    $preResolveRemoteHead = (& git ls-remote $remote refs/heads/feature/push-state2-guard 2>&1 | Out-String).Trim().Split("`t")[0]

    # The guard-refusal we care about. If this REPORTS ok:true, the guard is broken and the
    # test rig has just polluted feature/push-state2-guard on origin - the exact pre-verification
    # failure. Refusal with isWorktree=true is the correctness proof.
    $r = Invoke-Tool -RepoRoot $worktreePath -UserHome $home2 -Mode 'resolve-state3'
    $resolveReport = Parse-Report $r.Out
    Assert 'resolve-state3 refuses in a worktree' (($null -ne $resolveReport) -and ($resolveReport.ok -eq $false)) $r.Out
    Assert 'resolve-state3 refusal names the worktree flag' (($null -ne $resolveReport) -and ($resolveReport.isWorktree -eq $true)) $r.Out
    Assert 'resolve-state3 worktree refusal exits nonzero' ($r.Exit -ne 0) ("exit={0}" -f $r.Exit)

    # Prove nothing shipped: the worktree branch's remote HEAD MUST equal what it was before we
    # invoked resolve-state3. A moved HEAD means the guard let the auto-resolve run and the
    # ticket branch got polluted - which is what the previous verification caught.
    $postResolveRemoteHead = (& git ls-remote $remote refs/heads/feature/push-state2-guard 2>&1 | Out-String).Trim().Split("`t")[0]
    Assert 'resolve-state3 in a worktree did not move the branchs remote HEAD (no pollution shipped)' `
        ($postResolveRemoteHead -eq $preResolveRemoteHead) `
        ("before={0}`nafter ={1}" -f $preResolveRemoteHead, $postResolveRemoteHead)

    # Tear the worktree down BEFORE the outer finally deletes the sandbox - git tracks it and
    # would leave orphaned pointers under .git/worktrees/ otherwise. The state1 block below
    # resets live itself, so no live-side restore is needed here.
    & git -C $local worktree remove --force $worktreePath 2>&1 | Out-Null

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
