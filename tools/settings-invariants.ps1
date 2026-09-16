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

    BOTH files are edited by surgical text insertion, never by re-serialising the whole
    document: each keeps its existing indentation, key order and line endings. For
    settings.json that is the mirror's byte-for-byte contract. For ~/.claude.json it is
    issue 302: that file is the desktop's whole per-project memory (history, MCP servers,
    onboarding counters, oauthAccount) and the old -Trust path round-tripped all of it
    through PowerShell 5.1's ConvertFrom-Json / ConvertTo-Json, which is lossy in ways the
    caller cannot see - >Int64 integers become doubles and lose digits, the whole file is
    reflowed, and on 5.1 an empty object or array can come back re-shaped. Rewriting a
    fresh machine's entire state file to add one boolean is a trade nobody asked for, so
    the -Trust path now inserts only the missing record (or swaps a lone false literal)
    and leaves every other byte alone. ConvertFrom-Json is still used, but only to READ:
    to decide what is missing, and - after the edit - to verify that the new text parses
    and says exactly what the old one said plus the trust records. If that verification
    fails, nothing is written.

    Finding on the engines (issue 302 AC2): the -Trust path has been run end to end on pwsh 7.4.6
    against that representative file - large integer, unicode, empty array and object, nested
    projects, one record missing - and the result was ONE contiguous insertion, every other byte
    of the file identical. Because the edit is an insertion, no JSON serializer runs at all, so the
    5.1-vs-7 serialization differences that opened this ticket cannot reach the file on either
    engine; what 5.1 still does here is parse, and it only parses to decide and to verify.
    That first real run is also what caught the phantom-empty-key bug in the verification step
    (Get-JsonKey below): a fresh machine's empty "projects": {} made the verifier report a lost
    record and refuse to write, on every engine, which no port of the algorithm had shown.
    Windows PowerShell 5.1 is Windows-only, so its run of the suite is the one the restore test
    makes on the desktop (tests/restore-test.ps1 runs the suite from the clone).

.NOTES
    Idempotent. Backs up before writing (<file>.bak-issue199-<stamp>).
    Exits 0 on success; the caller reads $LASTEXITCODE.
    tests/settings-invariants.tests.ps1 covers the -Trust path on either engine
    (it re-invokes whichever PowerShell started it).
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

function ConvertTo-JsonLiteral {
    <#
        The JSON string literal (quoted, escaped) for a key we insert or search for. Hand-rolled
        on purpose: PowerShell 5.1's ConvertTo-Json goes through JavaScriptSerializer, which also
        escapes ' < > & as \uXXXX, while pwsh 7 leaves them alone. Both spellings are valid JSON,
        but a text search for an EXISTING key has to match what wrote the file (Node's
        JSON.stringify), so escape exactly what JSON requires and nothing more.
    #>
    param([string]$Value)
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $Value.ToCharArray()) {
        $code = [int]$ch
        if     ($code -eq 34) { [void]$sb.Append('\"') }
        elseif ($code -eq 92) { [void]$sb.Append('\\') }
        elseif ($code -eq 8)  { [void]$sb.Append('\b') }
        elseif ($code -eq 9)  { [void]$sb.Append('\t') }
        elseif ($code -eq 10) { [void]$sb.Append('\n') }
        elseif ($code -eq 12) { [void]$sb.Append('\f') }
        elseif ($code -eq 13) { [void]$sb.Append('\r') }
        elseif ($code -lt 32) { [void]$sb.Append(('\u{0:x4}' -f $code)) }
        else                  { [void]$sb.Append($ch) }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function Test-IsJsonObject {
    <#
        True for a ConvertFrom-Json object node. NOT `-is [pscustomobject]`: that accelerator
        is PSObject, and in PowerShell 5.1 every value - a string, an int - answers true to it.
        The unwrapped GetType() is the only reliable discriminator.
    #>
    param($Value)
    if ($null -eq $Value) { return $false }
    return ($Value.GetType().FullName -eq 'System.Management.Automation.PSCustomObject')
}

function Get-JsonKey {
    <#
        The member names a parsed JSON object actually holds. ConvertFrom-Json turns {} into a
        bare PSCustomObject, and PowerShell reports ONE property on that object whose name is the
        empty string - a placeholder, not a key the file carries. Enumerating it raw makes an
        empty object look like it has a member called "", so an empty "projects": {} compared
        against itself-plus-a-record reads as "project record lost: " and the verified write is
        refused - exactly the shape a fresh machine's ~/.claude.json has before any project is
        opened (issue 302). Blank names are dropped; this file never carries a real "" key.
    #>
    param($Object)
    if ($null -eq $Object) { return @() }
    $names = @()
    foreach ($n in @($Object.PSObject.Properties.Name)) {
        if (-not [string]::IsNullOrEmpty($n)) { $names += $n }
    }
    return $names
}

function Get-PropertyName {
    <#
        The object's own spelling of a property, matched case-insensitively (the keys here are
        Windows paths, and a machine may hold one under a different case). $null when absent.
    #>
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    foreach ($n in @($Object.PSObject.Properties.Name)) {
        if ($n -eq $Name) { return $n }
    }
    return $null
}

