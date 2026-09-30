<#
.SYNOPSIS
    Install the current @caveman-ai/cli npm release on this machine and wire it into settings.json, or fail
    closed - never leave a hook or a model route pointing at a binary that was never installed.

.DESCRIPTION
    The desktop side of issue 825. The cloud container gets caveman from
    .claude/hooks/caveman-bootstrap.sh at every SessionStart; a desktop instead gets it once, from
    sync.ps1 -Mode pull, which calls this script after the normal file-copy pass (profile/claude
    /settings.json has already landed at $UserHome\.claude\settings.json by then, hooks and env
    route baked in from whichever machine last ran `caveman enable claude`).

    Both installers track the current npm release of @caveman-ai/cli, asked with `npm view`
    every run (issue 931); $env:CAVEMAN_DESKTOP_CLI_VERSION pins a one-off version instead.

    What a real run does, mirroring the cloud bootstrap's steps 3 (CLI, binaries, proxy, enable):
      1. skip entirely, fail closed, if $env:CAVEMAN_DESKTOP_SKIP_CLI is set (offline machine, a
         test run, or a caller that wants no network touched);
      2. skip the npm install (not the rest) when the current release is already present - a
         second run is a no-op on that count - or when the registry cannot be reached and a CLI
         is already installed (it is kept, and a running proxy is left alone);
      3. `npm install -g --prefix $UserHome\.local ...` the current release;
      4. `caveman setup --install` (fetch the signed proxy binary) and `caveman enable claude`
         (the CLI's own writer for the hook + route wiring in ~/.claude/settings.json - it knows
         its own install paths, so this script never hand-authors those commands);
      5. when the proxy binary is on disk (issue 1110): start it, hidden, if port 8787 does not
         answer - `caveman enable claude` routes Claude there, and nothing else launches it - and
         register it to start at logon under the HKCU Run key (value CavemanProxy; no elevation),
         so a reboot does not leave the route pointing at a dead port. A proxy that already
         answers is left alone. $env:CAVEMAN_DESKTOP_RUN_KEY names another key (a test's).

    Fail-closed path (offline skip, or any step above failing): Remove-CavemanWiring strips every
    hook entry naming a caveman binary that is not on disk, and the model route (ANTHROPIC_BASE_URL
    / the first-party override, both only when they are the caveman ones) when the proxy binary is
    not, from the live settings.json, so a machine that never got the CLI never carries a dead hook
    or a route with nothing listening on it. Wiring whose binaries are on disk is this machine's
    working proxy and stays: a pull never breaks it (issue 826). That
    keeps the two invariants the restore suite checks true on every machine, not only the ones
    with working network: every hook command naming a caveman binary resolves to a file that
    exists, and the model route is present if and only if the proxy binary is.

    -DryRun reports what would happen and changes nothing: no npm, no settings.json edit.

.NOTES
    Best-effort by design (same rule as Invoke-RepoMemoryPointer in sync.ps1): a caveman problem
    must never fail a pull. Always exits 0.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$UserHome,
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProxyPort = 8787
# Issue 1110: the logon start. setup-check.ps1 reads the same key and value name.
$RunKey   = if ($env:CAVEMAN_DESKTOP_RUN_KEY) { $env:CAVEMAN_DESKTOP_RUN_KEY } else { 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' }
$RunValue = 'CavemanProxy'

function Test-ProxyPort {
    param([Parameter(Mandatory = $true)][int]$Port)
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $pending = $tcp.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(1000)) { return $false }
        $tcp.EndConnect($pending)
        return $true
    } catch { return $false } finally { $tcp.Close() }
}

function Start-CavemanProxy {
    <#
        Start the proxy binary, hidden and detached, when the port does not answer, then wait up
        to 15 s for it to listen. Start-Process goes through ShellExecute, so the proxy inherits
        no handle of a caller that captures this script's output and never holds it open.
        Returns a one-phrase state for the status line.
    #>
    param([Parameter(Mandatory = $true)][string]$ProxyExe, [Parameter(Mandatory = $true)][int]$Port)
    if (Test-ProxyPort $Port) { return "already answering on 127.0.0.1:$Port" }
    try {
        $startArgs = @{ FilePath = $ProxyExe; WorkingDirectory = (Split-Path -Parent $ProxyExe) }
        # WindowStyle exists only on Windows ($IsWindows is unset on 5.1, which is Windows).
        if (-not (Test-Path variable:IsWindows) -or $IsWindows) { $startArgs.WindowStyle = 'Hidden' }
        Start-Process @startArgs | Out-Null
    } catch {
        return ("failed to start ({0})" -f $_.Exception.Message)
    }
    for ($i = 0; $i -lt 30; $i++) {
        if (Test-ProxyPort $Port) { return "started on 127.0.0.1:$Port" }
        Start-Sleep -Milliseconds 500
    }
    return "started, but 127.0.0.1:$Port did not answer within 15 s"
}

