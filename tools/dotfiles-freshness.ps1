<#
.SYNOPSIS
    Classify the freshness of the live ~/.claude configuration against this repo
    and the origin remote, and optionally auto-heal the safe case.

.DESCRIPTION
    Reads the stamp written by sync.ps1 (~/.claude/hook-state/dotfiles-sync/state.json),
    runs a lightweight `git fetch` on this repo checkout, and returns one of five
    states. The Node hook driver (tools/dotfiles-freshness-hook.js) consumes the
    JSON output to decide what to inject / block / auto-install.

    STATES
      synced   - up to date, live matches stamp                    -> silent
      state1   - origin AHEAD, live matches stamp (safe to pull)   -> auto-install
      state2   - origin NOT ahead, live drifted from stamp         -> report/warn only
      state3   - BOTH: origin ahead AND live drifted               -> hard block
      unknown  - no stamp / no repo / cannot fetch                 -> silent

    "Auto-pull must never run while live drift exists": every branch that would
    invoke sync pull is guarded by `-not $liveDrift`, and Install-Mode refuses
    unless the immediately preceding classification returned state1.

    ORIGIN AHEAD is measured against the current branch's upstream, restricted to
    the tracking branch with no local commits ahead (`ahead == 0`). A feature
    branch or a worktree with local work is not eligible for auto-install; that
    keeps the healer from clobbering someone's in-progress work.

.PARAMETER Mode
    classify       Print JSON state + counts + resolution commands. Read-only.
    install-state1 Auto-heal state1: git pull --ff-only, then sync.ps1 -Mode pull.
                   Refuses if a fresh classify does not return state1.
    stamp          Write an initial stamp (install.ps1 uses this after the first pull).

.PARAMETER RepoRoot
    The dotfiles checkout to inspect. Defaults to the script's grandparent.

.PARAMETER UserHome
    Overrideable for tests. Defaults to $env:USERPROFILE.

.PARAMETER SkipFetch
    Do not `git fetch` before classifying. Tests pass this to run offline.

.EXAMPLE
    powershell -File tools\dotfiles-freshness.ps1 -Mode classify
    powershell -File tools\dotfiles-freshness.ps1 -Mode install-state1
#>
[CmdletBinding()]
param(
    [ValidateSet('classify', 'install-state1', 'stamp')][string]$Mode = 'classify',
    [string]$RepoRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
    [string]$UserHome = $env:USERPROFILE,
    [switch]$SkipFetch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path $RepoRoot).Path.TrimEnd('\', '/')
$UserHome = $UserHome.TrimEnd('\', '/')

. (Join-Path $RepoRoot 'lib\manifest.ps1')

function Invoke-Git {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    # Git writes benign warnings to stderr; under -ErrorAction Stop that becomes a terminating
    # error. Read exit code and stdout ourselves. Stderr is routed to a temp file rather than
    # merged into stdout via 2>&1, because `2>&1 | Out-String` folds ErrorRecord objects into
    # the string with formatting that can corrupt the output we parse. Same pattern as
    # sync.ps1's commit block, but with stderr kept separate.
    #
    # GIT_* env vars are cleared for the duration of the call. When the classifier is invoked
    # from a pre-commit hook (restore-test -> freshness tests -> classifier -> git), the
    # parent git process leaks GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE into the child, and
    # every downstream `git -C <path>` silently operates on the PARENT repo instead - which is
    # what corrupted state1 detection on 2026-08-25 (git log ran against the wrong repo and
    # returned zero commits). `-C $path` does not override GIT_DIR; only unsetting does.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $errFile = [System.IO.Path]::GetTempFileName()
    $savedGitEnv = @{}
    foreach ($name in 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY') {
        $val = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $val) { $savedGitEnv[$name] = $val; [Environment]::SetEnvironmentVariable($name, $null) }
    }
    try {
        $stdout = & git -C $RepoRoot @Arguments 2>$errFile | Out-String
        $exit = $LASTEXITCODE
        $stderr = ''
        if (Test-Path $errFile) { $stderr = [System.IO.File]::ReadAllText($errFile) }
        return [pscustomobject]@{ ExitCode = $exit; Output = $stdout.Trim(); Stderr = $stderr.Trim() }
    } finally {
        foreach ($name in $savedGitEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $savedGitEnv[$name]) }
        $ErrorActionPreference = $prev
        if (Test-Path $errFile) { Remove-Item -Path $errFile -Force -ErrorAction SilentlyContinue }
    }
}

