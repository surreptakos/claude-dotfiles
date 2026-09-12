# Shared manifest + helpers for sync.ps1 and install.ps1.
# Dot-source this; it defines the whitelist of what travels and the path-templating rules.

Set-StrictMode -Version Latest

# ---------------------------------------------------------------- what travels

# Every entry is copied by name. Nothing outside this list is ever read, which is
# what keeps credentials, transcripts and caches out of the repo — a .gitignore
# alone would only catch what someone remembered to list.
function Get-DotfileItems {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$UserHome
    )

    $claude = Join-Path $UserHome '.claude'
    $codex  = Join-Path $UserHome '.codex'
    $agents = Join-Path $UserHome '.agents'
    $docs   = Get-DocumentsPath -UserHome $UserHome

    @(
        [pscustomobject]@{ Type = 'File'; Repo = 'claude/CLAUDE.md';                       Local = (Join-Path $claude 'CLAUDE.md') }
        [pscustomobject]@{ Type = 'File'; Repo = 'claude/settings.json';                   Local = (Join-Path $claude 'settings.json') }
        [pscustomobject]@{ Type = 'File'; Repo = 'claude/plugins/installed_plugins.json';  Local = (Join-Path $claude 'plugins\installed_plugins.json') }
        [pscustomobject]@{ Type = 'File'; Repo = 'claude/plugins/known_marketplaces.json'; Local = (Join-Path $claude 'plugins\known_marketplaces.json') }
        # Which Claude account owns which repo and routine (issue 103). Read by the session check
        # in every repo and by the master watchdog; hand-written, uuids and one email, no secrets.
        [pscustomobject]@{ Type = 'File'; Repo = 'claude/accounts.json';                    Local = (Join-Path $claude 'accounts.json') }
        [pscustomobject]@{ Type = 'Dir';  Repo = 'claude/skills';                          Local = (Join-Path $claude 'skills') }
        [pscustomobject]@{ Type = 'Dir';  Repo = 'claude/hooks';                           Local = (Join-Path $claude 'hooks') }
        # User-level subagent definitions (issue 86). Claude Code auto-discovers *.md files here
        # for the agent registry the Agent tool and Workflow's `agentType` share. Carrying this
        # tree via sync means the ticket-fleet's tool-restricted verifier reaches every repo the
        # fleet runs in on any machine, without a per-repo install step.
        [pscustomobject]@{ Type = 'Dir';  Repo = 'claude/agents';                          Local = (Join-Path $claude 'agents') }
        # Most of the flow skills the global CLAUDE.md names (implement, tdd, triage, handoff,
        # to-spec...) live here and reach ~/.claude/skills through junctions. Carrying only
        # ~/.claude/skills captured 13 of 37 skills and said nothing about the other 24.
        [pscustomobject]@{ Type = 'Dir';  Repo = 'agents/skills';                          Local = (Join-Path $agents 'skills') }
        [pscustomobject]@{ Type = 'Dir';  Repo = 'codex/hooks';                            Local = (Join-Path $codex  'hooks') }
        # Without hooks.json the carried ask_matt_gate.py is inert on the Codex side: the script
        # is there and nothing calls it. AGENTS.md is Codex's half of the global rules.
        [pscustomobject]@{ Type = 'File'; Repo = 'codex/hooks.json';                       Local = (Join-Path $codex  'hooks.json') }
        # Codex's settings file - the counterpart of claude/settings.json. Without it a fresh
        # machine gets the carried hooks wired over default settings (issue #2). Scanned for
        # credential values 2026-08-12 and again 2026-08-19: none; the sha256 values in it are
        # trust pins for hooks.json entries, not secrets.
        [pscustomobject]@{ Type = 'File'; Repo = 'codex/config.toml';                      Local = (Join-Path $codex  'config.toml') }
        [pscustomobject]@{ Type = 'File'; Repo = 'codex/AGENTS.md';                        Local = (Join-Path $codex  'AGENTS.md') }
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

# ------------------------------------------------------------------- skill links

# Junctions are the reason a skill can be installed and invisible to a file copy:
# Get-ChildItem -Recurse -File does not traverse a reparse point, so Copy-Tree walks straight
# past one and reports a smaller count with no error. Record them as data instead, and recreate
# them on pull once their targets are back.
$script:SkillLinkFile = 'claude/skill-links.json'

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

function Get-SkillLinks {
    param([Parameter(Mandatory = $true)][string]$UserHome)

    $skills = Join-Path $UserHome '.claude\skills'
    if (-not (Test-Path $skills)) { return @() }

    Get-ChildItem -Path $skills -Directory -Force |
        Where-Object { Test-IsLink -Item $_ } |
        ForEach-Object {
            [pscustomobject]@{ Name = $_.Name; Target = (Get-LinkTarget -Item $_) }
        } |
        Where-Object { $_.Target -ne '' }
}

# ConvertTo-Json is not an engine-independent formatter: Windows PowerShell 5.1 indents four
# spaces and pads the colon ("Name":  "x"), PowerShell 7 indents two and does not. The same
# push run from the two engines therefore rewrites every line of skill-links.json with
# identical content - `git diff -w` comes back empty - and the file flip-flops in history
# depending on which shell the owner happened to be in. Emit the bytes here instead.
function Write-JsonStringLiteral {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $Value.ToCharArray()) {
        switch ($ch) {
            '"'     { [void]$sb.Append('\"');   continue }
            '\'     { [void]$sb.Append('\\');   continue }
            "`b"    { [void]$sb.Append('\b');   continue }
            "`f"    { [void]$sb.Append('\f');   continue }
            "`n"    { [void]$sb.Append('\n');   continue }
            "`r"    { [void]$sb.Append('\r');   continue }
            "`t"    { [void]$sb.Append('\t');   continue }
            default {
                if ([int]$ch -lt 32) { [void]$sb.Append(('\u{0:x4}' -f [int]$ch)) }
                else                 { [void]$sb.Append($ch) }
            }
        }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

# Two-space indent, CRLF, no trailing newline - the shape ConvertTo-Json produced under
# PowerShell 7, so pinning it left the committed file unchanged.
function ConvertTo-SkillLinkJson {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][array]$Links)

    $nl    = "`r`n"
    $lines = New-Object System.Collections.ArrayList
    [void]$lines.Add('[')
    for ($i = 0; $i -lt $Links.Count; $i++) {
        $comma = if ($i -lt $Links.Count - 1) { ',' } else { '' }
        [void]$lines.Add('  {')
        [void]$lines.Add('    "Name": '   + (Write-JsonStringLiteral -Value $Links[$i].Name) + ',')
        [void]$lines.Add('    "Target": ' + (Write-JsonStringLiteral -Value $Links[$i].Target))
        [void]$lines.Add('  }' + $comma)
    }
    [void]$lines.Add(']')
    return ($lines -join $nl)
}

