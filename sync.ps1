<#
.SYNOPSIS
    Restore this machine's Claude Code configuration from the repo.

.DESCRIPTION
    pull  repo -> local  (tokens become this machine's home; backs up first)

    One direction only (issue 214). The repo is the source: skills are edited on a branch
    under aac-skills/, CI stamps them and rebuilds the plugin payload, and a merge to master
    is the release. `-Mode push`, the generated claude/ codex/ memory/ mirrors and the skill
    junctions retired with the PC's authorship; push still parses, so a stale caller gets a
    named reason rather than a parameter error, and exits non-zero.

    Only the whitelist in lib/manifest.ps1 is ever written, so nothing outside the consumer
    profile is touched.

.EXAMPLE
    .\sync.ps1 -Mode pull
    .\sync.ps1 -Mode pull -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('push', 'pull')][string]$Mode,
    [switch]$DryRun,
    [string]$UserHome = $env:USERPROFILE
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# Issue 454's rule, applied here too: spawn WHICHEVER PowerShell is running this file -
# powershell.exe under 5.1 on the desktop, pwsh under 7 in a container - rather than the literal
# 'powershell', which exists only on Windows. The fallback IS that literal, so the desktop path is
# unchanged. Without it the invariants step below dies on a missing binary everywhere else, and
# issue 214 made this script's pull half the one route a restore has.
$Engine = 'powershell'
try { $Engine = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch { }

# ------------------------------------------------------------------------ push (retired)

# Before anything is loaded or read: a caller that still says push must be told, not served.
if ($Mode -eq 'push') {
    $msg = @(
        "sync.ps1 -Mode push is RETIRED (issue 214).",
        "",
        "  This repo no longer mirrors ~/.claude and ~/.codex. It is the source:",
        "    - a skill, hook script or rules change is edited on a branch, under aac-skills/",
        "      for skills and profile/ for the rest;",
        "    - CI stamps it (tools/skill-stamps.py) and rebuilds the plugin payload",
        "      (tools/build-cloud-plugin.py);",
        "    - merging to master is the release - that is what a container and this machine",
        "      both install from.",
        "",
        "  To publish a live edit you have already made on this machine, copy the changed file",
        "  into the repo by hand on a branch, then open a PR. To take master's copy, run:",
        "",
        "    .\sync.ps1 -Mode pull"
    ) -join "`n"
    [Console]::Error.WriteLine($msg)
    exit 2
}

. (Join-Path $RepoRoot 'lib\manifest.ps1')
. (Join-Path $RepoRoot 'lib\personal.ps1')

$UserHome = $UserHome.TrimEnd('\', '/')
Write-Host ("{0}  (home: {1}){2}" -f $Mode.ToUpper(), $UserHome, $(if ($DryRun) { '  [dry run]' } else { '' }))
Write-Host ''

$items = Get-DotfileItems -RepoRoot $RepoRoot -UserHome $UserHome

function Backup-LocalTargets {
    $stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path $UserHome (".claude-dotfiles-backup-" + $stamp)
    Write-Host ("Backing up current config to {0}" -f $backup)
    if ($DryRun) { return $backup }

    foreach ($item in $items) {
        if (-not (Test-Path $item.Local)) { continue }
        $destination = Join-Path $backup ($item.Repo -replace '/', '\')
        $parent = Split-Path $destination -Parent
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        # A junction inside the tree can make Copy-Item throw. Losing the backup of one item is
        # bad; aborting the restore because the backup of one item failed is worse.
        try {
            Copy-Item -Path $item.Local -Destination $destination -Recurse -Force -ErrorAction Stop
        } catch {
            Write-Host ("  backup incomplete for {0}: {1}" -f $item.Repo, $_.Exception.Message) -ForegroundColor Yellow
        }
    }
    return $backup
}

# Issue 210: this repo's memory notes are committed under docs/agents/memory/ and loaded by the
# plugin's SessionStart hook, so the live per-project memory directory keeps a pointer file only -
# two copies of one note cannot diverge if only one of them exists. Nothing is deleted before it
# is archived (the script copies every file it removes into a backup directory first).
# Best-effort: a missing node must never block a restore.
function Invoke-RepoMemoryPointer {
    param([string]$BackupRoot)

    $pointerJs = Join-Path $RepoRoot 'tools\repo-memory-pointer.js'
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node -or -not (Test-Path $pointerJs)) { return }

    $argv = @($pointerJs, '--home', $UserHome)
    if ($BackupRoot) { $argv += @('--backup', (Join-Path $BackupRoot 'memory-archived')) }
    if ($DryRun) { $argv += '--dry-run' }
    $out = & $node.Source @argv 2>&1
    if ($LASTEXITCODE -eq 0) {
        $out | ForEach-Object { Write-Host ("  " + $_) }
    } else {
        Write-Host '  repo-memory pointer FAILED (restore continues):' -ForegroundColor Yellow
        $out | Select-Object -Last 3 | ForEach-Object { Write-Host ("    " + $_) -ForegroundColor Yellow }
    }
}

function Invoke-SettingsInvariants {
    <#
        Run tools\settings-invariants.ps1 and HONOUR ITS EXIT CODE. The tool exits non-zero
        when it cannot apply an invariant; the call site used to pipe its output and walk on
        regardless, so a sync whose settings.json half had failed still reported success
        (issue 362).

        stderr is folded into the output stream so the tool's failure text reaches this
        console, and $ErrorActionPreference is 'Continue' for the duration: under 'Stop' a
        single stderr line from a native command becomes a terminating NativeCommandError,
        which would surface the failure as a PowerShell crash rather than as an exit code.
    #>
    param(
        [Parameter(Mandatory = $true)][string[]]$ScriptArgs,
        [Parameter(Mandatory = $true)][string]$Label
    )
    # Defaults to failure: a path that never reaches the assignment (the child could not be
    # launched at all) must not read as a clean run.
    $code = 1
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Engine @ScriptArgs 2>&1 | ForEach-Object { Write-Host ("    {0}" -f $_) }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    if ($code -ne 0) {
        [Console]::Error.WriteLine(
            ("sync.ps1 -Mode {0}: tools\settings-invariants.ps1 ({1}) exited {2}." -f $Mode, $Label, $code) +
            "`n  The invariant it could not apply is named above. Fix that settings.json and" +
            "`n  re-run the sync - it is idempotent.")
        exit $code
    }
}

# Issue 717: installed_plugins.json and known_marketplaces.json are rewritten live by
# `claude plugin update`, so copying the committed snapshot over them rolled every update back.
# When a live copy exists, the committed one is detokenized to a temp file and merged into it by
# tools/plugin-records-merge.js, which keeps any live entry with a later lastUpdated. Without node
# the live file is left alone: skipping a merge loses nothing, overwriting would downgrade.
function Merge-PluginRecords {
    param(
        [Parameter(Mandatory = $true)]$Item,
        [Parameter(Mandatory = $true)][string]$Source
    )
    if ($DryRun) { Write-Host ("  would merge {0}" -f $Item.Local); return }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host ("  node not found - live {0} left as it is (issue 717)" -f $Item.Local) -ForegroundColor Yellow
        return
    }
    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("plugin-records-{0}.json" -f [guid]::NewGuid())
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        Copy-OneFile -Source $Source -Destination $temp -Direction Detokenize -UserHome $UserHome
        $out = & $node.Source (Join-Path $RepoRoot 'tools\plugin-records-merge.js') $Item.Merge $temp $Item.Local 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host ("  merge FAILED, live {0} left as it is:" -f $Item.Local) -ForegroundColor Yellow
            $out | ForEach-Object { Write-Host ("    " + $_) -ForegroundColor Yellow }
        }
    } finally {
        $ErrorActionPreference = $previous
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    }
}