function Get-RepoState {
    if (-not (Test-Path (Join-Path $RepoRoot '.git'))) {
        return @{ ok = $false; reason = 'not a git repo' }
    }
    $branch = (Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')).Output
    $gitDir = (Invoke-Git @('rev-parse', '--git-dir')).Output
    $upstreamProbe = Invoke-Git @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
    if ($upstreamProbe.ExitCode -ne 0) {
        return @{ ok = $false; reason = ('no upstream for {0}' -f $branch); branch = $branch; gitDir = $gitDir }
    }
    $upstream = $upstreamProbe.Output

    $fetchOk = $true
    if (-not $SkipFetch) {
        $fetch = Invoke-Git @('fetch', '--quiet', '--no-tags', '--prune')
        if ($fetch.ExitCode -ne 0) { $fetchOk = $false }
    }

    $counts = (Invoke-Git @('rev-list', '--left-right', '--count', ("{0}...HEAD" -f $upstream))).Output
    $behind = 0; $ahead = 0
    if ($counts -match '^\s*(\d+)\s+(\d+)\s*$') {
        $behind = [int]$Matches[1]
        $ahead  = [int]$Matches[2]
    }

    $localHead = (Invoke-Git @('rev-parse', 'HEAD')).Output
    $upstreamHead = (Invoke-Git @('rev-parse', $upstream)).Output

    return @{
        ok         = $true
        branch     = $branch
        gitDir     = $gitDir
        upstream   = $upstream
        behind     = $behind
        ahead      = $ahead
        fetchOk    = $fetchOk
        head       = $localHead
        upstreamHead = $upstreamHead
        isWorktree = ($gitDir -match '[\\/]worktrees[\\/]')
    }
}

function New-Report {
    param(
        [Parameter(Mandatory = $true)][string]$State,
        [Parameter(Mandatory = $true)][string]$Summary,
        $Repo = $null,
        $Stamp = $null,
        [bool]$LiveDrift = $false,
        [string[]]$Resolution = @(),
        [string[]]$Notes = @(),
        [string[]]$IncomingCommits = @()
    )
    $liveFingerprint = Get-DotfilesFingerprint -UserHome $UserHome
    return [ordered]@{
        state           = $State
        summary         = $Summary
        stateAt         = (Get-Date).ToUniversalTime().ToString('o')
        repoRoot        = $RepoRoot
        userHome        = $UserHome
        stamp           = $Stamp
        repo            = $Repo
        liveFingerprint = $liveFingerprint
        liveDrift       = $LiveDrift
        resolution      = $Resolution
        notes           = $Notes
        incomingCommits = $IncomingCommits
    }
}

function Get-Classification {
    $stamp = Read-DotfilesStamp -UserHome $UserHome
    $repo  = Get-RepoState

    if (-not $repo.ok) {
        return (New-Report -State 'unknown' -Summary ('cannot check: ' + $repo.reason) -Repo $repo -Stamp $stamp)
    }
    if ($null -eq $stamp) {
        # No stamp is a fresh machine, not a fault. Silent + auto-pull-forbidden by construction.
        return (New-Report -State 'unknown' -Summary 'no dotfiles-sync stamp yet - freshness cannot be classified' -Repo $repo -Stamp $null `
                          -Notes @('run `.\sync.ps1 -Mode pull` (or push) once to establish a baseline'))
    }

    $liveFingerprint = Get-DotfilesFingerprint -UserHome $UserHome
    # StrictMode: guard the property access before comparing.
    $stampedFingerprint = ''
    if ($null -ne $stamp -and ($stamp.PSObject.Properties.Name -contains 'liveFingerprint')) {
        $stampedFingerprint = [string]$stamp.liveFingerprint
    }
    $liveDrift = ($liveFingerprint -ne $stampedFingerprint)

    # Behind > 0 means origin has commits we do not have (state1 candidate). Auto-install is
    # only safe on the tracking branch with no local ahead commits and no worktree, so a feature
    # branch or a worktree cannot trigger it.
    $originAhead = ($repo.behind -gt 0)
    $eligible    = ($originAhead -and (-not $liveDrift) -and ($repo.ahead -eq 0) -and (-not $repo.isWorktree))

    $incoming = @()
    if ($originAhead) {
        $log = Invoke-Git @('--no-pager', 'log', '--oneline', ("HEAD..{0}" -f $repo.upstream))
        if ($log.ExitCode -eq 0 -and $log.Output) {
            $incoming = @($log.Output -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        }
        # Opt-in diagnostic breadcrumb for a class of intermittent failure we already fixed
        # once (see Invoke-Git's env-clearing comment). Set $env:DOTFILES_FRESHNESS_DEBUG to
        # capture the raw git output the next time origin-ahead disagrees with the log.
        if ($env:DOTFILES_FRESHNESS_DEBUG -and ($incoming.Count -eq 0)) {
            $dbg = Join-Path $env:TEMP ('dotfiles-freshness-debug-{0}.log' -f $PID)
            $entry = @(
                ('===[{0}]===' -f (Get-Date -Format o)),
                ('behind={0} ahead={1} upstream={2}' -f $repo.behind, $repo.ahead, $repo.upstream),
                ('log.ExitCode={0}' -f $log.ExitCode),
                ('log.Output:'),
                $log.Output,
                ('log.Stderr:'),
                $log.Stderr,
                ''
            ) -join "`n"
            Add-Content -Path $dbg -Value $entry -Encoding utf8
        }
    }

    if (-not $originAhead -and -not $liveDrift) {
        return (New-Report -State 'synced' -Summary 'up to date, live unchanged' -Repo $repo -Stamp $stamp)
    }
    if ($eligible) {
        return (New-Report -State 'state1' -Summary ("{0} commit(s) waiting on origin, live matches stamp" -f $repo.behind) `
                          -Repo $repo -Stamp $stamp -IncomingCommits $incoming `
                          -Resolution @(
                              ('cd "{0}"' -f $RepoRoot),
                              'git pull --ff-only',
                              '.\sync.ps1 -Mode pull'
                          ))
    }
    if ($originAhead -and -not $liveDrift) {
        # Origin ahead but ineligible (worktree, ahead > 0, or fetch failed). Not state3
        # because live is clean; not auto-install because pulling here could clobber work.
        return (New-Report -State 'state2' -Summary ("{0} commit(s) waiting on origin - manual pull required (ahead={1}, worktree={2})" -f `
                              $repo.behind, $repo.ahead, $repo.isWorktree) `
                          -Repo $repo -Stamp $stamp -LiveDrift $false -IncomingCommits $incoming `
                          -Resolution @(
                              ('cd "{0}"' -f $RepoRoot),
                              'git pull --ff-only',
                              '.\sync.ps1 -Mode pull'
                          ))
    }
    if (-not $originAhead -and $liveDrift) {
        return (New-Report -State 'state2' -Summary 'live copies edited since last sync (report only, never a block)' `
                          -Repo $repo -Stamp $stamp -LiveDrift $true `
                          -Resolution @(
                              ('cd "{0}"' -f $RepoRoot),
                              '.\sync.ps1 -Mode push -Commit "chore: sync"'
                          ))
    }
    # state3: BOTH diverged. Sync pull would clobber live edits (backup notwithstanding); sync
    # push would ignore what came in on origin. Order matters: capture live first, then merge.
    return (New-Report -State 'state3' -Summary 'BOTH DIVERGED: origin ahead AND live drifted - hard block' `
                      -Repo $repo -Stamp $stamp -LiveDrift $true -IncomingCommits $incoming `
                      -Resolution @(
                          ('cd "{0}"' -f $RepoRoot),
                          '.\sync.ps1 -Mode push -Commit "chore: capture live edits before pulling"',
                          'git pull --rebase',
                          'git push',
                          '.\sync.ps1 -Mode pull'
                      ))
}

function Emit-Report {
    param($report)
    $json = ConvertTo-Json -InputObject $report -Depth 6
    Write-Output $json
}

switch ($Mode) {
    'classify' {
        Emit-Report (Get-Classification)
        exit 0
    }
    'stamp' {
        $stampPath = Write-DotfilesStamp -RepoRoot $RepoRoot -UserHome $UserHome -Kind 'install'
        Write-Output (ConvertTo-Json ([ordered]@{ ok = $true; stampPath = $stampPath }) -Depth 3)
        exit 0
    }
    'install-state1' {
        # Guard: classify FIRST, refuse unless the safe branch is what we see. Auto-pull must
        # never run while live drift exists, and this is where that promise lives.
        $report = Get-Classification
        if ($report.state -ne 'state1') {
            $err = [ordered]@{
                ok       = $false
                reason   = ('refused: state is {0}, not state1' -f $report.state)
                state    = $report.state
                liveDrift = $report.liveDrift
            }
            Write-Output (ConvertTo-Json $err -Depth 4)
            exit 1
        }
        $steps = @()
        $pullGit = Invoke-Git @('pull', '--ff-only')
        $steps += [ordered]@{ step = 'git pull --ff-only'; exit = $pullGit.ExitCode; output = $pullGit.Output }
        if ($pullGit.ExitCode -ne 0) {
            Write-Output (ConvertTo-Json ([ordered]@{ ok = $false; reason = 'git pull --ff-only failed'; steps = $steps }) -Depth 6)
            exit 1
        }
        $newHead = (Invoke-Git @('rev-parse', 'HEAD')).Output

        # sync.ps1 -Mode pull writes the fresh stamp itself, so no separate stamp step needed.
        $syncPath = Join-Path $RepoRoot 'sync.ps1'
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $syncOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $syncPath -Mode pull -UserHome $UserHome 2>&1 | Out-String
        $syncExit = $LASTEXITCODE
        $ErrorActionPreference = $prev
        $steps += [ordered]@{ step = 'sync.ps1 -Mode pull'; exit = $syncExit; output = $syncOut.Trim() }
        if ($syncExit -ne 0) {
            Write-Output (ConvertTo-Json ([ordered]@{ ok = $false; reason = 'sync pull failed'; steps = $steps; newHead = $newHead }) -Depth 6)
            exit 1
        }

        $result = [ordered]@{
            ok              = $true
            installed       = $report.incomingCommits
            newHead         = $newHead
            steps           = $steps
        }
        Write-Output (ConvertTo-Json $result -Depth 6)
        exit 0
    }
}
