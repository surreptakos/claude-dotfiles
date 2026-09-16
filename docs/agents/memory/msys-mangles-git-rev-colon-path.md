---
name: msys-mangles-git-rev-colon-path
description: "In the Bash tool, `git show origin/master:path/file` fails because MSYS path conversion rewrites the rev:path argument; read the local file or set MSYS_NO_PATHCONV=1"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 09db5a64-421a-4918-b4f6-8d81ee05c17c
  modified: 2026-09-10T16:23:48.708Z
---

`git show origin/master:.claude-plugin/marketplace.json` in the Bash tool errored with
`ambiguous argument 'origin\master;.claude-plugin\marketplace.json'` (2026-09-10): MSYS treated the
colon as a path-list separator and converted both halves to Windows paths.

**Why:** Git Bash converts arguments that look like POSIX paths; a `rev:path` spec looks like a
two-entry path list.

**How to apply:** prefix the command with `MSYS_NO_PATHCONV=1`, or when the working tree equals
the pushed commit (`git status --short` empty, nothing unpushed) read the local file instead. A
command substitution that silently yields an empty string then feeds an empty `--version` into a
stamp; check the captured value before using it. See [[bash-tool-collapses-backslashes]].
