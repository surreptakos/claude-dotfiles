---
name: ps51-scripts-need-a-bom
description: "A .ps1 that Windows PowerShell 5.1 runs (Task Scheduler, powershell.exe) must carry a UTF-8 BOM or any non-ASCII char in a string breaks the parse; the Write tool drops the BOM"
metadata: 
  node_type: memory
  type: project
  originSessionId: 71b30f27-7c0a-4ac0-86b0-e50d45a35100
  modified: 2026-09-02T21:27:36.500Z
---

`orchestrator/master-watchdog.ps1` runs from Task Scheduler. Written fresh with the Write tool (no BOM) it failed under `powershell.exe` 5.1 with `You cannot call a method on a null-valued expression` and `The term 'else' is not recognized` on plain if/else lines: 5.1 read the BOM-less file as ANSI and the em dashes inside strings became a `”` that ended the string early. PowerShell 7 (`pwsh`, the tool engine since 2026-08-31) reads it fine either way, which is why the tool-side runs passed and the 5.1 run did not.

**Why:** 5.1 defaults to the ANSI code page for BOM-less files; 7 defaults to UTF-8.

**How to apply:** after writing or rewriting a `.ps1` in this repo, re-save it with `New-Object System.Text.UTF8Encoding $true` (or check bytes 0-2 are EF BB BF), or keep strings ASCII-only. Prefer registering scheduled tasks against `pwsh.exe` when it exists — `install-watchdog-task.ps1` does since 2026-09-02. Also: `-WhatIf` via `SupportsShouldProcess` leaks into the CimCmdlets module import and prints a dozen `What if: Set Alias` lines; a plain `[switch]$WhatIf` avoids it. Related: [[powershell-7-is-the-tool-engine]].
