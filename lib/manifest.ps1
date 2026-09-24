# Shared manifest + helpers for sync.ps1 and install.ps1.
# Dot-source this; it defines the whitelist of what travels and the path-templating rules.

Set-StrictMode -Version Latest

# ---------------------------------------------------------------- what travels

# The consumer profile (issue 214). The repo is the source now: a skill is edited on a branch
# under aac-skills/, CI stamps it and rebuilds the plugin, and merge is the release. Sync push,
# the generated claude/ codex/ memory/ mirrors and the skill junctions retired with that; what is
# left is one direction - master -> this machine - and this list is everything it writes.
#
# Every entry is copied by name. Nothing outside this list is ever read or written, which is what
# keeps credentials, transcripts and caches out of the picture in both directions.
function Get-DotfileItems {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$UserHome
    )

    $claude = Join-Path $UserHome '.claude'
    $codex  = Join-Path $UserHome '.codex'
    $docs   = Get-DocumentsPath -UserHome $UserHome

    @(
        # The skill tree itself: one hand-edited source, restored as ~/.claude/skills. The plugin
        # payload under marketplace/ is built from the same tree for cloud containers; a desktop
        # reads the source copy, which keeps this machine's paths rather than the plugin root.
        [pscustomobject]@{ Type = 'Dir';  Repo = 'aac-skills';                              Local = (Join-Path $claude 'skills') }

        [pscustomobject]@{ Type = 'File'; Repo = 'profile/claude/CLAUDE.md';                Local = (Join-Path $claude 'CLAUDE.md') }
        [pscustomobject]@{ Type = 'File'; Repo = 'profile/claude/settings.json';            Local = (Join-Path $claude 'settings.json') }
        # Claude Code's own plugin records (issue 717). A fresh machine needs them to register the
        # marketplaces and name what to install, but `claude plugin update` rewrites them live, so
        # pull MERGES rather than copies (tools/plugin-records-merge.js): a live entry newer than
        # the committed snapshot is kept. Merge names the merger's kind.
        [pscustomobject]@{ Type = 'File'; Repo = 'profile/claude/plugins/installed_plugins.json';  Local = (Join-Path $claude 'plugins\installed_plugins.json');  Merge = 'installed' }
        [pscustomobject]@{ Type = 'File'; Repo = 'profile/claude/plugins/known_marketplaces.json'; Local = (Join-Path $claude 'plugins\known_marketplaces.json'); Merge = 'marketplaces' }
        # Which Claude account owns which repo and routine (issue 103). Read by the session check
        # in every repo; hand-written, uuids and one email, no secrets.
        [pscustomobject]@{ Type = 'File'; Repo = 'profile/claude/accounts.json';            Local = (Join-Path $claude 'accounts.json') }
        # The i-have-adhd plugin's always-on opt-in. Its SessionStart hook injects the whole
        # ruleset only when ~/.claude/.i-have-adhd-always exists, so without this entry a restored
        # machine gets the skill on /i-have-adhd and nowhere else. Contents are never read; the
        # off-switch is ~/.claude/.adhd-off, which the ask-matt gate reads.
        [pscustomobject]@{ Type = 'File'; Repo = 'profile/claude/i-have-adhd-always';      Local = (Join-Path $claude '.i-have-adhd-always') }
        # The governance hook scripts settings.json dispatches. Also the source the packager
        # copies into the plugin payload, so the desktop and a container run the same code.
        [pscustomobject]@{ Type = 'Dir';  Repo = 'profile/claude/hooks';                    Local = (Join-Path $claude 'hooks') }
        # What those hook scripts import (issue 620). stopslop-write.py and stopslop-stop.py add
        # ../tools to sys.path and `import stopslop`; without this entry the module never lands and
        # both hooks fail open with one line on stderr, which is how the gate sat dead.
        [pscustomobject]@{ Type = 'Dir';  Repo = 'profile/claude/tools';                    Local = (Join-Path $claude 'tools') }
        # User-level subagent definitions (issue 86). Claude Code auto-discovers *.md files here
        # for the agent registry the Agent tool and Workflow's `agentType` share, so the
        # ticket-fleet's tool-restricted verifier reaches every repo the fleet runs in.
        [pscustomobject]@{ Type = 'Dir';  Repo = 'profile/claude/agents';                   Local = (Join-Path $claude 'agents') }
        [pscustomobject]@{ Type = 'Dir';  Repo = 'profile/codex/hooks';                     Local = (Join-Path $codex  'hooks') }
        # Without hooks.json the carried ask_matt_gate.py is inert on the Codex side: the script
        # is there and nothing calls it. AGENTS.md is Codex's half of the global rules.
        [pscustomobject]@{ Type = 'File'; Repo = 'profile/codex/hooks.json';                Local = (Join-Path $codex  'hooks.json') }
        # Codex's settings file - the counterpart of the Claude one. Without it a fresh machine
        # gets the carried hooks wired over default settings (issue #2). Scanned for credential
        # values 2026-08-12 and again 2026-08-19: none; the sha256 values in it are trust pins
        # for hooks.json entries, not secrets.
        [pscustomobject]@{ Type = 'File'; Repo = 'profile/codex/config.toml';               Local = (Join-Path $codex  'config.toml') }
        [pscustomobject]@{ Type = 'File'; Repo = 'profile/codex/AGENTS.md';                 Local = (Join-Path $codex  'AGENTS.md') }
        # The two PowerShell profiles. They are the only place a shell-level Claude Code setting
        # (CLAUDE_CODE_USE_POWERSHELL_TOOL) reaches a session launched from a terminal, and the
        # registry User variable does not substitute: an already-running Explorer hands its stale
        # environment block to everything it starts, so a Git Bash or cmd launch misses the value
        # until the next logon. Both engines get one because 5.1 and 7 read different files.
        [pscustomobject]@{ Type = 'File'; Repo = 'powershell/pwsh7-profile.ps1';            Local = (Join-Path $docs 'PowerShell\Microsoft.PowerShell_profile.ps1') }
        [pscustomobject]@{ Type = 'File'; Repo = 'powershell/windows-powershell-profile.ps1'; Local = (Join-Path $docs 'WindowsPowerShell\Microsoft.PowerShell_profile.ps1') }
    )
}

