---
name: windows-claude-code-hooks
description: "On this user's native Windows machine, Claude Code hooks must invoke python, not bash .sh scripts"
metadata: 
  node_type: memory
  type: reference
  originSessionId: d3e81e4f-f264-4415-926d-d5eb0c7fdddf
---

The user runs Claude Code on native Windows (PowerShell primary, Git Bash also present). Claude Code picks the hook shell as Git Bash if installed, otherwise PowerShell. A `.sh` hook that relies on a `#!/usr/bin/env bash` shebang and `$HOME` is unreliable here, so write hook logic in Python and register the command as `python __USERHOME_FWD__/.claude/hooks/<name>.py`. Forward-slash paths and bare `python` (Python 3.13 on PATH) both resolve under either shell. Reconfigure `sys.stderr` to UTF-8 inside the hook so matched tokens such as em dashes do not raise a UnicodeEncodeError on the console code page.

Applied for the stop-slop write and stop gates. See [[stop-slop-gate-installed]].
