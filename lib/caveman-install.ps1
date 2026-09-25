# Caveman CLI install step (issue 825), dot-sourced by sync.ps1 alongside lib\manifest.ps1.
#
# The committed consumer profile (profile\claude\settings.json) no longer carries any
# caveman-proxy hook entry or the caveman model route (ANTHROPIC_BASE_URL + its
# _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL pair) - `caveman enable claude` is the only writer of
# those, on the machine that runs the proxy (issue 824). This file is the step that gets them
# there: install the pinned `@caveman-ai/cli` under a user prefix, fetch its signed binaries with
# `caveman setup --install`, then run `caveman enable claude`.
#
# Fails closed: if any step does not succeed, or CAVEMAN_INSTALL_OFFLINE_SKIP is set, this removes
# any caveman route/hook entries a live settings.json already has and prints exactly one status
# line - a half-installed proxy never keeps the route (the observed failure this fixes: ten
# `caveman-proxy.exe` hook entries naming a binary that was never fetched).
#
# The CLI version pin is read from caveman-cli-version.txt at the repo root - the one file
# .claude\hooks\caveman-bootstrap.sh (the cloud bootstrap) also reads, so the two surfaces cannot
# drift.

Set-StrictMode -Version Latest

# A caveman-owned hook command names the proxy's native-hook entry point or the shrink-hook
# PreToolUse rewrite - never anything the aac-skills plugin or the desktop's own settings carry.
$script:CavemanHookPattern = 'caveman-proxy|shrink-hook'
$script:CavemanEnvKeys = @('ANTHROPIC_BASE_URL', '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL')

function Get-CavemanCliPin {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    $pinFile = Join-Path $RepoRoot 'caveman-cli-version.txt'
    if (-not (Test-Path $pinFile)) { return $null }
    $pin = (Get-Content -LiteralPath $pinFile -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($pin)) { return $null }
    return $pin
}

# Reads settings.json into a mutable object. $null on anything that does not parse, so a caller
# never mistakes "cannot read it" for "nothing caveman-owned is there".
function Read-SettingsJson {
    param([Parameter(Mandatory = $true)][string]$SettingsPath)
    if (-not (Test-Path $SettingsPath)) { return $null }
    try { return (Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json) } catch { return $null }
}

# Strips the caveman model route and any hook entry naming a caveman binary out of a live
# settings.json. Returns $true when it changed something. Best-effort and non-throwing: a missing
# or unparsable settings.json is not this function's problem to fix.
function Remove-CavemanRouteAndHooks {
    param(
        [Parameter(Mandatory = $true)][string]$SettingsPath,
        [switch]$DryRun
    )
    $json = Read-SettingsJson -SettingsPath $SettingsPath
    if ($null -eq $json) { return $false }

    $changed = $false
    if ($json.PSObject.Properties['env']) {
        foreach ($key in $script:CavemanEnvKeys) {
            if ($json.env.PSObject.Properties[$key]) {
                $json.env.PSObject.Properties.Remove($key)
                $changed = $true
            }
        }
    }

    if ($json.PSObject.Properties['hooks']) {
        foreach ($eventName in @($json.hooks.PSObject.Properties.Name)) {
            $groups = @($json.hooks.$eventName)
            $kept = @($groups | Where-Object {
                $cmds = @($_.hooks | ForEach-Object { $_.command })
                -not ($cmds -match $script:CavemanHookPattern)
            })
            if ($kept.Count -ne $groups.Count) {
                $changed = $true
                if ($kept.Count -eq 0) { $json.hooks.PSObject.Properties.Remove($eventName) }
                else { $json.hooks.$eventName = $kept }
            }
        }
        if (@($json.hooks.PSObject.Properties).Count -eq 0) {
            $json.PSObject.Properties.Remove('hooks')
            $changed = $true
        }
    }

    if ($changed -and -not $DryRun) {
        ($json | ConvertTo-Json -Depth 40) | Set-Content -LiteralPath $SettingsPath -Encoding UTF8
    }
    return $changed
}

function Test-CavemanRoutePresent {
    param([Parameter(Mandatory = $true)][string]$SettingsPath)
    $json = Read-SettingsJson -SettingsPath $SettingsPath
    if ($null -eq $json -or -not $json.PSObject.Properties['env']) { return $false }
    return [bool]$json.env.PSObject.Properties['ANTHROPIC_BASE_URL']
}