function Register-CavemanLogon {
    <#
        The HKCU Run entry that starts the proxy at logon: a hidden PowerShell that starts the
        binary hidden, so no console window opens at every logon. Idempotent. Returns a state.
    #>
    param([Parameter(Mandatory = $true)][string]$ProxyExe, [Parameter(Mandatory = $true)][string]$Key,
          [Parameter(Mandatory = $true)][string]$Name)
    $command = ('powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath ''{0}'' -WindowStyle Hidden"' -f $ProxyExe.Replace("'", "''"))
    try {
        $current = $null
        $item = Get-ItemProperty -LiteralPath $Key -Name $Name -ErrorAction SilentlyContinue
        if ($item) { $current = [string]$item.$Name }
        if ($current -ceq $command) { return "logon start registered ($Name)" }
        if (-not (Test-Path -LiteralPath $Key)) { New-Item -Path $Key -Force | Out-Null }
        New-ItemProperty -LiteralPath $Key -Name $Name -Value $command -PropertyType String -Force | Out-Null
        return "logon start registered now ($Name)"
    } catch {
        return ("logon start NOT registered ({0})" -f $_.Exception.Message)
    }
}

function Get-CavemanLatestVersion {
    <#
        The registry's current @caveman-ai/cli release, or $null when npm or the registry cannot
        be reached (issue 931; .claude/hooks/caveman-bootstrap.sh asks the same question).
        Bounded, so an offline pull does not wait out npm's five-minute default fetch timeout.
    #>
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & npm view '@caveman-ai/cli' version --fetch-retries=0 --fetch-timeout=20000 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return (@($out | ForEach-Object { "$_".Trim() } |
                 Where-Object { $_ -match '^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$' }) | Select-Object -Last 1)
    } catch {
        return $null
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Get-InstalledCavemanVersion {
    param([Parameter(Mandatory = $true)][string]$LocalPrefix)
    $pkg = Join-Path $LocalPrefix 'node_modules\@caveman-ai\cli\package.json'
    if (-not (Test-Path $pkg)) { return $null }
    try {
        $data = Get-Content -Raw -LiteralPath $pkg | ConvertFrom-Json
        return [string]$data.version
    } catch { return $null }
}

function Remove-CavemanWiring {
    <#
        Strip every hook entry whose command names a caveman binary that is not on disk, and the
        caveman model route when the proxy binary is not, from $Path. Idempotent, and it writes
        nothing when nothing is dead. Returns $true when it changed anything.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int]$ProxyPort,
        [Parameter(Mandatory = $true)][string]$ProxyExe
    )
    if (-not (Test-Path $Path)) { return $false }
    # Read and write as UTF-8 explicitly: Windows PowerShell 5.1's Get-Content decodes a BOM-less file
    # as ANSI, so the em dashes in settings.json came back as mojibake (issue 825).
    $json = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    $changed = $false
    $binaryPattern = 'caveman-proxy|caveman\.cmd|caveman\.CMD|shrink-hook|@caveman-ai'
    # Issue 826: a caveman hook is dead - and stripped - when it names no quoted caveman path, or
    # any one it names is missing. One whose paths all exist is this machine's working proxy.
    $isDead = {
        param([string]$Command)
        if ($Command -notmatch $binaryPattern) { return $false }
        $named = @(([regex]"(?i)['""]([^'""]*caveman[^'""]*)['""]").Matches($Command) |
                   ForEach-Object { $_.Groups[1].Value })
        if ($named.Count -eq 0) { return $true }
        return (@($named | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -gt 0)
    }

    if ($json.PSObject.Properties['env']) {
        $routeKey = 'ANTHROPIC_BASE_URL'
        if ($json.env.PSObject.Properties[$routeKey] -and
            ($json.env.$routeKey -match ("127\.0\.0\.1:{0}" -f $ProxyPort)) -and
            -not (Test-Path -LiteralPath $ProxyExe)) {
            $json.env.PSObject.Properties.Remove($routeKey)
            if ($json.env.PSObject.Properties['_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL']) {
                $json.env.PSObject.Properties.Remove('_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL')
            }
            $changed = $true
        }
    }

    if ($json.PSObject.Properties['hooks']) {
        # Enumerated, not .Properties.Name: strict mode throws on .Name of an empty hooks object,
        # which is exactly what a second run after a full strip sees (issue 825).
        foreach ($eventName in @($json.hooks.PSObject.Properties | ForEach-Object { $_.Name })) {
            $originalGroups = @($json.hooks.$eventName)
            $keptGroups = New-Object System.Collections.ArrayList
            foreach ($group in $originalGroups) {
                $keptHooks = @($group.hooks | Where-Object { -not (& $isDead ([string]$_.command)) })
                if ($keptHooks.Count -eq 0) {
                    $changed = $true
                    continue
                }
                if ($keptHooks.Count -ne @($group.hooks).Count) { $changed = $true }
                $group.hooks = $keptHooks
                [void]$keptGroups.Add($group)
            }
            if ($keptGroups.Count -eq 0) {
                $json.hooks.PSObject.Properties.Remove($eventName)
                $changed = $true
            } else {
                $json.hooks.$eventName = $keptGroups.ToArray()
            }
        }
    }

    if ($changed) {
        [System.IO.File]::WriteAllText($Path, ($json | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
    }
    return $changed
}

$UserHome = $UserHome.TrimEnd('\', '/')
$LiveSettings = Join-Path $UserHome '.claude\settings.json'
$LocalPrefix  = Join-Path $UserHome '.local'
$CavemanHome  = Join-Path $UserHome '.caveman'
$ProxyExe     = Join-Path $CavemanHome 'bin\caveman-proxy.exe'
$CavemanCmd   = Join-Path $LocalPrefix 'caveman.cmd'
$Pin          = $env:CAVEMAN_DESKTOP_CLI_VERSION

if ($DryRun) {
    $what = if ($Pin) { "@caveman-ai/cli@$Pin" } else { 'the current npm release of @caveman-ai/cli' }
    Write-Host ("  caveman: would install {0} to {1} (dry run - no npm, no settings.json edit)" -f $what, $LocalPrefix)
    exit 0
}

if ($env:CAVEMAN_DESKTOP_SKIP_CLI) {
    Remove-CavemanWiring -Path $LiveSettings -ProxyPort $ProxyPort -ProxyExe $ProxyExe | Out-Null
    Write-Host ("  caveman: offline skip (CAVEMAN_DESKTOP_SKIP_CLI set) - dead caveman hooks and route stripped")
    exit 0
}

$installed = Get-InstalledCavemanVersion -LocalPrefix $LocalPrefix
$Version = if ($Pin) { $Pin } else { Get-CavemanLatestVersion }
$npmState = 'skipped'
if (-not $Version) {
    if (-not $installed) {
        Remove-CavemanWiring -Path $LiveSettings -ProxyPort $ProxyPort -ProxyExe $ProxyExe | Out-Null
        Write-Host '  caveman: npm registry unreachable and no @caveman-ai/cli installed - failing closed (dead caveman hooks and route stripped)' -ForegroundColor Yellow
        exit 0
    }
    # Registry unreachable: keep the installed CLI; a running proxy is never touched here.
    $npmState = "registry unreachable, kept $installed (no npm install)"
} elseif ($installed -ne $Version) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & npm install -g --prefix $LocalPrefix --no-fund --no-audit ("@caveman-ai/cli@{0}" -f $Version) 2>&1 | Out-Null
        $npmExit = $LASTEXITCODE
    } catch {
        $npmExit = 1
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($npmExit -ne 0) {
        Remove-CavemanWiring -Path $LiveSettings -ProxyPort $ProxyPort -ProxyExe $ProxyExe | Out-Null
        Write-Host ("  caveman: npm install of @caveman-ai/cli@{0} FAILED - failing closed (dead caveman hooks and route stripped)" -f $Version) -ForegroundColor Yellow
        exit 0
    }
    $npmState = if ($installed) { "installed $Version (was $installed)" } else { "installed $Version" }
} else {
    $npmState = "present $Version (no npm install)"
}

$setupState = 'skipped'
if (Test-Path $CavemanCmd) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $CavemanCmd setup --install 2>&1 | Out-Null
    } catch { }
    finally { $ErrorActionPreference = $previous }
    $setupState = if (Test-Path $ProxyExe) { 'binaries present' } else { 'binaries missing' }
}

