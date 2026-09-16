# Issue 199 - desktop verification (delivery stage)

The automated half of AC1 - bypassPermissions in the settings mirror and hasTrustDialogAccepted
records in ~/.claude.json - is landed by every `sync.ps1 -Mode pull` (which install.ps1 calls),
and proven by the restore test:

- `permissions.defaultMode carries bypassPermissions (issue 199)`
- `.claude.json exists after pull (invariant tool seeds it)`
- `each of the four master-watchdog clone paths carries hasTrustDialogAccepted=true`

The other half - "shown by transcript/screenshot" - has to be captured on a real desktop because
it is a fresh interactive claude launch, which no CI runner and no worktree agent can perform.
Run these steps on the PC after this branch reaches master and the machine's next pull runs.

## 1. Land the settings

From the claude-dotfiles checkout:

```powershell
git pull
.\sync.ps1 -Mode pull
```

The pull's `settings.json invariants (live)` block should print `ok:` for
`~/.claude/settings.json` and either `ok:` for each of the four clones or a `set:`/`add:` line
that changes them to `hasTrustDialogAccepted=true`. A `MISSING` line (state file gone) is a
regression - the tool seeds a minimal one, and only `-DryRun` skips the write.

## 2. Confirm the two files on disk

```powershell
Get-Content $env:USERPROFILE\.claude\settings.json |
  Select-String -Pattern 'defaultMode'
# "defaultMode": "bypassPermissions"

$state = Get-Content $env:USERPROFILE\.claude.json -Raw | ConvertFrom-Json
foreach ($c in @(
    'Claude\Projects\Financial\aac-bill-intake',
    'Claude\Projects\Sales Data KPIs\contract-builder',
    'Claude\Projects\Sales Data KPIs\aac-cockpit',
    'Claude\Projects\Operations\zoho-source-of-truth')) {
    $p = Join-Path $env:USERPROFILE $c
    "{0,-6}  {1}" -f $state.projects.$p.hasTrustDialogAccepted, $p
}
# True   ...\aac-bill-intake
# True   ...\contract-builder
# True   ...\aac-cockpit
# True   ...\zoho-source-of-truth
```

## 3. Capture the transcript / screenshot per clone

For each of the four clones - bill-intake, contract-builder, sales-cockpit, zoho-source-of-truth:

```powershell
cd C:\Users\Dan\Claude\Projects\Financial\aac-bill-intake
claude --print "say READY and stop" --output-format json > $env:TEMP\issue-199-bill-intake.json
```

`--print` runs claude non-interactively but exercises the SAME startup path as an interactive
launch: permission-dialog and trust-dialog checks fire, or they don't. A successful run writes
JSON to the file and exits 0. Either dialog would leave the process waiting for input, and
`--print` would time out or return a shell error rather than a `.result` payload with READY.

The four JSON outputs collectively are the AC1 evidence: no permission dialog, no trust dialog,
first prompt reached in every clone. Attach them to the ticket.

An interactive screenshot works too if preferred - launch `claude` in each clone and screenshot
the first prompt reached without a dialog - but the four JSON outputs are the smaller record and
survive rebase into the ticket comment thread.

## 4. If a clone still stalls on a dialog

- **Permission dialog reappears** - the mirror rebuild dropped `permissions.defaultMode` from
  `claude/settings.json`, or a later hand edit did. Check the current mirror, re-push if needed,
  re-pull, re-run step 1.
- **Folder-trust dialog reappears** - the four paths in `tools/settings-invariants.ps1` no
  longer match this machine's clone layout (a clone moved, or the four names are stale). Fix
  the path list in the tool, re-pull, re-run step 2.
