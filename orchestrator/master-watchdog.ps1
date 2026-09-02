<#
.SYNOPSIS
    Relaunch watchdog for the local master orchestrators (issue 64; one master per repo since
    issue 70).

.DESCRIPTION
    Runs from Windows Task Scheduler every 30 minutes while Dan is logged on. For EACH target
    repo in $Repos (RUNBOOK.md priority order) it decides whether that repo's master is alive;
    if not, it launches one in a visible console with Remote Control, ROOTED IN THAT REPO'S
    CLONE. A master must run inside the repo it serves: every repo's
    .claude/workflows/ticket-fleet.js is cwd-relative (scout `gh issue list` with no -R,
    implement `isolation: 'worktree'`, verify `git worktree add` "in this repo"), so a master
    rooted in the claude-dotfiles checkout points all three at claude-dotfiles and cannot
    fleet. That is what stalled the 2026-09-02 run (claude-dotfiles issue 44, heartbeats 7-8).

    "Alive" for repo <slug> means EITHER of these holds:
      1. A `claude` (or `node`) process is running with `--remote-control` and `master-<slug>`
         on its command line. That is the launch shape below, so it is the process signature
         to trust. The match is per repo on purpose: with several masters alive, a bare
         `master` match would let the first one found suppress the launch of every other.
      2. That repo's state issue (claude-dotfiles #<StateIssue>) carries a
         `**Heartbeat N - <UTC>**` line newer than -MaxHeartbeatAgeMinutes (default 120).

    Either check passes: print the reason, launch nothing for that repo.
    Otherwise: `Start-Process` a NEW cmd.exe window (visible, own console) running
      claude --dangerously-skip-permissions --remote-control master-<slug> "<boot prompt>"
    with the working directory set to the repo clone. `--dangerously-skip-permissions` is
    there because the auto-mode permission classifier denied `gh pr merge` on 2026-09-02 while
    auto-merge is ON by ruling (issue 71); LOCAL-RUNBOOK.md states what that costs.

    Legacy guard: a process whose command line carries `--remote-control master` followed by
    a space or quote (the pre-issue-70 single master rooted in claude-dotfiles) blocks every
    launch until it is stopped, because it would double-run triage on all four repos. The
    script prints the PID and the stop command and exits 0.

    -WhatIf does every check, prints every decision, and launches nothing. It is a plain
    switch here, not SupportsShouldProcess: under ShouldProcess the WhatIf preference leaks
    into the CimCmdlets module import and prints a dozen "Set Alias" lines.

    This file is saved with a UTF-8 BOM on purpose. Windows PowerShell 5.1 reads a BOM-less
    file as ANSI, and any multibyte character inside a string then breaks the parse.

.PARAMETER DotfilesRoot
    The claude-dotfiles checkout the boot prompt points masters at for the runbooks. Defaults
    to C:\Users\<current>\Claude\Projects\Meta\claude-dotfiles.

.PARAMETER Only
    Slugs to consider (bill-intake, contract-builder, sales-cockpit, zoho). Empty = all.

.PARAMETER MaxHeartbeatAgeMinutes
    Fresh-heartbeat cutoff. 120 (2h) per issue 64's wording.

.PARAMETER Force
    Ignore the alive checks and the legacy guard; launch for every selected repo.

.PARAMETER NoBypass
    Omit --dangerously-skip-permissions from the launch. Debugging only; a master launched
    this way cannot run the merge pass (issue 71).

.PARAMETER WhatIf
    Do the checks, print the decisions, launch nothing.
#>
[CmdletBinding()]
param(
    [string]$DotfilesRoot = (Join-Path $env:USERPROFILE 'Claude\Projects\Meta\claude-dotfiles'),
    [string[]]$Only = @(),
    [int]$MaxHeartbeatAgeMinutes = 120,
    [string]$ClaudeExe = 'claude',
    [switch]$Force,
    [switch]$NoBypass,
    [switch]$WhatIf
)

# NEVER let a git-stderr warning end the script. Restore-test docs cover the trap.
$ErrorActionPreference = 'Continue'

