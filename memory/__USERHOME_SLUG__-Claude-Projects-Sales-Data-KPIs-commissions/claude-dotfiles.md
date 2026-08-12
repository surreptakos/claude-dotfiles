---
name: claude-dotfiles
description: Meta/claude-dotfiles carries ~/.claude + ~/.codex/hooks between machines; push after editing a skill or global CLAUDE.md
metadata: 
  node_type: memory
  type: project
  originSessionId: ab9ced42-0bad-436d-b16d-73cdd97e4941
  modified: 2026-08-12T20:32:57.231Z
---

`__USERHOME__\Claude\Projects\Meta\claude-dotfiles` (built 2026-08-12, git, **no remote yet**) carries
the half of the setup no project repo holds: global `CLAUDE.md`, `settings.json`, `skills/`,
`~/.claude/hooks/`, `~/.codex/hooks/ask_matt_gate.py`, plugin manifests, and per-project `memory/`
for 9 projects — 256 files.

- `.\sync.ps1 -Mode push` — this machine into the repo, then commit. `-Mode pull` restores, backing up
  to `~/.claude-dotfiles-backup-<stamp>` first. `install.ps1` = prerequisites + pull + the manual list.
- Home paths are stored as `__USERHOME__` tokens in four spellings (raw, JSON-escaped, forward-slash,
  Git-Bash) and memory dir slugs as `__USERHOME_SLUG__`, so a different username still restores.
- Whitelist in `lib/manifest.ps1` is the guard; a value-shaped secret scan is the backstop.
- Credentials never travel: SA key, `client_secret_*.json`, and `~/.clasprc.json` (re-authorize with
  `tools/clasp-auth.js` instead — see [[sheet-rest-api-access]]).

**Why:** a skill edited on one machine is invisible to the other, and the failure is silent — the
other machine keeps working with the older rule.

**How to apply:** push after changing a skill, a hook, or the global `CLAUDE.md`. Project side is
documented in `docs/runbooks/new-machine.md`.
