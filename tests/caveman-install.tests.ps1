<#
.SYNOPSIS
    lib\caveman-install.ps1 - the desktop caveman CLI install step (issue 825).

.DESCRIPTION
    Runs Install-CavemanCli in-process (dot-sourced, same as sync.ps1 does) against a stub npm
    and a stub caveman binary under a sandbox HOME, so every case runs offline and deterministic -
    the real `@caveman-ai/cli` install is exercised only by the Windows restore suite itself,
    which runs install.ps1 for real.

    Cases:
      1. a fresh install: npm runs once, the pin's version is what gets installed, caveman
         setup --install and enable claude both run, one OK status line.
      2. a second install is a no-op for npm (issue 825 AC3): the stub records every invocation,
         and the count must not grow once the installed version already matches the pin.
      3. -DryRun reports the step, runs no npm, and leaves a pre-existing settings.json
         byte-identical (issue 825 AC4).
      4. the offline skip variable (CAVEMAN_INSTALL_OFFLINE_SKIP) holds the fail-closed path:
         a live settings.json that already carries a caveman route and proxy hooks loses both,
         and exactly one status line is printed (issue 825 AC5).
      5. a missing npm on PATH fails closed the same way, without ever touching the stub.
      6. Remove-CavemanRouteAndHooks / Test-CavemanRoutePresent / Test-CavemanHooksPresent agree
         with each other on a settings.json seeded with both real and unrelated hook entries.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tests\caveman-install.tests.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TestsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $TestsRoot
$TempRoot  = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }

. (Join-Path $RepoRoot 'lib\caveman-install.ps1')

$script:Pass = 0
$script:Fail = 0

function Assert {
    param([string]$Name, [bool]$Ok, [string]$Info = '')
    if ($Ok) {
        $script:Pass++
        Write-Host ("  ok    {0}" -f $Name) -ForegroundColor Green
    } else {
        $script:Fail++
        Write-Host ("  FAIL  {0}" -f $Name) -ForegroundColor Red
        if ($Info) { Write-Host ("        {0}" -f $Info) -ForegroundColor Red }
    }
}