function Save-SkillLinks {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$UserHome,
        [switch]$DryRun
    )

    $links = @(Get-SkillLinks -UserHome $UserHome | ForEach-Object {
        [pscustomobject]@{ Name = $_.Name; Target = (ConvertTo-Tokens -Text $_.Target -UserHome $UserHome) }
    })
    $path = Join-Path $RepoRoot ($script:SkillLinkFile -replace '/', '\')
    if ($DryRun) {
        Write-Host ("  would write {0}  ({1} links)" -f $path, $links.Count)
        return $links.Count
    }
    $json = ConvertTo-SkillLinkJson -Links $links
    [System.IO.File]::WriteAllText($path, $json, $script:Utf8NoBom)
    return $links.Count
}

# @(Get-Content x -Raw | ConvertFrom-Json) does NOT reliably give you N elements on Windows
# PowerShell 5.1: the deserialised array can arrive as a single pipeline object, so @() wraps it
# into one nested element and a 22-entry file reads as one entry whose every property is an
# array. Piping through ForEach-Object enumerates it either way.
function Read-JsonArray {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) { return @() }
    $parsed = Get-Content $Path -Raw | ConvertFrom-Json
    if ($null -eq $parsed) { return @() }
    return @($parsed | ForEach-Object { $_ })
}

