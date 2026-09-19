---
name: hook-exit-126-is-the-mode-bit
description: "A settings hook that leaves no trace died before its first line: read hook_spawn_completed in $CLAUDE_CODE_DIAGNOSTICS_FILE, exit 126 = not executable; and ${CLAUDE_PLUGIN_ROOT} never resolves in settings.json (2026-09-19, issue 614)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9e978f2d-96a9-5db9-91c2-f651e56b68dc
  modified: 2026-09-19T06:30:00.000Z
---

Two hook facts that cost three harness versions (v27-v29) of green gates over a bootstrap that
never ran once in a container (issue 614, found doing #600 on aac-contract-builder).

**Read the diagnostics log before theorising.** `$CLAUDE_CODE_DIAGNOSTICS_FILE` (a cloud
container sets it; `/tmp/claude-code-*.diag.log`) records every hook spawn:
`hook_spawn_completed {"hook_event_name":"SessionStart","duration_ms":5,"exit_code":126}`.
Exit 126 in single-digit milliseconds is "Permission denied": the file is not executable and the
shell never started, so no marker, no stderr, no STOP line can exist. A hook's own failure
reporting starts at its first line; anything before that is only in this log. `git ls-files -s
<hook>` reading `100644` is the cause — `fs.chmod` and `chmod +x` are invisible to git under
`core.fileMode=false`, which is every Windows checkout; only `git update-index --chmod=+x` changes
what gets committed. Wire settings hooks as `bash "<path>"`, never the bare path.

**`${CLAUDE_PLUGIN_ROOT}` is refused in settings.json.** Claude Code resolves it only for hooks a
plugin registered from its own `hooks/hooks.json`. A command copied into `~/.claude/settings.json`
fails every time with `Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated
with a plugin` (114 in one session's `/tmp/claude-code.log`), and a hook that merely echoes a
marker beside it proves nothing about the rest. Seat such commands: absolute path in the text,
`CLAUDE_PLUGIN_ROOT=<path>` in front for scripts that read the env, and `PLUGIN_HOOK_GUARD_DISABLE=1`
because the payload's dedup guard exits silently when settings.json names the script.

**A gate that reads entries is not a gate.** `tests/bootstrap-test.sh` check 7 now executes the
merged hooks; that is the assertion the previous 14 lacked.
