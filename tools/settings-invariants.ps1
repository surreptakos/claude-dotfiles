<#
.SYNOPSIS
    Enforce the settings.json invariants this repo owns.

.DESCRIPTION
    A short list of settings.json keys is OWNED BY THIS TOOL, not by the live/mirror
    file's user-edit history: sync push/pull re-apply them each run so the mirror and
    live tree cannot drift out of alignment on them.

    Today the list is one entry:

      permissions.defaultMode = "bypassPermissions"   (issue 199)

    Interactive sessions on the desktop match the ruling on #170 (closed) and item 1
    of the #175 handoff: no permission dialog on launch. skipDangerousModePermissionPrompt
    is already set; this is the paired default-mode key.

    Called with -Path <settings.json>, ensures the invariant on that file and reports
    whether it made a change. Called with -Trust and -UserHome, additionally writes
    hasTrustDialogAccepted=true into the given home's ~/.claude.json for the four
    master-watchdog clone paths (bill-intake, contract-builder, sales-cockpit,
    zoho-source-of-truth). ~/.claude.json is NOT in the sync manifest (it holds
    oauthAccount and other machine-only state), so trust records land per-machine
    when sync.ps1 -Mode pull invokes this tool with -Trust; that is what wires the
    fresh-launch, no-dialog behaviour called for by issue 199 AC1. If ~/.claude.json
    does not exist yet (claude has never launched on this machine), the tool creates
    a minimal one containing just the four trust records; a subsequent claude launch
    will merge its own state around them.

    Edits are surgical text insertions, not full re-serialisation: the settings.json
    file keeps its existing indentation and line endings. Powershell 5.1's ConvertTo-Json
    would reformat every line and break the mirror's byte-for-byte contract. The
    ~/.claude.json case (delivery-only, machine-local, not diffed against the repo)
    round-trips through ConvertFrom-Json / ConvertTo-Json because the format there is
    Claude's own to define.

.NOTES
    Idempotent. Backs up before writing.
    Exits 0 on success; the caller reads $LASTEXITCODE.
