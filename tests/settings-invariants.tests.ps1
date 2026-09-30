<#
.SYNOPSIS
    Test that tools\settings-invariants.ps1 -Trust edits ~/.claude.json surgically (issue 302).

.DESCRIPTION
    ~/.claude.json is the desktop's whole per-project memory - history, MCP servers, onboarding
    counters, oauthAccount - and -Trust runs against it on every `sync.ps1 -Mode pull`, including
    the first pull on a fresh machine. It used to read the file with ConvertFrom-Json and write
    the WHOLE object back with ConvertTo-Json to add one boolean, so every key in the file rode
    through PowerShell 5.1's JSON round-trip. This suite is the proof that it no longer does.

    Scenario 1 feeds a representative file - nested projects, an empty array, an empty object, an
    integer past 2^53, literal UTF-8 text - holding the trust records of the first three rows of
    the shared repo list (lib/repos.json, issue 1067) and missing the rest, and asserts the result
    is the input plus a single contiguous insertion holding one record per missing row. That is the strongest
    statement of "every pre-existing key round-trips unchanged" available: not one byte outside
    the inserted record moved, so no round-trip could have reflowed, re-typed or truncated it.

    Scenario 2 covers the other rewrite path - a record that exists with hasTrustDialogAccepted
    false - and asserts the edit is confined to that one literal.

    Engine-agnostic on purpose: the suite re-invokes WHICHEVER PowerShell started it (5.1 on the
    desktop, pwsh 7 anywhere else) and puts its sandbox under the platform temp directory, so the
    same assertions can be run on both engines - which is what issue 302's acceptance criteria ask
    for - and a Linux agent container can run the shipped .ps1 instead of a port of it.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tests\settings-invariants.tests.ps1

.EXAMPLE
    pwsh -File tests/settings-invariants.tests.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TestsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $TestsRoot
$Tool      = Join-Path (Join-Path $RepoRoot 'tools') 'settings-invariants.ps1'
# The engine running this file, by full path: powershell.exe under 5.1, pwsh under 7. Spawning
# THIS engine (rather than the literal string 'powershell') is what lets one suite assert the
# same behaviour on both, and it is the same child process the restore test has always run.
$Engine    = 'powershell'
try { $Engine = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch { }

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

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-Trust {
    param([string]$FakeHome)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Engine -NoProfile -ExecutionPolicy Bypass -File $Tool -Trust -UserHome $FakeHome 2>&1 | Out-String
        return @{ Exit = $LASTEXITCODE; Out = $out }
    } finally { $ErrorActionPreference = $prev }
}

function Test-SingleInsertion {
    <#
        True when $After is $Before with exactly one contiguous run of characters inserted -
        i.e. every byte of $Before survives, in order, untouched. Returns the inserted text in
        the [ref] so a caller can show it.
    #>
    param([string]$Before, [string]$After, [ref]$Inserted)
    $p = 0
    while ($p -lt $Before.Length -and $p -lt $After.Length -and $Before[$p] -eq $After[$p]) { $p++ }
    $s = 0
    while ($s -lt ($Before.Length - $p) -and $s -lt ($After.Length - $p) -and
           $Before[$Before.Length - 1 - $s] -eq $After[$After.Length - 1 - $s]) { $s++ }
    $Inserted.Value = $After.Substring($p, $After.Length - $s - $p)
    return (($p + $s) -eq $Before.Length)
}

# The clone paths the tool owns, under the sandbox home: one per row of the shared repo list, in
# list order, through the one reader the tool itself uses (issue 1067).
. (Join-Path (Join-Path $RepoRoot 'lib') 'manifest.ps1')
function Get-ClonePaths {
    param([string]$FakeHome)
    return @((Read-RepoList -UserHome $FakeHome).Repos | ForEach-Object { $_.Path })
}
# The row count read straight off the file's text, not through the reader, so "one record per
# row" is checked against a number the reader did not produce.
$ListedRows = [regex]::Matches([System.IO.File]::ReadAllText((Join-Path (Join-Path $RepoRoot 'lib') 'repos.json')),
                               '"repo"\s*:').Count