# Issue 735: the commit this pull installed from, so session-check (pull-nudge.js) can compare a
# later merge against ONLY the whitelist above and nudge a pull just when it moved, rather than by
# habit. Read by node ($UserHome\.claude\hook-state\dotfiles-pull\state.json — the same
# .claude/hook-state/<feature>/state.json shape the other machine-wide checks use), written here
# in PowerShell so the record exists even on a machine with no node on PATH.
function Write-PullStamp {
    param([Parameter(Mandatory = $true)][string]$UserHome)
    $sha = (git -C $RepoRoot rev-parse HEAD 2>$null)
    if (-not $sha) { return }
    $sha = $sha.Trim()
    $stateDir = Join-Path $UserHome '.claude\hook-state\dotfiles-pull'
    if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
    $stamp = [ordered]@{ sha = $sha; pulledAt = (Get-Date).ToUniversalTime().ToString('o') }
    ($stamp | ConvertTo-Json) | Set-Content -LiteralPath (Join-Path $stateDir 'state.json') -Encoding UTF8
}

# ------------------------------------------------------------------------ pull

$backup = Backup-LocalTargets
Write-Host ''

$total = 0
foreach ($item in $items) {
    $source = Join-Path $RepoRoot ($item.Repo -replace '/', '\')
    if (-not (Test-Path $source)) {
        Write-Host ("  skip (not in repo): {0}" -f $item.Repo)
        continue
    }
    if ($item.Type -eq 'File' -and $item.PSObject.Properties['Merge'] -and (Test-Path $item.Local)) {
        Merge-PluginRecords -Item $item -Source $source
        $total++
        Write-Host ("  {0}  (merged)" -f $item.Local)
    } elseif ($item.Type -eq 'File') {
        Copy-OneFile -Source $source -Destination $item.Local `
                     -Direction Detokenize -UserHome $UserHome -DryRun:$DryRun
        $total++
        Write-Host ("  {0}" -f $item.Local)
    } else {
        $n = Copy-Tree -Source $source -Destination $item.Local `
                       -Direction Detokenize -UserHome $UserHome -DryRun:$DryRun
        $total += $n
        Write-Host ("  {0}  ({1} files)" -f $item.Local, $n)
    }
}

Invoke-RepoMemoryPointer -BackupRoot $backup

# Re-apply the settings.json invariants this repo owns (issue 199). Pull from a profile that
# already carries them is enough on its own; running the enforcer against live here
# belt-and-braces catches an older checkout or a partial pull.
#
# Also runs -Trust: writes hasTrustDialogAccepted=true into ~/.claude.json for the four
# clone paths (bill-intake, contract-builder, sales-cockpit, zoho-source-of-truth).
# ~/.claude.json is deliberately outside the manifest (it holds oauthAccount and other
# machine-only state), so trust records land per-machine here rather than travelling through
# the repo. Combined with the bypassPermissions default in the restored settings, a fresh
# claude launch in one of those four clones reaches first prompt with no permission dialog and
# no folder-trust dialog (issue 199 AC1). The tool prints MISSING and returns cleanly if
# ~/.claude.json has not been created yet (claude has never launched on this machine), which is
# the correct behaviour for a first-ever install - launching claude once creates the file, and
# the next pull wires it.
$invariants = Join-Path $RepoRoot 'tools\settings-invariants.ps1'
$liveSettings = Join-Path $UserHome '.claude\settings.json'
if ((Test-Path $invariants) -and (Test-Path $liveSettings)) {
    Write-Host ''
    Write-Host '  settings.json invariants (live)'
    $args_ = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $invariants,
               '-Path', $liveSettings, '-Trust', '-UserHome', $UserHome)
    if ($DryRun) { $args_ += '-DryRun' }
    # Fails fast: a pull must not report success when the invariants the repo owns could
    # not be applied to the live tree.
    Invoke-SettingsInvariants -ScriptArgs $args_ -Label 'live'
}

