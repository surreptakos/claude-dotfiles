<#
.SYNOPSIS
    Relaunch watchdog for the local master orchestrators (issue 64; one master per repo since
    issue 70; ONE MASTER AT A TIME since issue 79; idle guard and log since issue 82).

.DESCRIPTION
    Runs from Windows Task Scheduler every -IntervalMinutes while Dan is logged on. Exactly one
    master runs at a time (Dan, 2026-09-02): the watchdog launches one repo's master, rooted in
    that repo's clone; that master runs ONE pass, writes a `**Pass complete - <UTC>**` line into
    its state issue and stops; a later watchdog slot sees the marker, closes that window, and
    launches the next repo. Repos are served in RUNBOOK.md priority order the first time round,
    then least-recently-served first, so every repo gets a turn.

    A master must run inside the repo it serves: every repo's .claude/workflows/ticket-fleet.js
    is cwd-relative (scout `gh issue list` with no -R, implement `isolation: 'worktree'`, verify
    `git worktree add` "in this repo"), so a master rooted in the claude-dotfiles checkout
    cannot fleet. That is what stalled the 2026-09-02 run (claude-dotfiles issue 44).

    Each slot:
      1. Legacy guard. A process with the pre-issue-70 shape `--remote-control master "<prompt>"`
         (bare token, rooted in claude-dotfiles) blocks everything until stopped.
      2. Alive masters: every claude/node process with `--remote-control master-<slug>`.
         For each, read that repo's state issue. The master is DONE only when all three hold:
           a. a `Pass complete` line newer than the process start;
           b. that line is not older than the latest `Heartbeat` line (a heartbeat written after
              the marker means the pass was reopened - Dan typed into the window and the master
              went back to work);
           c. the session transcript has not been written for -IdleMinutes (default 5) - the
              real "nobody is talking to it" signal. On 2026-09-02 22:30 UTC the first version
              of this rule killed master-bill-intake mid-fleet: it had written Pass complete at
              22:20, Dan resumed it at 22:27, it launched a fleet at 22:30:01, and the 22:30 slot
              stopped it on the stale marker (issue 82).
         Done: stop the claude process and its cmd.exe wrapper window and record that.
         Otherwise the master is still working: exit, launch nothing. A master whose latest
         marker is older than -MaxHeartbeatAgeMinutes is reported as possibly stalled but NOT
         killed - an interactive session mid-work is Dan's to stop.
      3. Nothing alive: pick the next repo - never-served repos first in priority order, then
         the one whose latest marker (heartbeat or pass complete) is oldest - and launch it:
           set AAC_ORCHESTRATOR_AUTONOMOUS=1 && claude --dangerously-skip-permissions
             --remote-control master-<slug> "<boot prompt>"
         in a visible cmd.exe window with the working directory set to the repo clone.
         `--dangerously-skip-permissions` is there because the auto-mode permission classifier
         denied `gh pr merge` on 2026-09-02 while auto-merge is ON by ruling (issue 71).
         AAC_ORCHESTRATOR_AUTONOMOUS=1 is what the ask-matt publish gate keys its ticket-set
         exemption on (issue 81): nobody is at the keyboard to approve a ticket set, by design.
         LOCAL-RUNBOOK.md states what both cost.

    Every decision is also appended to -LogFile (default
    ~/.claude/hook-state/master-watchdog/watchdog.log), because a scheduled task's stdout goes
    nowhere and the 22:30 kill above had to be reconstructed from process tables.

    -WhatIf does every check, prints every decision, stops and launches nothing. It is a plain
    switch, not SupportsShouldProcess: under ShouldProcess the WhatIf preference leaks into the
    CimCmdlets module import and prints a dozen "Set Alias" lines.

    This file is saved with a UTF-8 BOM on purpose. Windows PowerShell 5.1 reads a BOM-less
    file as ANSI, and any multibyte character inside a string then breaks the parse.

.PARAMETER DotfilesRoot
    The claude-dotfiles checkout the boot prompt points masters at for the runbooks.

.PARAMETER Only
    Slugs to consider (bill-intake, contract-builder, sales-cockpit, zoho). Empty = all.

.PARAMETER MaxHeartbeatAgeMinutes
    Age past which an alive master's heartbeat is reported as stale. 120 per issue 64.

.PARAMETER IdleMinutes
    A finished master is closed only when its transcript has been untouched this long. 5.

.PARAMETER LogFile
    Append-only decision log. Empty string disables it.