$enableState = 'skipped'
if (Test-Path $ProxyExe) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $enableOut = & $CavemanCmd enable claude 2>&1
    } catch { $enableOut = $_.Exception.Message }
    finally { $ErrorActionPreference = $previous }
    if ("$enableOut" -match 'native Caveman enabled|already') {
        $enableState = 'enabled'
    } else {
        Remove-CavemanWiring -Path $LiveSettings -ProxyPort $ProxyPort -ProxyExe $ProxyExe | Out-Null
        $enableState = 'failed - failing closed (dead caveman hooks and route stripped)'
    }
} else {
    # Binaries never landed (offline npm registry reached but the signed-binary fetch did not,
    # or a platform with no signed build): the same fail-closed rule applies - a hook naming a
    # binary that is not on disk is worse than no hook.
    Remove-CavemanWiring -Path $LiveSettings -ProxyPort $ProxyPort -ProxyExe $ProxyExe | Out-Null
    $enableState = 'skipped (no proxy binary) - failing closed (dead caveman hooks and route stripped)'
}

# Issue 1110: the route above points at 127.0.0.1:8787 whenever the binary is on disk, so the proxy
# must be listening now and again after every logon.
$proxyState = 'skipped (no proxy binary)'
$logonState = 'skipped (no proxy binary)'
if (Test-Path $ProxyExe) {
    $proxyState = Start-CavemanProxy -ProxyExe $ProxyExe -Port $ProxyPort
    $logonState = Register-CavemanLogon -ProxyExe $ProxyExe -Key $RunKey -Name $RunValue
}

Write-Host ("  caveman: cli {0}; setup {1}; enable {2}; proxy {3}; {4}" -f $npmState, $setupState, $enableState, $proxyState, $logonState)
exit 0
