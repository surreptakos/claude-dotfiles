# claude-dotfiles

The half of a Claude Code setup that lives outside any project repo: the global rules, the skills,
the hooks that enforce them, and the per-project memory. Clone this plus a project and a new machine
behaves like this one.

It does **not** carry credentials. Three files have to move by hand; `install.ps1` names them at the
end of a run.

## What is in here

| Path | Restores to | Why it matters |
|---|---|---|
| `claude/CLAUDE.md` | `~/.claude/CLAUDE.md` | global governance — caveman, YES, ask-matt, the AAC Google access notes |
| `claude/settings.json` | `~/.claude/settings.json` | hook wiring, plugin marketplaces, status line |
| `claude/skills/` | `~/.claude/skills/` | the skills the flows in CLAUDE.md refer to |
| `claude/hooks/` | `~/.claude/hooks/` | `session-gate.js`, `governance-reminder.js`, the stop-slop pair |
| `claude/plugins/*.json` | `~/.claude/plugins/` | which plugins and marketplaces to reinstall — not the 10 MB cache |
| `codex/hooks/` | `~/.codex/hooks/` | `ask_matt_gate.py`, which the pre-send lint and the governance gate both call |
| `memory/<slug>/` | `~/.claude/projects/<slug>/memory/` | per-project memory files |

Nothing else is read. `sync.ps1` copies the whitelist in `lib/manifest.ps1` by name, so a credential
file or a session transcript cannot be swept up by a pattern that was slightly too broad. The
`.gitignore` is only a backstop for things copied in by hand.

## Daily use

```powershell
.\sync.ps1 -Mode push -Commit "chore: sync"   # this machine -> repo, guard, commit
.\sync.ps1 -Mode pull                         # repo -> this machine, backing up first
```

Pass `-Commit` rather than chaining your own `git commit`. A non-zero exit does not stop the next
statement in a PowerShell chain, so `sync.ps1 ; git commit` commits even when the secret guard
failed — which is how the guard got overridden the first time it ever fired.

Push after editing a skill, the global `CLAUDE.md`, or a hook. Pull on the other machine. Add
`-DryRun` to either to see the file list without writing anything.

`push` clears the mirrored trees (`claude/skills`, `claude/hooks`, `codex/hooks`, `memory`) before
copying, so a skill deleted locally also leaves the repo. `pull` never deletes: it writes over what
it carries and leaves anything else alone, after copying the current state to
`~/.claude-dotfiles-backup-<timestamp>`.

## New machine

```powershell
git clone <this repo> ; cd claude-dotfiles ; .\install.ps1
```

It checks for git, node, `py`, `claude`, `clasp` and `gh`, restores the configuration, and prints
what remains: the two secret files, `/login`, `gh auth login`, and `node tools/clasp-auth.js` from a
project repo.

## Absolute paths are stored as tokens

`settings.json` hard-codes `C:\Users\<you>\...` in five hook commands, and a memory directory is
named after the project's absolute path with every non-alphanumeric character replaced by `-`
(`C:\Users\Dan\Claude\Projects\...` becomes `C--Users-Dan-Claude-Projects-...`). Both would break on a
machine with a different username.

Push rewrites the home directory to `__USERHOME__` in every text file, in all four spellings that
occur in practice — `C:\Users\Dan`, the JSON-escaped `C:\\Users\\Dan`, the forward-slash
`C:/Users/Dan`, and the Git-Bash `/c/Users/Dan`. Directory slugs get `__USERHOME_SLUG__`. Pull
substitutes the local home back. A machine with the same username sees no difference; one with a
different username still works.

## The secret guard

`push` refuses to finish if any file it staged matches a credential *value* — a JSON
`"refresh_token": "..."`, a PEM private key header, an `sk-ant-` key, a `ya29.` Google token. The
patterns match assignments, not words, on purpose: the global `CLAUDE.md` discusses `refresh_token`
in prose, and a guard that cries wolf on documentation is a guard someone turns off.

It is a backstop, not the mechanism. The whitelist is the mechanism.

## What this repo deliberately does not solve

Switching *accounts* on one machine is a different problem, solved separately in
`../claude-account-handoff` — that one moves `CLAUDE_CONFIG_DIR` between a work and a personal
profile. This repo carries one profile between machines.
