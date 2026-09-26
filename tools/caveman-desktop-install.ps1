<#
.SYNOPSIS
    Install the pinned @caveman-ai/cli on this machine and wire it into settings.json, or fail
    closed - never leave a hook or a model route pointing at a binary that was never installed.

.DESCRIPTION
    The desktop side of issue 825. The cloud container gets caveman from
    .claude/hooks/caveman-bootstrap.sh at every SessionStart; a desktop instead gets it once, from
    sync.ps1 -Mode pull, which calls this script after the normal file-copy pass (profile/claude
    /settings.json has already landed at $UserHome\.claude\settings.json by then, hooks and env
    route baked in from whichever machine last ran `caveman enable claude`).

    Both installers share ONE version pin - lib\caveman-cli.json - so bumping the CLI means
    editing one file, not two languages.

    What a real run does, mirroring the cloud bootstrap's steps 3 (CLI, binaries, proxy, enable):
      1. skip entirely, fail closed, if $env:CAVEMAN_DESKTOP_SKIP_CLI is set (offline machine, a
         test run, or a caller that wants no network touched);
      2. skip the npm install (not the rest) when the pinned version is already present - a
         second run is a no-op on that count;
      3. `npm install -g --prefix $UserHome\.local ...` the pinned version;
      4. `caveman setup --install` (fetch the signed proxy binary) and `caveman enable claude`
         (the CLI's own writer for the hook + route wiring in ~/.claude/settings.json - it knows
         its own install paths, so this script never hand-authors those commands).

    Fail-closed path (offline skip, or any step above failing): Remove-CavemanWiring strips every
    hook entry naming a caveman binary and the model route (ANTHROPIC_BASE_URL / the first-party
    override, both only when they are the caveman ones) from the live settings.json, so a machine
    that never got the CLI never carries a dead hook or a route with nothing listening on it. That
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

function Get-CavemanPinnedVersion {
    <# The one pin shared with .claude/hooks/caveman-bootstrap.sh (issue 825). #>
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    if ($env:CAVEMAN_DESKTOP_CLI_VERSION) { return $env:CAVEMAN_DESKTOP_CLI_VERSION }
    $pinFile = Join-Path $RepoRoot 'lib\caveman-cli.json'
    if (Test-Path $pinFile) {
        try {
            $pin = Get-Content -Raw -LiteralPath $pinFile | ConvertFrom-Json
            if ($pin.PSObject.Properties['cliVersion'] -and $pin.cliVersion) { return [string]$pin.cliVersion }
        } catch { }
    }
    return '1.3.4'
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
        Strip every hook entry whose command names a caveman binary, and the caveman model route,
        from $Path. Idempotent: a settings.json already clean of caveman wiring round-trips with
        no visible change other than re-serialization. Returns $true when it changed anything.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int]$ProxyPort
    )
    if (-not (Test-Path $Path)) { return $false }
    $json = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
    $changed = $false
    $binaryPattern = 'caveman-proxy|caveman\.cmd|caveman\.CMD|shrink-hook|@caveman-ai'

    if ($json.PSObject.Properties['env']) {
        $routeKey = 'ANTHROPIC_BASE_URL'
        if ($json.env.PSObject.Properties[$routeKey] -and
            ($json.env.$routeKey -match ("127\.0\.0\.1:{0}" -f $ProxyPort))) {
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
                $keptHooks = @($group.hooks | Where-Object { $_.command -notmatch $binaryPattern })
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
        ($json | ConvertTo-Json -Depth 20) | Set-Content -LiteralPath $Path -Encoding UTF8
    }
    return $changed
}

$UserHome = $UserHome.TrimEnd('\', '/')
$LiveSettings = Join-Path $UserHome '.claude\settings.json'
$LocalPrefix  = Join-Path $UserHome '.local'
$CavemanHome  = Join-Path $UserHome '.caveman'
$ProxyExe     = Join-Path $CavemanHome 'bin\caveman-proxy.exe'
$CavemanCmd   = Join-Path $LocalPrefix 'caveman.cmd'
$Version      = Get-CavemanPinnedVersion -RepoRoot $RepoRoot

if ($DryRun) {
    Write-Host ("  caveman: would install {0} to {1} (dry run - no npm, no settings.json edit)" -f $Version, $LocalPrefix)
    exit 0
}

if ($env:CAVEMAN_DESKTOP_SKIP_CLI) {
    Remove-CavemanWiring -Path $LiveSettings -ProxyPort $ProxyPort | Out-Null
    Write-Host ("  caveman: offline skip (CAVEMAN_DESKTOP_SKIP_CLI set) - no route, no proxy hooks" )
    exit 0
}

$installed = Get-InstalledCavemanVersion -LocalPrefix $LocalPrefix
$npmState = 'skipped'
if ($installed -ne $Version) {
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
        Remove-CavemanWiring -Path $LiveSettings -ProxyPort $ProxyPort | Out-Null
        Write-Host ("  caveman: npm install of @caveman-ai/cli@{0} FAILED - failing closed (no route, no proxy hooks)" -f $Version) -ForegroundColor Yellow
        exit 0
    }
    $npmState = "installed $Version"
} else {
    $npmState = "present $Version (no npm run)"
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
        Remove-CavemanWiring -Path $LiveSettings -ProxyPort $ProxyPort | Out-Null
        $enableState = 'failed - failing closed (no route, no proxy hooks)'
    }
} else {
    # Binaries never landed (offline npm registry reached but the signed-binary fetch did not,
    # or a platform with no signed build): the same fail-closed rule applies - a hook naming a
    # binary that is not on disk is worse than no hook.
    Remove-CavemanWiring -Path $LiveSettings -ProxyPort $ProxyPort | Out-Null
    $enableState = 'skipped (no proxy binary) - failing closed (no route, no proxy hooks)'
}

Write-Host ("  caveman: cli {0}; setup {1}; enable {2}" -f $npmState, $setupState, $enableState)
exit 0