function Write-TextFile {
    param([string]$Path, [string]$Text)
    $parent = Split-Path $Path -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

$sandbox = Join-Path $TempRoot ('caveman-install-{0}-{1}' -f $PID, ([guid]::NewGuid().ToString('N').Substring(0, 6)))
New-Item -ItemType Directory -Path $sandbox -Force | Out-Null

# A throwaway repo carrying only what Get-CavemanCliPin reads.
$stubRepo = Join-Path $sandbox 'repo'
$pin = '1.3.4-test'
Write-TextFile -Path (Join-Path $stubRepo 'caveman-cli-version.txt') -Text ("{0}`n" -f $pin)

# The stub npm: logs every invocation to $env:CAVEMAN_TEST_NPM_LOG, honours
# $env:CAVEMAN_TEST_NPM_FAIL, and otherwise writes a stub `caveman` binary (below) into
# --prefix\bin so Resolve-CavemanExe finds it, the same shape a real `npm install -g --prefix`
# leaves behind.
$stubBin = Join-Path $sandbox 'stub-bin'
New-Item -ItemType Directory -Path $stubBin -Force | Out-Null

# Each stub is its own process (the .cmd shim spawns `powershell -File`), so state has to live on
# disk, never in an environment variable one stub sets for another to read - a child process
# cannot hand an env var back to its parent, let alone to a sibling process spawned later.
# .installed-version next to the stub caveman binary is what --version reports, written once by
# the npm stub at "install" time; caveman-proxy.exe is a plain marker file `setup --install`
# leaves behind, exactly like the real signed binary would from Test-Path's point of view.
$cavemanStub = @'
param()
$binDir = $PSScriptRoot
if ($args.Count -ge 1 -and $args[0] -eq '--version') {
    $installed = ''
    $versionFile = Join-Path $binDir '.installed-version'
    if (Test-Path $versionFile) { $installed = (Get-Content -Path $versionFile -Raw).Trim() }
    Write-Output ('{"version": "' + $installed + '"}')
    exit 0
}
if ($args.Count -ge 2 -and $args[0] -eq 'setup' -and $args[1] -eq '--install') {
    if ($env:CAVEMAN_TEST_SETUP_FAIL -eq '1') { exit 1 }
    $proxyDir = Join-Path $env:CAVEMAN_HOME 'bin'
    New-Item -ItemType Directory -Path $proxyDir -Force | Out-Null
    Set-Content -Path (Join-Path $proxyDir 'caveman-proxy.exe') -Value 'stub' -Encoding ascii
    exit 0
}
if ($args.Count -ge 2 -and $args[0] -eq 'enable' -and $args[1] -eq 'claude') {
    if ($env:CAVEMAN_TEST_ENABLE_FAIL -eq '1') { Write-Output 'refused'; exit 1 }
    Write-Output 'native Caveman enabled'
    exit 0
}
exit 1
'@

$npmStub = @'
param()
if ($env:CAVEMAN_TEST_NPM_LOG) { Add-Content -Path $env:CAVEMAN_TEST_NPM_LOG -Value ($args -join ' ') }
if ($env:CAVEMAN_TEST_NPM_FAIL -eq '1') { exit 1 }
$prefixIndex = [array]::IndexOf($args, '--prefix')
if ($prefixIndex -lt 0 -or $prefixIndex + 1 -ge $args.Count) { exit 1 }
$prefix = $args[$prefixIndex + 1]
$binDir = Join-Path $prefix 'bin'
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
Copy-Item -Path $env:CAVEMAN_TEST_STUB_SOURCE -Destination (Join-Path $binDir 'caveman.ps1') -Force
$shim = '@echo off' + [Environment]::NewLine + 'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0caveman.ps1" %*'
[System.IO.File]::WriteAllText((Join-Path $binDir 'caveman.cmd'), $shim, (New-Object System.Text.ASCIIEncoding))
# The freshly "installed" CLI now reports the pin on disk, exactly like a real install would -
# not an env var, which would die with this process.
Set-Content -Path (Join-Path $binDir '.installed-version') -Value $env:CAVEMAN_TEST_PIN -Encoding ascii
exit 0
'@

Write-TextFile -Path (Join-Path $stubBin 'caveman-stub.ps1') -Text $cavemanStub
Write-TextFile -Path (Join-Path $stubBin 'npm.ps1') -Text $npmStub
$npmShim = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$stubBin\npm.ps1`" %*`r`n"
[System.IO.File]::WriteAllText((Join-Path $stubBin 'npm.cmd'), $npmShim, (New-Object System.Text.ASCIIEncoding))

$OldPath = $env:PATH
$OldEnv = @{}
foreach ($k in 'CAVEMAN_INSTALL_OFFLINE_SKIP', 'CAVEMAN_TEST_NPM_LOG', 'CAVEMAN_TEST_NPM_FAIL',
              'CAVEMAN_TEST_CAVEMAN_LOG', 'CAVEMAN_TEST_SETUP_FAIL', 'CAVEMAN_TEST_ENABLE_FAIL',
              'CAVEMAN_TEST_INSTALLED_VERSION', 'CAVEMAN_TEST_STUB_SOURCE', 'CAVEMAN_TEST_PIN', 'CAVEMAN_HOME') {
    $OldEnv[$k] = [Environment]::GetEnvironmentVariable($k)
}

function Reset-TestEnv {
    foreach ($k in $OldEnv.Keys) { [Environment]::SetEnvironmentVariable($k, $null) }
    $env:PATH = $OldPath
    $env:CAVEMAN_TEST_STUB_SOURCE = Join-Path $stubBin 'caveman-stub.ps1'
    $env:CAVEMAN_TEST_PIN = $pin
}

function Invoke-InstallCaveman {
    param([string]$UserHome, [switch]$DryRun)
    $env:PATH = "$stubBin;$OldPath"
    $out = Install-CavemanCli -RepoRoot $stubRepo -UserHome $UserHome -DryRun:$DryRun 6>&1 | Out-String
    return $out
}

function New-SettingsWithCavemanEntries {
    param([string]$Path)
    $settings = @{
        env   = @{ ENABLE_TOOL_SEARCH = 'auto'; ANTHROPIC_BASE_URL = 'http://127.0.0.1:8787/w/claude'; _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL = '1' }
        hooks = @{
            SessionStart = @(@{ hooks = @(@{ type = 'command'; command = "& 'C:/x/caveman-proxy.exe' native-hook claude" }) })
            PreToolUse   = @(
                @{ hooks = @(@{ type = 'command'; command = "& 'C:/x/caveman-proxy.exe' native-hook claude" }) },
                @{ hooks = @(@{ type = 'command'; command = "& 'C:/x/caveman.CMD' shrink-hook" }) },
                @{ hooks = @(@{ type = 'command'; command = 'py -3 ask_matt_gate.py PreToolUse' }) }
            )
        }
        permissions = @{ defaultMode = 'bypassPermissions' }
    }
    Write-TextFile -Path $Path -Text ($settings | ConvertTo-Json -Depth 20)
}

try {
    # ---- (1) fresh install: npm runs once, binaries land, one OK line -------------------
    Write-Host ''
    Write-Host 'fresh install'
    Reset-TestEnv
    $home1 = Join-Path $sandbox 'home-fresh'
    $env:CAVEMAN_TEST_NPM_LOG = Join-Path $sandbox 'npm-fresh.log'
    $out = Invoke-InstallCaveman -UserHome $home1
    Assert 'reports OK with the pinned version' ($out -match [regex]::Escape($pin) -and $out -match 'OK') $out
    Assert 'the stub caveman binary landed under .local\bin' (Test-Path (Join-Path $home1 '.local\bin\caveman.cmd')) $out
    Assert 'the stub proxy binary landed under .caveman\bin' (Test-Path (Join-Path $home1 '.caveman\bin\caveman-proxy.exe')) $out
    Assert 'npm ran exactly once' ((Get-Content (Join-Path $sandbox 'npm-fresh.log')).Count -eq 1) $out

    # ---- (2) second install is a no-op for npm (AC3) -------------------------------------
    Write-Host ''
    Write-Host 'second install (issue 825 AC3: no npm run once the pin is already installed)'
    $out2 = Invoke-InstallCaveman -UserHome $home1
    Assert 'second run still reports OK' ($out2 -match 'OK') $out2
    Assert 'npm log did not grow (no npm run on the second install)' `
        ((Get-Content (Join-Path $sandbox 'npm-fresh.log')).Count -eq 1) $out2

    # ---- (3) -DryRun reports the step, runs no npm, changes no settings (AC4) -----------
    Write-Host ''
    Write-Host '-DryRun'
    Reset-TestEnv
    $home3 = Join-Path $sandbox 'home-dryrun'
    New-SettingsWithCavemanEntries -Path (Join-Path $home3 '.claude\settings.json')
    $before = [System.IO.File]::ReadAllText((Join-Path $home3 '.claude\settings.json'))
    $env:CAVEMAN_TEST_NPM_LOG = Join-Path $sandbox 'npm-dryrun.log'
    $out3 = Invoke-InstallCaveman -UserHome $home3 -DryRun
    Assert 'dry run names the caveman step' ($out3 -match 'caveman') $out3
    Assert 'dry run ran no npm' (-not (Test-Path (Join-Path $sandbox 'npm-dryrun.log'))) $out3
    $after = [System.IO.File]::ReadAllText((Join-Path $home3 '.claude\settings.json'))
    Assert 'dry run left settings.json byte-identical' ($before -ceq $after) 'settings.json changed under -DryRun'

    # ---- (4) offline skip: fail closed, one status line (AC5) ---------------------------
    Write-Host ''
    Write-Host 'offline skip variable (issue 825 AC5: fail-closed)'
    Reset-TestEnv
    $home4 = Join-Path $sandbox 'home-offline'
    $settingsPath4 = Join-Path $home4 '.claude\settings.json'
    New-SettingsWithCavemanEntries -Path $settingsPath4
    Assert 'seed: route present before the run' (Test-CavemanRoutePresent -SettingsPath $settingsPath4)
    Assert 'seed: proxy hooks present before the run' (Test-CavemanHooksPresent -SettingsPath $settingsPath4)
    $env:CAVEMAN_INSTALL_OFFLINE_SKIP = '1'
    $out4 = Invoke-InstallCaveman -UserHome $home4
    $statusLines = @(($out4 -split "`r?`n") | Where-Object { $_ -match 'caveman:' })
    Assert 'exactly one status line' ($statusLines.Count -eq 1) $out4
    Assert 'no model route left behind' (-not (Test-CavemanRoutePresent -SettingsPath $settingsPath4)) `
        ([System.IO.File]::ReadAllText($settingsPath4))
    Assert 'no proxy hook entries left behind' (-not (Test-CavemanHooksPresent -SettingsPath $settingsPath4)) `
        ([System.IO.File]::ReadAllText($settingsPath4))
    $stripped = Get-Content -LiteralPath $settingsPath4 -Raw | ConvertFrom-Json
    $survivedCount = @($stripped.hooks.PreToolUse | Where-Object { $_.hooks[0].command -match 'ask_matt_gate' }).Count
    Assert 'the unrelated hook entry survives the strip' ($survivedCount -gt 0) `
        ([System.IO.File]::ReadAllText($settingsPath4))

    # ---- (5) npm missing fails closed too ------------------------------------------------
    Write-Host ''
    Write-Host 'npm not on PATH'
    Reset-TestEnv
    $home5 = Join-Path $sandbox 'home-nonpm'
    $settingsPath5 = Join-Path $home5 '.claude\settings.json'
    New-SettingsWithCavemanEntries -Path $settingsPath5
    $env:PATH = $OldPath  # deliberately exclude $stubBin - no npm
    $out5 = Install-CavemanCli -RepoRoot $stubRepo -UserHome $home5 6>&1 | Out-String
    Assert 'reports FAILED' ($out5 -match 'FAILED') $out5
    Assert 'no route left behind when npm is missing' (-not (Test-CavemanRoutePresent -SettingsPath $settingsPath5)) $out5

    # ---- (6) the primitives agree with each other ---------------------------------------
    Write-Host ''
    Write-Host 'Remove/Test-Caveman* primitives'
    Reset-TestEnv
    $settingsPath6 = Join-Path $sandbox 'settings6.json'
    New-SettingsWithCavemanEntries -Path $settingsPath6
    $changed = Remove-CavemanRouteAndHooks -SettingsPath $settingsPath6
    Assert 'reports a change was made' $changed
    Assert 'route gone after removal' (-not (Test-CavemanRoutePresent -SettingsPath $settingsPath6))
    Assert 'proxy hooks gone after removal' (-not (Test-CavemanHooksPresent -SettingsPath $settingsPath6))
    $unchanged = Remove-CavemanRouteAndHooks -SettingsPath $settingsPath6
    Assert 'a second removal is a no-op (reports no change)' (-not $unchanged)

} finally {
    $env:PATH = $OldPath
    foreach ($k in $OldEnv.Keys) { [Environment]::SetEnvironmentVariable($k, $OldEnv[$k]) }
    if (Test-Path $sandbox) {
        try { Remove-Item -Path $sandbox -Recurse -Force -ErrorAction Stop } catch {}
    }
}

Write-Host ''
Write-Host ("pass {0}  fail {1}" -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
