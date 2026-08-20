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
| `agents/skills/` | `~/.agents/skills/` | where most flow skills actually live; `~/.claude/skills` only junctions to them |
| `claude/skill-links.json` | (recreated junctions) | which skills are junctions and what they point at |
| `codex/hooks/` | `~/.codex/hooks/` | `ask_matt_gate.py`, which the pre-send lint and the governance gate both call |
| `codex/hooks.json` | `~/.codex/hooks.json` | the wiring that calls it — without this the script above is inert |
| `codex/config.toml` | `~/.codex/config.toml` | Codex's settings — model, sandbox, marketplaces, plugin enables, project trust. The counterpart of `claude/settings.json`; carried since issue #2 so the hooks above don't land on default settings. Scanned for credential values (2026-08-12 and 2026-08-19): none — the `sha256:` values in it are trust pins for `hooks.json` entries, not secrets |
| `codex/AGENTS.md` | `~/.codex/AGENTS.md` | Codex's half of the global rules |
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
`~/.claude-dotfiles-backup-<timestamp>`. A pull ends by refreshing `~/.claude-personal` when that
profile exists — see below.

## The personal profile (`~/.claude-personal`)

Issue #9 decisions, 2026-08-19:

- **(a) Adopted** — a pull ends with `Update-PersonalProfile` (`lib/personal.ps1`), a one-way
  overlay from the freshly written `~/.claude` onto `~/.claude-personal`. Hooks, `CLAUDE.md` and
  agents copy verbatim (the hooks are profile-aware via `CLAUDE_CONFIG_DIR`, so identical copies
  are correct); skill junctions are recreated against the same machine-wide targets and real skill
  dirs are overlaid; `settings.json` gets the work profile's **hooks key only**, with the
  mechanical path rewrite `\.claude\` → `\.claude-personal\` (`.codex` paths untouched) — the
  personal model, plugins, statusLine and prefs are preserved; project memories union-merge (work
  files copy in, newer mtime wins, `MEMORY.md` unions by pointer-line target).
- **(b) Declined** — reverse memory sync. Personal-only memories never flow into the work profile
  or into this repo: push reads only `~/.claude`. Declined by default 2026-08-19; flipping it
  requires an explicit owner instruction.

The refresh never deletes anything personal and never touches `.credentials.json`, `.claude.json`
or any account state in either profile. On a machine without `~/.claude-personal` it does nothing
and never creates one. Any file it would overwrite with different bytes is backed up first to
`~/.claude-personal-refresh-backup-<timestamp>`; identical bytes are skipped, so a second run
writes nothing.

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

Push rewrites the home directory to `__USERHOME__` in every text file, in all five spellings that
occur in practice — `C:\Users\Dan`, the JSON-escaped `C:\\Users\\Dan`, the forward-slash
`C:/Users/Dan`, the Git-Bash `/c/Users/Dan`, and the all-lowercase `c:\users\dan` that Codex
writes into `config.toml`'s project-trust keys (`__USERHOME_LC__` — the replacement is
case-sensitive, so the other four spellings cannot catch it). Directory slugs get
`__USERHOME_SLUG__`. Pull substitutes the local home back. A machine with the same username sees
no difference; one with a different username still works.

## Line endings are pinned

`.gitattributes` says `* -text`: git converts nothing, in either direction. The mirrored trees
hold the exact bytes `sync.ps1` read off the live machine — some files CRLF, some LF, a couple
mixed, and all of that is the truth being carried. Before the pin, this machine's global
`core.autocrlf=true` made a fresh clone materialize every LF file as CRLF, so a new machine
restored byte-different files while every git operation printed line-ending warnings. The
restore test's clone-fidelity check (below) is what watches for the conversion coming back.

## Junctioned skills

Twenty of the skills under `~/.claude/skills` are junctions into `~/.agents/skills` —
`implement`, `tdd`, `triage`, `handoff`, `to-spec`, `code-review` and the rest of the flow map the
global `CLAUDE.md` names. `Get-ChildItem -Recurse -File` does not traverse a reparse point, so a
file copy walks straight past them **without an error**: the repo carried 13 of 37 skills for its
first eight commits and nothing said so.

So the targets travel as `agents/skills/`, and the junctions travel as data in
`claude/skill-links.json`. Pull restores the trees first and recreates the junctions afterwards —
a junction whose target is not on disk yet would be skipped as missing. A real directory sitting
where a junction should go is left alone; that is someone's local edit.

Not following reparse points is now the deliberate half of the arrangement: it is what stops a
junctioned skill being stored twice, once under each path.

## Proving the restore, without a second machine

```powershell
powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1
```

Both scripts take `-UserHome`, so a restore can be aimed anywhere. The test clones the **pushed
remote** — what is in your working tree is not what a new machine gets — and installs it into
`C:\dotfiles-restore-test\run-<pid>-<rand>\Users\Restored`: a different username, outside the real
profile, so any occurrence of the real home path in the output is unambiguously a leak rather than
the scratch directory's own name. The run id is what keeps two simultaneous runs apart — the whole
scratch root is deleted at startup, and while it was a constant, the session-start hook and the
first prompt hook 8 seconds later wiped each other and both reported a failure on a healthy repo.
`-FakeHome` still pins the path explicitly; two runs given the same one still collide, by design.

Twenty-nine checks. The clone carries the exact bytes that were pushed — each working-tree file
hashed raw against the blob git stored, which is what catches a checkout quietly rewriting line
endings. Files landed; no `__USERHOME` token or real-home path survived; `settings.json`
still parses and every path in it points at a file that exists; `codex/config.toml` was restored
and every user-profile path in it — the lowercased trust keys included — points inside the fake
home; every junction resolves to a real
`SKILL.md`; every file survives the round trip byte-for-byte; nothing credential-shaped came
along; two overlapping runs each keep their own scratch directory; and the restored hooks and
skills **run** from the new home — `session-gate.js` passes its own test suite there,
`ask_matt_gate.py` lints, `session-check` reports on a repo. That last group is the difference
between proving bytes moved and proving the machine would work.

The personal-profile refresh is proven too: the test seeds a minimal `~/.claude-personal` in the
fake home — a personal pref, a stale hooks key, a personal-only memory with its own pointer line —
and asserts after the install that the hooks are byte-equal to the work profile's, the settings
keep the personal prefs with every hook command rewritten onto `.claude-personal` paths that
resolve, the junctions mirror the work profile's, and the memory ended up a union with the
personal-only file and its pointer line intact.

A failing run also writes its failure detail to `%TEMP%\restore-test-failures\<stamp>-<pid>.log`.
The session hooks run the suite through `execFileSync` and report only `tests FAIL`, so without
that file an intermittent failure seen by a hook leaves no evidence to diagnose.

Cleanup never decides the verdict. Deleting the scratch at the end can fail because a child process
left over from the last check still holds the clone, and under `$ErrorActionPreference = 'Stop'`
that ended a 21-of-21 run non-zero — which is what the hooks reported as `tests FAIL`. The delete
now retries, then leaves the directory for a later run's sweep.

A run does not restore itself. The last check runs the restored `session-check` inside the clone,
and `session-check` runs whatever the repo names as its test command — this suite. Every run used
to restore a copy and test that copy, several directories deep, leaving nested processes holding
the clone open. `RESTORE_TEST_ACTIVE` stops the descent: a nested run reports `pass 0` / `fail 0`
and exits 0, so the check still gets a real `session-check` run and a run now creates exactly one
scratch directory.

`-Fault missing|crlf|home-leak|secret|drift|broken-hook|dead-link|collision|locked-scratch` breaks one thing on purpose so the
matching check can be watched going red. A check that has only ever passed is not yet a check —
`dead-link` passed on its first attempt because it deleted a directory nothing linked to.

What it does **not** prove: that Claude Code itself authenticates and boots from the restored
config. That needs `/login`, which is item 1 of the by-hand list `install.ps1` prints.

## The secret guard

`push` refuses to finish if any file it staged matches a credential *value* — a JSON
`"refresh_token": "..."`, a PEM private key header, an `sk-ant-` key, a `ya29.` Google token. The
patterns match assignments, not words, on purpose: the global `CLAUDE.md` discusses `refresh_token`
in prose, and a guard that cries wolf on documentation is a guard someone turns off.

It is a backstop, not the mechanism. The whitelist is the mechanism.

## What this repo deliberately does not solve

Switching *accounts* on one machine is a different problem, solved separately in
`../claude-account-handoff` — that one moves `CLAUDE_CONFIG_DIR` between a work and a personal
profile. This repo carries the work profile between machines, and refreshes the personal profile
*from* it.

Reverse memory sync is also deliberately unsolved: the personal-only memories in
`~/.claude-personal/projects/*/memory` never flow back into `~/.claude` or into this repo. That is
a privacy default (declined 2026-08-19), not an oversight — push reads only `~/.claude`, and
flipping the direction requires an explicit owner instruction.