#>
[CmdletBinding()]
param(
    [string]$Path,
    [switch]$Trust,
    [string]$UserHome = $env:USERPROFILE,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Backup-One {
    param([string]$File)
    if (-not (Test-Path $File)) { return }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $bak = "$File.bak-issue199-$stamp"
    Copy-Item -Path $File -Destination $bak -Force
    Write-Host "  backup -> $bak"
}

function Set-SettingsInvariant {
    <#
        Ensures permissions.defaultMode = "bypassPermissions" is set at the top level of
        the given settings.json. Text-based surgical edit preserves the existing indent
        and line endings so the mirror contract holds.
    #>
    param([string]$File)
    if (-not (Test-Path $File)) {
        Write-Host "  MISSING: $File"
        return $false
    }
    $bytes = [System.IO.File]::ReadAllBytes($File)
    $raw   = [System.Text.Encoding]::UTF8.GetString($bytes)

    # Line ending the file already uses. The mirror is LF; a live-tree file may be CRLF.
    $newline = if ($raw -match "`r`n") { "`r`n" } else { "`n" }
    # Indent width: read from the first indented line inside the top-level object.
    $indent = if ($raw -match "(?m)^( +)`"") { $matches[1] } else { '  ' }

    $parsed = $raw | ConvertFrom-Json
    if ($parsed.PSObject.Properties.Name -contains 'permissions' -and
        $parsed.permissions.PSObject.Properties.Name -contains 'defaultMode' -and
        $parsed.permissions.defaultMode -eq 'bypassPermissions') {
        Write-Host "  ok: $File"
        return $false
    }

    if ($DryRun) {
        Write-Host "  would set permissions.defaultMode=bypassPermissions in $File"
        return $true
    }

    # Two cases: the key is entirely absent (insert a fresh block), or "permissions"
    # exists but lacks the mode (rewrite that block). If it exists with a WRONG mode we
    # also rewrite the block. Anything else (permissions has other keys like allow/deny)
    # merges in defaultMode without touching the rest.
    $insertBlock = "$indent`"permissions`": {$newline$indent$indent`"defaultMode`": `"bypassPermissions`"$newline$indent},$newline"

    if ($parsed.PSObject.Properties.Name -notcontains 'permissions') {
        # Insert before skipDangerousModePermissionPrompt (the paired key). Fall back to
        # the closing brace of the top-level object if that anchor is not there.
        $anchor = "(?m)^$indent`"skipDangerousModePermissionPrompt`""
        if ([regex]::IsMatch($raw, $anchor)) {
            $raw = [regex]::Replace($raw, $anchor, "$insertBlock`$0", 1)
        } else {
            $raw = $raw -replace "(?s)`n}\s*\z", ",$newline$($insertBlock.TrimEnd(",$newline"))$newline}"
        }
    } elseif ($parsed.permissions.PSObject.Properties.Name -contains 'defaultMode') {
        # defaultMode key exists with a wrong value. Swap its literal value in place; the
        # surrounding block (and any siblings) is untouched.
        $rewrite = [regex]::Replace(
            $raw,
            '("defaultMode"\s*:\s*)"[^"]*"',
            '$1"bypassPermissions"',
            1)
        if ($rewrite -eq $raw) {
            throw ("Could not rewrite existing permissions.defaultMode in $File; " +
                   "the value literal was not a simple `"...`" string. Edit by hand.")
        }
        $raw = $rewrite
    } else {
        # permissions block exists with other keys (allow/deny/additionalDirectories) but no
        # defaultMode. Insert the key as the FIRST entry of that block, immediately after its
        # opening brace: every other byte in the file - the sibling keys, their order, the
        # indentation, the line endings - is carried through untouched, which is what the
        # mirror's byte-for-byte contract needs. This branch used to throw, which left the
        # invariant unenforceable on any machine whose settings.json carried an allow list
        # and turned a routine sync into a hand edit (issue 362).
        $anchors = [regex]::Matches($raw, '(?<indent>[ \t]*)"permissions"[ \t]*:[ \t]*\{')
        $anchor = $null
        foreach ($candidate in $anchors) {
            # Prefer the block at the top-level indent; a nested "permissions" key elsewhere
            # in the file is not the one ConvertFrom-Json just read.
            if ($candidate.Groups['indent'].Value -eq $indent) { $anchor = $candidate; break }
        }
        if ($null -eq $anchor -and $anchors.Count -gt 0) { $anchor = $anchors[0] }
        if ($null -eq $anchor) {
            throw ("The `"permissions`" value in $File parses but is not an object literal this " +
                   "tool can insert into; add `"defaultMode`": `"bypassPermissions`" by hand.")
        }
        $blockIndent = $anchor.Groups['indent'].Value
        $insertAt    = $anchor.Index + $anchor.Length
        $tail        = $raw.Substring($insertAt)
        $line        = "$newline$blockIndent$indent`"defaultMode`": `"bypassPermissions`""
        if ($tail -match '\A\s*\}') {
            # Empty block: no sibling to separate with a comma, and the closing brace needs a
            # line of its own now that the block has content.
            $tail = $tail -replace '\A\s*\}', "$newline$blockIndent}"
        } else {
            $line += ','
        }
        $raw = $raw.Substring(0, $insertAt) + $line + $tail
    }

    Backup-One -File $File
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($File, $raw, $utf8)
    Write-Host "  set permissions.defaultMode=bypassPermissions in $File"
    return $true
}

function Set-TrustInvariant {
    <#
        ~/.claude.json holds machine-local state Claude Code owns; a full round-trip is
        the right shape here.
    #>
    param([string]$StatePath, [string[]]$Clones)
    if (-not (Test-Path $StatePath)) {
        # Fresh machine: claude has not launched yet. Create a minimal state file whose only
        # content is the trust records this tool owns. The next `claude` launch merges its own
        # keys (oauthAccount, telemetry, per-project settings) in around them.
        Write-Host "  seed: $StatePath (creating minimal file with trust records)"
        if ($DryRun) {
            Write-Host "  would seed $StatePath with $($Clones.Count) trust record(s)"
            return $true
        }
        $state = [pscustomobject]@{ projects = [pscustomobject]@{} }
    } else {
        $state = Get-Content $StatePath -Raw | ConvertFrom-Json
    }
    if (-not ($state.PSObject.Properties.Name -contains 'projects')) {
        $state | Add-Member -MemberType NoteProperty -Name 'projects' -Value ([pscustomobject]@{})
    }
    $changed = 0
    foreach ($clone in $Clones) {
        $entry = $null
        if ($state.projects.PSObject.Properties.Name -contains $clone) {
            $entry = $state.projects.$clone
        }
        if ($null -eq $entry) {
            $entry = [pscustomobject]@{ hasTrustDialogAccepted = $true }
            $state.projects | Add-Member -MemberType NoteProperty -Name $clone -Value $entry
            $changed++
            Write-Host "  add: $clone"
        } elseif (-not ($entry.PSObject.Properties.Name -contains 'hasTrustDialogAccepted')) {
            $entry | Add-Member -MemberType NoteProperty -Name 'hasTrustDialogAccepted' -Value $true
            $changed++
            Write-Host "  set: $clone"
        } elseif (-not $entry.hasTrustDialogAccepted) {
            $entry.hasTrustDialogAccepted = $true
            $changed++
            Write-Host "  set: $clone"
        } else {
            Write-Host "  ok:  $clone"
        }
    }
    if ($changed -eq 0) { return $false }
    if ($DryRun) {
        Write-Host "  would rewrite $StatePath ($changed change(s))"
        return $true
    }
    Backup-One -File $StatePath
    $json = $state | ConvertTo-Json -Depth 32
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($StatePath, $json, $utf8)
    Write-Host "  rewrote $StatePath ($changed change(s))"
    return $true
}

if ($Path) {
    Write-Host "settings.json invariant"
    [void](Set-SettingsInvariant -File $Path)
}

if ($Trust) {
    $UserHome = $UserHome.TrimEnd('\', '/')
    $statePath = Join-Path $UserHome '.claude.json'
    $clones = @(
        (Join-Path $UserHome 'Claude\Projects\Financial\aac-bill-intake'),
        (Join-Path $UserHome 'Claude\Projects\Sales Data KPIs\contract-builder'),
        (Join-Path $UserHome 'Claude\Projects\Sales Data KPIs\aac-cockpit'),
        (Join-Path $UserHome 'Claude\Projects\Operations\zoho-source-of-truth')
    )
    Write-Host ''
    Write-Host '.claude.json per-project trust'
    [void](Set-TrustInvariant -StatePath $statePath -Clones $clones)
}