function Test-CavemanHooksPresent {
    param([Parameter(Mandatory = $true)][string]$SettingsPath)
    $json = Read-SettingsJson -SettingsPath $SettingsPath
    if ($null -eq $json -or -not $json.PSObject.Properties['hooks']) { return $false }
    foreach ($eventName in $json.hooks.PSObject.Properties.Name) {
        foreach ($group in @($json.hooks.$eventName)) {
            foreach ($h in @($group.hooks)) {
                if ($h.command -match $script:CavemanHookPattern) { return $true }
            }
        }
    }
    return $false
}

# Installs the pinned CLI, fetches its binaries, and enables it for this machine. -DryRun reports
# the step and returns before anything runs - no npm, no settings change. Every failure path
# (missing pin, offline skip, missing npm, a failed install/setup/enable step) prints one line
# and calls Remove-CavemanRouteAndHooks so a half-installed proxy never keeps its route.
function Install-CavemanCli {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$UserHome,
        [switch]$DryRun
    )

    $settingsPath = Join-Path $UserHome '.claude\settings.json'
    $localPrefix  = Join-Path $UserHome '.local'
    $binDir       = Join-Path $localPrefix 'bin'
    $cavemanHome  = Join-Path $UserHome '.caveman'
    $proxyExe     = Join-Path $cavemanHome 'bin\caveman-proxy.exe'

    function Resolve-CavemanExe {
        foreach ($name in 'caveman.cmd', 'caveman.ps1', 'caveman') {
            $candidate = Join-Path $binDir $name
            if (Test-Path $candidate) { return $candidate }
        }
        return $null
    }

    $pin = Get-CavemanCliPin -RepoRoot $RepoRoot
    if (-not $pin) {
        Write-Host '  caveman: FAILED - no caveman-cli-version.txt pin at the repo root; add one and re-run install.ps1 to retry' -ForegroundColor Yellow
        Remove-CavemanRouteAndHooks -SettingsPath $settingsPath | Out-Null
        return
    }

    if ($DryRun) {
        Write-Host ("  caveman: would install @caveman-ai/cli@{0}, run setup --install and enable claude (dry run - no npm, no settings change)" -f $pin)
        return
    }

    if ($env:CAVEMAN_INSTALL_OFFLINE_SKIP) {
        Write-Host ("  caveman: SKIPPED (offline) - no model route, no proxy hooks; re-run install.ps1 once online to install @caveman-ai/cli@{0}" -f $pin) -ForegroundColor Yellow
        Remove-CavemanRouteAndHooks -SettingsPath $settingsPath | Out-Null
        return
    }

    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        Write-Host '  caveman: FAILED - npm not found on PATH; install Node then re-run install.ps1 to retry' -ForegroundColor Yellow
        Remove-CavemanRouteAndHooks -SettingsPath $settingsPath | Out-Null
        return
    }

    $installed = $null
    $exe = Resolve-CavemanExe
    if ($exe) {
        $raw = & $exe --version 2>$null
        if ($raw -match '"version":\s*"([^"]+)"') { $installed = $Matches[1] }
    }

    # Idempotent: skip npm entirely when the installed CLI already reports the pinned version.
    if ($installed -ne $pin) {
        & $npm.Source install -g --prefix $localPrefix --no-fund --no-audit ("@caveman-ai/cli@{0}" -f $pin) 2>&1 | Out-Null
        $npmExit = $LASTEXITCODE
        $exe = Resolve-CavemanExe
        if ($npmExit -ne 0 -or -not $exe) {
            Write-Host ("  caveman: FAILED - npm install of @caveman-ai/cli@{0} did not complete; re-run install.ps1 to retry" -f $pin) -ForegroundColor Yellow
            Remove-CavemanRouteAndHooks -SettingsPath $settingsPath | Out-Null
            return
        }
    }

    $env:CAVEMAN_HOME = $cavemanHome
    & $exe setup --install 2>&1 | Out-Null
    $setupExit = $LASTEXITCODE
    if ($setupExit -ne 0 -or -not (Test-Path $proxyExe)) {
        Write-Host '  caveman: FAILED - caveman setup --install did not fetch the signed binaries; re-run install.ps1 to retry' -ForegroundColor Yellow
        Remove-CavemanRouteAndHooks -SettingsPath $settingsPath | Out-Null
        return
    }

    $enableOut = & $exe enable claude 2>&1 | Out-String
    $enableExit = $LASTEXITCODE
    if ($enableExit -ne 0 -or -not ($enableOut -match 'native Caveman enabled|already')) {
        Write-Host '  caveman: FAILED - caveman enable claude did not confirm; re-run install.ps1 to retry' -ForegroundColor Yellow
        Remove-CavemanRouteAndHooks -SettingsPath $settingsPath | Out-Null
        return
    }

    Write-Host ("  caveman: OK - @caveman-ai/cli@{0}, binaries present, hooks and model route enabled" -f $pin)
}
