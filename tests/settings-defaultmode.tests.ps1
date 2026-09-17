<#
.SYNOPSIS
    The settings.json half of the invariant enforcer, and sync.ps1 honouring its exit code
    (issue 362).

.DESCRIPTION
    Two behaviours, both of them regressions the tool shipped with:

      1. tools\settings-invariants.ps1 -Path <file>, run against a settings.json whose
         "permissions" block has other keys but no defaultMode, INSERTS the key. It used to
         throw and tell the operator to edit by hand, which left the invariant unenforceable
         on any machine whose settings.json carries an allow/deny list. Every other byte -
         the sibling keys, their order, the indentation, the line endings - must survive,
         because claude\settings.json is a byte-for-byte mirror of the live file. Asserted
         for an LF file (the mirror) and a CRLF one (the live tree, issue 87).

      2. sync.ps1 -Mode pull FAILS when that tool exits non-zero. Both call sites used to
         pipe the tool's output and walk on, so a pull whose invariant enforcement had died
         still exited 0 and stamped a clean sync. The success case is asserted too, so the
         new check cannot pass by failing every pull.

    Cases 3 and 4 run a real (not -DryRun) pull: under -DryRun the tool returns before it can
    fail, so a dry run cannot exercise the exit-code path at all. Everything they touch lives
    in a sandbox under $env:TEMP - a throwaway repo (sync.ps1 + lib\ + the tool) and a
    throwaway home.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tests\settings-invariants.tests.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TestsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $TestsRoot

# Issue 454: spawn WHICHEVER PowerShell is running this file - powershell.exe under 5.1 on the
# desktop, pwsh under 7 in a Linux container - rather than the literal 'powershell', which exists
# only on Windows. The fallback IS that literal, so the Windows path is unchanged. $env:TEMP is
# Windows-only for the same reason; GetTempPath() returns %TEMP% when it is set.
$Engine   = 'powershell'
try { $Engine = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch { }
$TempRoot = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }

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

function Get-FileBase64 {
    param([string]$Path)
    return [System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($Path))
}

function Get-TextBase64 {
    param([string]$Text)
    return [System.Convert]::ToBase64String((New-Object System.Text.UTF8Encoding($false)).GetBytes($Text))
}

# Reads permissions.defaultMode without tripping Set-StrictMode, which throws on a property
# that is not there - and "not there" is exactly what a regression looks like.
function Get-DefaultMode {
    param([string]$Path)
    $parsed = $null
    try { $parsed = Get-Content $Path -Raw | ConvertFrom-Json } catch { return '<unparseable>' }
    if ($null -eq $parsed) { return '<empty>' }
    if ($parsed.PSObject.Properties.Name -notcontains 'permissions') { return '<no permissions>' }
    if ($parsed.permissions.PSObject.Properties.Name -notcontains 'defaultMode') { return '<no defaultMode>' }
    return [string]$parsed.permissions.defaultMode
}

# Native children write their failure text to stderr, and under $ErrorActionPreference =
# 'Stop' a single stderr line becomes a terminating NativeCommandError - the exit code would
# never be read. 'Continue' for the duration of each call, same shape as the other suites.
function Invoke-Child {
    param([string[]]$PsArgs)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out  = & $Engine @PsArgs 2>&1 | Out-String
        $exit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    return [pscustomobject]@{ Out = $out; Exit = $exit }
}

function Invoke-Invariants {
    param([string]$Target)
    return Invoke-Child -PsArgs @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                                  (Join-Path $RepoRoot 'tools\settings-invariants.ps1'), '-Path', $Target)
}

function Invoke-Pull {
    param([string]$Repo, [string]$UserHome)
    return Invoke-Child -PsArgs @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                                  (Join-Path $Repo 'sync.ps1'), '-Mode', 'pull', '-UserHome', $UserHome)
}

# A settings.json shaped like a real customised one: a permissions block carrying an allow
# list and a deny list, and no defaultMode.
$withOtherKeys = @'
{
  "env": {
    "CLAUDE_CODE_USE_POWERSHELL_TOOL": "1"
  },
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Bash(node:*)"
    ],
    "deny": [],
    "additionalDirectories": []
  },
  "skipDangerousModePermissionPrompt": true
}
'@
# Normalised to LF so the CRLF case below is built from the same text and the two fixtures
# differ in nothing but their line endings, whatever this file was checked out as.
$withOtherKeys = $withOtherKeys -replace "`r`n", "`n"
if (-not $withOtherKeys.EndsWith("`n")) { $withOtherKeys += "`n" }

