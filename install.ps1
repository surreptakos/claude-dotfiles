<#
.SYNOPSIS
    Set up Claude Code on a fresh machine from this repo.

.DESCRIPTION
    A wrapper: restores the configuration (sync.ps1 -Mode pull), then runs the setup check
    (setup-check.ps1 -Fix) against the same home and exits with its code. The setup check owns
    the prerequisite checks and the owner to-do list - the secret files and the logins a repo
    cannot carry - so a first install and a later audit print the same list (issue 1068).

    Safe to re-run. The pull backs up whatever is already there first.

    -DryRun passes through to the pull and runs the setup check report-only.

.EXAMPLE
    .\install.ps1 -DryRun
    .\install.ps1
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$UserHome = $env:USERPROFILE
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$UserHome = $UserHome.TrimEnd('\', '/')

& (Join-Path $RepoRoot 'sync.ps1') -Mode pull -DryRun:$DryRun -UserHome $UserHome
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Restore failed.' -ForegroundColor Red
    exit 1
}

Write-Host ''
& (Join-Path $RepoRoot 'setup-check.ps1') -UserHome $UserHome -Fix:(-not $DryRun)
exit $LASTEXITCODE
