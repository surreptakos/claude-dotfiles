<#
.SYNOPSIS
    The master watchdog's stall recycle for a master that never reached its first prompt
    (issue 1205).

.DESCRIPTION
    A master with no transcript used to read as "transcript idle -1m", which never met the
    stall rule's 30 minutes, so master-routines held the only slot for 13h45m. Now no transcript
    counts as idle since the process start, and every alive line names the first transcript
    write (or "none yet"). Each case runs orchestrator\master-watchdog.ps1 -WhatIf in this
    process against a sandbox home: Get-CimInstance (the process table) and gh (the state issue
    body) are stubbed as functions, which PowerShell resolves before the cmdlet and the exe, and
    the verdict is read from the watchdog's own -LogFile.

      1. no transcript, started 45m ago, marker 180m old: takes the recycle path.
      2. no transcript, started 10m ago, marker 180m old: not killed.
      3. a transcript written 2m ago: not killed, and the line names its first write.
      4. the process-table read throws: the tick logs `tick FAILED` with the line and message,
         exits 1 and launches nothing (issue 1156).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tests\master-watchdog.tests.ps1
#>
[CmdletBinding()]
param()

# No Set-StrictMode: the watchdog runs in a child scope of this one and would inherit it.
$ErrorActionPreference = 'Continue'

$TestsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $TestsRoot
$Watchdog  = Join-Path $RepoRoot 'orchestrator\master-watchdog.ps1'
$TempRoot  = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
$sandbox   = Join-Path $TempRoot ("master-watchdog-tests-" + [guid]::NewGuid().ToString('N').Substring(0, 8))

$script:Pass = 0
$script:Fail = 0
function Assert {
    param([string]$Name, [bool]$Ok, [string]$Info = '')
    if ($Ok) { $script:Pass++; Write-Host ("  ok    {0}" -f $Name) -ForegroundColor Green }
    else {
        $script:Fail++
        Write-Host ("  FAIL  {0}" -f $Name) -ForegroundColor Red
        if ($Info) { Write-Host ("        {0}" -f $Info) -ForegroundColor Red }
    }
}

# The first served row of the shared repo list is the master under test.
. (Join-Path $RepoRoot 'lib\manifest.ps1')
Set-StrictMode -Off
$row = @((Read-RepoList -UserHome 'C:\home').Repos | Where-Object { $_.Served } | Sort-Object Priority)[0]

# Stubs the watchdog resolves before the real commands. Their data is global: $script: inside a
# stub called from the watchdog names the watchdog's script scope, not this one.
function Get-CimInstance {
    [CmdletBinding()] param([Parameter(Position = 0)]$ClassName, $Filter)
    if ($global:WatchdogTestThrow) { throw $global:WatchdogTestThrow }
    if ($Filter -like '*claude.exe*') { return $global:WatchdogTestProc }
}
function gh {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'issue' -and $args[1] -eq 'view') { return $global:WatchdogTestBody }
}