# One row per target repo, RUNBOOK.md priority order. StateIssue is that repo's
# "Master orchestrator state - <owner/repo>" issue in surreptakos/claude-dotfiles; #44 is the
# registry and must never be a master's state issue again.
$Repos = @(
    @{ Slug = 'bill-intake';      Repo = 'surreptakos/aac-bill-intake';      StateIssue = 74; Root = (Join-Path $env:USERPROFILE 'Claude\Projects\Financial\aac-bill-intake') },
    @{ Slug = 'contract-builder'; Repo = 'surreptakos/aac-contract-builder'; StateIssue = 75; Root = (Join-Path $env:USERPROFILE 'Claude\Projects\Sales Data KPIs\contract-builder') },
    @{ Slug = 'sales-cockpit';    Repo = 'surreptakos/aac-sales-cockpit';    StateIssue = 76; Root = (Join-Path $env:USERPROFILE 'Claude\Projects\Sales Data KPIs\aac-cockpit') },
    @{ Slug = 'zoho';             Repo = 'surreptakos/zoho-source-of-truth'; StateIssue = 77; Root = (Join-Path $env:USERPROFILE 'Claude\Projects\Operations\zoho-source-of-truth') }
)

function Write-Info { param($msg) Write-Host "[watchdog] $msg" }

function Get-RemoteControlProcesses {
    # Every claude/node process whose command line carries --remote-control. Win32_Process
    # because Get-Process does not expose CommandLine on Windows.
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='claude.exe' OR Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and ($_.CommandLine -match '--remote-control') })
    return , $procs
}

function Test-MasterProcess {
    param([array]$Procs, [string]$Slug)
    # A repo's master is a --remote-control process whose name token is master-<slug>.
    $rx = '--remote-control\s+master-' + [regex]::Escape($Slug) + '(?=\s|"|$)'
    return , @($Procs | Where-Object { $_.CommandLine -match $rx })
}

function Test-LegacyMasterProcess {
    param([array]$Procs)
    # Pre-issue-70 shape: `--remote-control master "<prompt>"` - bare token, rooted in dotfiles.
    return , @($Procs | Where-Object { $_.CommandLine -match '--remote-control\s+master(?=\s|"|$)' })
}

function Get-LatestHeartbeatUtc {
    param([int]$Issue)
    # gh must be on PATH and authenticated. If it is not, treat as "unknown" (no fresh
    # heartbeat) - the process check may still let the repo count as alive.
    # PS 5.1 reads console output as ANSI by default. Force UTF-8 so em dashes in the
    # heartbeat separator do not get mangled into three garbage chars that never match.
    $prevEnc = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $body = & gh issue view $Issue --repo surreptakos/claude-dotfiles --json body -q .body 2>$null
    } finally {
        [Console]::OutputEncoding = $prevEnc
    }
    if ($body -is [Array]) { $body = $body -join [Environment]::NewLine }
    if (-not $body -or $LASTEXITCODE -ne 0) {
        Write-Info "gh could not read issue #$Issue; heartbeat check inconclusive"
        return $null
    }
    # Match `**Heartbeat N <em dash or hyphen> YYYY-MM-DD HH:MM UTC**`.
    $rx = '(?m)\*\*Heartbeat\s+\d+\s*[\u2014\-]\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+UTC\*\*'
    $matches = [regex]::Matches($body, $rx)
    if ($matches.Count -eq 0) { return $null }
    $latest = $null
    foreach ($m in $matches) {
        $ts = [datetime]::ParseExact(
            ($m.Groups[1].Value + ' ' + $m.Groups[2].Value),
            'yyyy-MM-dd HH:mm',
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
        if ($null -eq $latest -or $ts -gt $latest) { $latest = $ts }
    }
    return $latest
}

