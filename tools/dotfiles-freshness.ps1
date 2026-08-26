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
    push-state2    Auto-capture state2 (live drift): sync.ps1 -Mode push -Commit "chore:
                   session-start capture", then git push. Refuses unless a fresh classify
                   returns state2 with liveDrift=true and behind=0 (no incoming commits).
                   This is issue 19 - pairs with the state1 auto-resolver to prevent state3
                   accumulation. Failure returns ok:false with a reason; the driver falls
                   back to the state2 advisory rather than blocking the session.
    resolve-state3 Attempt the 5-step state3 recovery in place: sync push (capture live),
                   git pull --rebase, git push, sync pull. Refuses unless a fresh classify
                   returns state3 with liveDrift=true, behind>0, ahead=0, AND isWorktree=false
                   - matches push-state2's guard shape (issue 18). If the rebase encounters
                   a merge conflict, aborts the rebase, returns ok:false with conflictedPaths,
                   and leaves the working tree untouched from the caller's point of view (the
                   pre-rebase capture commit stays - it is the operator's manual-merge base).
                   Called only from UserPromptSubmit - never SessionStart - because a
                   background auto-resolve at session-start would run before the user asked
                   for anything and could still leave a bad merge behind.
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
    [ValidateSet('classify', 'install-state1', 'push-state2', 'resolve-state3', 'stamp')][string]$Mode = 'classify',
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
    'push-state2' {
        # Guard: classify FIRST, refuse unless we still see state2 with live drift, no
        # incoming commits, AND we are not sitting on a worktree/feature branch. This
        # mirrors install-state1's guard-first pattern, INCLUDING install-state1's
        # `-not $repo.isWorktree` clause - `Get-RepoState` sets isWorktree=true whenever
        # `.git/worktrees/` appears in the git-dir path, and this repo is used by many
        # concurrent agent worktrees. Without this clause, a SessionStart hook fired inside
        # a ticket's worktree would auto-commit and push the "chore: session-start capture"
        # commit onto that feature branch, polluting the ticket's diff. Refuses on state1
        # (auto-pull's job), state3 (needs manual merge), origin-ahead-ineligible state2
        # (behind>0, liveDrift=false), and the worktree/feature-branch shape (isWorktree=true
        # OR ahead>0 - pushing there would move the wrong branch).
        $report = Get-Classification
        $behind = 0
        $ahead = 0
        $isWorktree = $false
        if ($null -ne $report.repo -and ($report.repo -is [hashtable])) {
            if ($report.repo.ContainsKey('behind'))     { $behind     = [int]$report.repo['behind'] }
            if ($report.repo.ContainsKey('ahead'))      { $ahead      = [int]$report.repo['ahead'] }
            if ($report.repo.ContainsKey('isWorktree')) { $isWorktree = [bool]$report.repo['isWorktree'] }
        } elseif ($null -ne $report.repo) {
            if ($report.repo.PSObject.Properties.Name -contains 'behind')     { $behind     = [int]$report.repo.behind }
            if ($report.repo.PSObject.Properties.Name -contains 'ahead')      { $ahead      = [int]$report.repo.ahead }
            if ($report.repo.PSObject.Properties.Name -contains 'isWorktree') { $isWorktree = [bool]$report.repo.isWorktree }
        }
        if ($report.state -ne 'state2' -or (-not $report.liveDrift) -or $behind -gt 0 -or $ahead -gt 0 -or $isWorktree) {
            $err = [ordered]@{
                ok         = $false
                reason     = ('refused: state is {0} (liveDrift={1}, behind={2}, ahead={3}, worktree={4})' -f $report.state, $report.liveDrift, $behind, $ahead, $isWorktree)
                state      = $report.state
                liveDrift  = $report.liveDrift
                behind     = $behind
                ahead      = $ahead
                isWorktree = $isWorktree
            }
            Write-Output (ConvertTo-Json $err -Depth 4)
            exit 1
        }

        $steps = @()
        # 1. sync.ps1 -Mode push -Commit "chore: session-start capture" - fixed commit prefix
        # for grep-ability across the history. sync.ps1 clears mirror roots, tokenizes home
        # paths, runs the secret guard, and commits in one step - a follow-up `git commit`
        # would run even if the secret guard exited 1, so the -Commit path is the safe one.
        $syncPath = Join-Path $RepoRoot 'sync.ps1'
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $syncOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $syncPath -Mode push -Commit 'chore: session-start capture' -UserHome $UserHome 2>&1 | Out-String
        $syncExit = $LASTEXITCODE
        $ErrorActionPreference = $prev
        $steps += [ordered]@{ step = 'sync.ps1 -Mode push -Commit'; exit = $syncExit; output = $syncOut.Trim() }
        if ($syncExit -ne 0) {
            # Trim the sync output to the last decisive line - full push output is too noisy
            # to inject as hook context, and the driver prints the reason unedited.
            $lastLine = ''
            if ($syncOut) {
                $trimmed = $syncOut.Trim()
                $parts = $trimmed -split "`n"
                $lastLine = ($parts[$parts.Count - 1]).Trim()
            }
            $reason = 'sync.ps1 -Mode push failed'
            if ($lastLine) { $reason = 'sync.ps1 -Mode push failed: ' + $lastLine }
            Write-Output (ConvertTo-Json ([ordered]@{ ok = $false; reason = $reason; steps = $steps }) -Depth 6)
            exit 1
        }

        # 2. git push - Invoke-Git already clears GIT_* env vars and separates stderr, which
        # matters because git writes benign warnings there and $ErrorActionPreference=Stop
        # would treat them as terminating. See sync.ps1 comments for the same gotcha.
        $pushGit = Invoke-Git @('push')
        $steps += [ordered]@{ step = 'git push'; exit = $pushGit.ExitCode; output = $pushGit.Output; stderr = $pushGit.Stderr }
        if ($pushGit.ExitCode -ne 0) {
            $reason = 'git push failed'
            if ($pushGit.Stderr) {
                $firstLine = ($pushGit.Stderr -split "`n")[0].Trim()
                if ($firstLine) { $reason = 'git push failed: ' + $firstLine }
            }
            Write-Output (ConvertTo-Json ([ordered]@{ ok = $false; reason = $reason; steps = $steps }) -Depth 6)
            exit 1
        }

        $newHead = (Invoke-Git @('rev-parse', 'HEAD')).Output
        $result = [ordered]@{
            ok      = $true
            pushed  = $newHead
            steps   = $steps
        }
        Write-Output (ConvertTo-Json $result -Depth 6)
        exit 0
    }
    'resolve-state3' {
        # Issue 18. Guard: classify FIRST and refuse unless we still see state3 with live drift,
        # incoming commits waiting, no local ahead commits, and NOT sitting on a worktree. This
        # mirrors push-state2's guard shape - and the isWorktree/ahead guard is not decorative,
        # it is the specific bug that failed verification on the previous attempt: state3 inside
        # an agent's ticket worktree would auto-commit "chore: capture live edits before pulling"
        # onto that feature branch and push it to the branch's origin, polluting the ticket diff
        # exactly the way push-state2 was built to prevent.
        #
        # The driver at tools/dotfiles-freshness-hook.js SHOULD short-circuit these shapes before
        # invoking us so we do not spend a PowerShell round-trip on a case we will refuse - but
        # this guard is the correctness contract and must not depend on the driver honouring it.
        $report = Get-Classification
        $behind = 0
        $ahead = 0
        $isWorktree = $false
        if ($null -ne $report.repo -and ($report.repo -is [hashtable])) {
            if ($report.repo.ContainsKey('behind'))     { $behind     = [int]$report.repo['behind'] }
            if ($report.repo.ContainsKey('ahead'))      { $ahead      = [int]$report.repo['ahead'] }
            if ($report.repo.ContainsKey('isWorktree')) { $isWorktree = [bool]$report.repo['isWorktree'] }
        } elseif ($null -ne $report.repo) {
            if ($report.repo.PSObject.Properties.Name -contains 'behind')     { $behind     = [int]$report.repo.behind }
            if ($report.repo.PSObject.Properties.Name -contains 'ahead')      { $ahead      = [int]$report.repo.ahead }
            if ($report.repo.PSObject.Properties.Name -contains 'isWorktree') { $isWorktree = [bool]$report.repo.isWorktree }
        }
        if ($report.state -ne 'state3' -or (-not $report.liveDrift) -or $behind -le 0 -or $ahead -gt 0 -or $isWorktree) {
            $err = [ordered]@{
                ok         = $false
                reason     = ('refused: state is {0} (liveDrift={1}, behind={2}, ahead={3}, worktree={4})' -f $report.state, $report.liveDrift, $behind, $ahead, $isWorktree)
                state      = $report.state
                liveDrift  = $report.liveDrift
                behind     = $behind
                ahead      = $ahead
                isWorktree = $isWorktree
            }
            Write-Output (ConvertTo-Json $err -Depth 4)
            exit 1
        }

        $steps = @()
        # 1. Capture live edits into a commit BEFORE the rebase. Same shape as push-state2's
        # step 1; the commit message is distinct so history reads chronologically (capture,
        # then rebase, then post-rebase state).
        $syncPath = Join-Path $RepoRoot 'sync.ps1'
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $syncOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $syncPath -Mode push -Commit 'chore: capture live edits before pulling' -UserHome $UserHome 2>&1 | Out-String
        $syncExit = $LASTEXITCODE
        $ErrorActionPreference = $prev
        $steps += [ordered]@{ step = 'sync.ps1 -Mode push -Commit (capture)'; exit = $syncExit; output = $syncOut.Trim() }
        if ($syncExit -ne 0) {
            $lastLine = ''
            if ($syncOut) {
                $trimmed = $syncOut.Trim()
                $parts = $trimmed -split "`n"
                $lastLine = ($parts[$parts.Count - 1]).Trim()
            }
            $reason = 'sync.ps1 -Mode push failed'
            if ($lastLine) { $reason = 'sync.ps1 -Mode push failed: ' + $lastLine }
            Write-Output (ConvertTo-Json ([ordered]@{ ok = $false; reason = $reason; steps = $steps }) -Depth 6)
            exit 1
        }

        # 2. Rebase onto incoming. This is where a real merge conflict shows up. On failure
        # collect the conflicted paths from `git diff --name-only --diff-filter=U` while the
        # rebase is still in progress, then `git rebase --abort` to leave a clean tree. Callers
        # get ok:false + conflictedPaths so the hook can surface them in the block message.
        $rebase = Invoke-Git @('pull', '--rebase')
        $steps += [ordered]@{ step = 'git pull --rebase'; exit = $rebase.ExitCode; output = $rebase.Output; stderr = $rebase.Stderr }
        if ($rebase.ExitCode -ne 0) {
            $conflicted = @()
            $rebaseInProgress = $false
            $gitDir = (Invoke-Git @('rev-parse', '--git-dir')).Output
            if ($gitDir) {
                # `git rev-parse --git-dir` returns a path relative to cwd when invoked from
                # inside a worktree, absolute otherwise. Resolve either shape against RepoRoot.
                if (-not [System.IO.Path]::IsPathRooted($gitDir)) { $gitDir = Join-Path $RepoRoot $gitDir }
                if ((Test-Path (Join-Path $gitDir 'rebase-merge')) -or (Test-Path (Join-Path $gitDir 'rebase-apply'))) {
                    $rebaseInProgress = $true
                }
            }
            if ($rebaseInProgress) {
                $diff = Invoke-Git @('diff', '--name-only', '--diff-filter=U')
                if ($diff.ExitCode -eq 0 -and $diff.Output) {
                    $conflicted = @($diff.Output -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
                }
                $abort = Invoke-Git @('rebase', '--abort')
                $steps += [ordered]@{ step = 'git rebase --abort'; exit = $abort.ExitCode; output = $abort.Output; stderr = $abort.Stderr }
            }
            # Distinguish conflict-that-needs-a-human from any other pull failure (network,
            # auth, non-fast-forward without rebase-in-progress). The hook uses conflictedPaths
            # to build the surfaced message; if absent it falls back to a generic reason.
            $reason = 'git pull --rebase failed'
            if ($conflicted.Count -gt 0) {
                $reason = ('rebase produced merge conflicts in {0} file(s)' -f $conflicted.Count)
            } elseif ($rebase.Stderr) {
                $firstLine = ($rebase.Stderr -split "`n")[0].Trim()
                if ($firstLine) { $reason = 'git pull --rebase failed: ' + $firstLine }
            }
            Write-Output (ConvertTo-Json ([ordered]@{
                ok              = $false
                reason          = $reason
                conflictedPaths = $conflicted
                aborted         = $rebaseInProgress
                steps           = $steps
            }) -Depth 6)
            exit 1
        }

        # 3. Push the rebased history. Failure here (auth, non-fast-forward from another push
        # that raced in between fetch and push) is a legitimate blocker - the operator has to
        # resolve it manually.
        $pushGit = Invoke-Git @('push')
        $steps += [ordered]@{ step = 'git push'; exit = $pushGit.ExitCode; output = $pushGit.Output; stderr = $pushGit.Stderr }
        if ($pushGit.ExitCode -ne 0) {
            $reason = 'git push failed'
            if ($pushGit.Stderr) {
                $firstLine = ($pushGit.Stderr -split "`n")[0].Trim()
                if ($firstLine) { $reason = 'git push failed: ' + $firstLine }
            }
            Write-Output (ConvertTo-Json ([ordered]@{ ok = $false; reason = $reason; steps = $steps }) -Depth 6)
            exit 1
        }

        # 4. sync.ps1 -Mode pull writes the fresh stamp itself, so no separate stamp step needed.
        # Also updates any mirrored files the incoming commits touched.
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $pullOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $syncPath -Mode pull -UserHome $UserHome 2>&1 | Out-String
        $pullExit = $LASTEXITCODE
        $ErrorActionPreference = $prev
        $steps += [ordered]@{ step = 'sync.ps1 -Mode pull'; exit = $pullExit; output = $pullOut.Trim() }
        if ($pullExit -ne 0) {
            Write-Output (ConvertTo-Json ([ordered]@{ ok = $false; reason = 'sync.ps1 -Mode pull failed'; steps = $steps }) -Depth 6)
            exit 1
        }

        $newHead = (Invoke-Git @('rev-parse', 'HEAD')).Output
        $result = [ordered]@{
            ok      = $true
            resolved = $newHead
            steps   = $steps
        }
        Write-Output (ConvertTo-Json $result -Depth 6)
        exit 0
    }
}
