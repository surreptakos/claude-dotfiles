<#
.SYNOPSIS
    The setup check: inspect this PC's local build and print what is missing (issue 1068).

.DESCRIPTION
    Inspects the layers of a local build (CONTEXT.md) one heading at a time and reports each
    line in session-check's vocabulary:

        ok    the thing is there and works
        !!    worth knowing, blocks nothing
        STOP  broken; a numbered owner to-do below says what to run
        --    not checked, and why

    This slice covers two layers:

      Prerequisites  git, node, py, claude, gh on PATH; PyYAML importable by py -3.
      Credentials    the service account key and the OAuth client secret under ~/.config exist
                     and parse as JSON; the GitHub, Claude and gas logins answer a live probe.

    Without -Fix it only reports. With -Fix it first applies the fixes that are safe to repeat
    (this slice: pip-install PyYAML), then reports. Whatever only the owner can do - install a
    binary, copy a secret file, log in - becomes a numbered to-do with the exact command.

    No secret value is ever printed: the secret files are parsed, never echoed, and a parse
    error is reported by file name alone because the parser's message can quote the content.
    Probe output is discarded for the same reason (gas whoami names the account).

    Machine probes - anything that asks the machine rather than reading the home: PATH lookups,
    py, the three login probes - run only when -UserHome is this user's real profile. Against any
    other home they are reported as skipped, so the restore test can drive install.ps1 into a fake
    home. A test controls them through SETUP_CHECK_STUBS: a directory holding <probe>.ps1 files,
    each of which replaces that probe and answers with its exit code (0 = pass). Probe names:
    command (arg: the tool name), pyyaml, pyyaml-install, gh-auth, claude-auth, gas-auth.

    Exit 0 when no STOP remains, 1 when one does, 2 when the check itself could not run.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File setup-check.ps1
    powershell -ExecutionPolicy Bypass -File setup-check.ps1 -Fix