function Get-TrustedCount {
    <# How many of $Clones hold a hasTrustDialogAccepted=true record in the state file. #>
    param([string]$StatePath, [string[]]$Clones)
    $state = [System.IO.File]::ReadAllText($StatePath) | ConvertFrom-Json
    $n = 0
    foreach ($clone in $Clones) {
        if ($state.projects.PSObject.Properties.Name -notcontains $clone) { continue }
        $entry = $state.projects.$clone
        if ($entry.PSObject.Properties.Name -contains 'hasTrustDialogAccepted' -and $entry.hasTrustDialogAccepted -eq $true) { $n++ }
    }
    return $n
}

# Built from code points, not typed into this file: PowerShell 5.1 reads a BOM-less source file
# as the ANSI code page, which would mangle literal non-ASCII text before it ever reached JSON.
$Unicode = 'un' + [char]0x00EF + 'code-caf' + [char]0x00E9 + '-' + [char]0x4E2D + [char]0x6587
$BigInt  = '9007199254740993'   # 2^53 + 1: survives as text, not as a double

$Fixture = @'
{
  "installMethod": "native",
  "firstStartTime": "2026-01-02T03:04:05.678Z",
  "numStartups": __BIGINT__,
  "userID": "__UNICODE__",
  "emptyArray": [],
  "emptyObject": {},
  "projects": {
    "__C0__": {
      "allowedTools": [],
      "history": [
        {
          "display": "__UNICODE__",
          "pastedContents": {}
        }
      ],
      "mcpServers": {},
      "hasTrustDialogAccepted": true,
      "projectOnboardingSeenCount": 3
    },
    "__C1__": {
      "allowedTools": [],
      "hasTrustDialogAccepted": true
    },
    "__C2__": {
      "hasTrustDialogAccepted": true,
      "lastTotalWebSearchRequests": 0
    },
    "__OTHER__": {
      "hasTrustDialogAccepted": false,
      "lastCost": 1.5
    }
  },
  "oauthAccount": {
    "accountUuid": "0000-1111",
    "emailAddress": "someone@example.com"
  },
  "tipsHistory": {
    "new-user-warmup": 12
  }
}
'@