.PARAMETER Force
    Ignore the legacy guard and the alive check; launch the next repo regardless.

.PARAMETER NoBypass
    Omit --dangerously-skip-permissions from the launch. Debugging only; such a master cannot
    run the merge pass (issue 71).

.PARAMETER WhatIf
    Do the checks, print the decisions, stop nothing, launch nothing.
#>
[CmdletBinding()]
param(
    [string]$DotfilesRoot = (Join-Path $env:USERPROFILE 'Claude\Projects\Meta\claude-dotfiles'),
    [string[]]$Only = @(),
    [int]$MaxHeartbeatAgeMinutes = 120,
    [int]$IdleMinutes = 5,
    [string]$LogFile = (Join-Path $env:USERPROFILE '.claude\hook-state\master-watchdog\watchdog.log'),
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

$script:RunStamp = [datetime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss')
if ($LogFile) {
    $logDir = Split-Path -Parent $LogFile
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
}

function Write-Info {
    param($msg)
    $line = "[watchdog] $msg"
    Write-Host $line
    if ($LogFile) {
        try { Add-Content -Path $LogFile -Value "$script:RunStamp $line" -Encoding UTF8 } catch { }
    }
}

function Get-RemoteControlProcesses {
    # Every claude/node process whose command line carries --remote-control. Win32_Process
    # because Get-Process does not expose CommandLine on Windows.
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='claude.exe' OR Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and ($_.CommandLine -match '--remote-control') })
    return , $procs
}

function Get-MasterSlug {
    param($Proc)
    # The slug from a `--remote-control master-<slug>` command line, or $null.
    if ($Proc.CommandLine -match '--remote-control\s+master-([A-Za-z0-9-]+)(?=\s|"|$)') { return $Matches[1] }
    return $null
}

function Test-LegacyMasterProcess {
    param([array]$Procs)
    # Pre-issue-70 shape: `--remote-control master "<prompt>"` - bare token, rooted in dotfiles.
    return , @($Procs | Where-Object { $_.CommandLine -match '--remote-control\s+master(?=\s|"|$)' })
}

function Get-StateMarkers {
    param([int]$Issue)
    # Reads the state issue body and returns @{ Heartbeat = <utc or null>; PassComplete = <utc or null> },
    # each the latest of its kind, or $null when gh could not read the issue.
    # PS 5.1 reads console output as ANSI by default. Force UTF-8 so em dashes in the
    # marker lines do not get mangled into three garbage chars that never match.
    $prevEnc = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $body = & gh issue view $Issue --repo surreptakos/claude-dotfiles --json body -q .body 2>$null
    } finally {
        [Console]::OutputEncoding = $prevEnc
    }
    if ($body -is [Array]) { $body = $body -join [Environment]::NewLine }
    if (-not $body -or $LASTEXITCODE -ne 0) {
        Write-Info "gh could not read issue #$Issue; marker check inconclusive"
        return $null
    }
    # `**Heartbeat N <em dash or hyphen> YYYY-MM-DD HH:MM UTC**` and `**Pass complete <dash> YYYY-MM-DD HH:MM UTC**`.
    $rx = '(?m)\*\*(Heartbeat\s+\d+|Pass complete)\s*[—\-]\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+UTC\*\*'
    $out = @{ Heartbeat = $null; PassComplete = $null }
    foreach ($m in [regex]::Matches($body, $rx)) {
        $ts = [datetime]::ParseExact(
            ($m.Groups[2].Value + ' ' + $m.Groups[3].Value),
            'yyyy-MM-dd HH:mm',
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
        $key = 'Heartbeat'
        if ($m.Groups[1].Value -like 'Pass complete*') { $key = 'PassComplete' }
        if ($null -eq $out[$key] -or $ts -gt $out[$key]) { $out[$key] = $ts }
    }
    return $out
}

function Get-LatestMarkerUtc {
    param($Markers)
    if ($null -eq $Markers) { return $null }
    $latest = $Markers.Heartbeat
    if ($Markers.PassComplete -and ($null -eq $latest -or $Markers.PassComplete -gt $latest)) { $latest = $Markers.PassComplete }
    return $latest
}

