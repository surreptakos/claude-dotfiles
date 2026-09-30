<#
.SYNOPSIS
    Drive setup-check.ps1 against seeded fake homes (issues 1068, 1070, 1071).

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
$FixtureRoot = Join-Path $Sandbox 'fixture'
$BareRepo    = Join-Path $Sandbox 'bare.git'
$Sentinel = 'FIXTURE-SECRET-' + [guid]::NewGuid().ToString('N')
$Tools    = @('git', 'node', 'py', 'claude', 'gh')
. (Join-Path (Join-Path $RepoRoot 'lib') 'manifest.ps1')
[void](Clear-GitEnv)

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

# One restored profile, built once by a real pull (caveman kept offline) and copied into every
# fixture, so the profile layer starts clean: no drift, the plugin recorded, a caveman proxy binary.
# Restored files carry the home path, so every fixture lives at the one path the pull wrote to.
function New-Template {
    $thome = Join-Path $FixtureRoot 'home'
    New-Item -ItemType Directory -Path $thome -Force | Out-Null
    $prevSkip = $env:CAVEMAN_DESKTOP_SKIP_CLI
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $env:CAVEMAN_DESKTOP_SKIP_CLI = '1'
        & $Engine -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoRoot 'sync.ps1') -Mode pull -UserHome $thome *> $null
        if ($LASTEXITCODE -ne 0) { throw "template pull exited $LASTEXITCODE" }
    } finally {
        $env:CAVEMAN_DESKTOP_SKIP_CLI = $prevSkip
        $ErrorActionPreference = $prevEap
    }
    Get-ChildItem -LiteralPath $thome -Directory -Filter '.claude-dotfiles-backup-*' | Remove-Item -Recurse -Force
    $proxy = Join-Path $thome '.caveman\bin\caveman-proxy.exe'
    New-Item -ItemType Directory -Path (Split-Path $proxy -Parent) -Force | Out-Null
    Write-Utf8NoBom $proxy 'fixture proxy'
    # Every listed repo cloned at its path, right origin, commit gate on. The pull above already
    # wrote their trust records.
    foreach ($row in (Read-RepoList -UserHome $thome).Repos) {
        & git init -q $row.Path
        & git -C $row.Path remote add origin ('https://github.com/{0}.git' -f $row.Repo)
        New-Item -ItemType Directory -Path (Join-Path $row.Path '.githooks') -Force | Out-Null
        & git -C $row.Path config core.hooksPath .githooks
    }
    # The local repo a stubbed clone copies: one commit carrying a .githooks folder.
    $src = Join-Path $Sandbox 'bare-src'
    & git init -q $src
    New-Item -ItemType Directory -Path (Join-Path $src '.githooks') -Force | Out-Null
    Write-Utf8NoBom (Join-Path $src '.githooks\pre-commit') "#!/bin/sh`nexit 0`n"
    & git -C $src -c core.autocrlf=false add -A
    & git -C $src -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m fixture
    & git clone -q --bare $src $BareRepo 2>$null
    $plugins = [System.IO.File]::ReadAllText((Join-Path $thome '.claude\plugins\installed_plugins.json')) | ConvertFrom-Json
    $script:InstalledVersion = [string]@($plugins.plugins.'aac-skills@claude-dotfiles')[0].version
    $saved = Join-Path $Sandbox 'template'
    Move-Item -LiteralPath $thome -Destination $saved
    return $saved
}

# A clean fixture: the template profile, both secret files present and parseable, every stub
# passing. Returns the home and the stub directory; a case then breaks exactly one thing.
function New-Fixture {
    $script:Case++
    $root  = $FixtureRoot
    $fhome = Join-Path $root 'home'
    $stubs = Join-Path $root 'stubs'
    $config = Join-Path $fhome '.config'
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    Copy-Item -LiteralPath $Template -Destination $fhome -Recurse
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
    # Profile probes: master's plugin version comes from a file; caveman-live exits with the code
    # in caveman-live.code (0 when absent); caveman-enable leaves a marker that it ran.
    Write-Utf8NoBom (Join-Path $stubs 'offered-version') $script:InstalledVersion
    Write-Utf8NoBom (Join-Path $stubs 'master-plugin-version.ps1') @'
[System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'offered-version'))
'@
    Write-Utf8NoBom (Join-Path $stubs 'caveman-live.ps1') @'
