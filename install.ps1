<#
.SYNOPSIS
    Set up Claude Code on a fresh machine from this repo.

.DESCRIPTION
    Checks prerequisites, restores the configuration (sync.ps1 -Mode pull), then
    prints the short list of things a repo cannot carry: the three secret files
    and the two logins.

    Safe to re-run. The pull backs up whatever is already there first.

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

Write-Host 'Prerequisites'
$required = @(
    @{ Name = 'git';      Command = 'git' },
    @{ Name = 'node';     Command = 'node' },
    @{ Name = 'python';   Command = 'py' },
    @{ Name = 'claude';   Command = 'claude' },
    @{ Name = 'gh';       Command = 'gh' },
    @{ Name = 'PyYAML';   Command = $null }
)
$missing = @()
foreach ($tool in $required) {
    if ($tool.Command -eq $null) {
        # PyYAML is a Python package, check it separately
        continue
    }
    $found = Get-Command $tool.Command -ErrorAction SilentlyContinue
    if ($null -eq $found) {
        Write-Host ("  MISSING  {0}" -f $tool.Name) -ForegroundColor Yellow
        $missing += $tool.Name
    } else {
        Write-Host ("  ok       {0}  ({1})" -f $tool.Name, $found.Source)
    }
}

# Check for PyYAML Python package
$pyyamlInstalled = $false
try {
    & py -3 -c "import yaml" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ok       PyYAML"
        $pyyamlInstalled = $true
    }
} catch {
    # Continue to install
}

if (-not $pyyamlInstalled) {
    Write-Host "  MISSING  PyYAML" -ForegroundColor Yellow
    if (-not $DryRun) {
        Write-Host "    Installing PyYAML..." -ForegroundColor Cyan
        try {
            & py -3 -m pip install PyYAML 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "    PyYAML installed successfully" -ForegroundColor Green
                $pyyamlInstalled = $true
            } else {
                Write-Host "    Failed to install PyYAML" -ForegroundColor Red
                $missing += 'PyYAML'
            }
        } catch {
            Write-Host "    Error installing PyYAML: $_" -ForegroundColor Red
            $missing += 'PyYAML'
        }
    } else {
        $missing += 'PyYAML'
    }
}

if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Host ("Install these first: {0}" -f ($missing -join ', ')) -ForegroundColor Yellow
        Write-Host ''
}

Write-Host ''
& (Join-Path $RepoRoot 'sync.ps1') -Mode pull -DryRun:$DryRun -UserHome $UserHome
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Restore failed.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'Still to do by hand - a repo cannot carry these:'
Write-Host ''
Write-Host '  1. Secrets. Copy over a secure channel (password manager or encrypted drive),'
Write-Host '     never email and never a repo:'
Write-Host ("       {0}\.config\gpt-sheets-access-475817-853f8648243b.json   (service account key)" -f $UserHome)
Write-Host ("       {0}\Downloads\client_secret_594980791877-*.json          (OAuth client)" -f $UserHome)
Write-Host ''
Write-Host '  2. Logins:'
Write-Host '       claude            then /login'
Write-Host '       gh auth login'
Write-Host '       node <claude-dotfiles>\gas\cli\gas.js login   (once per Google account; Apps Script repos deploy themselves - no clasp)'
Write-Host ''
Write-Host '  3. Plugins reinstall themselves from the marketplaces in profile/claude/settings.json on'
Write-Host '     first launch. The statusLine command points into plugins\cache\... with a build'
Write-Host '     hash that will differ here; re-point it if the status line is blank.'
Write-Host ''
Write-Host '  4. Verify, in a project clone:'
Write-Host '       node tests/run-all.js'
Write-Host '       node tools/tracker-audit.js'