function Get-TranscriptLastWriteUtc {
    param([hashtable]$R, [datetime]$StartedUtc)
    # Claude Code keeps one transcript per session under ~/.claude/projects/<cwd slug>/<id>.jsonl,
    # where the slug is the clone path with every non-alphanumeric run turned into '-'. The
    # master's transcript is the newest one in that folder CREATED after the process started
    # (creation time, not last write: the whole point is to read how long ago it was last written).
    $slug = ($R.Root -replace '[^A-Za-z0-9]', '-')
    $dir = Join-Path $env:USERPROFILE (Join-Path '.claude\projects' $slug)
    if (-not (Test-Path $dir)) { return $null }
    $files = @(Get-ChildItem -Path $dir -Filter '*.jsonl' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.CreationTimeUtc -gt $StartedUtc } |
        Sort-Object LastWriteTimeUtc -Descending)
    if ($files.Count -eq 0) { return $null }
    return $files[0].LastWriteTimeUtc
}

function Get-BootPrompt {
    param([hashtable]$R)
    # No double quotes inside: the prompt travels as one double-quoted cmd.exe argument.
    $runbooks = Join-Path $DotfilesRoot 'orchestrator'
    return ("You are the master orchestrator, local variant, serving $($R.Repo). This session is rooted in that repo's clone; " +
            "never change directory out of it. Nobody is at the keyboard: never call AskUserQuestion and never wait for a typed " +
            "approval; anything that needs Dan becomes a ready-for-human ticket with the evidence in its body. " +
            "Read $runbooks\LOCAL-RUNBOOK.md and then $runbooks\RUNBOOK.md - binding, in that " +
            "order of precedence. Your state issue is surreptakos/claude-dotfiles#$($R.StateIssue); issue #44 there is the shared " +
            "registry and config - read it, never write to it or to another repo's state issue. Check your state issue for the " +
            "current state and that no other master serves $($R.Repo); claim venue local-pc there. Then run ONE pass, no /loop: " +
            "serve this repo until nothing is actionable or a cap is hit, heartbeating as you go. When the pass is done, clear " +
            "the venue, write a line **Pass complete - YYYY-MM-DD HH:MM UTC** (current UTC) at the top of your state issue's " +
            "heartbeat section, say pass complete, and stop; the watchdog closes this window once it has been idle five minutes " +
            "and starts the next repo. If a message arrives after that, the pass is reopened: write a fresh Heartbeat line " +
            "before doing anything else, so the watchdog does not close you mid-work. My messages in this terminal override everything.")
}

function Stop-MasterWindow {
    param($Proc, [string]$Tag)
    # Stop the claude process and, when its parent is the cmd.exe /k wrapper the watchdog
    # launched (its command line carries the same master-<slug> token), that window too.
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($Proc.ParentProcessId)" -ErrorAction SilentlyContinue
    Stop-Process -Id $Proc.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Info "$Tag stopped claude pid=$($Proc.ProcessId)"
    if ($parent -and $parent.Name -eq 'cmd.exe' -and $parent.CommandLine -match 'master-') {
        Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Info "$Tag stopped cmd.exe wrapper pid=$($parent.ProcessId)"
    }
}

Write-Info "dotfiles=$DotfilesRoot  staleAfter=${MaxHeartbeatAgeMinutes}m  idle=${IdleMinutes}m  repos=$(($Repos | ForEach-Object { $_.Slug }) -join ',')"

