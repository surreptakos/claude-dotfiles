---
name: powershell-7-is-the-tool-engine
description: "PowerShell 7 installed 2026-08-31; the PowerShell tool re-resolves its engine per call, and ConvertTo-Json now indents 2 spaces"
metadata: 
  node_type: memory
  type: project
  originSessionId: 422b7e48-b3a2-49db-ba3f-ef7dfd40388a
  modified: 2026-08-31T16:27:51.236Z
---

PowerShell 7.6.5 was installed 2026-08-31 at `C:\Program Files\PowerShell\7\pwsh.exe`, which is the
first entry on `claude.exe`'s fixed interpreter list — it does not consult PATH.

Two things that cost time to establish:

- The PowerShell tool **re-resolves its engine per call, not once at session launch**. Installing
  pwsh mid-session flipped `$PSVersionTable.PSVersion` from `5.1.26100.9168` to `7.6.5` in the same
  session, with no restart. Do not tell the owner to restart for the interpreter. `CLAUDE_CODE_USE_POWERSHELL_TOOL`
  is different — that one is read at launch.
- `ConvertTo-Json` indents 4 spaces on 5.1 and 2 spaces on 7, so a file written by both engines
  shows whole-file diffs of identical content; `git diff -w` is empty when this is the cause. It bit
  `claude/skill-links.json` (commit `5c0e270`), which retired with issue 214 along with the push
  that wrote it.

winget cannot deliver this: `Microsoft.PowerShell` ships an msixbundle only, which deploys under
`WindowsApps` and is invisible to that fixed list. The MSI from the GitHub release is the only route,
and it needs elevation.

