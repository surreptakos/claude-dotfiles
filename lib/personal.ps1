# Refresh of the personal profile (~/.claude-personal) from the work profile (~/.claude).
# Dot-source after lib/manifest.ps1; sync.ps1 calls Update-PersonalProfile at the end of a pull.
#
# Issue #9 decisions (2026-08-19):
#   (a) ADOPTED  - pull refreshes ~/.claude-personal from the same source as ~/.claude, so the
#       personal profile stops drifting back into a stale snapshot.
#   (b) DECLINED - reverse memory sync. Personal-only memories never flow into the work profile
#       or this repo (push reads only ~/.claude). Declined by default 2026-08-19; flipping this
#       requires an explicit owner instruction.
#
# The refresh is a one-way overlay, and the work profile is the source of truth:
#   - hooks, CLAUDE.md, agents: copied verbatim (byte-equal; both profiles' hooks are
#     profile-aware via CLAUDE_CONFIG_DIR since commit 5bec0bd, so identical copies are correct)
#   - skills: junctions recreated against the same machine-wide targets; real skill dirs
#     overlaid file-by-file; personal-only skills left alone
#   - settings.json: HOOKS KEY ONLY, with the mechanical path rewrite \.claude\ ->
#     \.claude-personal\ (.codex paths untouched). Every other key - model, plugins,
#     statusLine, prefs - is the personal profile's own and is preserved.
#   - project memories: union merge. Work files copy in (newer mtime wins), MEMORY.md is
#     unioned by pointer-line target, and personal-only files are NEVER deleted.
#
# Never touched, in either profile: .credentials.json, .claude.json, or any account/token
# state. The refresh writes only the paths named above.
#
# The profile is optional: on a machine without ~/.claude-personal the refresh does nothing
# and never creates one. Every file it would overwrite with different bytes is backed up
# first to ~/.claude-personal-refresh-backup-<stamp>; identical bytes are skipped, which is
# what makes a second run a no-op.

Set-StrictMode -Version Latest

function Test-SameFileBytes {
    param(
        [Parameter(Mandatory = $true)][string]$PathA,
        [Parameter(Mandatory = $true)][string]$PathB
    )
    $a = [System.IO.File]::ReadAllBytes($PathA)
    $b = [System.IO.File]::ReadAllBytes($PathB)
    return [System.Linq.Enumerable]::SequenceEqual($a, $b)
}