$f = Join-Path $PSScriptRoot 'caveman-live.code'
if (Test-Path $f) { exit ([int](Get-Content $f)) }
exit 0
'@
    Write-Utf8NoBom (Join-Path $stubs 'caveman-enable.ps1') @'
Set-Content -Path (Join-Path $PSScriptRoot 'caveman-enabled') -Value 'ran'
exit 0
'@
    # Projects probes. The PC is not the anchor unless computer-name says so; watchdog-state holds
    # the task's state; install/disable change it and leave a marker; the routine registry is an
    # empty directory a case can seed; clone copies the local bare repo and points origin home.
    Write-Utf8NoBom (Join-Path $stubs 'computer-name') 'FIXTURE-PC'
    Write-Utf8NoBom (Join-Path $stubs 'watchdog-state') 'missing'
    New-Item -ItemType Directory -Path (Join-Path $stubs 'registry') -Force | Out-Null
    Write-Utf8NoBom (Join-Path $stubs 'computer-name.ps1') @'
[System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'computer-name'))
'@
    Write-Utf8NoBom (Join-Path $stubs 'watchdog-task.ps1') @'
[System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'watchdog-state'))
'@
    Write-Utf8NoBom (Join-Path $stubs 'watchdog-install.ps1') @'
Set-Content -Path (Join-Path $PSScriptRoot 'watchdog-state') -Value 'enabled' -NoNewline
Set-Content -Path (Join-Path $PSScriptRoot 'watchdog-installed') -Value 'ran'
exit 0
'@
    Write-Utf8NoBom (Join-Path $stubs 'watchdog-disable.ps1') @'
Set-Content -Path (Join-Path $PSScriptRoot 'watchdog-state') -Value 'disabled' -NoNewline
Set-Content -Path (Join-Path $PSScriptRoot 'watchdog-disabled') -Value 'ran'
exit 0
'@
    Write-Utf8NoBom (Join-Path $stubs 'routine-registry.ps1') @'
Join-Path $PSScriptRoot 'registry'
'@
    Write-Utf8NoBom (Join-Path $stubs 'clone.ps1') (@'
param($Slug, $Dest)
& git clone -q '__BARE__' $Dest 2>$null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& git -C $Dest remote set-url origin ('https://github.com/{0}.git' -f $Slug)
exit $LASTEXITCODE
'@).Replace('__BARE__', $BareRepo)
    return [pscustomobject]@{ Home = $fhome; Stubs = $stubs; Config = $config }
}

function Get-Row {
    param($Fixture, [string]$Slug)
    return @((Read-RepoList -UserHome $Fixture.Home).Repos | Where-Object { $_.Repo -eq $Slug })[0]
}

function Get-TrustRecord {
    param($Fixture, [string]$Path)
    $state = [System.IO.File]::ReadAllText((Join-Path $Fixture.Home '.claude.json')) | ConvertFrom-Json
    $p = @($state.projects.PSObject.Properties | Where-Object { $_.Name -eq $Path })
    if ($p.Count -eq 0) { return $null }
    return $p[0].Value
}

function Remove-TrustRecord {
    param($Fixture, [string]$Path)
    $file = Join-Path $Fixture.Home '.claude.json'
    $state = [System.IO.File]::ReadAllText($file) | ConvertFrom-Json
    $state.projects.PSObject.Properties.Remove($Path)
    Write-Utf8NoBom $file ($state | ConvertTo-Json -Depth 20)
}

