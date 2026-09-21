---
name: cowork-runs-plugin-hooks
description: "Cowork DOES run the aac-skills plugin hooks, on the Windows host (proved 2026-09-18, plugin 2026.9.182049): SessionStart marker delivered with host and timestamp, PreToolUse gate fires; the model's shell is a Linux sandbox tool named mcp__workspace__bash"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6163f97e-2557-4f4b-a19e-f45845bf9312
  modified: 2026-09-18T21:30:00.000Z
---

Cowork runs the aac-skills plugin hooks. Proved 2026-09-18 on claude-dotfiles #228: a Cowork session
quoted the SessionStart marker with its runtime values (`RUNTIME PROBE: os=MINGW64_NT-10.0-26200 ...
home=/c/Users/Dan host=Dan-Inspiron15`), and its session export shows the PreToolUse ask-matt gate
denying every tool call. The hooks run on the Windows host from the desktop app's plugin directory
(`%APPDATA%\Claude\local-agent-mode-sessions\<account>\<org>\rpm\plugin_<id>`, plugin.json
`2026.9.182049` that day), while the model's shell is a Linux sandbox exposed as the tool
`mcp__workspace__bash`, not `Bash`. The 2026-09-03 test that found no marker ran an older build, and
this note said the opposite until 2026-09-18.

**Why:** the governance stack (ask-matt gate, YES lint, caveman level) reaches Cowork after all, but
any hook that exempts a command by tool name `Bash`/`PowerShell`, or tells the model to run a Windows
path with `py -3`, deadlocks there: the gate's declare exemption never matches `mcp__workspace__bash`,
so no tool call can satisfy it (claude-dotfiles issue #608).

**Fixed 2026-09-21 (issue 608):** the gate now takes the declaration from any shell tool, `Bash`, `PowerShell` or `mcp__<server>__bash`, tolerates a trailing `; echo "exit=$?"`, and refuses a surface with no shell at all once per session instead of forever.

**How to apply:** treat Cowork as a hooked surface with a Linux shell. A hook that gates tool calls
must recognise `mcp__workspace__bash` and print a command the sandbox can run (`python3` on the
plugin-root path, never `py -3` on a Windows path). Keep the text-only rules in the global CLAUDE.md
too; they are the floor, not the whole. Related: [[marketplace-is-the-distribution-spine]],
[[cowork-transcripts-not-local]], [[gate-declare-bare-command]].