#>
[CmdletBinding()]
param(
    [string]$UserHome = '',
    [switch]$Fix
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RealHome = [Environment]::GetFolderPath('UserProfile')
if (-not $RealHome) { $RealHome = $env:USERPROFILE }
if (-not $UserHome) { $UserHome = $RealHome }
$UserHome = $UserHome.TrimEnd('\', '/')

# The files the owner copies by hand. The OAuth client's file name carries a per-client suffix,
# so it is matched by the stable prefix; any one match that parses is enough.
$ServiceKeyName  = 'gpt-sheets-access-475817-853f8648243b.json'
$OAuthClientGlob = 'client_secret_594980791877-*.json'
$GasCli          = Join-Path (Join-Path (Join-Path $RepoRoot 'gas') 'cli') 'gas.js'

# Exact command for each missing binary. Owner-only: installing software is not a safe repeat.
$InstallCommands = [ordered]@{
    git    = 'winget install --id Git.Git -e'
    node   = 'winget install --id OpenJS.NodeJS.LTS -e'
    py     = 'winget install --id Python.Python.3.12 -e'
    claude = 'irm https://claude.ai/install.ps1 | iex'
    gh     = 'winget install --id GitHub.cli -e'
}

$script:Stops = 0
$script:Warns = 0
$script:Todo  = New-Object System.Collections.ArrayList

function Write-Line {
    param([ValidateSet('ok', 'warn', 'stop', 'skip')][string]$Level, [string]$Text)
    switch ($Level) {
        'ok'   { Write-Host ('  ok    {0}' -f $Text) -ForegroundColor Green }
        'warn' { $script:Warns++; Write-Host ('  !!    {0}' -f $Text) -ForegroundColor Yellow }
        'stop' { $script:Stops++; Write-Host ('  STOP  {0}' -f $Text) -ForegroundColor Red }
        'skip' { Write-Host ('  --    {0}' -f $Text) -ForegroundColor DarkGray }
    }
}

function Add-Todo {
    param([string]$Text, [string[]]$Commands = @())
    [void]$script:Todo.Add([pscustomobject]@{ Text = $Text; Commands = $Commands })
}

function Test-SamePath {
    param([string]$A, [string]$B)
    try {
        $fa = [System.IO.Path]::GetFullPath($A).TrimEnd('\', '/')
        $fb = [System.IO.Path]::GetFullPath($B).TrimEnd('\', '/')
        return [string]::Equals($fa, $fb, [System.StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

# Run a native command for its exit code only. Output is discarded (it can name an account), and
# $ErrorActionPreference drops to Continue so a 5.1 stderr line is not a terminating error.
function Invoke-NativeExit {
    param([string]$File, [string[]]$Arguments = @())
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $File @Arguments *> $null
        return [int]$LASTEXITCODE
    } catch {
        return 127
    } finally { $ErrorActionPreference = $prev }
}

$StubDir = $env:SETUP_CHECK_STUBS
if ($StubDir -and -not (Test-Path -LiteralPath $StubDir -PathType Container)) { $StubDir = $null }
$MachineProbes = Test-SamePath $UserHome $RealHome

# One probe: the stub when the test supplies one, else the real thing on the real profile, else
# $null (skipped). Returns the exit code, 0 = pass.
function Invoke-Probe {
    param([string]$Name, [scriptblock]$Real, [string[]]$Arguments = @())
    if ($StubDir) {
        $stub = Join-Path $StubDir ($Name + '.ps1')
        if (Test-Path -LiteralPath $stub) {
            $prev = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                $global:LASTEXITCODE = 0
                & $stub @Arguments *> $null
                return [int]$global:LASTEXITCODE
            } catch {
                return 1
            } finally { $ErrorActionPreference = $prev }
        }
    }
    if (-not $MachineProbes) { return $null }
    return [int](& $Real @Arguments)
}

$SkipReason = 'machine probe skipped: -UserHome is not this user''s profile'

# ------------------------------------------------------------------ prerequisites

function Test-Prerequisites {
    Write-Host 'Prerequisites'
    $found = @{}
    foreach ($tool in $InstallCommands.Keys) {
        $code = Invoke-Probe -Name 'command' -Arguments @($tool) -Real {
            param($t)
            if (Get-Command $t -CommandType Application -ErrorAction SilentlyContinue) { 0 } else { 1 }
        }
        if ($null -eq $code) {
            Write-Line skip ('{0}  ({1})' -f $tool, $SkipReason)
            $found[$tool] = $null
        } elseif ($code -eq 0) {
            Write-Line ok $tool
            $found[$tool] = $true
        } else {
            Write-Line stop ('{0} not found on PATH' -f $tool)
            Add-Todo ('Install {0}, then open a new terminal:' -f $tool) @($InstallCommands[$tool])
            $found[$tool] = $false
        }
    }

    if ($found['py'] -eq $false) {
        Write-Line skip 'PyYAML  (not probed: py is missing)'
        return $found
    }
    $pyyamlProbe = { Invoke-NativeExit 'py' @('-3', '-c', 'import yaml') }
    $code = Invoke-Probe -Name 'pyyaml' -Real $pyyamlProbe
    if ($null -eq $code) {
        Write-Line skip ('PyYAML  ({0})' -f $SkipReason)
    } elseif ($code -eq 0) {
        Write-Line ok 'PyYAML'
    } elseif (-not $Fix) {
        Write-Line stop 'PyYAML is not importable by py -3  (-Fix installs it)'
        Add-Todo 'Install PyYAML (or re-run the setup check with -Fix):' @('py -3 -m pip install PyYAML')
    } else {
        $installed = Invoke-Probe -Name 'pyyaml-install' -Real { Invoke-NativeExit 'py' @('-3', '-m', 'pip', 'install', 'PyYAML') }
        $after = $null
        if ($installed -eq 0) { $after = Invoke-Probe -Name 'pyyaml' -Real $pyyamlProbe }
        if ($after -eq 0) {
            Write-Line ok 'PyYAML  (installed by -Fix)'
        } else {
            Write-Line stop 'PyYAML is not importable by py -3, and pip install PyYAML failed'
            Add-Todo 'Install PyYAML by hand and read pip''s error:' @('py -3 -m pip install PyYAML')
        }
    }
    return $found
}

# ------------------------------------------------------------------ credentials

# True when the file parses as JSON. The parse error is swallowed on purpose: its message can
# quote the file's content, which is the secret.
function Test-JsonFile {
    param([string]$Path)
    try {
        $text = [System.IO.File]::ReadAllText($Path)
        if (-not $text.Trim()) { return $false }
        $null = $text | ConvertFrom-Json
        return $true
    } catch { return $false }
}

function Test-SecretFile {
    param([string]$Label, [string]$Dir, [string]$Pattern)
    $want = Join-Path $Dir $Pattern
    $copyTodo = ('Copy the {0} to {1} over a secure channel (password manager or encrypted drive), never email and never a repo.' -f $Label, $want)
    $hits = @()
    if (Test-Path -LiteralPath $Dir -PathType Container) {
        $hits = @(Get-ChildItem -LiteralPath $Dir -File -Filter $Pattern -ErrorAction SilentlyContinue)
    }
    if ($hits.Count -eq 0) {
        Write-Line stop ('{0} missing  ({1})' -f $Label, $want)
        Add-Todo $copyTodo
        return
    }
    $good = @($hits | Where-Object { Test-JsonFile $_.FullName })
    if ($good.Count -gt 0) {
        Write-Line ok ('{0}  ({1} parses as JSON)' -f $Label, $good[0].FullName)
    } else {
        Write-Line stop ('{0} does not parse as JSON  ({1})' -f $Label, (($hits | ForEach-Object { $_.Name }) -join ', '))
        Add-Todo ('Replace the damaged {0}: {1}' -f $Label, $copyTodo)
    }
}

function Test-Login {
    param([string]$Label, [string]$Probe, [string]$Needs, $Found, [scriptblock]$Real,
          [string]$TodoText, [string[]]$Commands)
    if ($Found.ContainsKey($Needs) -and $Found[$Needs] -eq $false) {
        Write-Line skip ('{0}  (not probed: {1} is missing)' -f $Label, $Needs)
        return
    }
    $code = Invoke-Probe -Name $Probe -Real $Real
    if ($null -eq $code) {
        Write-Line skip ('{0}  ({1})' -f $Label, $SkipReason)
    } elseif ($code -eq 0) {
        Write-Line ok ('{0} answers' -f $Label)
    } else {
        Write-Line stop ('{0} is missing or expired' -f $Label)
        Add-Todo $TodoText $Commands
    }
}

function Test-Credentials {
    param($Found)
    Write-Host 'Credentials'
    $configDir = Join-Path $UserHome '.config'
    Test-SecretFile 'service account key' $configDir $ServiceKeyName
    Test-SecretFile 'OAuth client secret' $configDir $OAuthClientGlob

    Test-Login -Label 'GitHub login (gh auth status)' -Probe 'gh-auth' -Needs 'gh' -Found $Found `
        -Real { Invoke-NativeExit 'gh' @('auth', 'status') } `
        -TodoText 'Log in to GitHub:' -Commands @('gh auth login')
    Test-Login -Label 'Claude login (claude auth status)' -Probe 'claude-auth' -Needs 'claude' -Found $Found `
        -Real { Invoke-NativeExit 'claude' @('auth', 'status') } `
        -TodoText 'Log in to Claude in a terminal, then type /login at its prompt:' -Commands @('claude')
    Test-Login -Label 'gas login (gas whoami)' -Probe 'gas-auth' -Needs 'node' -Found $Found `
        -Real { Invoke-NativeExit 'node' @($GasCli, 'whoami') } `
        -TodoText 'Log in to Google for Apps Script (once per Google account):' `
        -Commands @(('node "{0}" login' -f $GasCli))
}

# ------------------------------------------------------------------ report

try {
    if (-not (Test-Path -LiteralPath $UserHome -PathType Container)) {
        Write-Host ('Setup check could not run: -UserHome {0} is not a directory.' -f $UserHome) -ForegroundColor Red
        exit 2
    }

    $mode = if ($Fix) { 'fix' } else { 'report only' }
    Write-Host ('Setup check  {0}  ({1})' -f $UserHome, $mode)
    if (-not $MachineProbes) { Write-Host ('  {0}' -f $SkipReason) -ForegroundColor DarkGray }
    Write-Host ''

    $found = Test-Prerequisites
    Write-Host ''
    Test-Credentials $found
    Write-Host ''

    Write-Host 'Owner to-do'
    if ($script:Todo.Count -eq 0) {
        Write-Host '  nothing'
    } else {
        $n = 0
        foreach ($item in $script:Todo) {
            $n++
            Write-Host ('  {0}. {1}' -f $n, $item.Text)
            foreach ($c in $item.Commands) { Write-Host ('       {0}' -f $c) }
        }
    }
    Write-Host ''
    Write-Host ('{0} STOP, {1} !!' -f $script:Stops, $script:Warns)
} catch {
    Write-Host ('Setup check could not run: {0}' -f $_.Exception.Message) -ForegroundColor Red
    exit 2
}

if ($script:Stops -gt 0) { exit 1 }
exit 0
