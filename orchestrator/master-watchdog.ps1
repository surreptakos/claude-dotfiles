<#
.SYNOPSIS
    Relaunch watchdog for the local master orchestrator (issue 64).

.DESCRIPTION
    Runs from Windows Task Scheduler every 30 minutes while Dan is logged on. Decides whether
    a master is alive; if not, launches one in a visible console with Remote Control so the
    session shows up at claude.ai/code and stays steerable in the mobile app while the window
    stays on the desktop.

    "Alive" means EITHER of these holds:
      1. A `claude` (or `node`) process is running with `--remote-control` and `master` on
         its command line. That is the launch shape from the runbook, so it's the process
         signature to trust.
      2. The state issue (claude-dotfiles #44) carries a `**Heartbeat N — <UTC>**` line
         newer than -MaxHeartbeatAgeMinutes (default 120). The runbook's heartbeat
         procedure updates this on every wake; a fresh line means a master is doing work
         even if its window has migrated to a different PID.

    If either check passes: exit 0, print the reason, launch nothing.
    Otherwise: `Start-Process` a NEW cmd.exe window (visible, own console) running
      claude --remote-control master "<boot prompt>"
    in the claude-dotfiles checkout, and exit 0. -WhatIf skips the launch and prints what
    it would have done — the scheduled task registration uses the real script; humans
    checking the "would launch" branch use -WhatIf.

.PARAMETER RepoRoot
    Path to the claude-dotfiles checkout the master reads its runbooks from. Defaults to
    C:\Users\<current>\Claude\Projects\Meta\claude-dotfiles because that is where the
    checkout lives on this PC and Dan does not want to duplicate it.

.PARAMETER StateIssue
    Numeric issue in claude-dotfiles that carries the master state. Defaults to 44.

.PARAMETER MaxHeartbeatAgeMinutes
    Fresh-heartbeat cutoff. 120 (2h) per issue 64's wording.

.PARAMETER WhatIf
    Do the checks, print the decision, but do NOT launch the master even if the "no master"
    branch fired. Used to prove the launching branch by hand without actually spawning one.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$RepoRoot = (Join-Path $env:USERPROFILE 'Claude\Projects\Meta\claude-dotfiles'),
    [int]$StateIssue = 44,
    [int]$MaxHeartbeatAgeMinutes = 120,
    [string]$ClaudeExe = 'claude',
    [switch]$Force
)

# NEVER let a git-stderr warning end the script. Restore-test docs cover the trap.
$ErrorActionPreference = 'Continue'

function Write-Info { param($msg) Write-Host "[watchdog] $msg" }

function Test-MasterProcess {
    <#
      A master is a claude/node process whose command line contains BOTH `--remote-control`
      and a `master` token. Match on Win32_Process because Get-Process does not expose
      CommandLine on Windows. Returns the PIDs found or an empty array.
    #>
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='claude.exe' OR Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $cl = $_.CommandLine
            $cl -and ($cl -match '--remote-control') -and ($cl -match '\bmaster\b')
        })
    return , $procs
}

function Get-LatestHeartbeatUtc {
    param([int]$Issue)
    # gh must be on PATH and authenticated. If it is not, treat as "unknown" (no fresh
    # heartbeat) — the process check may still let the run exit 0, or the launch will proceed.
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
    # Match `**Heartbeat N — YYYY-MM-DD HH:MM UTC**` (em dash) or plain hyphen fallback.
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

$bootPrompt = @'
You are the master orchestrator, local variant. Read orchestrator/LOCAL-RUNBOOK.md and orchestrator/RUNBOOK.md in this repo — binding, in that order of precedence. Check issue #44 for the current state and that no other master (cloud or local) is active; claim "venue": "local-pc". Then begin the heartbeat procedure under /loop dynamic pacing if available, else as single passes. My messages in this terminal override everything.
'@

Write-Info "repo=$RepoRoot  stateIssue=#$StateIssue  cutoff=${MaxHeartbeatAgeMinutes}m"

# --- Check 1: live master process -------------------------------------------------
$procs = Test-MasterProcess
if ($procs.Count -gt 0 -and -not $Force) {
    $pids = ($procs | ForEach-Object { $_.ProcessId }) -join ','
    Write-Info "MASTER ALIVE (process check): pid(s)=$pids"
    Write-Info "exit 0, no launch"
    exit 0
}

# --- Check 2: fresh heartbeat -----------------------------------------------------
$hb = Get-LatestHeartbeatUtc -Issue $StateIssue
if ($hb) {
    $ageMin = [int](([datetime]::UtcNow - $hb).TotalMinutes)
    if ($ageMin -lt $MaxHeartbeatAgeMinutes -and -not $Force) {
        Write-Info "MASTER ALIVE (heartbeat check): latest=$($hb.ToString('u'))  age=${ageMin}m < ${MaxHeartbeatAgeMinutes}m"
        Write-Info "exit 0, no launch"
        exit 0
    } else {
        Write-Info "heartbeat stale: latest=$($hb.ToString('u'))  age=${ageMin}m"
    }
} else {
    Write-Info "no heartbeat line found in issue #$StateIssue"
}

# --- Launch branch ----------------------------------------------------------------
if (-not (Test-Path $RepoRoot)) {
    Write-Info "ERROR: repo root not found: $RepoRoot"
    exit 1
}

$launchCmd = @(
    '/k',
    'cd', '/d', "`"$RepoRoot`"", '&&',
    $ClaudeExe, '--remote-control', 'master', "`"$bootPrompt`""
) -join ' '

Write-Info "NO MASTER ALIVE — would launch: cmd.exe $launchCmd"

if ($PSCmdlet.ShouldProcess("cmd.exe (visible console)", "Start-Process claude --remote-control master")) {
    Start-Process -FilePath 'cmd.exe' -ArgumentList $launchCmd -WorkingDirectory $RepoRoot -WindowStyle Normal
    Write-Info "launched"
} else {
    Write-Info "-WhatIf: no process started"
}
exit 0