function New-Fixture {
    <#
        The representative file, holding the records of the first three listed rows and missing
        every other row's record on purpose.
    #>
    param([string]$FakeHome)
    $clones = Get-ClonePaths -FakeHome $FakeHome
    $esc    = { param($p) $p.Replace('\', '\\') }
    $text   = $Fixture -replace "`r`n", "`n"
    $text = $text.Replace('__BIGINT__',  $BigInt)
    $text = $text.Replace('__UNICODE__', $Unicode)
    $text = $text.Replace('__C0__',      (& $esc $clones[0]))
    $text = $text.Replace('__C1__',      (& $esc $clones[1]))
    $text = $text.Replace('__C2__',      (& $esc $clones[2]))
    $text = $text.Replace('__OTHER__',   (& $esc (Join-Path $FakeHome 'Claude\Projects\Unrelated\other-clone')))
    return $text
}

function Test-AllTrusted {
    param([string]$StatePath, [string[]]$Clones)
    $state = [System.IO.File]::ReadAllText($StatePath) | ConvertFrom-Json
    foreach ($clone in $Clones) {
        if ($state.projects.PSObject.Properties.Name -notcontains $clone) { return $false }
        $entry = $state.projects.$clone
        if ($entry.PSObject.Properties.Name -notcontains 'hasTrustDialogAccepted') { return $false }
        if ($entry.hasTrustDialogAccepted -ne $true) { return $false }
    }
    return $true
}

$stamp   = 'settings-inv-{0}-{1}' -f $PID, ([guid]::NewGuid().ToString('N').Substring(0, 6))
$Sandbox = Join-Path ([System.IO.Path]::GetTempPath()) $stamp
New-Item -ItemType Directory -Path $Sandbox -Force | Out-Null

try {
    # ---- scenario 1: all but three listed rows' records missing ------------------------
    Write-Host ''
    Write-Host 'representative ~/.claude.json, most trust records missing'

    $home1 = Join-Path $Sandbox 'home1'
    New-Item -ItemType Directory -Path $home1 -Force | Out-Null
    $state1  = Join-Path $home1 '.claude.json'
    $before  = New-Fixture -FakeHome $home1
    Write-Utf8NoBom -Path $state1 -Text $before
    $clones1 = Get-ClonePaths -FakeHome $home1

    $r = Invoke-Trust -FakeHome $home1
    Assert '-Trust exits 0 on a representative file' ($r.Exit -eq 0) $r.Out

    $after  = [System.IO.File]::ReadAllText($state1)
    $parsed = $null
    try { $parsed = $after | ConvertFrom-Json } catch { }
    Assert 'the rewritten file still parses as JSON' ($null -ne $parsed) $r.Out

    $inserted = ''
    $single = Test-SingleInsertion -Before $before -After $after -Inserted ([ref]$inserted)
    Assert 'the rewrite is ONE contiguous insertion - every pre-existing byte survives' $single `
        ("inserted: {0}" -f $inserted)
    # The diff window can start mid-record: the inserted records share their leading
    # "<home>\\Claude\\Projects\\" with the record after them, so the window found is a rotation of
    # the true insertion. Every record is whole inside the window doubled.
    $window = $inserted + $inserted
    $absent = @($clones1 | Select-Object -Skip 3 | Where-Object { -not $window.Contains($_.Replace('\', '\\')) })
    $records = ([regex]::Matches($inserted, '"hasTrustDialogAccepted": true')).Count
    Assert 'the inserted text is the missing rows'' trust records and nothing else' `
        (($absent.Count -eq 0) -and ($records -eq ($clones1.Count - 3))) `
        ("{0} record(s) inserted for {1} missing row(s); absent: {2}" -f $records, ($clones1.Count - 3), ($absent -join ', '))

    Assert ("the shared repo list reads {0} rows, as many as lib/repos.json lists" -f $clones1.Count) `
        (($clones1.Count -eq $ListedRows) -and ($ListedRows -gt 0)) ("file lists {0}" -f $ListedRows)
    $trusted1 = Get-TrustedCount -StatePath $state1 -Clones $clones1
    Assert ("one trust record per listed repo ({0} of {1})" -f $trusted1, $ListedRows) `
        (($trusted1 -eq $ListedRows) -and (Test-AllTrusted -StatePath $state1 -Clones $clones1)) $r.Out

    # Called out one by one because these are the shapes a PowerShell 5.1 JSON round-trip
    # damages: >2^53 integers lose their last digits, non-ASCII is re-encoded, and an empty
    # array or object comes back reflowed.
    # .Contains, not -like: [ and ] are character-class metacharacters in a -like pattern, so
    # '*"emptyArray": []*' would never match the thing it is looking for.
    $kept = @()
    if (-not $after.Contains($BigInt))                 { $kept += 'integer past 2^53' }
    if (-not $after.Contains($Unicode))                { $kept += 'non-ASCII text' }
    if (-not $after.Contains('"emptyArray": []'))      { $kept += 'empty array' }
    if (-not $after.Contains('"emptyObject": {}'))     { $kept += 'empty object' }
    if (-not $after.Contains('"lastCost": 1.5'))       { $kept += 'fractional number' }
    Assert 'large integer, unicode, empty array/object and float survive verbatim' ($kept.Count -eq 0) ($kept -join ', ')

    $otherPath = Join-Path $home1 'Claude\Projects\Unrelated\other-clone'
    $otherOk   = $false
    if ($null -ne $parsed) { $otherOk = ($parsed.projects.$otherPath.hasTrustDialogAccepted -eq $false) }
    Assert 'a project this tool does not own keeps hasTrustDialogAccepted=false' $otherOk

    # Issue 199 kept a backup before every rewrite; issue 302 keeps that promise.
    $baks = @(Get-ChildItem -Path $home1 -Filter '*.bak-issue199-*' -Force)
    $bakOk = ($baks.Count -eq 1) -and ([System.IO.File]::ReadAllText($baks[0].FullName) -ceq $before)
    Assert 'the pre-rewrite .bak-issue199-* backup is kept, byte-identical to the original' $bakOk `
        ("{0} backup(s)" -f $baks.Count)

    $r2 = Invoke-Trust -FakeHome $home1
    $again = [System.IO.File]::ReadAllText($state1)
    $baks2 = @(Get-ChildItem -Path $home1 -Filter '*.bak-issue199-*' -Force)
    Assert 'a second run changes nothing and writes no second backup' `
        (($r2.Exit -eq 0) -and ($again -ceq $after) -and ($baks2.Count -eq 1)) $r2.Out

    # ---- scenario 2: a record present with the flag false ----------------------------
    Write-Host ''
    Write-Host 'a trust record present with hasTrustDialogAccepted false'

    $home2 = Join-Path $Sandbox 'home2'
    New-Item -ItemType Directory -Path $home2 -Force | Out-Null
    $state2  = Join-Path $home2 '.claude.json'
    $clones2 = Get-ClonePaths -FakeHome $home2
    # Start from scenario 1's post-rewrite text, which holds every listed record (New-Fixture leaves
    # most rows out on purpose, so a run from it makes adds AND a flip and "nothing else moves"
    # cannot hold). Only the paths differ between the two homes.
    $complete2 = $after.Replace($home1.Replace('\', '\\'), $home2.Replace('\', '\\'))
    $before2 = $complete2.Replace(
        "`"hasTrustDialogAccepted`": true,`n      `"lastTotalWebSearchRequests`"",
        "`"hasTrustDialogAccepted`": false,`n      `"lastTotalWebSearchRequests`"")
    Assert 'scenario 2 fixture carries exactly one false flag to flip' ($before2 -cne $complete2)
    Write-Utf8NoBom -Path $state2 -Text $before2

    $r3 = Invoke-Trust -FakeHome $home2
    $after2 = [System.IO.File]::ReadAllText($state2)
    Assert 'a false flag flips to true and nothing else in the file moves' `
        (($r3.Exit -eq 0) -and ($after2 -ceq $complete2)) $r3.Out
    Assert 'every listed clone path is trusted after the flip' (Test-AllTrusted -StatePath $state2 -Clones $clones2) $r3.Out

    # ---- scenario 3: the fresh-machine shapes ----------------------------------------
    # A file claude has written but no project has been opened in holds an EMPTY projects
    # object, and a half-initialised one can be a bare {}. Both are objects with no members,
    # and a parsed empty object reports one phantom property whose name is '' - so the
    # post-edit verification read the insertion as "project record lost: " and refused to
    # write. The fresh machine in this ticket's title is exactly that case.
    Write-Host ''
    Write-Host 'a fresh machine: empty projects object, and a bare {}'

    $shapes = @{ 'empty projects object' = '{"projects": {}}'; 'bare {} document' = '{}' }
    foreach ($shape in @($shapes.Keys | Sort-Object)) {
        $h = Join-Path $Sandbox ('home-' + ($shape -replace '[^a-zA-Z]', ''))
        New-Item -ItemType Directory -Path $h -Force | Out-Null
        $state = Join-Path $h '.claude.json'
        Write-Utf8NoBom -Path $state -Text $shapes[$shape]
        $r = Invoke-Trust -FakeHome $h
        Assert ("one record per listed repo lands in a {0}" -f $shape) `
            (($r.Exit -eq 0) -and (Test-AllTrusted -StatePath $state -Clones (Get-ClonePaths -FakeHome $h))) $r.Out
    }

} finally {
    if (Test-Path $Sandbox) {
        # Cleanup must never decide the verdict - a lingering child can hold the sandbox open.
        try { Remove-Item -Path $Sandbox -Recurse -Force -ErrorAction Stop } catch {}
    }
}

Write-Host ''
Write-Host ("pass {0}  fail {1}" -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