# Documents is a redirectable shell folder - on this machine it points into OneDrive, not
# $UserHome\Documents, and $UserHome\Documents still exists as the legacy stub holding
# My Music / My Pictures. Ask the shell for the real one, but only when $UserHome IS this
# machine's profile: the restore test installs into a fake home under a different username
# and must not be handed the real Documents folder to write into.
function Get-DocumentsPath {
    param([Parameter(Mandatory = $true)][string]$UserHome)

    $real = $env:USERPROFILE
    if ($real -and ($UserHome.TrimEnd('\', '/') -ieq $real.TrimEnd('\', '/'))) {
        $shell = [Environment]::GetFolderPath('MyDocuments')
        if ($shell) { return $shell }
    }
    return (Join-Path $UserHome 'Documents')
}

# ------------------------------------------------------------------ links on disk

# ~/.claude/skills used to hold junctions into ~/.agents/skills, and push recorded them as data
# because Get-ChildItem -Recurse -File walks straight past a reparse point. The repo has one
# skill tree now (issue 214) and pull writes real directories, so nothing here creates a link -
# but a machine restored before the cut still has them, and lib/personal.ps1 mirrors whatever it
# finds into ~/.claude-personal. These two readers are what it uses.

function Test-IsLink {
    param([Parameter(Mandatory = $true)][System.IO.FileSystemInfo]$Item)
    return (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

# DirectoryInfo.Target is a string[] on Windows PowerShell 5.1 and a string on PowerShell 7.
# Binding the array straight into a [string] parameter throws "cannot convert value to type
# System.String", which is a confusing way to learn that.
function Get-LinkTarget {
    param([Parameter(Mandatory = $true)][System.IO.FileSystemInfo]$Item)
    $target = $Item.Target
    if ($null -eq $target) { return '' }
    if ($target -is [array]) {
        if ($target.Count -eq 0) { return '' }
        return [string]$target[0]
    }
    return [string]$target
}

# ------------------------------------------------------------------ exclusions

$script:ExcludeDirNames = @('__pycache__', '.pytest_cache', 'node_modules', '.git')
$script:ExcludeFileGlobs = @(
    '*.bak-*', '*.bak', '*.pyc', '*.log',
    '.credentials.json', '.clasprc.json', '*.pem', '*.key', '*.p12', '*.json.bak'
)

function Test-Excluded {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    foreach ($segment in ($RelativePath -split '[\\/]')) {
        if ($script:ExcludeDirNames -contains $segment) { return $true }
    }
    $leaf = Split-Path $RelativePath -Leaf
    foreach ($glob in $script:ExcludeFileGlobs) {
        if ($leaf -like $glob) { return $true }
    }
    return $false
}

# ------------------------------------------------------------------ templating

# Absolute home paths are stored as tokens so a machine with a different username
# still works. settings.json hard-codes C:\Users\<you>\... in five hook commands.
#
# The skill tree is the exception: aac-skills/ is hand-edited prose that names the owner's home
# literally (a clasp-auth path, a --home argument), and since issue 214 retired sync push
# nothing tokenises it before it is committed. Pull folds that spelling into the same tokens
# before substituting the local home, so a restore under another username never carries it
# (issue 582). Same constant as OWNER_HOME in tools/skill-stamps.py: the owner's home, never
# the running user's.
$script:OwnerHome = 'C:\Users\Dan'
$script:TextExtensions = @(
    '.md', '.json', '.jsonl', '.js', '.mjs', '.cjs', '.ts', '.ps1', '.psm1',
    '.py', '.sh', '.cmd', '.bat', '.txt', '.yml', '.yaml', '.toml', '.css', '.html'
)

function Test-TextFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    return $script:TextExtensions -contains ([System.IO.Path]::GetExtension($Path).ToLower())
}

function Get-HomeForms {
    param([Parameter(Mandatory = $true)][string]$UserHome)

    $trimmed = $UserHome.TrimEnd('\', '/')
    [pscustomobject]@{
        Raw   = $trimmed                                                                   # C:\Users\Dan
        Json  = $trimmed.Replace('\', '\\')                                                # C:\\Users\\Dan
        Fwd   = $trimmed.Replace('\', '/')                                                 # C:/Users/Dan
        Posix = '/' + $trimmed.Substring(0, 1).ToLower() + $trimmed.Substring(2).Replace('\', '/')  # /c/Users/Dan
        Lower = $trimmed.ToLower()                                                         # c:\users\dan (Codex trust keys)
    }
}

# Order matters only in that the JSON form must go first; it contains a doubled
# backslash the raw form cannot match, but replacing raw first would still leave
# a half-converted string behind if that ever changed. The lowercase form goes
# last: String.Replace is case-sensitive, so on a home that is already lowercase
# the raw pass has consumed every occurrence before the lowercase pass looks.
# Codex writes its project-trust keys lowercased ([projects.'c:\users\dan\...']
# in config.toml), which is the one place this spelling occurs in practice.
function ConvertTo-Tokens {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text,
        [Parameter(Mandatory = $true)][string]$UserHome
    )
    $h = Get-HomeForms -UserHome $UserHome
    $out = $Text
    $out = $out.Replace($h.Json,  '__USERHOME_JSON__')
    $out = $out.Replace($h.Posix, '__USERHOME_POSIX__')
    $out = $out.Replace($h.Fwd,   '__USERHOME_FWD__')
    $out = $out.Replace($h.Raw,   '__USERHOME__')
    $out = $out.Replace($h.Lower, '__USERHOME_LC__')
    return $out
}

function ConvertFrom-Tokens {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text,
        [Parameter(Mandatory = $true)][string]$UserHome
    )
    $h = Get-HomeForms -UserHome $UserHome
    $out = $Text
    $out = $out.Replace('__USERHOME_JSON__',  $h.Json)
    $out = $out.Replace('__USERHOME_POSIX__', $h.Posix)
    $out = $out.Replace('__USERHOME_FWD__',   $h.Fwd)
    $out = $out.Replace('__USERHOME_LC__',    $h.Lower)
    $out = $out.Replace('__USERHOME__',       $h.Raw)
    return $out
}

# ------------------------------------------------------------------- file copy

$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Copy-OneFile {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][ValidateSet('Tokenize', 'Detokenize')][string]$Direction,
        [Parameter(Mandatory = $true)][string]$UserHome,
        [switch]$DryRun
    )

    $parent = Split-Path $Destination -Parent
    if ($DryRun) {
        Write-Host ("  would write {0}" -f $Destination)
        return
    }
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

    if (Test-TextFile -Path $Source) {
        $text = [System.IO.File]::ReadAllText($Source)
        if ($Direction -eq 'Tokenize') {
            $text = ConvertTo-Tokens   -Text $text -UserHome $UserHome
        } else {
            $text = ConvertTo-Tokens   -Text $text -UserHome $script:OwnerHome
            $text = ConvertFrom-Tokens -Text $text -UserHome $UserHome
        }
        [System.IO.File]::WriteAllText($Destination, $text, $script:Utf8NoBom)
    } else {
        Copy-Item -Path $Source -Destination $Destination -Force
    }
}

function Copy-Tree {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][ValidateSet('Tokenize', 'Detokenize')][string]$Direction,
        [Parameter(Mandatory = $true)][string]$UserHome,
        [switch]$DryRun
    )

    if (-not (Test-Path $Source)) {
        Write-Host ("  skip (missing): {0}" -f $Source)
        return 0
    }

    $count = 0
    Get-ChildItem -Path $Source -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($Source.Length).TrimStart('\', '/')
        if (Test-Excluded -RelativePath $relative) { return }
        Copy-OneFile -Source $_.FullName -Destination (Join-Path $Destination $relative) `
                     -Direction $Direction -UserHome $UserHome -DryRun:$DryRun
        $count++
    }
    return $count
}

# ---------------------------------------------------------------- secret guard

# Value-shaped patterns only. Prose that merely names a credential ("refresh at
# oauth2.googleapis.com/token with client_id/secret/refresh_token from that file"
# in the global CLAUDE.md) must not trip this, or the guard gets disabled and
# stops guarding.
$script:SecretPatterns = @(
    '"refresh_token"\s*:\s*"[^"]{10,}"',
    '"access_token"\s*:\s*"[^"]{10,}"',
    '"client_secret"\s*:\s*"[^"]{10,}"',
    '"private_key"\s*:\s*"[^"]{10,}"',
    '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    'sk-ant-[A-Za-z0-9]{8,}',
    'ya29\.[A-Za-z0-9_\-]{10,}'
)

function Assert-NoSecrets {
    param([Parameter(Mandatory = $true)][string]$Root)

    $hits = @()
    Get-ChildItem -Path $Root -Recurse -File |
        Where-Object { $_.FullName -notmatch '\\\.git\\' } |
        ForEach-Object {
            $file = $_
            if (-not (Test-TextFile -Path $file.FullName)) { return }
            $content = [System.IO.File]::ReadAllText($file.FullName)
            foreach ($pattern in $script:SecretPatterns) {
                if ($content -match $pattern) {
                    $hits += ("{0}  ({1})" -f $file.FullName, $pattern)
                }
            }
        }

    if ($hits.Count -gt 0) {
        Write-Host ''
        Write-Host 'SECRET GUARD FAILED - these files look like they contain live credentials:' -ForegroundColor Red
        $hits | ForEach-Object { Write-Host ("  {0}" -f $_) -ForegroundColor Red }
        Write-Host 'Nothing was committed. Remove the values, then re-run.' -ForegroundColor Red
        return $false
    }
    return $true
}

# Names of the six GIT_* environment variables that override `git -C <path>` and would silently
# redirect any child git call to the parent process's repo. See Clear-GitEnv below for the full
# rationale; issue 28.
$script:GitEnvNames = @('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY')

function Clear-GitEnv {
    <#
    .SYNOPSIS
        Strip the six GIT_* env vars from the current process, returning a saved-state
        hashtable for Restore-GitEnv. Issue 28.
    .DESCRIPTION
        `git -C <path>` does NOT override GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_PREFIX /
        GIT_COMMON_DIR / GIT_OBJECT_DIRECTORY: git honours those env vars first, and the -C
        flag only relocates its resolution of a path when they are unset. A git hook that
        runs a PowerShell suite (which runs git) leaks
        those vars into every child process; every downstream `git -C <target>` then silently
        operates on the PARENT repo instead of the intended target. Corrupted state1
        detection 2026-08-25 and polluted a parent bare repo's .git/config with test
        user.email entries on the same run.

        Callers must pair Clear-GitEnv with Restore-GitEnv in a try/finally so the parent's
        environment is not permanently mutated when the caller returns.
    #>
    $saved = @{}
    foreach ($name in $script:GitEnvNames) {
        $val = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $val) {
            $saved[$name] = $val
            [Environment]::SetEnvironmentVariable($name, $null)
        }
    }
    return $saved
}

function Restore-GitEnv {
    param([hashtable]$Saved)
    if ($null -eq $Saved) { return }
    foreach ($name in $Saved.Keys) {
        [Environment]::SetEnvironmentVariable($name, $Saved[$name])
    }
}