function Update-PersonalProfile {
    param(
        [Parameter(Mandatory = $true)][string]$UserHome,
        [switch]$DryRun
    )

    $work     = Join-Path $UserHome '.claude'
    $personal = Join-Path $UserHome '.claude-personal'

    if (-not (Test-Path $personal)) {
        Write-Host '  skip: no ~/.claude-personal on this machine (the refresh never creates one)'
        return
    }
    if (-not (Test-Path $work)) {
        Write-Host '  skip: no ~/.claude to refresh from'
        return
    }
    if ($DryRun) {
        Write-Host ("  would refresh {0} from {1}:" -f $personal, $work)
        Write-Host '    hooks, CLAUDE.md, agents verbatim; skill junctions + real skill dirs;'
        Write-Host '    settings.json hooks key (paths rewritten to .claude-personal); memory union.'
        Write-Host '    Personal-only files are never deleted; overwrites are backed up first.'
        return
    }

    $stamp      = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupRoot = Join-Path $UserHome ('.claude-personal-refresh-backup-' + $stamp)
    $script:PersonalBackupCount = 0

    # Copy $Source over $Destination, backing the old bytes up first. Returns 'copied' or
    # 'unchanged'. Identical bytes are left alone so re-running the refresh writes nothing.
    function Copy-WithBackup {
        param(
            [Parameter(Mandatory = $true)][string]$Source,
            [Parameter(Mandatory = $true)][string]$Destination
        )
        if ((Test-Path $Destination) -and (Test-SameFileBytes -PathA $Source -PathB $Destination)) {
            return 'unchanged'
        }
        if (Test-Path $Destination) {
            $relative = $Destination.Substring($personal.Length).TrimStart('\', '/')
            $slot     = Join-Path $backupRoot $relative
            $parent   = Split-Path $slot -Parent
            if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
            Copy-Item -Path $Destination -Destination $slot -Force
            $script:PersonalBackupCount++
        }
        $parent = Split-Path $Destination -Parent
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -Path $Source -Destination $Destination -Force
        return 'copied'
    }

    # ---------------------------------------------------------- hooks / CLAUDE.md / agents

    $copied = 0
    foreach ($tree in @('hooks', 'agents')) {
        $src = Join-Path $work $tree
        if (-not (Test-Path $src)) { continue }
        Get-ChildItem -Path $src -Recurse -File | ForEach-Object {
            $relative = $_.FullName.Substring($src.Length).TrimStart('\', '/')
            if (Test-Excluded -RelativePath $relative) { return }
            $state = Copy-WithBackup -Source $_.FullName -Destination (Join-Path (Join-Path $personal $tree) $relative)
            if ($state -eq 'copied') { $copied++ }
        }
    }
    $claudeMd = Join-Path $work 'CLAUDE.md'
    if (Test-Path $claudeMd) {
        $state = Copy-WithBackup -Source $claudeMd -Destination (Join-Path $personal 'CLAUDE.md')
        if ($state -eq 'copied') { $copied++ }
    }
    Write-Host ("  hooks/CLAUDE.md/agents: {0} file(s) updated" -f $copied)

    # -------------------------------------------------------------------------- skills

    # Junctions point at machine-wide targets (~/.agents/skills), so the personal profile gets
    # a junction to the SAME target the work profile has. Real skill dirs are overlaid
    # file-by-file. Skills that exist only in the personal profile are left alone.
    $workSkills     = Join-Path $work 'skills'
    $personalSkills = Join-Path $personal 'skills'
    $junctions = 0; $skillFiles = 0
    if (Test-Path $workSkills) {
        if (-not (Test-Path $personalSkills)) {
            New-Item -ItemType Directory -Path $personalSkills -Force | Out-Null
        }
        foreach ($dir in (Get-ChildItem -Path $workSkills -Directory -Force)) {
            $dest = Join-Path $personalSkills $dir.Name
            if (Test-IsLink -Item $dir) {
                $target = Get-LinkTarget -Item $dir
                if (-not (Test-Path $target)) {
                    Write-Host ("  skip skill link (no target): {0}" -f $dir.Name) -ForegroundColor Yellow
                    continue
                }
                if (Test-Path $dest) {
                    $existing = Get-Item $dest -Force
                    if (-not (Test-IsLink -Item $existing)) {
                        Write-Host ("  skip skill link (real directory in the way): {0}" -f $dest) -ForegroundColor Yellow
                        continue
                    }
                    if ((Get-LinkTarget -Item $existing) -eq $target) { $junctions++; continue }
                    Remove-Item -Path $dest -Force -Recurse
                }
                New-Item -ItemType Junction -Path $dest -Target $target | Out-Null
                $junctions++
            } else {
                Get-ChildItem -Path $dir.FullName -Recurse -File | ForEach-Object {
                    $relative = $_.FullName.Substring($dir.FullName.Length).TrimStart('\', '/')
                    if (Test-Excluded -RelativePath $relative) { return }
                    $state = Copy-WithBackup -Source $_.FullName -Destination (Join-Path $dest $relative)
                    if ($state -eq 'copied') { $skillFiles++ }
                }
            }
        }
    }
    Write-Host ("  skills: {0} junction(s) in place, {1} real-dir file(s) updated" -f $junctions, $skillFiles)

    # ------------------------------------------------------------------- settings.json

    # HOOKS KEY ONLY. The work profile's hooks block is serialized, its \.claude\ paths are
    # mechanically rewritten to \.claude-personal\ (in serialized JSON a path backslash is
    # doubled, hence the \\ spellings), and the result replaces the personal hooks key.
    # Everything else in the personal settings.json is preserved as-is.
    $workSettingsPath     = Join-Path $work 'settings.json'
    $personalSettingsPath = Join-Path $personal 'settings.json'
    if (Test-Path $workSettingsPath) {
        $workSettings = Get-Content $workSettingsPath -Raw | ConvertFrom-Json
        if ($workSettings.PSObject.Properties.Name -contains 'hooks') {
            $hooksJson = ConvertTo-Json -InputObject $workSettings.hooks -Depth 32
            $hooksJson = $hooksJson.Replace('\\.claude\\', '\\.claude-personal\\')
            $hooksJson = $hooksJson.Replace('/.claude/',   '/.claude-personal/')
            $rewritten = $hooksJson | ConvertFrom-Json

            $personalSettings = $null
            if (Test-Path $personalSettingsPath) {
                $personalSettings = Get-Content $personalSettingsPath -Raw | ConvertFrom-Json
            }
            if ($null -eq $personalSettings) { $personalSettings = [pscustomobject]@{} }
            if ($personalSettings.PSObject.Properties.Name -contains 'hooks') {
                $personalSettings.hooks = $rewritten
            } else {
                $personalSettings | Add-Member -MemberType NoteProperty -Name hooks -Value $rewritten
            }

            $newText = ConvertTo-Json -InputObject $personalSettings -Depth 32
            $oldText = if (Test-Path $personalSettingsPath) { [System.IO.File]::ReadAllText($personalSettingsPath) } else { '' }
            if ($newText -ceq $oldText) {
                Write-Host '  settings.json: hooks key already current'
            } else {
                if (Test-Path $personalSettingsPath) {
                    $slot   = Join-Path $backupRoot 'settings.json'
                    $parent = Split-Path $slot -Parent
                    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
                    Copy-Item -Path $personalSettingsPath -Destination $slot -Force
                    $script:PersonalBackupCount++
                }
                [System.IO.File]::WriteAllText($personalSettingsPath, $newText, $script:Utf8NoBom)
                Write-Host '  settings.json: hooks key replaced (paths rewritten to .claude-personal), personal prefs preserved'
            }
        } else {
            Write-Host '  settings.json: work profile has no hooks key - nothing to merge'
        }
    }

    # ----------------------------------------------------------------- memory union

    # Work memories flow IN; personal-only memories stay put and never flow back (decision b).
    # Same-named files: newer mtime wins. MEMORY.md is a union keyed on each pointer line's
    # (target.md): work's copy first, then any pointer line whose target exists only in the
    # personal index.
    $pointer = [regex]'\]\(([^)]+\.md)\)'
    $memCopied = 0; $memKept = 0; $indexMerged = 0; $personalOnly = 0
    $workProjects = Join-Path $work 'projects'
    if (Test-Path $workProjects) {
        foreach ($project in (Get-ChildItem -Path $workProjects -Directory)) {
            $src = Join-Path $project.FullName 'memory'
            if (-not (Test-Path $src)) { continue }
            $dst = Join-Path $personal ('projects\' + $project.Name + '\memory')
            if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }

            foreach ($file in (Get-ChildItem -Path $src -File)) {
                if ($file.Name -eq 'MEMORY.md') { continue }
                if (Test-Excluded -RelativePath $file.Name) { continue }
                $destFile = Join-Path $dst $file.Name
                if ((Test-Path $destFile) -and
                    ((Get-Item $destFile).LastWriteTimeUtc -ge $file.LastWriteTimeUtc)) {
                    $memKept++
                    continue
                }
                $state = Copy-WithBackup -Source $file.FullName -Destination $destFile
                if ($state -eq 'copied') { $memCopied++ } else { $memKept++ }
            }

            $srcIdx = Join-Path $src 'MEMORY.md'
            $dstIdx = Join-Path $dst 'MEMORY.md'
            if (Test-Path $srcIdx) {
                $merged = [System.IO.File]::ReadAllText($srcIdx)
                if (Test-Path $dstIdx) {
                    $have = @{}
                    foreach ($m in $pointer.Matches($merged)) { $have[$m.Groups[1].Value] = $true }
                    foreach ($line in ([System.IO.File]::ReadAllText($dstIdx) -split "`r?`n")) {
                        $m = $pointer.Match($line)
                        if ($m.Success -and -not $have.ContainsKey($m.Groups[1].Value)) {
                            $merged = $merged.TrimEnd() + "`n" + $line + "`n"
                            $have[$m.Groups[1].Value] = $true
                            $indexMerged++
                        }
                    }
                }
                $oldIdx = if (Test-Path $dstIdx) { [System.IO.File]::ReadAllText($dstIdx) } else { '' }
                if (-not ($merged -ceq $oldIdx)) {
                    if (Test-Path $dstIdx) {
                        $slot   = Join-Path $backupRoot ('projects\' + $project.Name + '\memory\MEMORY.md')
                        $parent = Split-Path $slot -Parent
                        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
                        Copy-Item -Path $dstIdx -Destination $slot -Force
                        $script:PersonalBackupCount++
                    }
                    [System.IO.File]::WriteAllText($dstIdx, $merged, $script:Utf8NoBom)
                }
            }

            # Count what stays personal-only, so a run states what it deliberately did not touch.
            foreach ($file in (Get-ChildItem -Path $dst -File)) {
                if ($file.Name -eq 'MEMORY.md') { continue }
                if (-not (Test-Path (Join-Path $src $file.Name))) { $personalOnly++ }
            }
        }
    }
    Write-Host ("  memory: {0} copied in, {1} kept (personal newer/same), {2} index line(s) merged, {3} personal-only file(s) preserved" -f `
        $memCopied, $memKept, $indexMerged, $personalOnly)

    if ($script:PersonalBackupCount -gt 0) {
        Write-Host ("  {0} overwritten file(s) backed up to {1}" -f $script:PersonalBackupCount, $backupRoot)
    } else {
        Write-Host '  nothing overwritten - no backup dir created'
    }
}