function Restore-SkillLinks {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$UserHome,
        [switch]$DryRun
    )

    $path = Join-Path $RepoRoot ($script:SkillLinkFile -replace '/', '\')
    $links = Read-JsonArray -Path $path
    if ($links.Count -eq 0) { return 0 }
    $made = 0
    foreach ($link in $links) {
        $target = ConvertFrom-Tokens -Text $link.Target -UserHome $UserHome
        $linkPath = Join-Path $UserHome (".claude\skills\" + $link.Name)

        if (-not (Test-Path $target)) {
            Write-Host ("  skip link (no target): {0} -> {1}" -f $link.Name, $target) -ForegroundColor Yellow
            continue
        }
        if ($DryRun) { Write-Host ("  would link {0} -> {1}" -f $linkPath, $target); $made++; continue }

        # A real directory already sitting there is somebody's local edit, not ours to replace.
        if (Test-Path $linkPath) {
            $existing = Get-Item $linkPath -Force
            if (-not (Test-IsLink -Item $existing)) {
                Write-Host ("  skip link (real directory in the way): {0}" -f $linkPath) -ForegroundColor Yellow
                continue
            }
            Remove-Item -Path $linkPath -Force -Recurse
        }
        $parent = Split-Path $linkPath -Parent
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        New-Item -ItemType Junction -Path $linkPath -Target $target | Out-Null
        $made++
    }
    return $made
}

# Per-project memory lives under ~/.claude/projects/<slug>/memory. The slug is the
# project's absolute path with every non-alphanumeric character replaced by "-",
# so it embeds the username and has to be re-slugged on a machine with a different one.
function Get-MemoryItems {
    param(
        [Parameter(Mandatory = $true)][string]$UserHome
    )

    $projects = Join-Path $UserHome '.claude\projects'
    if (-not (Test-Path $projects)) { return @() }

    Get-ChildItem -Path $projects -Directory | ForEach-Object {
        $memory = Join-Path $_.FullName 'memory'
        if (Test-Path $memory) {
            [pscustomobject]@{ Type = 'Dir'; Slug = $_.Name; Local = $memory }
        }
    }
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
$script:TextExtensions = @(
    '.md', '.json', '.jsonl', '.js', '.mjs', '.cjs', '.ts', '.ps1', '.psm1',
    '.py', '.sh', '.cmd', '.bat', '.txt', '.yml', '.yaml', '.toml', '.css', '.html'
)

function Test-TextFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    return $script:TextExtensions -contains ([System.IO.Path]::GetExtension($Path).ToLower())
}

function ConvertTo-Slug {
    param([Parameter(Mandatory = $true)][string]$Path)
    return ($Path -replace '[^A-Za-z0-9]', '-')
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
        Slug  = (ConvertTo-Slug $trimmed)                                                  # C--Users-Dan
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

function ConvertTo-TokenSlug {
    param(
        [Parameter(Mandatory = $true)][string]$Slug,
        [Parameter(Mandatory = $true)][string]$UserHome
    )
    $h = Get-HomeForms -UserHome $UserHome
    return $Slug.Replace($h.Slug, '__USERHOME_SLUG__')
}

function ConvertFrom-TokenSlug {
    param(
        [Parameter(Mandatory = $true)][string]$Slug,
        [Parameter(Mandatory = $true)][string]$UserHome
    )
    $h = Get-HomeForms -UserHome $UserHome
    return $Slug.Replace('__USERHOME_SLUG__', $h.Slug)
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

    # -Recurse does not traverse reparse points, and that is load-bearing rather than incidental:
    # it is what stops a junctioned skill being copied twice, once under claude/skills and again
    # under agents/skills. The junctions themselves travel as data - see Get-SkillLinks.
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

# --------------------------------------------------------- freshness fingerprint

# SHA256 over the LIVE contents of every whitelisted file (relative path + null
# byte + raw bytes, sorted by relative path). Relative paths, raw bytes: the same
# ~/.claude on two machines with different usernames must fingerprint identically,
# so the stamp travels through the pull/push round trip without a false mismatch.
# Missing files contribute nothing (they show up in the sorted-list difference
# instead), which keeps the fingerprint defined on a partial install.
function Get-DotfilesFingerprint {
    param(
        [Parameter(Mandatory = $true)][string]$UserHome
    )
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $items = Get-DotfileItems -RepoRoot 'unused' -UserHome $UserHome
        $entries = New-Object System.Collections.Generic.List[object]

        foreach ($item in $items) {
            if (-not (Test-Path $item.Local)) { continue }
            if ($item.Type -eq 'File') {
                $entries.Add([pscustomobject]@{
                    Relative = $item.Repo
                    Full     = $item.Local
                }) | Out-Null
                continue
            }
            $base = $item.Local
            Get-ChildItem -Path $base -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
                $relative = $_.FullName.Substring($base.Length).TrimStart('\', '/') -replace '\\', '/'
                if (Test-Excluded -RelativePath $relative) { return }
                $entries.Add([pscustomobject]@{
                    Relative = ($item.Repo + '/' + $relative)
                    Full     = $_.FullName
                }) | Out-Null
            }
        }
        foreach ($memory in (Get-MemoryItems -UserHome $UserHome)) {
            $slug = ConvertTo-TokenSlug -Slug $memory.Slug -UserHome $UserHome
            $base = $memory.Local
            Get-ChildItem -Path $base -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
                $relative = $_.FullName.Substring($base.Length).TrimStart('\', '/') -replace '\\', '/'
                if (Test-Excluded -RelativePath $relative) { return }
                $entries.Add([pscustomobject]@{
                    Relative = ('memory/' + $slug + '/' + $relative)
                    Full     = $_.FullName
                }) | Out-Null
            }
        }

        $sorted = @($entries | Sort-Object -Property Relative)
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        $stream = New-Object System.IO.MemoryStream
        try {
            foreach ($entry in $sorted) {
                $prefix = $utf8.GetBytes($entry.Relative)
                $stream.Write($prefix, 0, $prefix.Length)
                $stream.WriteByte(0)
                # Text files: tokenize so the fingerprint is username-invariant.
                # Binary files: raw bytes.
                if (Test-TextFile -Path $entry.Full) {
                    $text = [System.IO.File]::ReadAllText($entry.Full)
                    $text = ConvertTo-Tokens -Text $text -UserHome $UserHome
                    $bytes = $utf8.GetBytes($text)
                } else {
                    $bytes = [System.IO.File]::ReadAllBytes($entry.Full)
                }
                $stream.Write($bytes, 0, $bytes.Length)
                $stream.WriteByte(0)
            }
            $stream.Position = 0
            $hash = $sha.ComputeHash($stream)
        } finally {
            $stream.Dispose()
        }
        return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLower()
    } finally {
        $sha.Dispose()
    }
}

# The stamp lives under the user profile, NOT the repo. Push and pull each write
# it after they finish; the freshness check reads it. If the file is missing
# ("no stamp"), the freshness check stays silent - the criterion "auto-pull must
# never run while live drift exists" then holds trivially because a missing
# stamp cannot possibly report "unedited since last sync".
# Names of the five GIT_* environment variables that override `git -C <path>` and would silently
# redirect any child git call to the parent process's repo. See Clear-GitEnv below for the full
# rationale; issue 28.
$script:GitEnvNames = @('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY')

function Clear-GitEnv {
    <#
    .SYNOPSIS
        Strip the five GIT_* env vars from the current process, returning a saved-state
        hashtable for Restore-GitEnv. Issue 28.
    .DESCRIPTION
        `git -C <path>` does NOT override GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE /
        GIT_COMMON_DIR / GIT_OBJECT_DIRECTORY: git honours those env vars first, and the -C
        flag only relocates its resolution of a path when they are unset. A pre-commit hook
        that runs restore-test.ps1 (which runs the freshness suite, which runs git) leaks
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

function Get-DotfilesStampPath {
    param([Parameter(Mandatory = $true)][string]$UserHome)
    return (Join-Path $UserHome '.claude\hook-state\dotfiles-sync\state.json')
}

function Write-DotfilesStamp {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$UserHome,
        [Parameter(Mandatory = $true)][ValidateSet('push', 'pull', 'install')][string]$Kind
    )
    $stampPath = Get-DotfilesStampPath -UserHome $UserHome
    $parent = Split-Path $stampPath -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

    $commit = ''
    $savedGitEnv = Clear-GitEnv
    try {
        $commit = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
    } catch { $commit = '' }
    finally { Restore-GitEnv -Saved $savedGitEnv }

    $stamp = [ordered]@{
        version         = 1
        kind            = $Kind
        stampedAt       = (Get-Date).ToUniversalTime().ToString('o')
        repoRoot        = $RepoRoot
        syncedCommit    = $commit
        liveFingerprint = (Get-DotfilesFingerprint -UserHome $UserHome)
    }
    $json = ConvertTo-Json -InputObject $stamp -Depth 3
    [System.IO.File]::WriteAllText($stampPath, $json, $script:Utf8NoBom)
    return $stampPath
}

function Read-DotfilesStamp {
    param([Parameter(Mandatory = $true)][string]$UserHome)
    $stampPath = Get-DotfilesStampPath -UserHome $UserHome
    if (-not (Test-Path $stampPath)) { return $null }
    try { return Get-Content $stampPath -Raw | ConvertFrom-Json }
    catch { return $null }
}