function Test-JsonEqual {
    <# Deep value equality over ConvertFrom-Json trees. Used to verify a rewrite, never to build one. #>
    param($Left, $Right)
    if ($null -eq $Left -or $null -eq $Right) { return (($null -eq $Left) -and ($null -eq $Right)) }

    $lObj = Test-IsJsonObject $Left
    $rObj = Test-IsJsonObject $Right
    if ($lObj -ne $rObj) { return $false }
    if ($lObj) {
        $ln = @(Get-JsonKey $Left)
        $rn = @(Get-JsonKey $Right)
        if ($ln.Count -ne $rn.Count) { return $false }
        foreach ($n in $ln) {
            if ($rn -notcontains $n) { return $false }
            if (-not (Test-JsonEqual $Left.$n $Right.$n)) { return $false }
        }
        return $true
    }

    $lArr = ($Left -is [System.Array])
    $rArr = ($Right -is [System.Array])
    if ($lArr -ne $rArr) { return $false }
    if ($lArr) {
        if ($Left.Count -ne $Right.Count) { return $false }
        for ($i = 0; $i -lt $Left.Count; $i++) {
            if (-not (Test-JsonEqual $Left[$i] $Right[$i])) { return $false }
        }
        return $true
    }

    # `-eq` coerces the right operand to the left's type, so $true -eq 'false' is TRUE, and
    # string comparison is case-INsensitive. Either would hide a changed value. Compare like
    # with like, and compare strings case-sensitively.
    if (($Left -is [bool]) -or ($Right -is [bool])) {
        if (-not (($Left -is [bool]) -and ($Right -is [bool]))) { return $false }
        return ($Left -eq $Right)
    }
    if (($Left -is [string]) -or ($Right -is [string])) {
        if (-not (($Left -is [string]) -and ($Right -is [string]))) { return $false }
        return ($Left -ceq $Right)
    }
    return ($Left -eq $Right)
}

function Find-ObjectBrace {
    <#
        Index of the '{' that opens the value of <KeyLiteral> at or after $From, or -1.
        KeyLiteral is a full JSON string literal, quotes included.
    #>
    param([string]$Raw, [int]$From, [string]$KeyLiteral)
    $pattern = [regex]::Escape($KeyLiteral) + '\s*:\s*\{'
    $m = [regex]::Match($Raw.Substring($From), $pattern,
                        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $m.Success) { return -1 }
    return ($From + $m.Index + $m.Length - 1)
}

