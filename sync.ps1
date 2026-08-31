<#
.SYNOPSIS
    Move the Claude Code configuration between this machine and the repo.

.DESCRIPTION
    push  local  -> repo   (absolute home paths become tokens)
    pull  repo   -> local  (tokens become this machine's home; backs up first)

    Only the whitelist in lib/manifest.ps1 is ever read, so credentials, session
    transcripts and plugin caches cannot be picked up by accident.

.EXAMPLE
    .\sync.ps1 -Mode push
    .\sync.ps1 -Mode pull -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('push', 'pull')][string]$Mode,
    [switch]$DryRun,
    [string]$Commit,
    [string]$UserHome = $env:USERPROFILE
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $RepoRoot 'lib\manifest.ps1')
. (Join-Path $RepoRoot 'lib\personal.ps1')

$UserHome = $UserHome.TrimEnd('\', '/')
Write-Host ("{0}  (home: {1}){2}" -f $Mode.ToUpper(), $UserHome, $(if ($DryRun) { '  [dry run]' } else { '' }))
Write-Host ''

$items       = Get-DotfileItems -RepoRoot $RepoRoot -UserHome $UserHome
$mirrorRoots = @('claude\skills', 'claude\hooks', 'agents\skills', 'codex\hooks', 'memory')

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
    foreach ($memory in (Get-MemoryItems -UserHome $UserHome)) {
        $destination = Join-Path $backup ("memory\" + $memory.Slug)
        Copy-Item -Path $memory.Local -Destination $destination -Recurse -Force
    }
    return $backup
}

# ------------------------------------------------------------------------ push

if ($Mode -eq 'push') {
    # Clear the mirrored trees first so a skill deleted locally also leaves the repo.
    foreach ($relative in $mirrorRoots) {
        $path = Join-Path $RepoRoot $relative
        if (Test-Path $path) {
            if ($DryRun) { Write-Host ("  would clear {0}" -f $path) }
            else { Remove-Item -Path $path -Recurse -Force }
        }
    }

    $total = 0
    foreach ($item in $items) {
        $destination = Join-Path $RepoRoot ($item.Repo -replace '/', '\')
        if ($item.Type -eq 'File') {
            if (Test-Path $item.Local) {
                Copy-OneFile -Source $item.Local -Destination $destination `
                             -Direction Tokenize -UserHome $UserHome -DryRun:$DryRun
                $total++
                Write-Host ("  {0}" -f $item.Repo)
            } else {
                Write-Host ("  skip (missing): {0}" -f $item.Local)
            }
        } else {
            $n = Copy-Tree -Source $item.Local -Destination $destination `
                           -Direction Tokenize -UserHome $UserHome -DryRun:$DryRun
            $total += $n
            Write-Host ("  {0}  ({1} files)" -f $item.Repo, $n)
        }
    }

    foreach ($memory in (Get-MemoryItems -UserHome $UserHome)) {
        $slug        = ConvertTo-TokenSlug -Slug $memory.Slug -UserHome $UserHome
        $destination = Join-Path $RepoRoot ("memory\" + $slug)
        $n = Copy-Tree -Source $memory.Local -Destination $destination `
                       -Direction Tokenize -UserHome $UserHome -DryRun:$DryRun
        $total += $n
        Write-Host ("  memory/{0}  ({1} files)" -f $slug, $n)
    }

    $links = Save-SkillLinks -RepoRoot $RepoRoot -UserHome $UserHome -DryRun:$DryRun
    Write-Host ("  claude/skill-links.json  ({0} junctions recorded)" -f $links)

    # Refresh the marketplace payload (marketplace/dan-skills + .claude-plugin/marketplace.json)
    # from the same live tree the mirror was just read from, so one push updates every surface
    # that installs from this repo. Best-effort: a missing python must not block a dotfiles sync.
    if (-not $DryRun) {
        $packager = Join-Path $RepoRoot 'tools\build-cloud-plugin.py'
        $py = Get-Command py -ErrorAction SilentlyContinue
        if ($py -and (Test-Path $packager)) {
            $pkgOut = & $py.Source -3 $packager 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host '  marketplace/aac-skills refreshed from live skills'
            } else {
                Write-Host '  marketplace refresh FAILED (sync continues):' -ForegroundColor Yellow
                $pkgOut | Select-Object -Last 3 | ForEach-Object { Write-Host ("    " + $_) -ForegroundColor Yellow }
            }
        }
    }

    Write-Host ''
    Write-Host ("{0} files staged in the repo." -f $total)

    if (-not $DryRun) {
        if (-not (Assert-NoSecrets -Root $RepoRoot)) { exit 1 }
        Write-Host 'Secret guard passed.'
        Write-Host ''

        # Committing here rather than in a follow-up command is the point: a caller
        # chaining `sync.ps1 ; git commit` runs the commit even when the guard exits 1,
        # because a non-zero exit does not stop the next statement in a PowerShell chain.
        if ($PSBoundParameters.ContainsKey('Commit')) {
            # git reports line-ending normalisation on stderr, and under
            # $ErrorActionPreference = 'Stop' PowerShell turns any native stderr into a
            # terminating NativeCommandError. That killed this block between the add and the
            # commit - leaving everything staged and nothing committed - on a checkout whose
            # only sin was mixed line endings. Exit codes are the signal here, not stderr.
            #
            # GIT_* env vars are cleared for the duration of this block (issue 28). When
            # sync.ps1 is invoked from a pre-commit hook (or from the state2 auto-push path
            # in dotfiles-freshness-hook.js, which is called from a hook itself), the parent
            # git process leaks GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE into the child;
            # `git -C $RepoRoot add/commit` would then silently operate on the PARENT repo
            # instead of the target. `-C` does not override GIT_DIR - only unsetting does.
            $previous = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $savedGitEnv = Clear-GitEnv
            try {
                git -C $RepoRoot add -A 2>&1 |
                    Where-Object { $_ -notmatch 'will be replaced by CRLF' } |
                    ForEach-Object { Write-Host ("  git: {0}" -f $_) }
                if ($LASTEXITCODE -ne 0) {
                    Write-Host 'git add failed; nothing was committed.' -ForegroundColor Yellow
                    exit $LASTEXITCODE
                }

                git -C $RepoRoot commit -m $Commit 2>&1 |
                    Where-Object { $_ -notmatch 'will be replaced by CRLF' } |
                    ForEach-Object { Write-Host ("  git: {0}" -f $_) }
                if ($LASTEXITCODE -ne 0) {
                    Write-Host 'Commit failed (or there was nothing to commit).' -ForegroundColor Yellow
                    exit $LASTEXITCODE
                }
                Write-Host ''
                Write-Host ('Committed: ' + (git -C $RepoRoot log --oneline -1))
            } finally {
                Restore-GitEnv -Saved $savedGitEnv
                $ErrorActionPreference = $previous
            }
        } else {
            Write-Host 'Review and commit:'
            Write-Host ('  git -C "{0}" status --short' -f $RepoRoot)
            Write-Host '  (or re-run with -Commit "<message>" so the guard gates the commit)'
        }

        # Stamp AFTER the commit so syncedCommit records what the mirror actually holds. The
        # freshness check (tools/dotfiles-freshness.ps1) reads this to decide whether live has
        # drifted since the last sync; without a stamp the whole check stays silent.
        $stampPath = Write-DotfilesStamp -RepoRoot $RepoRoot -UserHome $UserHome -Kind 'push'
        Write-Host ("Stamped {0}" -f $stampPath)
    }
    exit 0
}

# ------------------------------------------------------------------------ pull

if ($Mode -eq 'pull') {
    $backup = Backup-LocalTargets
    Write-Host ''

    $total = 0
    foreach ($item in $items) {
        $source = Join-Path $RepoRoot ($item.Repo -replace '/', '\')
        if (-not (Test-Path $source)) {
            Write-Host ("  skip (not in repo): {0}" -f $item.Repo)
            continue
        }
        if ($item.Type -eq 'File') {
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

    $memoryRoot = Join-Path $RepoRoot 'memory'
    if (Test-Path $memoryRoot) {
        Get-ChildItem -Path $memoryRoot -Directory | ForEach-Object {
            $slug        = ConvertFrom-TokenSlug -Slug $_.Name -UserHome $UserHome
            $destination = Join-Path $UserHome (".claude\projects\" + $slug + "\memory")
            $n = Copy-Tree -Source $_.FullName -Destination $destination `
                           -Direction Detokenize -UserHome $UserHome -DryRun:$DryRun
            $total += $n
            Write-Host ("  {0}  ({1} files)" -f $destination, $n)
        }
    }

    # After the trees, never before: a junction to a directory that has not been restored yet
    # would be skipped as a missing target.
    $links = Restore-SkillLinks -RepoRoot $RepoRoot -UserHome $UserHome -DryRun:$DryRun
    Write-Host ("  {0} skill junctions recreated" -f $links)

    # Last, because it reads the ~/.claude the lines above just wrote. One-way overlay onto
    # ~/.claude-personal (issue #9): skipped entirely when the profile does not exist, and
    # personal-only content never flows back - push above reads only ~/.claude.
    Write-Host ''
    Write-Host 'Personal profile (~/.claude-personal)'
    Update-PersonalProfile -UserHome $UserHome -DryRun:$DryRun

    # Stamp AFTER the writes so liveFingerprint matches what pull just landed. Same file the
    # push branch writes; a fresh install runs `install.ps1 -> sync.ps1 -Mode pull` and gets
    # its initial stamp for free.
    if (-not $DryRun) {
        $stampPath = Write-DotfilesStamp -RepoRoot $RepoRoot -UserHome $UserHome -Kind 'pull'
        Write-Host ("Stamped {0}" -f $stampPath)
    }

    Write-Host ''
    Write-Host ("{0} files written. Backup of what was there: {1}" -f $total, $backup)
    exit 0
}