function Get-BootPrompt {
    param([hashtable]$R)
    # No double quotes inside: the prompt travels as one double-quoted cmd.exe argument.
    $runbooks = Join-Path $DotfilesRoot 'orchestrator'
    return ("You are the master orchestrator, local variant, serving $($R.Repo). This session is rooted in that repo's clone; " +
            "never change directory out of it. Read $runbooks\LOCAL-RUNBOOK.md and then $runbooks\RUNBOOK.md - binding, in that " +
            "order of precedence. Your state issue is surreptakos/claude-dotfiles#$($R.StateIssue); issue #44 there is the shared " +
            "registry and config - read it, never write to it or to another repo's state issue. Check your state issue for the " +
            "current state and that no other master serves $($R.Repo); claim venue local-pc there. Then begin the heartbeat " +
            "procedure under /loop dynamic pacing if available, else as single passes. My messages in this terminal override everything.")
}

Write-Info "dotfiles=$DotfilesRoot  cutoff=${MaxHeartbeatAgeMinutes}m  repos=$(($Repos | ForEach-Object { $_.Slug }) -join ',')"

$selected = @($Repos | Where-Object { $Only.Count -eq 0 -or $Only -contains $_.Slug })
if ($selected.Count -eq 0) { Write-Info "ERROR: -Only matched no repo"; exit 1 }

$rcProcs = Get-RemoteControlProcesses

# --- Legacy guard --------------------------------------------------------------------
$legacy = Test-LegacyMasterProcess -Procs $rcProcs
if ($legacy.Count -gt 0 -and -not $Force) {
    $pids = ($legacy | ForEach-Object { $_.ProcessId }) -join ','
    Write-Info "LEGACY single master alive (pid(s)=$pids): the pre-issue-70 shape rooted in claude-dotfiles. It cannot fleet or merge and would double-run triage against the per-repo masters."
    Write-Info "Stop it first: Stop-Process -Id $pids   (then this task launches per-repo masters on its next slot)"
    Write-Info "exit 0, no launch"
    exit 0
}

$exitCode = 0
foreach ($r in $selected) {
    $tag = "[$($r.Slug)]"

    # --- Check 1: live master process for this repo ---------------------------------
    $procs = Test-MasterProcess -Procs $rcProcs -Slug $r.Slug
    if ($procs.Count -gt 0 -and -not $Force) {
        $pids = ($procs | ForEach-Object { $_.ProcessId }) -join ','
        Write-Info "$tag MASTER ALIVE (process check): pid(s)=$pids - no launch"
        continue
    }

    # --- Check 2: fresh heartbeat in this repo's state issue -------------------------
    $hb = Get-LatestHeartbeatUtc -Issue $r.StateIssue
    if ($hb) {
        $ageMin = [int](([datetime]::UtcNow - $hb).TotalMinutes)
        if ($ageMin -lt $MaxHeartbeatAgeMinutes -and -not $Force) {
            Write-Info "$tag MASTER ALIVE (heartbeat check): issue #$($r.StateIssue) latest=$($hb.ToString('u'))  age=${ageMin}m < ${MaxHeartbeatAgeMinutes}m - no launch"
            continue
        } else {
            Write-Info "$tag heartbeat stale: issue #$($r.StateIssue) latest=$($hb.ToString('u'))  age=${ageMin}m"
        }
    } else {
        Write-Info "$tag no heartbeat line found in issue #$($r.StateIssue)"
    }

    # --- Launch branch ----------------------------------------------------------------
    if (-not (Test-Path $r.Root)) {
        Write-Info "$tag ERROR: repo clone not found: $($r.Root) - skipped"
        $exitCode = 1
        continue
    }

    $bypass = @()
    if (-not $NoBypass) { $bypass = @('--dangerously-skip-permissions') }
    $launchCmd = (@(
        '/k',
        'cd', '/d', "`"$($r.Root)`"", '&&',
        $ClaudeExe) + $bypass + @('--remote-control', "master-$($r.Slug)", "`"$(Get-BootPrompt -R $r)`"")
    ) -join ' '

    Write-Info "$tag NO MASTER ALIVE - would launch: cmd.exe $launchCmd"

    if ($WhatIf) {
        Write-Info "$tag -WhatIf: no process started"
    } else {
        Start-Process -FilePath 'cmd.exe' -ArgumentList $launchCmd -WorkingDirectory $r.Root -WindowStyle Normal
        Write-Info "$tag launched"
    }
}
exit $exitCode