# The one line the tool is allowed to add, at the top of the block it found. Building the
# expectation by pure insertion IS the byte-identical assertion: anything else the tool
# touched shows up as a mismatch.
$expectedLf = $withOtherKeys.Replace(
    "`"permissions`": {`n",
    "`"permissions`": {`n    `"defaultMode`": `"bypassPermissions`",`n")

$sandbox = Join-Path $TempRoot ('settings-inv-{0}-{1}' -f $PID, ([guid]::NewGuid().ToString('N').Substring(0, 6)))
New-Item -ItemType Directory -Path $sandbox -Force | Out-Null

try {
    # ---- (1) LF fixture: the key is inserted, everything else keeps its bytes -----------
    Write-Host ''
    Write-Host 'permissions block with other keys, no defaultMode (LF)'
    $lfFile = Join-Path $sandbox 'lf\settings.json'
    Write-TextFile -Path $lfFile -Text $withOtherKeys
    $r = Invoke-Invariants -Target $lfFile
    Assert 'tool exits 0 instead of refusing the block' ($r.Exit -eq 0) ("exit={0}`n{1}" -f $r.Exit, $r.Out)
    Assert 'file still parses and carries permissions.defaultMode=bypassPermissions' `
        ((Get-DefaultMode -Path $lfFile) -eq 'bypassPermissions') `
        ([System.IO.File]::ReadAllText($lfFile))
    Assert 'the rest of the file is byte-identical (one inserted line, nothing else)' `
        ((Get-FileBase64 -Path $lfFile) -eq (Get-TextBase64 -Text $expectedLf)) `
        ([System.IO.File]::ReadAllText($lfFile))

    # ---- (2) the same file as CRLF: the insertion follows the file's line endings -------
    Write-Host ''
    Write-Host 'permissions block with other keys, no defaultMode (CRLF, the live-tree shape)'
    $crlfFile = Join-Path $sandbox 'crlf\settings.json'
    Write-TextFile -Path $crlfFile -Text ($withOtherKeys -replace "`n", "`r`n")
    $r = Invoke-Invariants -Target $crlfFile
    Assert 'CRLF file: the rest is byte-identical and the inserted line is CRLF too' `
        (($r.Exit -eq 0) -and ((Get-FileBase64 -Path $crlfFile) -eq (Get-TextBase64 -Text ($expectedLf -replace "`n", "`r`n")))) `
        ("exit={0}`n{1}" -f $r.Exit, [System.IO.File]::ReadAllText($crlfFile))

    # ---- sandbox repo for the two pull cases -------------------------------------------
    # sync.ps1 dot-sources lib\, runs tools\settings-invariants.ps1, and restores the skill
    # junctions from claude\skill-links.json. That last file is carried because
    # Restore-SkillLinks dies under Set-StrictMode when the manifest is absent (an empty
    # result unrolls to $null, and $null.Count throws) - a bug of its own, not this ticket's.
    # Its targets all resolve under the sandbox home and none of them exist, so every link is
    # skipped.
    $repo = Join-Path $sandbox 'repo'
    New-Item -ItemType Directory -Path (Join-Path $repo 'tools') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $repo 'claude') -Force | Out-Null
    Copy-Item -Path (Join-Path $RepoRoot 'sync.ps1') -Destination (Join-Path $repo 'sync.ps1') -Force
    Copy-Item -Path (Join-Path $RepoRoot 'lib') -Destination (Join-Path $repo 'lib') -Recurse -Force
    Copy-Item -Path (Join-Path $RepoRoot 'tools\settings-invariants.ps1') `
              -Destination (Join-Path $repo 'tools\settings-invariants.ps1') -Force
    Copy-Item -Path (Join-Path $RepoRoot 'claude\skill-links.json') `
              -Destination (Join-Path $repo 'claude\skill-links.json') -Force

    # ---- (3) pull reports failure when the tool exits non-zero --------------------------
    # defaultMode present but not a plain "..." string literal: the tool refuses to guess at
    # the value and throws, which is exit 1 out of a -File run. sync.ps1 used to print that
    # and carry on to the stamp.
    Write-Host ''
    Write-Host 'sync.ps1 -Mode pull when the invariant tool fails'
    $badHome = Join-Path $sandbox 'home-bad'
    Write-TextFile -Path (Join-Path $badHome '.claude\settings.json') `
                   -Text "{`n  `"permissions`": {`n    `"defaultMode`": null`n  }`n}`n"
    $r = Invoke-Pull -Repo $repo -UserHome $badHome
    Assert 'pull exits non-zero' ($r.Exit -ne 0) ("exit={0}`n{1}" -f $r.Exit, $r.Out)
    Assert 'pull names the tool that failed and its exit code' `
        ($r.Out -match 'settings-invariants\.ps1 \(live\) exited') $r.Out
    Assert 'pull stops before stamping a clean sync' `
        (-not (Test-Path (Join-Path $badHome '.claude\hook-state\dotfiles-sync\state.json'))) $r.Out

    # ---- (4) the control: a pull whose invariants apply still exits 0 -------------------
    # Without this, the check above would pass just as well if every pull failed. It also
    # puts case 1's insertion on the live-tree path through sync.ps1, not only a direct call.
    Write-Host ''
    Write-Host 'sync.ps1 -Mode pull when the invariant tool succeeds'
    $goodHome = Join-Path $sandbox 'home-good'
    Write-TextFile -Path (Join-Path $goodHome '.claude\settings.json') -Text ($withOtherKeys -replace "`n", "`r`n")
    $r = Invoke-Pull -Repo $repo -UserHome $goodHome
    Assert 'pull exits 0' ($r.Exit -eq 0) ("exit={0}`n{1}" -f $r.Exit, $r.Out)
    Assert 'the live settings.json gained permissions.defaultMode=bypassPermissions' `
        ((Get-DefaultMode -Path (Join-Path $goodHome '.claude\settings.json')) -eq 'bypassPermissions') $r.Out

} finally {
    # Cleanup never decides the verdict: a lingering child can hold the sandbox open.
    if (Test-Path $sandbox) {
        try { Remove-Item -Path $sandbox -Recurse -Force -ErrorAction Stop } catch {}
    }
}

Write-Host ''
Write-Host ("pass {0}  fail {1}" -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
