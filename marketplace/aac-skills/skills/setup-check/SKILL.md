---
name: setup-check
description: Run the setup check on this Windows desktop - audit and fix its local build, register or stand down the desktop routines, list what only the owner can do. Use when the user asks to check or set up a PC, or the setup check's to-do says to run /setup-check.
metadata:
  modified: '2026-09-30T21:08:10Z'
  previous-modified: none
  revision: '1'
  content-sha: c21803f4762e
---

# Setup check

The engine is `setup-check.ps1` in the claude-dotfiles clone; this skill runs it and does the one
thing it cannot: change desktop routines, which only a Claude session's scheduled-tasks tools can
reach. Terms (local build, setup check, anchor PC) are in that repo's `CONTEXT.md`.

Paths come from `$env:USERPROFILE`, never a literal home: the plugin is built on one PC and runs on
all of them. Quote every path. Commands below are for the PowerShell tool.

## 1. Find the clone

```powershell
$d = Join-Path $env:USERPROFILE 'Claude\Projects\Meta\claude-dotfiles'
if (-not (Test-Path -LiteralPath (Join-Path $d '.git'))) { gh repo clone surreptakos/claude-dotfiles "$d" }
git -C "$d" pull --ff-only
```

A failed clone ends the run: report gh's error and the bare-PC steps in the clone's README
(`gh auth login` first). The anchor name is read from this checkout, so a failed pull, or a clone
not on `master`, is reported as "anchor name may be stale" and the run continues on what is there.

Done when `$d\setup-check.ps1` exists.

## 2. Run the engine with fixes

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$d\setup-check.ps1" -Fix
```

Windows PowerShell 5.1, always, even where pwsh exists. Keep the whole report. Exit 0 is clean, 1
means a STOP remains (normal on a new PC; carry on), 2 means the check could not run: quote its
last line and stop.

Done when you hold the report and its exit code.

## 3. Act on the routine findings

Read two lines under **Projects**: `<PC> is the anchor PC` or `<PC> is not the anchor PC`, and the
desktop-routines line. The routine ids are the comma-separated list after its colon. An `ok`
routine line, a `not audited` line or a `--` line means nothing to act on; report it and skip to
step 4.

The tools write to the signed-in account, and the audit counts a routine only under its owner
(`~/.claude/accounts.json`). Run this from a session signed in to that owner.

Only two tool calls change routines: `create_scheduled_task` and `update_scheduled_task`. A
routine is never deleted and no registry file is edited, even when a routine looks wrong: that is
an owner to-do.

**Anchor PC** - `N of M desktop routines not registered here: <ids>`. Call `list_scheduled_tasks`
once, then for each id:

```powershell
$r = Join-Path $env:USERPROFILE 'Claude\Projects\Meta\aac-routines'
py -3 "$r\scripts\desktop_routines.py" show <id>
```

- Not in the task list: call `create_scheduled_task` with the output's `create_scheduled_task`
  object as printed, except that a `C:\Users\<name>` home in its `prompt` becomes this PC's
  `$env:USERPROFILE` value. Then, if `registry.enabled` is false, `update_scheduled_task` with
  `enabled: false`.
- In the list but disabled while `registry.enabled` is true: `update_scheduled_task` with
  `enabled: true`.
- Otherwise leave it.
- The tool takes no `cwd`, `model`, `permissionMode` or `useWorktree`. When `registry` holds any,
  add one owner step: set them on that routine in the app's routine settings, with `cwd` under
  this PC's `%USERPROFILE%`.

**Any other PC** - `N desktop routines live on a PC that is not the anchor: <ids>`. For each id,
`update_scheduled_task` with `taskId: <id>` and `enabled: false`.

Then re-run the engine without `-Fix` (same command, flag dropped). Done when its routine line is
`ok`, or names only ids whose `registry.enabled` is false (the audit counts enabled routines
only, so a routine the store keeps disabled always reads as not registered). Any other id still
named is a finding to report with the tool's error.

## 4. Report

Report from the last engine run: the step 3 re-run when there was one, else step 2's. Drop its
`Run /setup-check ...` to-do item: this run is that. Print, in order:

1. The PC and whether it is the anchor, quoting the engine's line.
2. What the routine step did, one line per id (created, disabled, enabled, left), or "nothing".
3. The **Owner to-do**: the engine's numbered items, then the steps from step 3, numbered on
   through. One step per item, its exact command under it in a code block; an item the engine gave
   no command keeps its sentence alone.
4. The engine's last line (`<n> STOP, <n> !!`) and its exit code.