# One desktop registry file under <stubs>\registry\<account>\<org>, holding the named routines
# enabled on a cron.
function Set-Routines {
    param($Fixture, [string[]]$Ids)
    $reg = [System.IO.File]::ReadAllText((Join-Path $Fixture.Home '.claude\accounts.json')) | ConvertFrom-Json
    $first = $reg.routines.($Ids[0])
    $dir = Join-Path (Join-Path (Join-Path $Fixture.Stubs 'registry') $reg.accounts.($first.owner).uuid) $first.org
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $tasks = @($Ids | ForEach-Object { [ordered]@{ id = $_; enabled = $true; cronExpression = '0 3 * * *' } })
    $file = Join-Path $dir 'scheduled-tasks.json'
    Write-Utf8NoBom $file (ConvertTo-Json -InputObject ([ordered]@{ scheduledTasks = $tasks }) -Depth 5)
    return $file
}

function Invoke-Check {
    param($Fixture, [switch]$Fix, [switch]$NoStubs, [string]$HomeOverride = '')
    $h = if ($HomeOverride) { $HomeOverride } else { $Fixture.Home }
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Tool, '-UserHome', $h)
    if ($Fix) { $argList += '-Fix' }
    $prevStubs = $env:SETUP_CHECK_STUBS
    $prevSkip = $env:CAVEMAN_DESKTOP_SKIP_CLI
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($NoStubs) { $env:SETUP_CHECK_STUBS = $null } else { $env:SETUP_CHECK_STUBS = $Fixture.Stubs }
        # A -Fix pull runs the desktop caveman step; keep it offline, as the restore test does.
        $env:CAVEMAN_DESKTOP_SKIP_CLI = '1'
        $out = & $Engine @argList 2>&1 | Out-String
        $exit = $LASTEXITCODE
    } finally {
        $env:SETUP_CHECK_STUBS = $prevStubs
        $env:CAVEMAN_DESKTOP_SKIP_CLI = $prevSkip
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
    $Template = New-Template

    Write-Host 'Clean fixture'
    $f = New-Fixture
    $r = Invoke-Check $f
    Assert 'clean fixture exits 0' ($r.Exit -eq 0) $r.Out
    Assert 'report has one heading per layer, then the to-do' `
        ($r.Out -match '(?ms)^Prerequisites\s*$.*^Profile\s*$.*^Credentials\s*$.*^Projects\s*$.*^Owner to-do\s*$') $r.Out
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

    Write-Host 'Profile: pull drift'
    $f = New-Fixture
    $accounts = Join-Path $f.Home '.claude\accounts.json'
    $want = [System.IO.File]::ReadAllText($accounts)
    Write-Utf8NoBom $accounts '{ "drifted": true }'
    $r = Invoke-Check $f
    Assert 'a drifted profile file exits 1' ($r.Exit -eq 1) $r.Out
    Assert 'it is a STOP naming the file, and the to-do is pull' `
        (($r.Out -match 'STOP  profile differs from the repo .*accounts\.json') -and (Test-Todo $r.Out 'sync\.ps1" -Mode pull')) $r.Out
    $r = Invoke-Check $f -Fix
    Assert '-Fix runs pull and exits 0' (($r.Exit -eq 0) -and ($r.Out -match 'ok    profile matches the repo  \(pull ran under -Fix\)')) $r.Out
    Assert '-Fix restored the file' ([System.IO.File]::ReadAllText($accounts) -eq $want)

    Write-Host 'Profile: aac-skills plugin'
    $f = New-Fixture
    $r = Invoke-Check $f
    Assert 'a current plugin is ok, naming both versions' `
        ($r.Out -match ('ok    aac-skills plugin {0}  \(master offers {0}\)' -f [regex]::Escape($script:InstalledVersion))) $r.Out
    Write-Utf8NoBom (Join-Path $f.Stubs 'offered-version') '2999.1.1'
    $r = Invoke-Check $f
    Assert 'a stale plugin is !! naming both versions' `
        ($r.Out -match ('!!    aac-skills plugin is stale: installed {0}, master offers 2999\.1\.1' -f [regex]::Escape($script:InstalledVersion))) $r.Out
    Assert 'its to-do is a restart, never claude plugin update' `
        ((Test-Todo $r.Out 'Restart the Claude app') -and ($r.Out -notmatch 'plugin update')) $r.Out
    Assert 'a stale plugin alone blocks nothing (exit 0)' ($r.Exit -eq 0) $r.Out

    $f = New-Fixture
    $ip = Join-Path $f.Home '.claude\plugins\installed_plugins.json'
    Write-Utf8NoBom $ip '{ "version": 2, "plugins": {} }'
    $r = Invoke-Check $f
    Assert 'a missing plugin is a STOP with an install to-do' `
        (($r.Exit -eq 1) -and ($r.Out -match 'STOP  aac-skills plugin not installed') -and (Test-Todo $r.Out 'claude plugin install aac-skills@claude-dotfiles')) $r.Out

    Write-Host 'Profile: hooks and caveman'
    $f = New-Fixture
    $settingsPath = Join-Path $f.Home '.claude\settings.json'
    $settings = [System.IO.File]::ReadAllText($settingsPath) | ConvertFrom-Json
    $dead = Join-Path $f.Home '.caveman\bin\gone\caveman-proxy.exe'
    $settings.hooks = [pscustomobject]@{ SessionStart = @([pscustomobject]@{ hooks = @([pscustomobject]@{ type = 'command'; command = ("& '{0}' native-hook claude" -f $dead) }) }) }
    Write-Utf8NoBom $settingsPath ($settings | ConvertTo-Json -Depth 20)
    $r = Invoke-Check $f
    Assert 'a hook naming a missing file exits 1' ($r.Exit -eq 1) $r.Out
    Assert 'it is a STOP naming the event and the file' `
        ($r.Out -match ('STOP  SessionStart hook names a missing file: {0}' -f [regex]::Escape($dead))) $r.Out

    $f = New-Fixture
    Remove-Item (Join-Path $f.Home '.caveman\bin\caveman-proxy.exe')
    $r = Invoke-Check $f
    Assert 'a missing proxy binary is !! with an install to-do' `
        (($r.Out -match '!!    caveman proxy binary missing') -and (Test-Todo $r.Out 'caveman-desktop-install\.ps1')) $r.Out
    Assert 'report-only never runs the caveman install' (-not (Test-Path (Join-Path $f.Stubs 'caveman-enabled')))
    $r = Invoke-Check $f -Fix
    Assert '-Fix runs the caveman install' (Test-Path (Join-Path $f.Stubs 'caveman-enabled')) $r.Out

    $f = New-Fixture
    Write-Utf8NoBom (Join-Path $f.Stubs 'caveman-live.code') '1'
    $r = Invoke-Check $f
    Assert 'a dead proxy port exits 1 as a STOP' `
        (($r.Exit -eq 1) -and ($r.Out -match 'STOP  caveman proxy port 8787 does not answer')) $r.Out
    Write-Utf8NoBom (Join-Path $f.Stubs 'caveman-live.code') '2'
    $r = Invoke-Check $f
    Assert 'a claude -p that does not answer exits 1 as a STOP' `
        (($r.Exit -eq 1) -and ($r.Out -match 'STOP  proxy port 8787 answers, but a terminal claude -p did not')) $r.Out

    Write-Host 'Profile: personal profile'
    $f = New-Fixture
    $personal = Join-Path $f.Home '.claude-personal'
    $r = Invoke-Check $f -Fix
    Assert 'an absent personal profile is reported skipped' ($r.Out -match '--    ~/.claude-personal  \(absent: skipped, never created\)') $r.Out
    Assert 'and -Fix does not create it' (-not (Test-Path $personal))

    $f = New-Fixture
    $personal = Join-Path $f.Home '.claude-personal'
    New-Item -ItemType Directory -Path (Join-Path $personal 'plugins') -Force | Out-Null
    Copy-Item (Join-Path $f.Home '.claude\plugins\installed_plugins.json') (Join-Path $personal 'plugins\installed_plugins.json')
    $pdead = Join-Path $personal 'hooks\gone.js'
    Write-Utf8NoBom (Join-Path $personal 'settings.json') ((@{ hooks = @{ Stop = @(@{ hooks = @(@{ type = 'command'; command = ('node "{0}"' -f $pdead) }) }) } }) | ConvertTo-Json -Depth 20)
    $r = Invoke-Check $f
    Assert 'a present personal profile gets the plugin check' `
        ($r.Out -match '(?ms)~/.claude-personal\s*$.*ok    aac-skills plugin') $r.Out
    Assert 'and the hook check: a dead personal hook is a STOP' `
        (($r.Exit -eq 1) -and ($r.Out -match ('STOP  Stop hook names a missing file: {0}' -f [regex]::Escape($pdead)))) $r.Out

    Write-Host 'Projects: clones, commit gate, trust'
    $f = New-Fixture
    $row = Get-Row $f 'surreptakos/aac-sales-commissions'
    Remove-Item -LiteralPath $row.Path -Recurse -Force
    Remove-TrustRecord $f $row.Path
    $r = Invoke-Check $f
    Assert 'a missing clone exits 1 as a STOP' `
        (($r.Exit -eq 1) -and ($r.Out -match 'STOP  surreptakos/aac-sales-commissions .*Sales Data KPIs\\commissions\) not cloned')) $r.Out
    Assert 'its to-do is gh repo clone with the quoted path' (Test-Todo $r.Out 'gh repo clone surreptakos/aac-sales-commissions ".*Sales Data KPIs\\commissions"') $r.Out
    $r = Invoke-Check $f -Fix
    Assert '-Fix clones it from the local bare repo (path with a space) and exits 0' `
        (($r.Exit -eq 0) -and ($r.Out -match 'ok    surreptakos/aac-sales-commissions .*\[cloned by -Fix, commit gate set by -Fix\]')) $r.Out
    Assert 'the clone is there, origin pointing home' `
        ((& git -C $row.Path remote get-url origin) -eq 'https://github.com/surreptakos/aac-sales-commissions.git')
    Assert 'its commit gate is on' ((& git -C $row.Path config --get core.hooksPath) -eq '.githooks')
    $rec = Get-TrustRecord $f $row.Path
    Assert 'its trust record is written' ($null -ne $rec -and $rec.hasTrustDialogAccepted -eq $true)
    $before = Get-Snapshot $FixtureRoot
    $r2 = Invoke-Check $f -Fix
    $after = Get-Snapshot $FixtureRoot
    Assert 'a second -Fix exits 0 and changes nothing' (($r2.Exit -eq 0) -and ($before -eq $after)) $r2.Out

    $f = New-Fixture
    $row = Get-Row $f 'surreptakos/osh-rfp'
    & git -C $row.Path config --unset core.hooksPath
    $r = Invoke-Check $f
    Assert 'a commit gate off is a STOP' (($r.Exit -eq 1) -and ($r.Out -match 'STOP  surreptakos/osh-rfp .* commit gate off')) $r.Out
    $r = Invoke-Check $f -Fix
    Assert '-Fix turns it on' (($r.Exit -eq 0) -and ((& git -C $row.Path config --get core.hooksPath) -eq '.githooks')) $r.Out
    & git -C $row.Path config core.hooksPath (Join-Path $row.Path '.githooks')
    $r = Invoke-Check $f
    Assert 'an absolute core.hooksPath to the clone''s .githooks counts as on' `
        (($r.Exit -eq 0) -and ($r.Out -match 'ok    surreptakos/osh-rfp ')) $r.Out

    $f = New-Fixture
    $row = Get-Row $f 'surreptakos/brazil-flights'
    & git -C $row.Path remote set-url origin 'https://github.com/someone/else.git'
    $r = Invoke-Check $f -Fix
    Assert 'a wrong origin is a STOP, even with -Fix' `
        (($r.Exit -eq 1) -and ($r.Out -match 'STOP  surreptakos/brazil-flights .* origin is https://github.com/someone/else.git')) $r.Out

    $f = New-Fixture
    $row = Get-Row $f 'surreptakos/aac-routines'
    Remove-TrustRecord $f $row.Path
    $r = Invoke-Check $f
    Assert 'a missing trust record is a STOP' (($r.Exit -eq 1) -and ($r.Out -match 'STOP  surreptakos/aac-routines .* has no Claude trust record')) $r.Out
    $r = Invoke-Check $f -Fix
    Assert '-Fix writes it through settings-invariants -Trust' `
        (($r.Exit -eq 0) -and ((Get-TrustRecord $f $row.Path).hasTrustDialogAccepted -eq $true)) $r.Out

    Write-Host 'Projects: anchor and watchdog'
    $f = New-Fixture
    Write-Utf8NoBom (Join-Path $f.Stubs 'computer-name') 'AAC-AI'
    $r = Invoke-Check $f
    Assert 'on the anchor a missing watchdog task is a STOP' `
        (($r.Exit -eq 1) -and ($r.Out -match 'ok    AAC-AI is the anchor PC') -and ($r.Out -match 'STOP  watchdog task missing on the anchor')) $r.Out
    $r = Invoke-Check $f -Fix
    Assert '-Fix on the anchor installs it and says so' `
        ((Test-Path (Join-Path $f.Stubs 'watchdog-installed')) -and ($r.Out -match 'ok    watchdog task installed by -Fix \(was missing\)')) $r.Out

    $f = New-Fixture
    Write-Utf8NoBom (Join-Path $f.Stubs 'watchdog-state') 'enabled'
    $r = Invoke-Check $f
    Assert 'off the anchor an enabled watchdog task is a STOP' `
        (($r.Exit -eq 1) -and ($r.Out -match 'ok    FIXTURE-PC is not the anchor PC \(the anchor is AAC-AI\)') -and
         ($r.Out -match 'STOP  watchdog task enabled on a PC that is not the anchor')) $r.Out
    $r = Invoke-Check $f -Fix
    Assert '-Fix off the anchor disables it and says so' `
        (($r.Exit -eq 0) -and (Test-Path (Join-Path $f.Stubs 'watchdog-disabled')) -and
         ($r.Out -match 'ok    watchdog task disabled by -Fix')) $r.Out

    Write-Host 'Projects: routine audit'
    $f = New-Fixture
    $ids = @(([System.IO.File]::ReadAllText((Join-Path $f.Home '.claude\accounts.json')) | ConvertFrom-Json).routines.PSObject.Properties | ForEach-Object { $_.Name })
    $regFile = Set-Routines $f @($ids | Select-Object -Skip 1)
    $hash = (Get-FileHash $regFile).Hash
    Write-Utf8NoBom (Join-Path $f.Stubs 'computer-name') 'AAC-AI'
    Write-Utf8NoBom (Join-Path $f.Stubs 'watchdog-state') 'enabled'
    $r = Invoke-Check $f -Fix
    Assert 'on the anchor a routine missing from the registry is reported by name' `
        ($r.Out -match ('!!    1 of {0} desktop routines not registered here: {1}' -f $ids.Count, [regex]::Escape($ids[0]))) $r.Out
    Assert 'the registry file is not written' ((Get-FileHash $regFile).Hash -eq $hash)

    $f = New-Fixture
    $regFile = Set-Routines $f @($ids[0])
    $hash = (Get-FileHash $regFile).Hash
    $r = Invoke-Check $f -Fix
    Assert 'off the anchor a live routine is reported by name' `
        ($r.Out -match ('!!    1 desktop routines live on a PC that is not the anchor: {0}' -f [regex]::Escape($ids[0]))) $r.Out
    Assert 'its to-do is the /setup-check skill' (Test-Todo $r.Out '/setup-check') $r.Out
    Assert 'the registry file is not written' ((Get-FileHash $regFile).Hash -eq $hash)

    Write-Host 'Machine probes in a fake home'
    $f = New-Fixture
    $r = Invoke-Check $f -NoStubs
    Assert 'a fake home with no stubs exits 0' ($r.Exit -eq 0) $r.Out
    $skipped = @([regex]::Matches($r.Out, '(?m)^  --    .*machine probe skipped')).Count
    Assert 'every machine probe is reported skipped (5 tools, PyYAML, master plugin version, claude -p, 3 logins, anchor)' ($skipped -eq 12) ("skipped lines: $skipped`n" + $r.Out)
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
