<#
.SYNOPSIS
    Drive setup-check.ps1 against seeded fake homes (issue 1068).

.DESCRIPTION
    Each case seeds a fake home and a stub directory (SETUP_CHECK_STUBS), runs the engine the way
    a caller does - a child process with -UserHome - and asserts only what a caller sees: the
    report, the exit code, and the files -Fix changed. Every check in the engine has a case here
    that makes it fail.

    The secret files carry a per-run sentinel value; every run's output is scanned for it, so a
    check that ever echoed a secret would fail here.

    Engine-agnostic: the suite spawns whichever PowerShell started it (5.1 on the desktop, pwsh 7
    anywhere else) and puts its sandbox under the platform temp directory.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tests\setup-check.tests.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TestsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $TestsRoot
$Tool      = Join-Path $RepoRoot 'setup-check.ps1'
$Engine    = 'powershell'
try { $Engine = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch { }
$TempRoot = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }

$Sandbox  = Join-Path $TempRoot ('setup-check-tests-' + [guid]::NewGuid().ToString('N'))
$Sentinel = 'FIXTURE-SECRET-' + [guid]::NewGuid().ToString('N')
$Tools    = @('git', 'node', 'py', 'claude', 'gh')

$script:Pass = 0
$script:Fail = 0
$script:Case = 0

