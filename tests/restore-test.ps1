<#
.SYNOPSIS
    Prove the restore path works, without a second machine.

.DESCRIPTION
    A fresh machine differs from this one in exactly two ways that matter here: it has no
    ~/.claude or ~/.codex, and its home directory is spelled with a different username. Both
    are simulable, because sync.ps1 and install.ps1 already take -UserHome.

    So: clone the REMOTE (not the working tree - the question is whether what was pushed
    restores), install it into a fake home under a different username, and check the result.
    The fake home lives outside the real profile on purpose: any occurrence of the real home
    path in a restored file is then unambiguously a leak, not the scratch directory's own name.

    Checks, in order:
      1  install.ps1 exits 0
      2  every whitelisted item landed, with the same file count as the repo
      3  memory slugs were de-tokenized back into real project directory names
      4  no __USERHOME* token survives in any restored file
      5  no real-home path survives in any restored file
      6  settings.json parses, and every absolute path in it points inside the fake home
      7  round trip is lossless: re-tokenizing each restored file reproduces the repo file
      8  nothing credential-shaped was restored (the guard, pointed at the output)
      9  the restored hooks and skills actually RUN from their new home
     10  two overlapping runs do not delete each other's scratch directory

    Check 9 is the one that separates this from a file-copy test. Everything up to 8 proves
    bytes moved; only 9 proves the machine would work.

    Check 10 exists because the scratch root used to be a constant, and the whole of it is
    deleted at startup. Two runs that overlap - the SessionStart hook and the first
    UserPromptSubmit hook, 8 seconds apart on 2026-08-13 - therefore wiped each other mid-run and
    BOTH reported failure on a repo that was fine. A false failure on session start is worse than
    no check, because it teaches the reader to ignore the real one. The scratch root is now derived
    per run, so concurrent runs never share a directory.

    -Fault injects a known break so a check can be watched going red. A monitor that has only
    ever passed is not yet a monitor. Every fault is expected to exit 1; see the table in the
    param block for which check each one is aimed at.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1
    powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1 -From local -Keep
    powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1 -Fault home-leak