function Invoke-Case {
    param([string]$Name, [int]$StartedMinutesAgo, [int]$TranscriptCreatedMinutesAgo = -1, [int]$TranscriptWrittenMinutesAgo = -1)
    $home_ = Join-Path $sandbox $Name
    New-Item -ItemType Directory -Path $home_ -Force | Out-Null
    $log = Join-Path $home_ 'watchdog.log'
    $now = [datetime]::UtcNow
    $global:WatchdogTestBody = "## Heartbeats`n`n**Pass complete - $($now.AddMinutes(-180).ToString('yyyy-MM-dd HH:mm')) UTC**`n"
    $global:WatchdogTestProc = [pscustomobject]@{
        Name = 'claude.exe'; ProcessId = 4242; ParentProcessId = 4241
        CommandLine = "claude --dangerously-skip-permissions --remote-control master-$($row.Master) ""boot"""
        CreationDate = [datetime]::Now.AddMinutes(-$StartedMinutesAgo)
    }
    $created = $null
    if ($TranscriptCreatedMinutesAgo -ge 0) {
        $clone = Join-Path $home_ ($row.RelativePath.Replace('/', '\'))
        $dir = Join-Path $home_ (Join-Path '.claude\projects' ($clone -replace '[^A-Za-z0-9]', '-'))
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        $t = Join-Path $dir 'session-1205.jsonl'
        Set-Content -Path $t -Value '{}'
        $created = $now.AddMinutes(-$TranscriptCreatedMinutesAgo)
        (Get-Item $t).CreationTimeUtc = $created
        (Get-Item $t).LastWriteTimeUtc = $now.AddMinutes(-$TranscriptWrittenMinutesAgo)
    }
    $prevHome = $env:USERPROFILE
    try {
        $env:USERPROFILE = $home_
        & $Watchdog -WhatIf -LogFile $log -DotfilesRoot $RepoRoot *> $null
        $exit = $LASTEXITCODE
    } finally { $env:USERPROFILE = $prevHome }
    $text = ''
    if (Test-Path $log) { $text = [System.IO.File]::ReadAllText($log) }
    return @{ Log = $text; Created = $created; Exit = $exit }
}

try {
    Write-Host "master-watchdog: no transcript reads as idle since the process start (issue 1205)"

    $r = Invoke-Case -Name 'never-booted-45m' -StartedMinutesAgo 45
    Assert 'no transcript, started 45m ago, marker 180m old: STALLED, recycled' `
        (($r.Log -match "\[$($row.Master)\] STALLED at .*transcript idle 4\dm >= 30m, first transcript write none yet\) - recycling pid=4242") -and
         ($r.Log -match '-WhatIf: not stopped') -and ($r.Log -notmatch 'possibly stalled')) $r.Log

    $r = Invoke-Case -Name 'never-booted-10m' -StartedMinutesAgo 10
    Assert 'no transcript, started 10m ago, marker 180m old: not killed, first write none yet' `
        (($r.Log -match 'MASTER ALIVE pid=4242 but latest marker is 1\d\dm old, transcript idle \d+m \(< 30m\), first transcript write none yet - possibly stalled; not killed') -and
         ($r.Log -cnotmatch 'STALLED at')) $r.Log

    $r = Invoke-Case -Name 'transcript-2m' -StartedMinutesAgo 45 -TranscriptCreatedMinutesAgo 43 -TranscriptWrittenMinutesAgo 2
    $first = [regex]::Escape($r.Created.ToString('u'))
    Assert 'transcript written 2m ago: not killed, alive line names the first transcript write' `
        (($r.Log -match "transcript idle [23]m \(< 30m\), first transcript write $first - possibly stalled; not killed") -and
         ($r.Log -cnotmatch 'STALLED at') -and ($r.Log -notmatch 'tick FAILED') -and ($r.Exit -eq 0)) $r.Log

    $global:WatchdogTestThrow = 'stub: WMI provider unavailable'
    try { $r = Invoke-Case -Name 'tick-throws' -StartedMinutesAgo 45 } finally { $global:WatchdogTestThrow = $null }
    Assert 'a terminating error mid-tick: tick FAILED with line and message, exit 1, no launch' `
        (($r.Log -match 'tick FAILED at master-watchdog\.tests\.ps1:\d+: .*throw .* - RuntimeException: stub: WMI provider unavailable') -and
         ($r.Log -match 'tick FAILED stack: at Get-CimInstance, .* <- at Get-RemoteControlProcesses, master-watchdog\.ps1: line \d+ <- ') -and ($r.Log -match 'exit 1, no launch') -and
         ($r.Log -notmatch 'NEXT - would launch') -and ($r.Exit -eq 1)) $r.Log
} finally {
    if (Test-Path $sandbox) { try { Remove-Item -Path $sandbox -Recurse -Force -ErrorAction Stop } catch {} }
}

Write-Host ''
Write-Host ("pass {0}  fail {1}" -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