# Issue 825: install the pinned @caveman-ai/cli and run `caveman enable claude`, or fail closed -
# profile/claude/settings.json (just restored above) still carries whichever machine last ran
# `enable` baked in, and a fresh machine must never carry that machine's hooks or model route
# pointing at a binary this one never installed. Best-effort like Invoke-RepoMemoryPointer: a
# caveman problem must never fail a pull.
$cavemanInstaller = Join-Path $RepoRoot 'tools\caveman-desktop-install.ps1'
if (Test-Path $cavemanInstaller) {
    Write-Host ''
    Write-Host '  caveman CLI (desktop)'
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # -DryRun only when set: Windows PowerShell 5.1's -File cannot bind -DryRun:False to a
        # switch, so passing it always made the installer refuse to start (issue 825).
        $cavemanArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cavemanInstaller,
                         '-UserHome', $UserHome, '-RepoRoot', $RepoRoot)
        if ($DryRun) { $cavemanArgs += '-DryRun' }
        & $Engine @cavemanArgs 2>&1 | ForEach-Object { Write-Host $_ }
    } catch {
        Write-Host ("  caveman install FAILED (pull continues): {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    } finally {
        $ErrorActionPreference = $previous
    }
}

# Last, because it reads the ~/.claude the lines above just wrote. One-way overlay onto
# ~/.claude-personal (issue #9): skipped entirely when the profile does not exist, and
# personal-only content never flows back.
Write-Host ''
Write-Host 'Personal profile (~/.claude-personal)'
Update-PersonalProfile -UserHome $UserHome -DryRun:$DryRun

Write-Host ''
if ($DryRun) {
    Write-Host ("{0} files would be written. Dry run: nothing written, no backup made." -f $total)
} else {
    Write-Host ("{0} files written. Backup of what was there: {1}" -f $total, $backup)
    # Issue 735: record the commit this pull installed from, so a later session check can nudge a
    # pull only when a merge since then touched a path still on the whitelist above, instead of by
    # habit. Best-effort and last: a failure here must not turn a real pull into a reported failure.
    try { Write-PullStamp -UserHome $UserHome } catch {
        Write-Host ("  could not record the pull stamp: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
}
exit 0
