---
name: cowork-runs-plugin-hooks
description: Cowork executes hooks shipped inside a marketplace plugin (verified 2026-09-03 via the aac-skills SessionStart marker); user-level ~/.claude hooks do not reach it
metadata:
  type: project
---

Cowork runs the agent in a VM, so nothing wired in `~/.claude/settings.json` or pointing at a Windows
path executes there. A hook carried inside the plugin does: on 2026-09-03 a Cowork session quoted the
`AAC-SKILLS HOOK MARKER` sentence emitted by the aac-skills `hooks/hooks.json` SessionStart hook,
"came from SessionStart hook additional context". Docs are silent on this; the marker is the proof.

**Why:** the whole governance stack (ask-matt gate, YES lint, caveman level) lives in user-level
hooks that Cowork never sees; the plugin is the only road in.

**How to apply:** to enforce anything in Cowork, ship it as a plugin hook with a script that needs
only what the VM has. The same SessionStart hook prints `AAC-SKILLS RUNTIME PROBE` (os, python3,
node, pwsh, home) — read that line from a Cowork session before choosing the port language. Cowork
also loads the global `~/.claude/CLAUDE.md` (memory docs), so instruction text reaches it without
hooks. Related: [[marketplace-is-the-distribution-spine]], [[cowork-transcripts-not-local]].