#>
[CmdletBinding()]
param(
    # origin   clone the pushed remote - the honest test, and the one to run before trusting a restore
    # local    clone this checkout's committed state, for iterating before pushing
    # worktree copy what git currently sees (index + working tree), no clone and no network. This is
    #          the automation mode: a pre-commit gate that cloned HEAD would be testing the PREVIOUS
    #          commit, and CI cannot clone a private remote from inside the runner.
    [ValidateSet('origin', 'local', 'worktree')][string]$From = 'origin',

    # Empty means "derive one per run", which is what keeps concurrent runs apart. Passing a path
    # explicitly pins it, and two runs given the SAME path still collide - that is the escape hatch
    # check 10 uses to watch itself fail.
    [string]$FakeHome = '',
    [switch]$Keep,

    # Deliberate breakage, to watch a check fail:
    #   missing      a whitelisted file never made it into the repo   -> check 2
    #   home-leak    a file was copied without going through Copy-OneFile -> check 5
    #   secret       a credential value reached the repo              -> check 8
    #   drift        a restored file does not round-trip              -> check 7
    #   broken-hook  a restored hook is present but not runnable      -> check 9
    #   dead-link    a junctioned skill's target never travelled      -> check 6b
    #   collision    two overlapping runs share one scratch root      -> check 10
    #   locked-scratch  the scratch cannot be deleted at the end      -> verdict must stay 0
    [ValidateSet('none', 'missing', 'home-leak', 'secret', 'drift', 'broken-hook', 'dead-link',
                 'collision', 'locked-scratch')]
    [string]$Fault = 'none',

    # Internal, used by check 10. Runs ONLY the scratch-root setup - derive, wipe, create - then
    # holds a marker file for -ProbeHoldMs and reports whether it survived. That is the exact code
    # path that used to clobber a concurrent run, without paying for a second full install.
    [switch]$Probe,
    [int]$ProbeHoldMs = 2000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SelfPath = $MyInvocation.MyCommand.Path
$RealHome = $env:USERPROFILE.TrimEnd('\', '/')

# Check 9 runs the RESTORED session-check inside the clone, and session-check runs whatever the
# repo's .claude/session.json names as its test command - this suite. So every run used to restore
# a copy of the repo and then test that copy, several scratch directories deep, and the nested
# session-check processes outlived their parents holding the clone open. While the scratch root was
# a constant the nested run wiped its own parent's directory, which broke the recursion by breaking
# the run. One env var stops the descent without changing what check 9 proves: the restored
# session-check still runs and still reports, it just does not restore the world again.
if ($env:RESTORE_TEST_ACTIVE -and -not $Probe) {
    Write-Host ("Nested restore-test skipped - already inside run {0}." -f $env:RESTORE_TEST_ACTIVE)
    Write-Host 'pass 0'
    Write-Host 'fail 0'
    exit 0
}
$env:RESTORE_TEST_ACTIVE = $PID

$ScratchBase = 'C:\dotfiles-restore-test'
if (-not $FakeHome) {
    # Per run, not per machine. The whole of $FakeRoot is deleted below, so two runs sharing it
    # destroy each other; the pid plus a random tail keeps them apart even when the pid is reused.
    $runId    = "run-{0}-{1}" -f $PID, ([guid]::NewGuid().ToString('N').Substring(0, 6))
    $FakeHome = Join-Path $ScratchBase ("{0}\Users\Restored" -f $runId)
}

# The script deletes $FakeHome outright. Anything inside the real profile is off limits, or a
# typo in -FakeHome turns this test into a way to lose the configuration it is testing.
if ($FakeHome.TrimEnd('\').ToLower().StartsWith($RealHome.ToLower())) {
    Write-Host "-FakeHome must be outside $RealHome - it gets deleted." -ForegroundColor Red
    exit 2
}

$FakeRoot = Split-Path -Parent (Split-Path -Parent $FakeHome)   # C:\dotfiles-restore-test\run-...
$Clone    = Join-Path $FakeRoot 'clone'

# ------------------------------------------------------------------ probe mode (check 10's child)

if ($Probe) {
    if (Test-Path $FakeRoot) { Remove-Item -Path $FakeRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $FakeRoot -Force | Out-Null
    $marker = Join-Path $FakeRoot ("probe-{0}.marker" -f $PID)
    Set-Content -Path $marker -Value $PID -Encoding utf8
    Start-Sleep -Milliseconds $ProbeHoldMs
    $intact = Test-Path $marker
    Write-Host ("probe {0} root {1} {2}" -f $PID, $FakeRoot, $(if ($intact) { 'intact' } else { 'CLOBBERED' }))
    if (-not $Keep) { Remove-Item -Path $FakeRoot -Recurse -Force -ErrorAction SilentlyContinue }
    if ($intact) { exit 0 }
    exit 1
}

# A run that crashed, one kept with -Keep, or one whose scratch was still locked at cleanup leaves
# its directory behind. Sweep only what is old enough that no live run can own it: a run takes
# about 15 seconds, so an hour is far past any sibling still in flight.
if (Test-Path $ScratchBase) {
    Get-ChildItem -Path $ScratchBase -Directory -Filter 'run-*' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-1) } |
        ForEach-Object { Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}

$script:Failures = 0
$script:Checks   = 0
$script:FailLog  = @()

function Check {
    param([string]$Name, [bool]$Ok, [string[]]$Detail = @())
    $script:Checks++
    if ($Ok) {
        Write-Host ("  ok    {0}" -f $Name)
    } else {
        $script:Failures++
        Write-Host ("  FAIL  {0}" -f $Name) -ForegroundColor Red
        $Detail | Select-Object -First 12 | ForEach-Object { Write-Host ("          {0}" -f $_) -ForegroundColor Red }
        # Kept as well as printed: the session hooks run this through execFileSync and report only
        # "tests FAIL", so a failure seen by a hook has no output anywhere unless it is written down.
        $script:FailLog += ("FAIL  " + $Name)
        $script:FailLog += ($Detail | Select-Object -First 12 | ForEach-Object { "        " + $_ })
    }
}

function Note { param([string]$Text) Write-Host ("  note  {0}" -f $Text) -ForegroundColor DarkGray }

# ------------------------------------------------------------------ set the stage

Write-Host ''
Write-Host ("RESTORE TEST   real home {0}   fake home {1}" -f $RealHome, $FakeHome)
Write-Host ''

if (Test-Path $FakeRoot) { Remove-Item -Path $FakeRoot -Recurse -Force }
New-Item -ItemType Directory -Path $FakeRoot -Force | Out-Null

if ($From -eq 'worktree') {
    # git ls-files rather than a directory copy: it is exactly what git sees, so it picks up
    # staged changes (what a pre-commit gate must test) while excluding ignored paths and
    # .claude/worktrees, which holds whole checkouts of this same repo.
    Write-Host ("Copying the working tree from {0}" -f $RepoRoot)
    $listed = & git -C $RepoRoot ls-files
    if ($LASTEXITCODE -ne 0) { Write-Host 'git ls-files failed.' -ForegroundColor Red; exit 2 }
    foreach ($relative in $listed) {
        # NOT $from: PowerShell variable names are case-insensitive, so $from IS the -From
        # parameter, and assigning a path to it fails its ValidateSet.
        $src = Join-Path $RepoRoot ($relative -replace '/', '\')
        if (-not (Test-Path $src)) { continue }   # staged deletion
        $dst    = Join-Path $Clone ($relative -replace '/', '\')
        $parent = Split-Path $dst -Parent
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -Path $src -Destination $dst -Force
    }
    Write-Host ("  {0} tracked files" -f $listed.Count)
} else {
    $source = $RepoRoot
    if ($From -eq 'origin') {
        $source = (git -C $RepoRoot remote get-url origin)
        if ($LASTEXITCODE -ne 0) { Write-Host 'No origin remote.' -ForegroundColor Red; exit 2 }
    }
    Write-Host ("Cloning {0}" -f $source)
    git clone --quiet --depth 1 $source $Clone
    if ($LASTEXITCODE -ne 0) { Write-Host 'Clone failed.' -ForegroundColor Red; exit 2 }
    Write-Host ("  at {0}" -f (git -C $Clone log --oneline -1))
}
Write-Host ''

. (Join-Path $Clone 'lib\manifest.ps1')

# ------------------------------------------------------------------ 0. inject the fault

if ($Fault -eq 'home-leak') {
    # What a copy that bypassed Copy-OneFile would leave behind: this machine's home, verbatim.
    Set-Content -Path (Join-Path $Clone 'claude\skills\leak-probe.md') `
                -Value ("Log at {0}\.claude\hook-state\probe.log" -f $RealHome) -Encoding utf8
    Note 'fault: planted a raw real-home path in the repo'
}
if ($Fault -eq 'secret') {
    # Assembled rather than written out, because a literal credential pair in this file would
    # trip the repo's own secret guard on the next push - which is the guard working correctly.
    $pair = '{ "' + 'refresh' + '_token": "' + ('A1b2C3d4E5' * 3) + '" }'
    Set-Content -Path (Join-Path $Clone 'claude\skills\secret-probe.json') -Value $pair -Encoding utf8
    Note 'fault: planted a credential value in the repo'
}
if ($Fault -eq 'dead-link') {
    # Has to be a directory something actually links TO. agents/skills holds more skills than
    # ~/.claude/skills junctions to, so picking the first directory there hits a non-linked one
    # and the fault quietly does nothing - which it did, the first time.
    $link   = (Read-JsonArray -Path (Join-Path $Clone 'claude\skill-links.json'))[0]
    $victim = Join-Path $Clone ('agents\skills\' + (Split-Path $link.Target -Leaf))
    Remove-Item -Path $victim -Recurse -Force
    Note ('fault: removed a junction target from the repo - ' + $link.Name)
}
Write-Host ''

# ------------------------------------------------------------------ 1. run the installer

$log = Join-Path $FakeRoot 'install.log'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Clone 'install.ps1') `
    -UserHome $FakeHome *> $log
$installExit = $LASTEXITCODE

Write-Host 'Install'
Check 'install.ps1 exits 0' ($installExit -eq 0) @(Get-Content $log -Tail 15)

# Post-install faults: breakage the restore itself would have to catch, which cannot be staged
# in the repo because the repo is the thing being restored FROM.
if ($Fault -eq 'missing') {
    $victim = Get-ChildItem -Path (Join-Path $FakeHome '.claude\projects') -Recurse -File | Select-Object -First 1
    Remove-Item $victim.FullName -Force
    Note ('fault: deleted a restored file - ' + $victim.Name)
}
if ($Fault -eq 'drift') {
    Add-Content -Path (Join-Path $FakeHome '.claude\CLAUDE.md') -Value 'appended after restore'
    Note 'fault: a restored file no longer matches the repo'
}
if ($Fault -eq 'broken-hook') {
    Set-Content -Path (Join-Path $FakeHome '.claude\hooks\session-gate.js') `
                -Value 'throw new Error("restored hook is broken");' -Encoding utf8
    Note 'fault: a restored hook is present but not runnable'
}

# Pair every repo file with where it should have landed. Everything below reads this list, so a
# path convention that changes only has to change here.
$pairs = @()
foreach ($item in (Get-DotfileItems -RepoRoot $Clone -UserHome $FakeHome)) {
    $repoPath = Join-Path $Clone ($item.Repo -replace '/', '\')
    if ($item.Type -eq 'File') {
        $pairs += [pscustomobject]@{ Repo = $repoPath; Local = $item.Local; Group = $item.Repo }
    } elseif (Test-Path $repoPath) {
        Get-ChildItem -Path $repoPath -Recurse -File | ForEach-Object {
            $relative = $_.FullName.Substring($repoPath.Length).TrimStart('\')
            if (Test-Excluded -RelativePath $relative) { return }
            $pairs += [pscustomobject]@{
                Repo  = $_.FullName
                Local = (Join-Path $item.Local $relative)
                Group = $item.Repo
            }
        }
    }
}

$memoryRoot = Join-Path $Clone 'memory'
$memoryDirs = @()
if (Test-Path $memoryRoot) {
    $memoryDirs = Get-ChildItem -Path $memoryRoot -Directory
    foreach ($dir in $memoryDirs) {
        $slug   = ConvertFrom-TokenSlug -Slug $dir.Name -UserHome $FakeHome
        $target = Join-Path $FakeHome (".claude\projects\" + $slug + "\memory")
        Get-ChildItem -Path $dir.FullName -Recurse -File | ForEach-Object {
            $relative = $_.FullName.Substring($dir.FullName.Length).TrimStart('\')
            if (Test-Excluded -RelativePath $relative) { return }
            $pairs += [pscustomobject]@{
                Repo  = $_.FullName
                Local = (Join-Path $target $relative)
                Group = 'memory'
            }
        }
    }
}

# ------------------------------------------------------------------ 2. everything landed

Write-Host ''
Write-Host 'Files'
$missing = @($pairs | Where-Object { -not (Test-Path $_.Local) } | ForEach-Object { $_.Local })
Check ("all {0} whitelisted files exist under the fake home" -f $pairs.Count) ($missing.Count -eq 0) $missing

# Restoring more than the repo carries would mean the installer invented something; restoring
# fewer is caught above. Both are worth knowing.
$restored = @(Get-ChildItem -Path $FakeHome -Recurse -File -ErrorAction SilentlyContinue |
              Where-Object { $_.FullName -notlike '*\.claude-dotfiles-backup-*' })
Check 'no files beyond the whitelist were written' ($restored.Count -eq $pairs.Count) `
    @(("repo pairs {0}, restored {1}" -f $pairs.Count, $restored.Count))

# ------------------------------------------------------------------ 3. slugs de-tokenized

Write-Host ''
Write-Host 'Path templating'
$stillTokenised = @(Get-ChildItem -Path $FakeHome -Recurse -Directory -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -like '*__USERHOME*' } | ForEach-Object { $_.FullName })
Check 'no memory directory kept its __USERHOME_SLUG__ name' ($stillTokenised.Count -eq 0) $stillTokenised

$fakeSlug = (Get-HomeForms -UserHome $FakeHome).Slug
$badSlug  = @()
foreach ($dir in $memoryDirs) {
    $slug = ConvertFrom-TokenSlug -Slug $dir.Name -UserHome $FakeHome
    if (-not $slug.StartsWith($fakeSlug)) { $badSlug += ("{0} -> {1}" -f $dir.Name, $slug) }
}
Check ("all {0} memory slugs re-slugged onto the new username" -f $memoryDirs.Count) ($badSlug.Count -eq 0) $badSlug

# ------------------------------------------------------------------ 4/5. no residue

$textFiles = @($restored | Where-Object { Test-TextFile -Path $_.FullName })

# Only the four tokens ConvertFrom-Tokens actually substitutes. __USERHOME_SLUG__ is deliberately
# excluded: it is a DIRECTORY-name token, never a content one, so it survives inside a file by
# design - a memory file documenting this repo names it in prose. Matching the word rather than
# the substitution would fail the run on a correct restore, which is how a check gets ignored.
$pathToken = [regex]'__USERHOME(_JSON|_POSIX|_FWD)?__'

$tokenLeft = @()
$homeLeft  = @()
$forms     = Get-HomeForms -UserHome $RealHome
foreach ($file in $textFiles) {
    $content = [System.IO.File]::ReadAllText($file.FullName)
    if ($pathToken.IsMatch($content)) { $tokenLeft += $file.FullName }
    foreach ($form in @($forms.Json, $forms.Posix, $forms.Fwd, $forms.Raw)) {
        if ($content.Contains($form)) { $homeLeft += ("{0}  ({1})" -f $file.FullName, $form); break }
    }
}
Check ("no __USERHOME token survives in {0} restored text files" -f $textFiles.Count) ($tokenLeft.Count -eq 0) $tokenLeft
Check 'no real-home path survives in any restored text file' ($homeLeft.Count -eq 0) $homeLeft

# ------------------------------------------------------------------ 6. settings.json is usable

Write-Host ''
Write-Host 'settings.json'
$settingsPath = Join-Path $FakeHome '.claude\settings.json'
$settings = $null
try { $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json } catch { }
Check 'parses as JSON after the rewrite' ($null -ne $settings)

if ($null -ne $settings) {
    $commands = @()
    if ($settings.PSObject.Properties.Name -contains 'statusLine') { $commands += $settings.statusLine.command }
    foreach ($event in $settings.hooks.PSObject.Properties) {
        foreach ($group in $event.Value) { foreach ($hook in $group.hooks) { $commands += $hook.command } }
    }

    $wrongHome = @()
    $absent    = @()
    foreach ($command in $commands) {
        foreach ($m in ([regex]'"([A-Za-z]:\\[^"]+)"').Matches($command)) {
            $p = $m.Groups[1].Value
            if (-not $p.ToLower().StartsWith($FakeHome.ToLower())) { $wrongHome += $p; continue }
            if (-not (Test-Path $p)) { $absent += $p }
        }
    }
    Check ("all {0} hook paths point inside the fake home" -f $commands.Count) ($wrongHome.Count -eq 0) $wrongHome

    # The plugin cache is deliberately not carried (10 MB, and it rebuilds on first launch), so the
    # statusLine path is expected to be absent. Anything else absent is a broken restore.
    $unexpected = @($absent | Where-Object { $_ -notlike '*\plugins\cache\*' })
    Check 'every hook script it names exists' ($unexpected.Count -eq 0) $unexpected
    foreach ($a in ($absent | Where-Object { $_ -like '*\plugins\cache\*' })) {
        Note ("expected-absent (rebuilds on first launch): {0}" -f $a)
    }
}

# ------------------------------------------------------------------ 6b. skill junctions

# The check that would have caught the original hole: most flow skills reach ~/.claude/skills
# through a junction, and a junction is invisible to a file copy. Present-and-empty is the
# failure mode to look for, so this asserts the target resolves and carries a SKILL.md.
Write-Host ''
Write-Host 'Skill junctions'
$linkFile = Join-Path $Clone 'claude\skill-links.json'
if (-not (Test-Path $linkFile)) {
    Check 'claude/skill-links.json is in the repo' $false @('push never recorded the junctions')
} else {
    $links = Read-JsonArray -Path $linkFile
    Check 'skill-links.json lists the junctions' ($links.Count -gt 0)
    $broken = @()
    foreach ($link in $links) {
        $linkPath = Join-Path $FakeHome (".claude\skills\" + $link.Name)
        if (-not (Test-Path $linkPath)) { $broken += ("{0}: not recreated" -f $link.Name); continue }
        $item = Get-Item $linkPath -Force
        if (-not (Test-IsLink -Item $item)) {
            $broken += ("{0}: exists but is not a link" -f $link.Name); continue
        }
        $target = Get-LinkTarget -Item $item
        if (-not $target.ToLower().StartsWith($FakeHome.ToLower())) {
            $broken += ("{0}: points outside the fake home - {1}" -f $link.Name, $target); continue
        }
        if (-not (Test-Path (Join-Path $linkPath 'SKILL.md'))) {
            $broken += ("{0}: link resolves to nothing readable" -f $link.Name)
        }
    }
    Check ("all {0} junctioned skills resolve to a real SKILL.md" -f $links.Count) ($broken.Count -eq 0) $broken

    # The flows the global CLAUDE.md names by name. If these are missing the machine restores
    # into a configuration whose own rules point at skills that are not there.
    $required = @('ask-matt', 'implement', 'tdd', 'triage', 'handoff', 'to-spec', 'to-tickets',
                  'code-review', 'diagnosing-bugs', 'grill-with-docs', 'wayfinder', 'research')
    $absentFlows = @($required | Where-Object {
        -not (Test-Path (Join-Path $FakeHome (".claude\skills\" + $_ + "\SKILL.md")))
    })
    Check 'every flow skill named in the global CLAUDE.md is invocable' ($absentFlows.Count -eq 0) $absentFlows
}

# ------------------------------------------------------------------ 7. round trip is lossless

Write-Host ''
Write-Host 'Fidelity'
$drift = @()
foreach ($pair in $pairs) {
    if (-not (Test-Path $pair.Local)) { continue }
    if (-not (Test-TextFile -Path $pair.Repo)) {
        $a = [System.IO.File]::ReadAllBytes($pair.Repo)
        $b = [System.IO.File]::ReadAllBytes($pair.Local)
        if (-not ([System.Linq.Enumerable]::SequenceEqual($a, $b))) { $drift += $pair.Local }
        continue
    }
    # Re-tokenizing the restored file with the FAKE home must reproduce the repo file exactly.
    # That is the whole round trip - detokenize on pull, tokenize on the next push - so a
    # mismatch here is a file that would come back different from the machine it was sent to.
    $back = ConvertTo-Tokens -Text ([System.IO.File]::ReadAllText($pair.Local)) -UserHome $FakeHome
    if (-not ($back -ceq [System.IO.File]::ReadAllText($pair.Repo))) { $drift += $pair.Local }
}
Check ("all {0} files survive tokenize/detokenize byte-for-byte" -f $pairs.Count) ($drift.Count -eq 0) $drift

# ------------------------------------------------------------------ 8. nothing secret came along

Write-Host ''
Write-Host 'Secrets'
$credentialFiles = @($restored | Where-Object { Test-Excluded -RelativePath $_.Name } | ForEach-Object { $_.FullName })
Check 'no credential-shaped filename was restored' ($credentialFiles.Count -eq 0) $credentialFiles
Check 'restored tree passes the value-shaped secret guard' (Assert-NoSecrets -Root $FakeHome)

# ------------------------------------------------------------------ 9. it actually runs

Write-Host ''
Write-Host 'Executable from the new home'

$gateTest = Join-Path $FakeHome '.claude\hooks\session-gate.test.js'
if (Test-Path $gateTest) {
    $out = & node --test $gateTest 2>&1
    Check 'restored session-gate.js passes its own test suite' ($LASTEXITCODE -eq 0) @($out | Select-Object -Last 12)
} else {
    Check 'restored session-gate.js passes its own test suite' $false @('session-gate.test.js was not restored')
}

$gate = Join-Path $FakeHome '.codex\hooks\ask_matt_gate.py'
$sample = Join-Path $FakeRoot 'sample-reply.txt'
Set-Content -Path $sample -Value 'Restore works. Fake home holds config.' -Encoding utf8
$env:GOVERNANCE_CLAUDE_HOME = (Join-Path $FakeHome '.claude')
$out = & py -3 $gate lint $sample 'restore-test-session' 2>&1
$gateExit = $LASTEXITCODE
Remove-Item Env:\GOVERNANCE_CLAUDE_HOME
# 0 clean / 1 violations. A traceback is neither, and is what a broken restore looks like.
Check 'restored ask_matt_gate.py runs the pre-send lint' ($gateExit -eq 0 -or $gateExit -eq 1) @($out | Select-Object -Last 10)

$check = Join-Path $FakeHome '.claude\skills\session-check\check.js'
Push-Location $Clone
$out = & node $check 2>&1
$checkExit = $LASTEXITCODE
Pop-Location
$ran = ($checkExit -eq 0 -or $checkExit -eq 1) -and (($out -join "`n") -match 'Starting a session')
Check 'restored session-check reports on a repo' $ran @($out | Select-Object -Last 10)

# ------------------------------------------------------------------ 10. two runs can overlap

# The regression check for the false failure of 2026-08-13. Two children run the scratch-root code
# path at the same time; each must still own its marker when it wakes. Under the old constant root
# the second child's wipe took the first child's marker with it and both runs reported failure.
Write-Host ''
Write-Host 'Concurrency'

$probeArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $SelfPath,
               '-Probe', '-ProbeHoldMs', '2000')
# The fault reinstates the old behaviour by handing both children one fixed root, which is
# exactly what the constant used to do to every run on the machine.
if ($Fault -eq 'collision') {
    $probeArgs += @('-FakeHome', (Join-Path $ScratchBase 'collision\Users\Restored'))
    Note 'fault: both concurrent runs were pinned to one scratch root'
}

# Start-Job, not Start-Process -PassThru: on PowerShell 5.1 the process object returned by
# Start-Process without -Wait comes back with an empty ExitCode, so a crashed child read as a pass.
# Inside a job, $LASTEXITCODE is the child's own, and both jobs still run as separate processes.
$jobs = @(1, 2 | ForEach-Object {
    Start-Job -ArgumentList (, $probeArgs) -ScriptBlock {
        param($childArgs)
        $out = & powershell @childArgs 2>&1
        [pscustomobject]@{ Exit = $LASTEXITCODE; Out = ($out | Out-String) }
    }
})
$results    = @($jobs | Wait-Job | Receive-Job)
$jobs | Remove-Job -Force
$probeLines = @($results | ForEach-Object { $_.Out -split "`r?`n" } | Where-Object { $_ -match '^probe ' })
$clobbered  = @($probeLines | Where-Object { $_ -match 'CLOBBERED' })
$exits      = @($results | ForEach-Object { if ($null -eq $_.Exit) { 'null' } else { $_.Exit } })
$bothOk     = (@($exits | Where-Object { $_ -ne 0 }).Count -eq 0) -and ($clobbered.Count -eq 0) -and
              ($probeLines.Count -eq 2)
Check 'two overlapping runs both keep their scratch directory' $bothOk `
    (@(("exit codes: {0}" -f ($exits -join ', '))) + $probeLines)

$roots = @($probeLines | ForEach-Object { ($_ -split ' root ')[1] -replace ' (intact|CLOBBERED)$', '' })
Check 'each run derives its own scratch root' `
    (($roots.Count -eq 2) -and ($roots[0] -ne $roots[1])) $roots

# ------------------------------------------------------------------ verdict

# Holds the clone open for the rest of the run, which is what a child process left over from check
# 9 does by accident. A passing run must still report a pass; the scratch is the tidying up.
if ($Fault -eq 'locked-scratch') {
    $lock = [System.IO.File]::Open((Join-Path $Clone 'README.md'), 'Open', 'Read', 'None')
    Note 'fault: something is holding the scratch directory open'
}

Write-Host ''
# node --test's shape, because that is what the dashboard's testSummary() parses. Without these two
# lines it falls through to the last line printed and the health line reads "Scratch removed."
Write-Host ("pass {0}" -f ($script:Checks - $script:Failures))
Write-Host ("fail {0}" -f $script:Failures)
Write-Host ''
if ($script:Failures -eq 0) {
    Write-Host ("RESTORE PROVEN - {0} checks, 0 failures" -f $script:Checks) -ForegroundColor Green
} else {
    Write-Host ("RESTORE NOT PROVEN - {0} of {1} checks failed" -f $script:Failures, $script:Checks) -ForegroundColor Red

    # A hook that swallows stdout leaves a failure with no evidence behind it, and an intermittent
    # one then cannot be diagnosed after the fact - which is exactly the position a run at
    # 2026-08-13 16:44 UTC left this repo in. The log outlives the run.
    $logDir = Join-Path $env:TEMP 'restore-test-failures'
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $stamp   = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $logPath = Join-Path $logDir ("{0}-{1}.log" -f $stamp, $PID)
    $header  = @(
        ("when      {0}" -f (Get-Date).ToString('o')),
        ("from      {0}" -f $From),
        ("fault     {0}" -f $Fault),
        ("fakeHome  {0}" -f $FakeHome),
        ("repo      {0}" -f $RepoRoot),
        ("commit    {0}" -f (& git -C $RepoRoot rev-parse --short HEAD 2>&1)),
        ("verdict   {0} of {1} checks failed" -f $script:Failures, $script:Checks),
        ''
    )
    Set-Content -Path $logPath -Value ($header + $script:FailLog) -Encoding utf8
    Write-Host ("Failure detail written to {0}" -f $logPath) -ForegroundColor Red
}

if ($Keep) {
    Write-Host ("Left in place: {0}" -f $FakeRoot)
} else {
    # Check 9 runs the restored session-check inside the clone, and its own children (git, gh, a
    # nested run) can still hold that directory a moment after it returns. With
    # $ErrorActionPreference = 'Stop' the failed delete ended the script non-zero, so a run whose
    # 21 checks all passed reported "tests FAIL" to the session hooks - observed 2026-08-13 16:44
    # UTC and again in the pre-commit gate. Tidying up is not a check, and must not decide the
    # verdict: retry briefly, then leave it for the next run's sweep and say so.
    $removed = $false
    for ($attempt = 1; $attempt -le 5 -and -not $removed; $attempt++) {
        try {
            Remove-Item -Path $FakeRoot -Recurse -Force -ErrorAction Stop
            $removed = $true
        } catch {
            Start-Sleep -Milliseconds 400
        }
    }
    if ($removed) {
        Write-Host 'Scratch removed.'
    } else {
        Write-Host ("Scratch still locked, left at {0} - a later run sweeps it." -f $FakeRoot) -ForegroundColor DarkGray
    }
}

if ($script:Failures -gt 0) { exit 1 }
exit 0