function New-HeadInsertion {
    <#
        An edit that inserts $Lines as the FIRST member(s) of the object whose '{' sits at
        $BraceIndex. Nothing already in the file is moved or re-serialised: the edit is a pure
        insertion at one offset. Indentation is read off the file - the existing first member's
        indent, or the brace's own line indent plus one unit when the object is empty - so the
        inserted text matches the surrounding style.
    #>
    param(
        [string]$Raw,
        [int]$BraceIndex,
        [string[]]$Lines,
        [string]$Newline,
        [string]$Unit,
        [bool]$Pretty
    )
    $j = $BraceIndex + 1
    while ($j -lt $Raw.Length -and [char]::IsWhiteSpace($Raw[$j])) { $j++ }
    if ($j -ge $Raw.Length) { throw "Unterminated JSON object at offset $BraceIndex." }
    $isEmpty = ($Raw[$j] -eq '}')

    $baseIndent = ''
    $lineStart  = $Raw.LastIndexOf("`n", $BraceIndex)
    if ($lineStart -ge 0) {
        $baseIndent = [regex]::Match($Raw.Substring($lineStart + 1), '^[ \t]*').Value
    }
    $memberIndent = $baseIndent + $Unit
    if (-not $isEmpty) {
        $between = $Raw.Substring($BraceIndex + 1, $j - $BraceIndex - 1)
        $m = [regex]::Match($between, "\n([ `t]*)\z")
        if ($m.Success) { $memberIndent = $m.Groups[1].Value }
    }

    if ($Pretty) {
        $text = $Newline + ((@($Lines) | ForEach-Object { $memberIndent + $_ }) -join $Newline)
        if ($isEmpty) { $text = $text + $Newline + $baseIndent } else { $text = $text + ',' }
    } else {
        $text = (@($Lines) | ForEach-Object { $_.TrimStart() }) -join ''
        if (-not $isEmpty) { $text = $text + ',' }
    }
    return [pscustomobject]@{ Start = ($BraceIndex + 1); Length = 0; Text = $text }
}

function New-TrustRecordLines {
    <# The member lines for one or more trust records, comma-separated between them. #>
    param([string[]]$Clones, [string]$Unit)
    $lines = @()
    for ($i = 0; $i -lt $Clones.Count; $i++) {
        $sep = ''
        if ($i -lt ($Clones.Count - 1)) { $sep = ',' }
        $lines += ((ConvertTo-JsonLiteral $Clones[$i]) + ': {')
        $lines += ($Unit + '"hasTrustDialogAccepted": true')
        $lines += ('}' + $sep)
    }
    return $lines
}

function Test-TrustRewrite {
    <#
        The safety net behind the surgical edit: parse the rewritten text and prove it says
        everything the original said, plus the trust records. Returns the list of problems; a
        non-empty list means the edit is discarded and the file is left untouched.
    #>
    param($Before, [string]$AfterText, [string[]]$Clones)
    $problems = @()
    $after = $null
    try { $after = $AfterText | ConvertFrom-Json }
    catch { return @("the rewritten text does not parse as JSON: $($_.Exception.Message)") }

    $bn = @(Get-JsonKey $Before)
    $an = @(Get-JsonKey $after)
    foreach ($n in $bn) {
        if ($an -notcontains $n) { $problems += "top-level key lost: $n"; continue }
        if ($n -eq 'projects') { continue }
        if (-not (Test-JsonEqual $Before.$n $after.$n)) { $problems += "top-level key changed: $n" }
    }
    foreach ($n in $an) {
        if (($bn -notcontains $n) -and ($n -ne 'projects')) { $problems += "top-level key invented: $n" }
    }

    $afterProjectsName = Get-PropertyName -Object $after -Name 'projects'
    if ($null -eq $afterProjectsName -or $null -eq $after.$afterProjectsName) {
        return ($problems + 'the rewrite lost the projects object')
    }
    $afterProjects = $after.$afterProjectsName

    $beforeProjects = $null
    $beforeProjectsName = Get-PropertyName -Object $Before -Name 'projects'
    if ($null -ne $beforeProjectsName) { $beforeProjects = $Before.$beforeProjectsName }
    $bpn = @()
    if ($null -ne $beforeProjects) { $bpn = @(Get-JsonKey $beforeProjects) }
    $apn = @(Get-JsonKey $afterProjects)

    foreach ($n in $bpn) {
        if ($apn -notcontains $n) { $problems += "project record lost: $n"; continue }
        if ($Clones -notcontains $n) {
            if (-not (Test-JsonEqual $beforeProjects.$n $afterProjects.$n)) {
                $problems += "project record changed: $n"
            }
            continue
        }
        # A record this tool owns: hasTrustDialogAccepted may differ, nothing else may.
        $old     = $beforeProjects.$n
        $new     = $afterProjects.$n
        $oldKeys = @(Get-JsonKey $old)
        foreach ($k in $oldKeys) {
            if ($k -eq 'hasTrustDialogAccepted') { continue }
            if (-not (Test-JsonEqual $old.$k $new.$k)) { $problems += "project $n key changed: $k" }
        }
        foreach ($k in @(Get-JsonKey $new)) {
            if (($k -ne 'hasTrustDialogAccepted') -and ($oldKeys -notcontains $k)) {
                $problems += "project $n key invented: $k"
            }
        }
    }
    foreach ($n in $apn) {
        if (($bpn -notcontains $n) -and ($Clones -notcontains $n)) { $problems += "project record invented: $n" }
    }
    foreach ($clone in $Clones) {
        $name = Get-PropertyName -Object $afterProjects -Name $clone
        if ($null -eq $name) { $problems += "trust record missing after rewrite: $clone"; continue }
        $flag = Get-PropertyName -Object $afterProjects.$name -Name 'hasTrustDialogAccepted'
        if ($null -eq $flag -or ($afterProjects.$name.$flag -ne $true)) {
            $problems += "hasTrustDialogAccepted is not true after rewrite: $clone"
        }
    }
    return $problems
}

