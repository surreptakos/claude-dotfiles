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

    Four layers:

      Prerequisites  git, node, py, claude, gh on PATH; PyYAML importable by py -3.
      Profile        the files pull restores match what the repo would write (compared through
                     the manifest, merges included); the aac-skills plugin is installed at the
                     version master offers (session-check's plugin-version.js compares them);
                     every settings.json hook entry names files that exist; the caveman proxy
                     binary is present, registered to start at logon (HKCU Run CavemanProxy,
                     issue 1110), and a terminal `claude -p` answers through its port.
                     ~/.claude-personal gets the plugin and hook checks when it exists and is
                     never created (issue 1070).
      Credentials    the service account key and the OAuth client secret under ~/.config exist
                     and parse as JSON; the GitHub, Claude and gas logins answer a live probe;
                     TYPESAFE_API_KEY is set (user, machine or this process's environment) and
                     Jev answers a live call with it (issue 1133).
      Projects       every repo in the shared repo list (lib/repos.json) is cloned at its path
                     with the right origin, its commit gate on (core.hooksPath .githooks when the
                     repo has that folder) and its Claude trust record written (by
                     tools/settings-invariants.ps1 -Trust, the one writer of ~/.claude.json). The
                     master watchdog task runs only on the anchor PC. Desktop routines are
                     audited, never written: missing on the anchor, or live elsewhere, is a
                     finding the /setup-check skill acts on (issue 1071).

    Without -Fix it only reports. With -Fix it first applies the fixes that are safe to repeat
    (pip-install PyYAML, run pull on drift, run the desktop caveman install when the wiring is
    broken, the proxy port dead or its logon start missing - the install starts the proxy and
    registers it - clone a missing repo, set a commit gate, write trust records, install the watchdog
    task on the anchor or disable it elsewhere), then reports. Whatever only the owner can do - install a
    binary, copy a secret file, log in - becomes a numbered to-do with the exact command.

    No secret value is ever printed: the secret files are parsed, never echoed, and a parse
    error is reported by file name alone because the parser's message can quote the content.
    Probe output is discarded for the same reason (gas whoami names the account).

    Machine probes - anything that asks the machine rather than reading the home: PATH lookups,
    py, the three login probes - run only when -UserHome is this user's real profile. Against any
    other home they are reported as skipped, so the restore test can drive install.ps1 into a fake
    home. A test controls them through SETUP_CHECK_STUBS: a directory holding <probe>.ps1 files,
    each of which replaces that probe and answers with its exit code (0 = pass). Probe names:
    command (arg: the tool name), pyyaml, pyyaml-install, gh-auth, claude-auth, gas-auth, jev-live,
    caveman-live, caveman-enable, caveman-logon, clone (args: slug, path), watchdog-install, watchdog-disable.
    Text probes print their answer instead: master-plugin-version (the aac-skills version master
    offers), jev-key (where TYPESAFE_API_KEY is set: user, machine, process, or empty when
    unset - never the value), computer-name, watchdog-task (missing, enabled or disabled) and routine-registry
    (the desktop app's scheduled-task registry root).

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
. (Join-Path $RepoRoot 'lib\manifest.ps1')
# A git hook's GIT_DIR would redirect every `git -C <clone>` below (issue 28).
[void](Clear-GitEnv)
$Engine = 'powershell'
try { $Engine = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch { }
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
    if (@($script:Todo | Where-Object { $_.Text -eq $Text }).Count -gt 0) { return }
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

# A probe that answers with text (stdout of the stub or of $Real). $null when skipped, '' when the
# probe ran and could not answer.
function Invoke-ProbeText {
    param([string]$Name, [scriptblock]$Real)
    if ($StubDir) {
        $stub = Join-Path $StubDir ($Name + '.ps1')
        if (Test-Path -LiteralPath $stub) {
            try { return ([string](& $stub 2>$null | Out-String)).Trim() } catch { return '' }
        }
    }
    if (-not $MachineProbes) { return $null }
    return [string](& $Real)
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
    Test-JevKey $Found
}

# The TypeSafe key the ask-matt route gate sends to Jev (issue 1133). Without it every turn opens
# 'route unchecked: Jev unavailable'. The value is never read into this script's output: the key
# probe answers with where the key is set, and the live probe hands it to node through the
# environment only.
$JevJs      = Join-Path (Join-Path $RepoRoot 'tools') 'jev.js'
$JevKeyVar  = 'TYPESAFE_API_KEY'
$JevKeyTodo = ('Set {0} as a Windows user environment variable (not settings.json, not a repo) - the command asks for the key, so it stays out of the shell history - then open a new terminal and restart the Claude app:' -f $JevKeyVar)
$JevKeySet  = ('[Environment]::SetEnvironmentVariable(''{0}'', (Read-Host ''TypeSafe API key''), ''User'')' -f $JevKeyVar)

function Test-JevKey {
    param($Found)
    $source = Invoke-ProbeText -Name 'jev-key' -Real {
        foreach ($scope in @('User', 'Machine')) {
            if ([Environment]::GetEnvironmentVariable($JevKeyVar, $scope)) { return $scope.ToLower() }
        }
        if ([Environment]::GetEnvironmentVariable($JevKeyVar, 'Process')) { return 'process' }
        return ''
    }
    if ($null -eq $source) {
        Write-Line skip ('TypeSafe key ({0})  ({1})' -f $JevKeyVar, $SkipReason)
        Write-Line skip ('Jev live call  ({0})' -f $SkipReason)
        return
    }
    if (-not $source) {
        Write-Line stop ('TypeSafe key missing: {0} is not set, so the route gate reads ''route unchecked: Jev unavailable''' -f $JevKeyVar)
        Add-Todo $JevKeyTodo @($JevKeySet)
        return
    }
    $where = switch ($source) {
        'user'    { 'the Windows user environment' }
        'machine' { 'the Windows machine environment' }
        'process' { 'this process only: not a Windows user or machine variable' }
        default   { $source }
    }
    Write-Line ok ('TypeSafe key ({0}, set in {1})' -f $JevKeyVar, $where)
    if ($Found.ContainsKey('node') -and $Found['node'] -eq $false) {
        Write-Line skip 'Jev live call  (not probed: node is missing)'
        return
    }
    $code = Invoke-Probe -Name 'jev-live' -Real {
        $prev = [Environment]::GetEnvironmentVariable($JevKeyVar, 'Process')
        try {
            if (-not $prev) {
                $key = [Environment]::GetEnvironmentVariable($JevKeyVar, 'User')
                if (-not $key) { $key = [Environment]::GetEnvironmentVariable($JevKeyVar, 'Machine') }
                [Environment]::SetEnvironmentVariable($JevKeyVar, $key, 'Process')
            }
            $js = 'const j=require(process.argv[1]);j.askJev({reply:''ok''},{ok:{type:''noul'',instructions:''Is reply the word ok?''}},{timeoutMs:10000}).then(a=>process.exit(a&&a.ok?0:1))'
            Invoke-NativeExit 'node' @('-e', $js, $JevJs)
        } finally { [Environment]::SetEnvironmentVariable($JevKeyVar, $prev, 'Process') }
    }
    if ($null -eq $code) {
        Write-Line skip ('Jev live call  ({0})' -f $SkipReason)
    } elseif ($code -eq 0) {
        Write-Line ok 'Jev answers a live call'
    } else {
        Write-Line stop ('Jev did not answer a live call with {0}: the key is refused or api.typesafe.ai is unreachable' -f $JevKeyVar)
        Add-Todo ('Replace the TypeSafe key: {0}' -f $JevKeyTodo) @($JevKeySet)
    }
}

# ------------------------------------------------------------------ profile

$PluginId        = 'aac-skills@claude-dotfiles'
$PluginVersionJs = Join-Path (Join-Path (Join-Path $RepoRoot 'aac-skills') 'session-check') 'plugin-version.js'
$ProxyPort       = 8787
$CavemanInstall  = Join-Path (Join-Path $RepoRoot 'tools') 'caveman-desktop-install.ps1'
# The logon start tools/caveman-desktop-install.ps1 registers (issue 1110).
$CavemanRunKey   = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$CavemanRunValue = 'CavemanProxy'

function Test-SameBytes {
    param([string]$A, [string]$B)
    $x = [System.IO.File]::ReadAllBytes($A)
    $y = [System.IO.File]::ReadAllBytes($B)
    return [System.Linq.Enumerable]::SequenceEqual($x, $y)
}

function Get-Node {
    return (Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)
}

# The files a pull would change. Each manifest entry is written to a scratch copy exactly the way
# sync.ps1 writes it - Copy-OneFile, or the node merger over a copy of the live file - and compared
# byte for byte with what is on disk. Returns the local paths that differ.
function Get-PullDrift {
    $drift = New-Object System.Collections.ArrayList
    $node = Get-Node
    $scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('setup-check-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $scratch -Force | Out-Null
    $tmp = { Join-Path $scratch ([guid]::NewGuid().ToString('N') + '.tmp') }
    $differs = {
        param([string]$Source, [string]$Local)
        if (-not (Test-Path -LiteralPath $Local -PathType Leaf)) { return $true }
        $expected = & $tmp
        Copy-OneFile -Source $Source -Destination $expected -Direction Detokenize -UserHome $UserHome
        return (-not (Test-SameBytes $expected $Local))
    }
    try {
        foreach ($item in (Get-DotfileItems -RepoRoot $RepoRoot -UserHome $UserHome)) {
            $source = Join-Path $RepoRoot ($item.Repo -replace '/', '\')
            if (-not (Test-Path -LiteralPath $source)) { continue }
            if ($item.Type -eq 'Dir') {
                foreach ($f in @(Get-ChildItem -LiteralPath $source -Recurse -File)) {
                    $rel = $f.FullName.Substring($source.Length).TrimStart('\', '/')
                    if (Test-Excluded -RelativePath $rel) { continue }
                    $local = Join-Path $item.Local $rel
                    if (& $differs $f.FullName $local) { [void]$drift.Add($local) }
                }
            } elseif ($item.PSObject.Properties['Merge'] -and (Test-Path -LiteralPath $item.Local)) {
                if (-not $node) { continue }
                $committed = & $tmp
                $merged    = & $tmp
                Copy-OneFile -Source $source -Destination $committed -Direction Detokenize -UserHome $UserHome
                Copy-Item -LiteralPath $item.Local -Destination $merged -Force
                if ($item.Merge -eq 'settings') {
                    $mergeArgs = @((Join-Path $RepoRoot 'tools\settings-caveman-merge.js'), $committed, $merged)
                } else {
                    $mergeArgs = @((Join-Path $RepoRoot 'tools\plugin-records-merge.js'), $item.Merge, $committed, $merged)
                }
                # A failed merge leaves the live file alone in pull too, so it is not drift.
                $code = Invoke-NativeExit $node.Source $mergeArgs
                if ($code -eq 0 -and -not (Test-SameBytes $merged $item.Local)) { [void]$drift.Add($item.Local) }
            } elseif (& $differs $source $item.Local) {
                [void]$drift.Add($item.Local)
            }
        }
    } finally {
        Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }
    return ,$drift
}

function Test-PullDrift {
    $pullCommand = ('powershell -ExecutionPolicy Bypass -File "{0}" -Mode pull' -f (Join-Path $RepoRoot 'sync.ps1'))
    $drift = Get-PullDrift
    $pullExit = $null
    if ($drift.Count -gt 0 -and $Fix) {
        $pullExit = Invoke-NativeExit $Engine @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            (Join-Path $RepoRoot 'sync.ps1'), '-Mode', 'pull', '-UserHome', $UserHome)
        $drift = Get-PullDrift
    }
    if ($drift.Count -eq 0) {
        $how = if ($null -ne $pullExit) { '  (pull ran under -Fix)' } else { '' }
        Write-Line ok ('profile matches the repo{0}' -f $how)
        return
    }
    $shown = (@($drift | Select-Object -First 3) -join ', ')
    if ($drift.Count -gt 3) { $shown += (', and {0} more' -f ($drift.Count - 3)) }
    if ($null -ne $pullExit) {
        Write-Line stop ('profile still differs from the repo after pull (exit {0}): {1}' -f $pullExit, $shown)
        Add-Todo 'Run pull by hand and read its output:' @($pullCommand)
    } else {
        Write-Line stop ('profile differs from the repo  (-Fix runs pull): {0}' -f $shown)
        Add-Todo 'Run pull (or re-run the setup check with -Fix):' @($pullCommand)
    }
}

# The aac-skills version master offers, read off origin/master after a fetch (the checkout's own
# manifest can be behind). $null when skipped, '' when it could not be read.
function Get-OfferedPluginVersion {
    return Invoke-ProbeText -Name 'master-plugin-version' -Real {
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & git -C $RepoRoot fetch -q origin master *> $null
            $text = & git -C $RepoRoot show 'origin/master:.claude-plugin/marketplace.json' 2>$null | Out-String
            if ($LASTEXITCODE -ne 0) { return '' }
            $hit = @(($text | ConvertFrom-Json).plugins | Where-Object { $_.name -eq 'aac-skills' })
            if ($hit.Count -gt 0) { return [string]$hit[0].version }
            return ''
        } catch { return '' } finally { $ErrorActionPreference = $prev }
    }
}

function Test-Plugin {
    # -Optional: the personal profile is optional (spec 1066), so a gap there is !! not STOP.
    param([string]$ProfileDir, $Offered, [switch]$Optional)
    $file = Join-Path $ProfileDir 'plugins\installed_plugins.json'
    $installed = $null
    try {
        $data = [System.IO.File]::ReadAllText($file) | ConvertFrom-Json
        $entry = @($data.plugins.$PluginId)
        if ($entry.Count -gt 0 -and $entry[0]) { $installed = [string]$entry[0].version }
    } catch { }
    if (-not $installed) {
        $level = if ($Optional) { 'warn' } else { 'stop' }
        Write-Line $level ('aac-skills plugin not installed  ({0} names no {1})' -f $file, $PluginId)
        Add-Todo 'Install the aac-skills plugin, then restart the Claude app:' @(('claude plugin install {0}' -f $PluginId))
        return
    }
    if ($null -eq $Offered) {
        Write-Line skip ('aac-skills plugin {0} installed; master''s version not read  ({1})' -f $installed, $SkipReason)
        return
    }
    if (-not $Offered) {
        Write-Line warn ('aac-skills plugin {0} installed; master''s version could not be read' -f $installed)
        return
    }
    # session-check's comparison, not a second copy of it.
    $cmp = ''
    $node = Get-Node
    if ($node) {
        $js = 'const {compareVersions}=require(process.argv[1]);process.stdout.write(String(compareVersions(process.argv[2],process.argv[3])))'
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { $cmp = [string](& $node.Source -e $js $PluginVersionJs $installed $Offered 2>$null) } catch { }
        finally { $ErrorActionPreference = $prev }
    }
    if ($cmp -eq 'behind') {
        Write-Line warn ('aac-skills plugin is stale: installed {0}, master offers {1}' -f $installed, $Offered)
        Add-Todo 'Restart the Claude app: the claude-dotfiles marketplace auto-updates aac-skills at the next session start.'
    } elseif ($cmp) {
        Write-Line ok ('aac-skills plugin {0}  (master offers {1})' -f $installed, $Offered)
    } else {
        Write-Line warn ('aac-skills plugin {0} installed; could not compare it with master''s {1}' -f $installed, $Offered)
    }
}

# Every absolute path a hook command names - quoted or bare, drive-rooted or ~ (expanded to
# $UserHome). Returns { Event; Path } objects.
function Get-HookPaths {
    param([string]$SettingsPath)
    $out = @()
    if (-not (Test-Path -LiteralPath $SettingsPath)) { return $out }
    $json = [System.IO.File]::ReadAllText($SettingsPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    if (-not $json.PSObject.Properties['hooks'] -or $null -eq $json.hooks) { return $out }
    foreach ($ev in @($json.hooks.PSObject.Properties)) {
        foreach ($group in @($ev.Value)) {
            if (-not $group -or -not $group.PSObject.Properties['hooks']) { continue }
            foreach ($h in @($group.hooks)) {
                if (-not $h -or -not $h.PSObject.Properties['command']) { continue }
                foreach ($m in [regex]::Matches([string]$h.command, '''([^'']*)''|"([^"]*)"|(\S+)')) {
                    $v = @($m.Groups[1].Value, $m.Groups[2].Value, $m.Groups[3].Value) | Where-Object { $_ } | Select-Object -First 1
                    if (-not $v) { continue }
                    if ($v -match '^~[\\/]') { $v = Join-Path $UserHome $v.Substring(2) }
                    elseif ($v -notmatch '^[A-Za-z]:[\\/]') { continue }
                    $out += [pscustomobject]@{ Event = $ev.Name; Path = $v }
                }
            }
        }
    }
    return $out
}

function Get-DeadHookPaths {
    param([string]$SettingsPath)
    return @(Get-HookPaths $SettingsPath | Where-Object { -not (Test-Path -LiteralPath $_.Path) })
}

function Test-HookPaths {
    param([string]$SettingsPath, [string]$InstallCommand)
    $dead = @(Get-DeadHookPaths $SettingsPath)
    if ($dead.Count -eq 0) {
        Write-Line ok ('every settings.json hook names files that exist  ({0})' -f $SettingsPath)
        return
    }
    foreach ($d in $dead) {
        Write-Line stop ('{0} hook names a missing file: {1}  ({2})' -f $d.Event, $d.Path, $SettingsPath)
    }
    Add-Todo ('Repair or remove the hook entries above in {0}; for a caveman entry, run the caveman install:' -f $SettingsPath) @($InstallCommand)
}

# 0 when the proxy port answers AND a terminal claude -p answers; 1 when the port is closed; 2 when
# the port answers but claude -p does not (an expired terminal login fails here too).
function Test-CavemanLive {
    return Invoke-Probe -Name 'caveman-live' -Real {
        $tcp = New-Object System.Net.Sockets.TcpClient
        try { $tcp.Connect('127.0.0.1', $ProxyPort) } catch { return 1 } finally { $tcp.Close() }
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $answer = & claude -p 'reply ok' 2>$null | Out-String
            if ($LASTEXITCODE -eq 0 -and $answer.Trim()) { return 0 }
            return 2
        } catch { return 2 } finally { $ErrorActionPreference = $prev }
    }
}

# 0 when the HKCU Run entry that starts the proxy at logon names this proxy binary, else 1.
function Test-CavemanLogon {
    param([string]$ProxyExe)
    return Invoke-Probe -Name 'caveman-logon' -Arguments @($ProxyExe) -Real {
        param($exe)
        try {
            $value = [string](Get-ItemProperty -LiteralPath $CavemanRunKey -Name $CavemanRunValue -ErrorAction Stop).$CavemanRunValue
        } catch { return 1 }
        if ($value.IndexOf($exe.Replace("'", "''"), [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { 0 } else { 1 }
    }
}

function Test-Caveman {
    param([string]$InstallCommand)
    $settings = Join-Path $UserHome '.claude\settings.json'
    $proxyExe = Join-Path $UserHome '.caveman\bin\caveman-proxy.exe'

    $live = Test-CavemanLive
    $logon = $null
    if (Test-Path -LiteralPath $proxyExe) { $logon = Test-CavemanLogon $proxyExe }
    $broken = (-not (Test-Path -LiteralPath $proxyExe)) -or ($null -ne $live -and $live -ne 0) -or
              ($null -ne $logon -and $logon -ne 0) -or (@(Get-DeadHookPaths $settings).Count -gt 0)
    $note = ''
    if ($broken -and $Fix) {
        # tools/caveman-desktop-install.ps1 runs `caveman enable claude`, or strips dead wiring.
        $code = Invoke-Probe -Name 'caveman-enable' -Real {
            Invoke-NativeExit $Engine @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $CavemanInstall,
                '-UserHome', $UserHome, '-RepoRoot', $RepoRoot)
        }
        if ($null -ne $code) {
            $note = '  (after -Fix ran the caveman install)'
            $live = Test-CavemanLive
            $logon = $null
            if (Test-Path -LiteralPath $proxyExe) { $logon = Test-CavemanLogon $proxyExe }
        }
    }

    if (Test-Path -LiteralPath $proxyExe) {
        Write-Line ok ('caveman proxy binary  ({0})' -f $proxyExe)
    } else {
        Write-Line warn ('caveman proxy binary missing  ({0}){1}' -f $proxyExe, $note)
        Add-Todo 'Install caveman (or re-run the setup check with -Fix):' @($InstallCommand)
    }
    if (-not (Test-Path -LiteralPath $proxyExe)) {
        Write-Line skip 'caveman proxy logon start  (not probed: the proxy binary is missing)'
    } elseif ($null -eq $logon) {
        Write-Line skip ('caveman proxy logon start  ({0})' -f $SkipReason)
    } elseif ($logon -eq 0) {
        Write-Line ok ('caveman proxy starts at logon  ({0} {1})' -f $CavemanRunKey, $CavemanRunValue)
    } else {
        Write-Line stop ('caveman proxy is not registered to start at logon, so port {0} goes dead after a reboot{1}' -f $ProxyPort, $note)
        Add-Todo 'Register the caveman proxy to start at logon: the caveman install writes the HKCU Run entry (or re-run the setup check with -Fix):' @($InstallCommand)
    }
    Test-HookPaths $settings $InstallCommand
    if ($null -eq $live) {
        Write-Line skip ('claude -p through the caveman proxy  ({0})' -f $SkipReason)
    } elseif ($live -eq 0) {
        Write-Line ok ('claude -p answers, proxy port {0} answering' -f $ProxyPort)
    } elseif ($live -eq 2) {
        Write-Line stop ('proxy port {0} answers, but a terminal claude -p did not (see the Claude login under Credentials){1}' -f $ProxyPort, $note)
        Add-Todo 'Log in to Claude in a terminal, then type /login at its prompt:' @('claude')
    } else {
        Write-Line stop ('caveman proxy port {0} does not answer, so claude -p cannot{1}' -f $ProxyPort, $note)
        if (Test-Path -LiteralPath $proxyExe) {
            # Issue 1110: the install starts the proxy and registers it at logon; Start-Process starts
            # it now (PR 1127); when it still does not listen, the proxy itself exits, and only
            # running it in a terminal shows why.
            Add-Todo ('Start the caveman proxy: the caveman install starts it and registers it at logon, or start it directly; if port {0} still does not answer, run the proxy in a terminal and read why it exits:' -f $ProxyPort) @(
                $InstallCommand,
                ('powershell -Command "Start-Process ''{0}'' -WindowStyle Hidden"' -f $proxyExe),
                ('& "{0}"' -f $proxyExe))
        } else {
            Add-Todo 'Install caveman - the install also starts its proxy - then check that a terminal claude -p "reply ok" answers:' @($InstallCommand)
        }
    }
}

function Test-Profile {
    Write-Host 'Profile'
    $installCommand = ('powershell -ExecutionPolicy Bypass -File "{0}" -UserHome "{1}" -RepoRoot "{2}"' -f $CavemanInstall, $UserHome, $RepoRoot)
    Test-PullDrift
    $offered = Get-OfferedPluginVersion
    Test-Plugin (Join-Path $UserHome '.claude') $offered
    Test-Caveman $installCommand

    # Pull refreshes the personal profile from ~/.claude, so drift is judged on ~/.claude alone;
    # the plugin and hook checks run here too.
    $personal = Join-Path $UserHome '.claude-personal'
    if (-not (Test-Path -LiteralPath $personal -PathType Container)) {
        Write-Line skip '~/.claude-personal  (absent: skipped, never created)'
        return
    }
    Write-Host '  ~/.claude-personal'
    Test-Plugin $personal $offered -Optional
    Test-HookPaths (Join-Path $personal 'settings.json') $installCommand
}

# ------------------------------------------------------------------ projects

$WatchdogTask     = 'Claude master watchdog'
$WatchdogInstall  = Join-Path (Join-Path $RepoRoot 'orchestrator') 'install-watchdog-task.ps1'
$TrustWriter      = Join-Path (Join-Path $RepoRoot 'tools') 'settings-invariants.ps1'
$IdentityJs       = Join-Path (Join-Path (Join-Path $RepoRoot 'aac-skills') 'session-check') 'identity.js'

# git for its output and exit code, stderr dropped. Returns @{ Code; Out }.
function Invoke-Git {
    param([string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git @Arguments 2>$null | Out-String
        return [pscustomobject]@{ Code = [int]$LASTEXITCODE; Out = $out.Trim() }
    } catch {
        return [pscustomobject]@{ Code = 127; Out = '' }
    } finally { $ErrorActionPreference = $prev }
}

# ~/.claude.json's project keys with hasTrustDialogAccepted true, lower-cased.
function Get-TrustedPaths {
    $trusted = @{}
    $file = Join-Path $UserHome '.claude.json'
    if (-not (Test-Path -LiteralPath $file)) { return $trusted }
    try {
        $state = [System.IO.File]::ReadAllText($file) | ConvertFrom-Json
        if ($state.PSObject.Properties['projects'] -and $state.projects) {
            foreach ($p in @($state.projects.PSObject.Properties)) {
                if ($p.Value -and $p.Value.PSObject.Properties['hasTrustDialogAccepted'] -and
                    $p.Value.hasTrustDialogAccepted -eq $true) { $trusted[$p.Name.ToLowerInvariant()] = $true }
            }
        }
    } catch { }
    return $trusted
}

function Test-OriginMatches {
    param([string]$Url, [string]$Slug)
    $m = [regex]::Match($Url, 'github\.com[:/]+([^/\s]+/[^/\s]+?)(?:\.git)?/?$', 'IgnoreCase')
    return ($m.Success -and [string]::Equals($m.Groups[1].Value, $Slug, [System.StringComparison]::OrdinalIgnoreCase))
}

function Test-Clones {
    param($List)
    $cloned = @{}
    foreach ($row in $List.Repos) {
        if (Test-Path -LiteralPath (Join-Path $row.Path '.git')) { continue }
        if (-not $Fix) { continue }
        $cloned[$row.Repo] = Invoke-Probe -Name 'clone' -Arguments @($row.Repo, $row.Path) -Real {
            param($slug, $dest)
            Invoke-NativeExit 'gh' @('repo', 'clone', $slug, $dest)
        }
    }
    # The commit gate, on every clone that has a .githooks folder.
    $gates = @{}
    foreach ($row in $List.Repos) {
        if (-not (Test-Path -LiteralPath (Join-Path $row.Path '.git'))) { continue }
        if (-not (Test-Path -LiteralPath (Join-Path $row.Path '.githooks') -PathType Container)) { continue }
        # Relative or absolute, the gate is on when the value resolves to the clone's .githooks.
        $value = (Invoke-Git @('-C', $row.Path, 'config', '--get', 'core.hooksPath')).Out
        $on = $false
        if ($value) {
            $full = if ([System.IO.Path]::IsPathRooted($value)) { $value } else { Join-Path $row.Path $value }
            $on = Test-SamePath $full (Join-Path $row.Path '.githooks')
        }
        if (-not $on -and $Fix) {
            $on = ((Invoke-Git @('-C', $row.Path, 'config', 'core.hooksPath', '.githooks')).Code -eq 0)
            if ($on) { $gates[$row.Repo] = 'set by -Fix' }
        }
        if (-not $on) { $gates[$row.Repo] = 'off' }
    }
    # Trust records: settings-invariants -Trust is the one writer of ~/.claude.json.
    $trusted = Get-TrustedPaths
    $untrusted = @($List.Repos | Where-Object {
        (Test-Path -LiteralPath (Join-Path $_.Path '.git')) -and -not $trusted.ContainsKey($_.Path.ToLowerInvariant()) })
    $trustWritten = $false
    if ($untrusted.Count -gt 0 -and $Fix) {
        [void](Invoke-NativeExit $Engine @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $TrustWriter,
            '-Trust', '-UserHome', $UserHome))
        $trustWritten = $true
        $trusted = Get-TrustedPaths
    }

    foreach ($row in $List.Repos) {
        $label = '{0}  ({1})' -f $row.Repo, $row.Path
        if (-not (Test-Path -LiteralPath (Join-Path $row.Path '.git'))) {
            $code = if ($cloned.ContainsKey($row.Repo)) { $cloned[$row.Repo] } else { 'report' }
            if ($null -eq $code) {
                Write-Line skip ('{0} not cloned  ({1})' -f $label, $SkipReason)
            } elseif ($code -eq 'report') {
                Write-Line stop ('{0} not cloned  (-Fix clones it)' -f $label)
                Add-Todo ('Clone {0} (or re-run the setup check with -Fix):' -f $row.Repo) @(('gh repo clone {0} "{1}"' -f $row.Repo, $row.Path))
            } else {
                Write-Line stop ('{0} not cloned: gh repo clone exited {1}' -f $label, $code)
                Add-Todo ('Clone {0} by hand and read the error:' -f $row.Repo) @(('gh repo clone {0} "{1}"' -f $row.Repo, $row.Path))
            }
            continue
        }
        $problems = 0
        # The configured URL, not `remote get-url`: that applies url.*.insteadOf rewrites, which can
        # splice a token into what this line would print.
        $origin = (Invoke-Git @('-C', $row.Path, 'config', '--get', 'remote.origin.url')).Out
        if (-not (Test-OriginMatches $origin $row.Repo)) {
            $problems++
            Write-Line stop ('{0} origin is {1}, not {2}' -f $label, $(if ($origin) { $origin } else { 'unset' }), $row.Repo)
            Add-Todo ('Point {0} at its GitHub repo:' -f $row.Path) @(('git -C "{0}" remote set-url origin https://github.com/{1}.git' -f $row.Path, $row.Repo))
        }
        if ($gates[$row.Repo] -eq 'off') {
            $problems++
            Write-Line stop ('{0} commit gate off: core.hooksPath is not .githooks  (-Fix sets it)' -f $label)
            Add-Todo ('Turn on the commit gate in {0} (or re-run with -Fix):' -f $row.Path) @(('git -C "{0}" config core.hooksPath .githooks' -f $row.Path))
        }
        if (-not $trusted.ContainsKey($row.Path.ToLowerInvariant())) {
            $problems++
            $how = if ($trustWritten) { 'after -Fix ran the trust writer' } else { '-Fix writes it' }
            Write-Line stop ('{0} has no Claude trust record  ({1})' -f $label, $how)
            Add-Todo 'Write the trust records (or re-run with -Fix):' @(('powershell -ExecutionPolicy Bypass -File "{0}" -Trust' -f $TrustWriter))
        }
        if ($problems -eq 0) {
            $notes = @()
            if ($cloned.ContainsKey($row.Repo)) { $notes += 'cloned by -Fix' }
            if ($gates.ContainsKey($row.Repo)) { $notes += 'commit gate set by -Fix' }
            $suffix = if ($notes.Count -gt 0) { '  [' + ($notes -join ', ') + ']' } else { '' }
            Write-Line ok ('{0}{1}' -f $label, $suffix)
        }
    }
}

# 'missing', 'enabled' or 'disabled'; $null when skipped.
function Get-WatchdogState {
    return Invoke-ProbeText -Name 'watchdog-task' -Real {
        $t = Get-ScheduledTask -TaskName $WatchdogTask -ErrorAction SilentlyContinue
        if (-not $t) { return 'missing' }
        if ([string]$t.State -eq 'Disabled') { return 'disabled' }
        return 'enabled'
    }
}

function Test-Anchor {
    param($List)
    $pc = Invoke-ProbeText -Name 'computer-name' -Real { $env:COMPUTERNAME }
    if ($null -eq $pc) {
        Write-Line skip ('anchor PC, watchdog task, desktop routines  ({0})' -f $SkipReason)
        return
    }
    $anchor = [string]::Equals($pc, $List.Anchor, [System.StringComparison]::OrdinalIgnoreCase)
    if ($anchor) { Write-Line ok ('{0} is the anchor PC' -f $pc) }
    else { Write-Line ok ('{0} is not the anchor PC (the anchor is {1})' -f $pc, $List.Anchor) }

    $state = Get-WatchdogState
    if ($anchor -and $state -ne 'enabled' -and $Fix) {
        [void](Invoke-Probe -Name 'watchdog-install' -Real {
            Invoke-NativeExit $Engine @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $WatchdogInstall, '-Install')
        })
        $after = Get-WatchdogState
        if ($after -eq 'enabled') { Write-Line ok ('watchdog task installed by -Fix (was {0})' -f $state); $state = $null }
        else { $state = $after }
    } elseif (-not $anchor -and $state -eq 'enabled' -and $Fix) {
        [void](Invoke-Probe -Name 'watchdog-disable' -Real { Invoke-NativeExit 'schtasks.exe' @('/Change', '/Disable', '/TN', $WatchdogTask) })
        $after = Get-WatchdogState
        if ($after -eq 'disabled') { Write-Line ok 'watchdog task disabled by -Fix (not the anchor; nothing deleted)'; $state = $null }
        else { $state = $after }
    }
    if ($null -ne $state) {
        if ($anchor -and $state -eq 'enabled') {
            Write-Line ok 'watchdog task enabled'
        } elseif ($anchor) {
            Write-Line stop ('watchdog task {0} on the anchor  (-Fix installs it)' -f $state)
            Add-Todo 'Install the master watchdog task (or re-run with -Fix):' @(('powershell -ExecutionPolicy Bypass -File "{0}" -Install' -f $WatchdogInstall))
        } elseif ($state -eq 'enabled') {
            Write-Line stop 'watchdog task enabled on a PC that is not the anchor  (-Fix disables it)'
            Add-Todo 'Disable the master watchdog task here (or re-run with -Fix):' @(('schtasks /Change /Disable /TN "{0}"' -f $WatchdogTask))
        } else {
            Write-Line ok ('watchdog task {0} (not the anchor)' -f $state)
        }
    }
    Test-Routines $anchor
}

# Report only: the /setup-check skill registers or disables routines through the desktop
# scheduled-tasks tool. Reads the registry through session-check's identity.js; writes nothing.
function Test-Routines {
    param([bool]$Anchor)
    $root = Invoke-ProbeText -Name 'routine-registry' -Real { Join-Path (Join-Path $env:APPDATA 'Claude') 'claude-code-sessions' }
    $node = Get-Node
    if (-not $node) { Write-Line skip 'desktop routines  (not audited: node is missing)'; return }
    $js = 'const id=require(process.argv[1]);const reg=id.loadRegistry({USERPROFILE:process.argv[2]});process.stdout.write(!reg||reg.error?String(null):JSON.stringify(id.routinePresence(reg,process.argv[3])))'
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $raw = [string](& $node.Source -e $js $IdentityJs $UserHome $root 2>$null) } catch { $raw = '' }
    finally { $ErrorActionPreference = $prev }
    $p = $null
    try { $p = $raw | ConvertFrom-Json } catch { }
    if (-not $p) {
        Write-Line warn ('desktop routines not audited: no readable accounts registry under {0}' -f (Join-Path $UserHome '.claude'))
        return
    }
    if ($Anchor) {
        $missing = @($p.missing)
        if ($missing.Count -eq 0) { Write-Line ok ('all {0} registered desktop routines enabled under their owner' -f @($p.registered).Count); return }
        Write-Line warn ('{0} of {1} desktop routines not registered here: {2}' -f $missing.Count, @($p.registered).Count, ($missing -join ', '))
        Add-Todo 'Run /setup-check in a Claude desktop session: it registers the missing routines from aac-routines.'
    } else {
        $live = @($p.live)
        if ($live.Count -eq 0) { Write-Line ok 'no registered desktop routine is live here (not the anchor)'; return }
        Write-Line warn ('{0} desktop routines live on a PC that is not the anchor: {1}' -f $live.Count, ($live -join ', '))
        Add-Todo 'Run /setup-check in a Claude desktop session: it disables these routines (nothing deleted).'
    }
}

function Test-Projects {
    Write-Host 'Projects'
    $list = Read-RepoList -UserHome $UserHome
    Test-Clones $list
    Test-Anchor $list
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
    Test-Profile
    Write-Host ''
    Test-Credentials $found
    Write-Host ''
    Test-Projects
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
