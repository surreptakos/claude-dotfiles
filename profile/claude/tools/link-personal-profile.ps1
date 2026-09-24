# Two-way sharing between the work profile (~/.claude) and the personal profile (~/.claude-personal).
#
# Owner instruction 2026-09-23: "I want two way sync between claude-personal and claude."
# Supersedes issue #9 decision (b) (reverse memory sync declined): personal-only content merges
# into ~/.claude, and each shared dir in ~/.claude-personal becomes a junction to its ~/.claude
# twin, so both accounts read and write one copy from then on. No sync job to drift.
#
# Shared (junctioned): projects (transcripts + memory, so /resume works across accounts),
# agents, hooks, tools, plans, file-history.
# Not shared: .credentials.json and .claude.json (account login), settings.json (work has the
# caveman-proxy base URL, model pin and plugin set), plugins (install paths are per profile),
# skills (owner, 2026-09-23: keep each profile's skills as they are).
#
# Run with every personal-profile Claude session closed. Each dir is renamed aside first; a
# rename that fails (open file) skips that dir before anything changes.
#   pwsh -File link-personal-profile.ps1 -DryRun
#   pwsh -File link-personal-profile.ps1
# Rollback per dir: cmd /c rmdir <personal>\<dir>; Rename-Item <personal>\<dir>.pre-link-<stamp> <dir>

param([switch]$DryRun, [string]$UserHome = $HOME)
$ErrorActionPreference = 'Stop'

$work     = Join-Path $UserHome '.claude'
$personal = Join-Path $UserHome '.claude-personal'
$dirs     = 'projects', 'agents', 'hooks', 'tools', 'plans', 'file-history'
$stamp    = Get-Date -Format 'yyyyMMdd-HHmmss'
$pointer  = [regex]'\]\(([^)]+\.md)\)'
$utf8     = [System.Text.UTF8Encoding]::new($false)

function Merge-Memories([string]$from, [string]$to, [switch]$Preview) {
    # Most personal-only memories are stale copies of work memories that work later pruned
    # (the old one-way pull never deleted). Bring in only memories born in a personal session
    # (originSessionId transcript under $from, not under $to) or in a project work lacks;
    # everything else stays in the renamed-aside dir.
    $script:memIn = 0; $script:memLeft = 0
    Get-ChildItem $from -Directory | ForEach-Object {
        $src = Join-Path $_.FullName 'memory'
        if (-not (Test-Path $src)) { return }
        $dst = Join-Path $to ($_.Name + '\memory')
        $workHasProject = Test-Path $dst
        Get-ChildItem $src -File -Filter *.md | Where-Object Name -ne 'MEMORY.md' | ForEach-Object {
            $target = Join-Path $dst $_.Name
            if (Test-Path $target) { return }
            $sid = ([regex]'originSessionId:\s*([0-9a-f-]{36})').Match([IO.File]::ReadAllText($_.FullName)).Groups[1].Value
            $personalBorn = $sid -and (Get-ChildItem $from -Filter "$sid.jsonl" -Recurse -Depth 1 -File) -and
                -not (Get-ChildItem $to -Filter "$sid.jsonl" -Recurse -Depth 1 -File)
            if ($personalBorn -or -not $workHasProject) {
                if (-not $Preview) { New-Item -ItemType Directory $dst -Force | Out-Null; Copy-Item $_.FullName $target }
                $script:memIn++
            } else { $script:memLeft++ }
        }
        if (-not $workHasProject -and -not $Preview) { Copy-Item (Join-Path $src 'MEMORY.md') $dst -ErrorAction SilentlyContinue }
    }
    "    memories: $($script:memIn) brought in, $($script:memLeft) stale work-era copies left in aside dir"
    Merge-MemoryIndexes $from $to -Preview:$Preview
}

function Merge-MemoryIndexes([string]$from, [string]$to, [switch]$Preview) {
    # Union of MEMORY.md pointer lines: work copy first, then personal pointers whose target
    # memory file now exists in work (so pruned memories do not get their pointers back).
    Get-ChildItem $from -Recurse -Filter MEMORY.md -File | ForEach-Object {
        $dst = Join-Path $to $_.FullName.Substring($from.Length).TrimStart('\')
        if (-not (Test-Path $dst)) { return }
        $dir = Split-Path $dst -Parent
        $merged = [IO.File]::ReadAllText($dst)
        $have = @{}; foreach ($m in $pointer.Matches($merged)) { $have[$m.Groups[1].Value] = 1 }
        $added = 0
        foreach ($line in ([IO.File]::ReadAllText($_.FullName) -split "`r?`n")) {
            $m = $pointer.Match($line)
            if ($m.Success -and -not $have.ContainsKey($m.Groups[1].Value) -and
                ($Preview -or (Test-Path (Join-Path $dir $m.Groups[1].Value)))) {
                $merged = $merged.TrimEnd() + "`n" + $line + "`n"; $have[$m.Groups[1].Value] = 1; $added++
            }
        }
        if ($added) {
            if (-not $Preview) { [IO.File]::WriteAllText($dst, $merged, $utf8) }
            "    MEMORY.md +$added pointer(s): $dst"
        }
    }
}

foreach ($d in $dirs) {
    $p = Join-Path $personal $d
    $w = Join-Path $work $d
    $item = Get-Item $p -Force -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType) { "${d}: already linked -> $($item.Target)"; continue }

    if ($DryRun) {
        if ($item) {
            $files = @(Get-ChildItem $p -Recurse -File -Force)
            $new = @($files | Where-Object { -not (Test-Path (Join-Path $w $_.FullName.Substring($p.Length).TrimStart('\'))) }).Count
            "${d}: would merge $new of $($files.Count) file(s) into $w, then junction"
            if ($d -eq 'projects' -and (Test-Path $w)) { Merge-Memories $p $w -Preview }
        } else { "${d}: absent in personal, would junction" }
        continue
    }

    if (-not (Test-Path $w)) { New-Item -ItemType Directory $w | Out-Null }
    if ($item) {
        $aside = "$p.pre-link-$stamp"
        try { Rename-Item $p $aside } catch { "${d}: SKIPPED, cannot rename (session open?): $($_.Exception.Message)"; continue }
        # Memories first: Merge-Memories tells personal-born from work-born by which profile
        # holds the origin transcript, which only holds before robocopy brings transcripts over.
        if ($d -eq 'projects') { Merge-Memories $aside $w }
        # /E recurse; /XC /XN /XO never overwrite a file work already has; memory dirs are
        # handled above.
        $xd = if ($d -eq 'projects') { @('/XD', 'memory') } else { @() }
        robocopy $aside $w /E /XC /XN /XO @xd /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { "${d}: robocopy FAILED exit $LASTEXITCODE, restoring"; Rename-Item $aside $p; continue }
        "${d}: merged (robocopy exit $LASTEXITCODE), original kept at $aside"
    }
    New-Item -ItemType Junction -Path $p -Target $w | Out-Null
    "${d}: junction $p -> $w"
}