function Set-TrustInvariant {
    <#
        Lands hasTrustDialogAccepted=true for each clone path in ~/.claude.json. Every edit is
        a targeted insertion (or a true/false literal swap), never a re-serialisation of the
        whole file - see the header for why. The result is parsed and compared against the
        original before anything is written.
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
        $seed = @('{', '  "projects": {')
        $seed += (New-TrustRecordLines -Clones $Clones -Unit '  ' | ForEach-Object { '    ' + $_ })
        $seed += @('  }', '}')
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($StatePath, (($seed -join "`n") + "`n"), $utf8)
        Write-Host "  seeded $StatePath with $($Clones.Count) trust record(s)"
        return $true
    }

    $bytes  = [System.IO.File]::ReadAllBytes($StatePath)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    if ($hasBom) { $raw = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3) }
    else         { $raw = [System.Text.Encoding]::UTF8.GetString($bytes) }

    $state = $raw | ConvertFrom-Json
    if (-not (Test-IsJsonObject $state)) {
        throw "$StatePath does not hold a JSON object; refusing to touch it."
    }

    # Style read off the file, so an insertion looks like it was always there.
    $newline = if ($raw -match "`r`n") { "`r`n" } else { "`n" }
    $pretty  = $raw.Contains("`n")
    $unit    = if ($raw -match "(?m)^([ `t]+)`"") { $matches[1] } else { '  ' }

    $topBrace = $raw.IndexOf('{')
    if ($topBrace -lt 0) { throw "$StatePath has no top-level object; refusing to touch it." }

    $edits   = @()
    $changed = 0

    $projectsName  = Get-PropertyName -Object $state -Name 'projects'
    $projectsBrace = -1
    if ($null -ne $projectsName -and (Test-IsJsonObject $state.$projectsName)) {
        $projectsBrace = Find-ObjectBrace -Raw $raw -From $topBrace `
                                          -KeyLiteral (ConvertTo-JsonLiteral $projectsName)
        if ($projectsBrace -lt 0) {
            throw ("Could not locate the `"projects`" object in $StatePath by text search. " +
                   "Add the trust records by hand; this tool refuses to guess.")
        }
    } elseif ($null -ne $projectsName) {
        # Present but null, or a scalar/array. Inserting a second "projects" member would leave
        # a duplicate key behind; adding records to something that is not an object cannot be
        # done safely by text.
        throw ("`"projects`" in $StatePath is not an object; refusing to guess. Edit by hand.")
    }

    if ($projectsBrace -lt 0) {
        # No projects object at all: insert the whole member at the head of the top-level object.
        $lines  = @('"projects": {')
        $lines += (New-TrustRecordLines -Clones $Clones -Unit $unit | ForEach-Object { $unit + $_ })
        $lines += '}'
        $edits += (New-HeadInsertion -Raw $raw -BraceIndex $topBrace -Lines $lines `
                                     -Newline $newline -Unit $unit -Pretty $pretty)
        foreach ($clone in $Clones) { Write-Host "  add: $clone" }
        $changed = $Clones.Count
    } else {
        # Missing records go in as ONE edit: two insertions at the same offset into an empty
        # projects object would each omit the comma that has to separate them.
        $missing = @()
        foreach ($clone in $Clones) {
            $entryName = Get-PropertyName -Object $state.$projectsName -Name $clone
            if ($null -eq $entryName) {
                $missing += $clone
                $changed++
                Write-Host "  add: $clone"
                continue
            }
            $entry = $state.$projectsName.$entryName
            if (-not (Test-IsJsonObject $entry)) {
                throw ("The entry for $entryName in $StatePath is not an object; refusing to guess. " +
                       "Edit by hand.")
            }
            $flagName = Get-PropertyName -Object $entry -Name 'hasTrustDialogAccepted'
            if ($null -ne $flagName -and ($entry.$flagName -is [bool]) -and $entry.$flagName) {
                Write-Host "  ok:  $clone"
                continue
            }
            $entryBrace = Find-ObjectBrace -Raw $raw -From $projectsBrace `
                                           -KeyLiteral (ConvertTo-JsonLiteral $entryName)
            if ($entryBrace -lt 0) {
                throw ("Could not locate the record for $entryName in $StatePath by text search. " +
                       "Set hasTrustDialogAccepted by hand; this tool refuses to guess.")
            }
            if ($null -eq $flagName) {
                $edits += (New-HeadInsertion -Raw $raw -BraceIndex $entryBrace `
                                             -Lines @('"hasTrustDialogAccepted": true') `
                                             -Newline $newline -Unit $unit -Pretty $pretty)
            } else {
                $flagPattern = [regex]::Escape((ConvertTo-JsonLiteral $flagName)) + '(\s*:\s*)(true|false|null)'
                $m = [regex]::Match($raw.Substring($entryBrace), $flagPattern,
                                    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
                if (-not $m.Success) {
                    throw ("hasTrustDialogAccepted in $entryName is not a bare true/false literal in " +
                           "$StatePath; set it by hand. This tool refuses to guess.")
                }
                $edits += [pscustomobject]@{
                    Start  = ($entryBrace + $m.Groups[2].Index)
                    Length = $m.Groups[2].Length
                    Text   = 'true'
                }
            }
            $changed++
            Write-Host "  set: $clone"
        }
        if ($missing.Count -gt 0) {
            $edits += (New-HeadInsertion -Raw $raw -BraceIndex $projectsBrace `
                                         -Lines (New-TrustRecordLines -Clones $missing -Unit $unit) `
                                         -Newline $newline -Unit $unit -Pretty $pretty)
        }
    }

    if ($changed -eq 0) { return $false }
    if ($DryRun) {
        Write-Host "  would rewrite $StatePath ($changed change(s))"
        return $true
    }

    # Every offset was computed against the original text, so apply the edits back to front.
    $updated = $raw
    foreach ($edit in @($edits | Sort-Object -Property Start -Descending)) {
        $updated = $updated.Remove($edit.Start, $edit.Length).Insert($edit.Start, $edit.Text)
    }

    $problems = @(Test-TrustRewrite -Before $state -AfterText $updated -Clones $Clones)
    if ($problems.Count -gt 0) {
        throw ("Refusing to write $StatePath - the edit did not verify:" + [Environment]::NewLine +
               '  ' + ($problems -join ([Environment]::NewLine + '  ')))
    }

    Backup-One -File $StatePath
    $utf8 = New-Object System.Text.UTF8Encoding($hasBom)
    [System.IO.File]::WriteAllText($StatePath, $updated, $utf8)
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
