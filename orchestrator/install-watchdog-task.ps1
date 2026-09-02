<#
.SYNOPSIS
    Register (or preview) the "Claude master watchdog" Windows scheduled task.

.DESCRIPTION
    Two-step install by design (issue 64, attempt 3, fixing a hazard the previous
    delivery had): the DEFAULT invocation is a preview that prints the exact
    schtasks command it would run and stops without touching the scheduler, so
    nothing schedules and no unattended `claude --remote-control master` process
    can spawn just from someone running the script to "see what it does". The
    caller has to add `-Install` to actually register.

    When `-Install` is passed, the task is registered and its first-run slot is
    set to `-FirstRunMinutes` minutes out (default 30, matching the interval)
    rather than the +1 minute the earlier script used. That kept the launch
    branch from firing during registration; the previous +1 minute made a real
    launch during an install-and-immediately-uninstall dry read of the runbook.
    Passing `-FirstRunMinutes 0` or `-Install -RunNow` puts the first slot 1 min
    out for an explicit "install and let it fire" test — you have to ask for it.

    Idempotent: deletes any prior task with the same name, then creates fresh
    so path/param changes always take effect. Uses `schtasks.exe /IT` because
    `Register-ScheduledTask` with the INTERACTIVE group principal needs UAC on
    this PC; `schtasks /IT /RL LIMITED` does not.

    Uninstall: `schtasks /Delete /TN "Claude master watchdog" /F`.
    Manual trigger for testing (still requires `-Install` first): `schtasks
    /Run /TN "Claude master watchdog"`.
#>
[CmdletBinding()]
param(
    [string]$TaskName    = 'Claude master watchdog',
    [string]$WatchdogPs1 = '',
    [int]$IntervalMinutes = 30,
    [int]$FirstRunMinutes = 30,
    [switch]$Install,
    [switch]$RunNow
)

if (-not $WatchdogPs1) {
    $here = $PSScriptRoot
    if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
    $WatchdogPs1 = Join-Path $here 'master-watchdog.ps1'
}
if (-not (Test-Path $WatchdogPs1)) {
    throw "watchdog not found at $WatchdogPs1"
}

$tr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$WatchdogPs1`""
if ($RunNow) { $FirstRunMinutes = 1 }
$startTime = (Get-Date).AddMinutes([Math]::Max(1, $FirstRunMinutes)).ToString('HH:mm')

$schArgs = @(
    '/Create',
    '/TN', $TaskName,
    '/TR', $tr,
    '/SC', 'MINUTE',
    '/MO', "$IntervalMinutes",
    '/ST', $startTime,
    '/IT',
    '/RL', 'LIMITED',
    '/F'
)

Write-Host "[install] task name       : $TaskName"
Write-Host "[install] watchdog script : $WatchdogPs1"
Write-Host "[install] interval        : every $IntervalMinutes minute(s)"
Write-Host "[install] first-run slot  : $startTime  (in ~$([Math]::Max(1,$FirstRunMinutes)) minute(s) from now)"
Write-Host "[install] logon mode      : interactive only  (/IT)"
Write-Host "[install] elevation       : LIMITED (no UAC prompt)"
Write-Host ""
Write-Host "[install] would run:"
Write-Host "  schtasks.exe $($schArgs -join ' ')"
Write-Host ""

if (-not $Install) {
    Write-Host "[install] PREVIEW ONLY - nothing registered."
    Write-Host "[install] re-run with -Install to register the task."
    Write-Host "[install] the first slot fires $FirstRunMinutes minute(s) after registration"
    Write-Host "[install] and every ${IntervalMinutes}m thereafter while you are logged on."
    Write-Host "[install] if you only want to preview one more time, that is safe;"
    Write-Host "[install] the task is only created when -Install is present."
    exit 0
}

# Delete any prior registration first so PATH/param changes always take effect.
& schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null

$out = & schtasks.exe @schArgs 2>&1
$rc = $LASTEXITCODE
Write-Host $out
if ($rc -ne 0) {
    throw "schtasks /Create exited $rc"
}

Write-Host ""
Write-Host "[install] registered '$TaskName' every ${IntervalMinutes}m (interactive only); script=$WatchdogPs1"
Write-Host "[install] first slot     : $startTime (~$FirstRunMinutes min out)"
Write-Host "[install] fire it now    : schtasks /Run /TN `"$TaskName`""
Write-Host "[install] stop for good  : schtasks /Delete /TN `"$TaskName`" /F"
Write-Host "[install] disable a slot : schtasks /Change /Disable /TN `"$TaskName`""