function Assert {
    param([string]$Name, [bool]$Ok, [string]$Info = '')
    if ($Ok) {
        $script:Pass++
        Write-Host ("  ok    {0}" -f $Name) -ForegroundColor Green
    } else {
        $script:Fail++
        Write-Host ("  FAIL  {0}" -f $Name) -ForegroundColor Red
        if ($Info) { Write-Host ("        {0}" -f ($Info -replace "`r?`n", "`n        ")) -ForegroundColor Red }
    }
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# A clean fixture: both secret files present and parseable, every stub passing. Returns the
# home and the stub directory; a case then breaks exactly one thing.
function New-Fixture {
    $script:Case++
    $root  = Join-Path $Sandbox ('case{0}' -f $script:Case)
    $fhome = Join-Path $root 'home'
    $stubs = Join-Path $root 'stubs'
    $config = Join-Path $fhome '.config'
    New-Item -ItemType Directory -Path $config, $stubs -Force | Out-Null
    $key = [ordered]@{ type = 'service_account'; private_key = $Sentinel }
    Write-Utf8NoBom (Join-Path $config 'gpt-sheets-access-475817-853f8648243b.json') ($key | ConvertTo-Json)
    $client = [ordered]@{ installed = [ordered]@{ client_id = 'fixture'; client_secret = $Sentinel } }
    Write-Utf8NoBom (Join-Path $config 'client_secret_594980791877-fixture.apps.googleusercontent.com.json') ($client | ConvertTo-Json)

    # Each stub answers from a marker file in its own directory, so a case flips one probe by
    # creating one file. pyyaml-install creates the marker pyyaml reads, as pip would.
    Write-Utf8NoBom (Join-Path $stubs 'command.ps1') @'
if (Test-Path (Join-Path $PSScriptRoot ('missing-' + $args[0]))) { exit 1 }
exit 0
'@
    Write-Utf8NoBom (Join-Path $stubs 'pyyaml.ps1') @'
if (Test-Path (Join-Path $PSScriptRoot 'pyyaml-present')) { exit 0 }
exit 1
'@
    Write-Utf8NoBom (Join-Path $stubs 'pyyaml-install.ps1') @'
if (Test-Path (Join-Path $PSScriptRoot 'pip-fails')) { exit 1 }
Set-Content -Path (Join-Path $PSScriptRoot 'pyyaml-present') -Value 'installed'
exit 0
'@
    foreach ($probe in @('gh-auth', 'claude-auth', 'gas-auth')) {
        Write-Utf8NoBom (Join-Path $stubs ($probe + '.ps1')) @"
if (Test-Path (Join-Path `$PSScriptRoot '$probe.dead')) { exit 1 }
exit 0
"@
    }
    Write-Utf8NoBom (Join-Path $stubs 'pyyaml-present') 'present'
    return [pscustomobject]@{ Home = $fhome; Stubs = $stubs; Config = $config }
}

function Invoke-Check {
    param($Fixture, [switch]$Fix, [switch]$NoStubs, [string]$HomeOverride = '')
    $h = if ($HomeOverride) { $HomeOverride } else { $Fixture.Home }
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Tool, '-UserHome', $h)
    if ($Fix) { $argList += '-Fix' }
    $prevStubs = $env:SETUP_CHECK_STUBS
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($NoStubs) { $env:SETUP_CHECK_STUBS = $null } else { $env:SETUP_CHECK_STUBS = $Fixture.Stubs }
        $out = & $Engine @argList 2>&1 | Out-String
        $exit = $LASTEXITCODE
    } finally {
        $env:SETUP_CHECK_STUBS = $prevStubs
        $ErrorActionPreference = $prevEap
    }
    Assert ("no secret value in the output (case {0})" -f $script:Case) (-not $out.Contains($Sentinel)) $out
    return [pscustomobject]@{ Exit = $exit; Out = $out }
}

function Get-Snapshot {
    param([string]$Root)
    @(Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object FullName | ForEach-Object {
        '{0}|{1}' -f $_.FullName.Substring($Root.Length), (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }) -join "`n"
}

function Test-Todo {
    param([string]$Out, [string]$Pattern)
    return [bool]([regex]::IsMatch($Out, '(?ms)^Owner to-do\s*$.*^\s+1\. .*' + $Pattern))
}

try {
    New-Item -ItemType Directory -Path $Sandbox -Force | Out-Null

    Write-Host 'Clean fixture'
    $f = New-Fixture
    $r = Invoke-Check $f
    Assert 'clean fixture exits 0' ($r.Exit -eq 0) $r.Out
    Assert 'report has one heading per layer, then the to-do' `
        ($r.Out -match '(?ms)^Prerequisites\s*$.*^Credentials\s*$.*^Owner to-do\s*$') $r.Out
    Assert 'every line is ok, no STOP' (($r.Out -match '(?m)^  ok    gh\r?$') -and ($r.Out -notmatch 'STOP  ')) $r.Out

    Write-Host '-Fix is idempotent'
    $f = New-Fixture
    $r1 = Invoke-Check $f -Fix
    $before = Get-Snapshot (Split-Path $f.Home -Parent)
    $r2 = Invoke-Check $f -Fix
    $after = Get-Snapshot (Split-Path $f.Home -Parent)
    Assert 'first -Fix on a clean fixture exits 0' ($r1.Exit -eq 0) $r1.Out
    Assert 'second -Fix exits 0' ($r2.Exit -eq 0) $r2.Out
    Assert 'second -Fix changes nothing in the fixture' ($before -eq $after) ("before:`n$before`nafter:`n$after")

    Write-Host 'Secret files'
    $f = New-Fixture
    Remove-Item (Join-Path $f.Config 'client_secret_594980791877-*.json')
    $r = Invoke-Check $f
    Assert 'missing OAuth client secret exits 1' ($r.Exit -eq 1) $r.Out
    Assert 'missing OAuth client secret is a STOP' ($r.Out -match 'STOP  OAuth client secret missing') $r.Out
    Assert 'its to-do names where to copy it' (Test-Todo $r.Out 'Copy the OAuth client secret to .*client_secret_594980791877-\*\.json') $r.Out

    $f = New-Fixture
    Remove-Item (Join-Path $f.Config 'gpt-sheets-access-475817-853f8648243b.json')
    $r = Invoke-Check $f
    Assert 'missing service account key exits 1' ($r.Exit -eq 1) $r.Out
    Assert 'its to-do names where to copy it' (Test-Todo $r.Out 'Copy the service account key to .*gpt-sheets-access') $r.Out

    $f = New-Fixture
    Write-Utf8NoBom (Join-Path $f.Config 'gpt-sheets-access-475817-853f8648243b.json') ('{ "private_key": "' + $Sentinel + '", ')
    $r = Invoke-Check $f
    Assert 'unparseable service account key exits 1' ($r.Exit -eq 1) $r.Out
    Assert 'it is a STOP naming the file, not the content' ($r.Out -match 'STOP  service account key does not parse as JSON') $r.Out

    Write-Host 'Prerequisites'
    foreach ($t in $Tools) {
        $f = New-Fixture
        Write-Utf8NoBom (Join-Path $f.Stubs ('missing-' + $t)) 'x'
        $r = Invoke-Check $f -Fix
        Assert ("missing {0} exits 1, even with -Fix" -f $t) ($r.Exit -eq 1) $r.Out
        Assert ("missing {0} is a STOP with an install to-do" -f $t) `
            (($r.Out -match ("STOP  {0} not found on PATH" -f $t)) -and (Test-Todo $r.Out ("Install {0}," -f $t))) $r.Out
    }

    $f = New-Fixture
    Remove-Item (Join-Path $f.Stubs 'pyyaml-present')
    $r = Invoke-Check $f
    Assert 'missing PyYAML without -Fix exits 1' ($r.Exit -eq 1) $r.Out
    Assert 'its to-do is the pip command' (Test-Todo $r.Out 'py -3 -m pip install PyYAML') $r.Out
    $r = Invoke-Check $f -Fix
    Assert 'missing PyYAML with -Fix is installed and exits 0' `
        (($r.Exit -eq 0) -and ($r.Out -match 'ok    PyYAML  \(installed by -Fix\)')) $r.Out
    Assert '-Fix ran the installer' (Test-Path (Join-Path $f.Stubs 'pyyaml-present'))

    $f = New-Fixture
    Remove-Item (Join-Path $f.Stubs 'pyyaml-present')
    Write-Utf8NoBom (Join-Path $f.Stubs 'pip-fails') 'x'
    $r = Invoke-Check $f -Fix
    Assert 'a failed PyYAML install exits 1' (($r.Exit -eq 1) -and ($r.Out -match 'STOP  PyYAML')) $r.Out

    Write-Host 'Logins'
    $logins = @(
        @{ Probe = 'gh-auth';     Label = 'GitHub login'; Todo = 'gh auth login' },
        @{ Probe = 'claude-auth'; Label = 'Claude login'; Todo = '/login' },
        @{ Probe = 'gas-auth';    Label = 'gas login';    Todo = 'gas\.js" login' }
    )
    foreach ($l in $logins) {
        $f = New-Fixture
        Write-Utf8NoBom (Join-Path $f.Stubs ($l.Probe + '.dead')) 'x'
        $r = Invoke-Check $f
        Assert ("dead {0} exits 1" -f $l.Label) ($r.Exit -eq 1) $r.Out
        Assert ("dead {0} is a STOP whose to-do gives the command" -f $l.Label) `
            (($r.Out -match ("STOP  {0}" -f $l.Label)) -and (Test-Todo $r.Out $l.Todo)) $r.Out
    }

    Write-Host 'Machine probes in a fake home'
    $f = New-Fixture
    $r = Invoke-Check $f -NoStubs
    Assert 'a fake home with no stubs exits 0' ($r.Exit -eq 0) $r.Out
    $skipped = @([regex]::Matches($r.Out, '(?m)^  --    .*machine probe skipped')).Count
    Assert 'every machine probe is reported skipped (5 tools, PyYAML, 3 logins)' ($skipped -eq 9) ("skipped lines: $skipped`n" + $r.Out)
    Assert 'the secret files are still checked in a fake home' ($r.Out -match 'ok    service account key') $r.Out

    Write-Host 'Could not run'
    $f = New-Fixture
    $r = Invoke-Check $f -HomeOverride (Join-Path $Sandbox 'no-such-home')
    Assert 'a -UserHome that does not exist exits 2' ($r.Exit -eq 2) $r.Out
} finally {
    Remove-Item -LiteralPath $Sandbox -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { exit 1 }
exit 0