# -Only arrives as one comma-joined string when the script is run with -File; split it.
$Only = @($Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$selected = @($Repos | Where-Object { $Only.Count -eq 0 -or $Only -contains $_.Slug })

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

# --- Alive masters: finished AND idle ones get closed, everything else blocks the launch ---
$markersBySlug = @{}
$stillWorking = 0
foreach ($p in $rcProcs) {
    $slug = Get-MasterSlug -Proc $p
    if (-not $slug) { continue }
    $tag = "[$slug]"
    $row = $Repos | Where-Object { $_.Slug -eq $slug } | Select-Object -First 1
    if (-not $row) {
        Write-Info "$tag master alive (pid=$($p.ProcessId)) for a repo not in this table - left alone, blocks the launch"
        $stillWorking++
        continue
    }
    $markers = Get-StateMarkers -Issue $row.StateIssue
    $markersBySlug[$slug] = $markers
    $started = $p.CreationDate.ToUniversalTime()
    $pc = $null
    if ($markers) { $pc = $markers.PassComplete }
    $hb = $null
    if ($markers) { $hb = $markers.Heartbeat }
    $lastWrite = Get-TranscriptLastWriteUtc -R $row -StartedUtc $started
    $idleMin = -1
    if ($lastWrite) { $idleMin = [int](([datetime]::UtcNow - $lastWrite).TotalMinutes) }

    $markerFresh = ($pc -and $pc -gt $started)
    $notReopened = ($pc -and (-not $hb -or $pc -ge $hb))
    $idle = ($idleMin -ge $IdleMinutes)   # -1 (no transcript found) never counts as idle
    if ($markerFresh -and $notReopened -and $idle -and -not $Force) {
        Write-Info "$tag PASS COMPLETE at $($pc.ToString('u')) (master started $($started.ToString('u')), transcript idle ${idleMin}m) - closing pid=$($p.ProcessId)"
        if ($WhatIf) { Write-Info "$tag -WhatIf: not stopped" ; $stillWorking++ }
        else { Stop-MasterWindow -Proc $p -Tag $tag }
        continue
    }
    if ($markerFresh -and -not $notReopened) {
        Write-Info "$tag MASTER ALIVE pid=$($p.ProcessId): Pass complete $($pc.ToString('u')) superseded by Heartbeat $($hb.ToString('u')) - pass reopened, working"
    } elseif ($markerFresh -and -not $idle) {
        Write-Info "$tag MASTER ALIVE pid=$($p.ProcessId): Pass complete $($pc.ToString('u')) but transcript written ${idleMin}m ago (< ${IdleMinutes}m) - still in use, not closed"
    } else {
        $latest = Get-LatestMarkerUtc -Markers $markers
        if ($latest) {
            $ageMin = [int](([datetime]::UtcNow - $latest).TotalMinutes)
            if ($ageMin -ge $MaxHeartbeatAgeMinutes) {
                Write-Info "$tag MASTER ALIVE pid=$($p.ProcessId) but latest marker is ${ageMin}m old - possibly stalled; not killed, Dan decides"
            } else {
                Write-Info "$tag MASTER ALIVE pid=$($p.ProcessId), working (latest marker ${ageMin}m ago, transcript idle ${idleMin}m)"
            }
        } else {
            Write-Info "$tag MASTER ALIVE pid=$($p.ProcessId), no marker yet (booting)"
        }
    }
    $stillWorking++
}
if ($stillWorking -gt 0 -and -not $Force) {
    Write-Info "one master at a time: $stillWorking alive - exit 0, no launch"
    exit 0
}

# --- Pick the next repo: never served first (priority order), then least recently served ---
# The -Only check sits here, after the close-finished-masters stage, so `-Only <bogus>` is a way
# to run that stage for real without launching anything.
if ($selected.Count -eq 0) { Write-Info "ERROR: -Only matched no repo; nothing launched"; exit 1 }
$candidates = @()
foreach ($r in $selected) {
    if (-not (Test-Path $r.Root)) { Write-Info "[$($r.Slug)] clone not found: $($r.Root) - skipped"; continue }
    $markers = $markersBySlug[$r.Slug]
    if (-not $markersBySlug.ContainsKey($r.Slug)) { $markers = Get-StateMarkers -Issue $r.StateIssue }
    $last = Get-LatestMarkerUtc -Markers $markers
    $lastText = 'never'
    if ($last) { $lastText = $last.ToString('u') }
    Write-Info "[$($r.Slug)] last served: $lastText"
    $candidates += [pscustomobject]@{ Row = $r; Last = $last; Order = [array]::IndexOf(@($Repos | ForEach-Object { $_.Slug }), $r.Slug) }
}
if ($candidates.Count -eq 0) { Write-Info "ERROR: no launchable repo"; exit 1 }
$next = ($candidates | Sort-Object @{ Expression = { if ($_.Last) { 1 } else { 0 } } }, @{ Expression = { if ($_.Last) { $_.Last } else { [datetime]::MinValue } } }, Order | Select-Object -First 1).Row

# --- Launch exactly one ----------------------------------------------------------------
$tag = "[$($next.Slug)]"
$bypass = @()
if (-not $NoBypass) { $bypass = @('--dangerously-skip-permissions') }
$launchCmd = (@(
    '/k',
    'cd', '/d', "`"$($next.Root)`"", '&&',
    'set', 'AAC_ORCHESTRATOR_AUTONOMOUS=1', '&&',
    $ClaudeExe) + $bypass + @('--remote-control', "master-$($next.Slug)", "`"$(Get-BootPrompt -R $next)`"")
) -join ' '

Write-Info "$tag NEXT - would launch: cmd.exe $launchCmd"
if ($WhatIf) {
    Write-Info "$tag -WhatIf: no process started"
} else {
    Start-Process -FilePath 'cmd.exe' -ArgumentList $launchCmd -WorkingDirectory $next.Root -WindowStyle Normal
    Write-Info "$tag launched"
}
exit 0
