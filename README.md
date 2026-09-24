# claude-dotfiles

The half of a Claude Code setup that lives outside any project repo: the global rules, the skills
and the hooks that enforce them. A cloud container installs it from master at session start; clone
this plus a project and a new machine behaves the same way.

It does **not** carry credentials. Three files have to move by hand; `install.ps1` names them at the
end of a run.

Live working dashboard (open issues, PRDs, triage counts, pipeline health) is at
[`DASHBOARD.md` on the `dashboard` branch](https://github.com/surreptakos/claude-dotfiles/blob/dashboard/DASHBOARD.md).
CI regenerates it on every push and every issue event and force-pushes there — never onto master
(issue 20).

## What is in here

This repo is the source. Nothing in it is copied out of a live `~/.claude` tree: a skill, a hook
script or the global rules text is edited here, on a branch, and merging to master is the release.

| Path | Restores to | Why it matters |
|---|---|---|
| `aac-skills/` | `~/.claude/skills/` | every skill, one hand-edited tree; also what the plugin payload is built from |
| `profile/claude/CLAUDE.md` | `~/.claude/CLAUDE.md` | global governance — caveman, YES, ask-matt, the AAC Google access notes. The payload's rules text is copied from this file |
| `profile/claude/settings.json` | `~/.claude/settings.json` | hook wiring, plugin marketplaces, status line |
| `profile/claude/hooks/` | `~/.claude/hooks/` | `session-gate.js`, `governance-reminder.js`, the stop-slop pair — and the source the packager copies into the plugin |
| `profile/claude/agents/` | `~/.claude/agents/` | user-level subagent definitions, including the fleet's tool-restricted verifier |
| `profile/claude/plugins/*.json` | `~/.claude/plugins/` | which plugins and marketplaces to reinstall — not the 10 MB cache |
| `profile/claude/accounts.json` | `~/.claude/accounts.json` | which Claude account owns which repo and routine (issue 103) |
| `profile/codex/hooks/` | `~/.codex/hooks/` | `ask_matt_gate.py`, which the pre-send lint and the governance gate both call |
| `profile/codex/hooks.json` | `~/.codex/hooks.json` | the wiring that calls it — without this the script above is inert |
| `profile/codex/config.toml` | `~/.codex/config.toml` | Codex's settings — model, sandbox, marketplaces, plugin enables, project trust. Scanned for credential values (2026-08-12 and 2026-08-19): none — the `sha256:` values in it are trust pins for `hooks.json` entries, not secrets |
| `profile/codex/AGENTS.md` | `~/.codex/AGENTS.md` | Codex's half of the global rules |
| `powershell/*.ps1` | `Documents\{Windows,}PowerShell\` | the two shell profiles, the only place `CLAUDE_CODE_USE_POWERSHELL_TOOL` reaches a terminal-launched session |

Generated, never hand-edited: `marketplace/` and `.claude-plugin/marketplace.json` (the plugin
payload, rebuilt by `tools/build-cloud-plugin.py`), the
`aac-skills/project-harness/templates/` files the two generators own, and `DASHBOARD.md`.

This repo's own memory notes are hand-written at `docs/agents/memory/` with `MEMORY.md` as the
index, and the plugin's SessionStart hook loads them, so cloud sessions have them too (issue 210).
Other repos keep their notes the same way, in their own checkouts.

Repo-only tooling that is not restored to any machine: `gas/`, the Apps Script self-deploy package
(no clasp, no Google credential in CI; `gas/README.md`), with the reusable `gas-deploy.yml` /
`gas-promote.yml` workflows other repos call.

Nothing else is written. `sync.ps1` restores the whitelist in `lib/manifest.ps1` by name, so a
credential file or a session transcript cannot be clobbered by a pattern that was slightly too
broad. The `.gitignore` is only a backstop for things copied in by hand.

## Daily use

Edit `aac-skills/<name>/` or `profile/`, on a branch. Then, from the repo root:

```bash
python3 tools/skill-stamps.py stamp aac-skills --home 'C:\Users\Dan'
python3 tools/build-cloud-plugin.py --home 'C:\Users\Dan'
```

Commit both the source and the rebuilt `marketplace/`, and merge. **The merge is the release** —
every cloud container installs the payload from master at session start, and a desktop takes the
same change with:

```powershell
.\sync.ps1 -Mode pull    # repo -> this machine, backing up first
```

Add `-DryRun` to see the file list without writing anything. `-Mode push` is retired (issue 214):
it prints where the edit path went and exits 2.

The packager stamps every skill it packages: `metadata.modified`, `metadata.previous-modified`,
`metadata.revision` and `metadata.content-sha` in the SKILL.md frontmatter rotate whenever the
skill's content changed since the last stamp (`tools/skill-stamps.py`). Open any skill and the
frontmatter says when it last changed and when it changed before that; `git log -p` on the file
shows what. An agent that revises a skill can no longer do it invisibly.

`pull` never deletes: it writes over what it carries and leaves anything else alone, after copying
the current state to `~/.claude-dotfiles-backup-<timestamp>`. A pull ends by refreshing
`~/.claude-personal` when that profile exists — see below.

## The personal profile (`~/.claude-personal`)

Issue #9 decisions, 2026-08-19:

- **(a) Adopted** — a pull ends with `Update-PersonalProfile` (`lib/personal.ps1`), a one-way
  overlay from the freshly written `~/.claude` onto `~/.claude-personal`. Hooks, `CLAUDE.md` and
  agents copy verbatim (the hooks are profile-aware via `CLAUDE_CONFIG_DIR`, so identical copies
  are correct); skill directories are overlaid file by file; `settings.json` gets the work
  profile's **hooks key only**, with the
  mechanical path rewrite `\.claude\` → `\.claude-personal\` (`.codex` paths untouched) — the
  personal model, plugins, statusLine and prefs are preserved; project memories union-merge (work
  files copy in, newer mtime wins, `MEMORY.md` unions by pointer-line target).
- **(b) Superseded 2026-09-23** — declined on 2026-08-19, then flipped by owner instruction ("I
  want two way sync between claude-personal and claude"). `profile/claude/tools/link-personal-profile.ps1`
  merges personal-only content into `~/.claude`, then replaces `projects`, `agents`, `hooks`,
  `tools`, `plans` and `file-history` in `~/.claude-personal` with junctions to their `~/.claude`
  twins. Both accounts then read and write one copy: memories, transcripts (`/resume` spans both)
  and file history. Personal-only memories come in only when born in a personal session, so work
  memories that consolidation pruned stay pruned. Skills stay per profile by owner choice. Each
  replaced folder is kept as `<dir>.pre-link-<stamp>` for rollback. Run it once, with no
  personal-profile session open; a re-run reports "already linked". Once linked, the refresh
  above is a no-op for those folders (its copies land on the same files).

The refresh never deletes anything personal and never touches `.credentials.json`, `.claude.json`
or any account state in either profile. On a machine without `~/.claude-personal` it does nothing
and never creates one. Any file it would overwrite with different bytes is backed up first to
`~/.claude-personal-refresh-backup-<timestamp>`; identical bytes are skipped, so a second run
writes nothing.

## New machine

```powershell
git clone <this repo> ; cd claude-dotfiles ; .\install.ps1
```

It checks for git, node, `py`, `claude` and `gh`, restores the configuration, and prints what
remains: the two secret files, `/login`, `gh auth login`, and `gas login` (once per Google account;
`clasp` is no longer a prerequisite — every AAC Apps Script repo deploys itself, see `gas/README.md`).

## Absolute paths are stored as tokens

`settings.json` hard-codes `C:\Users\<you>\...` in its hook commands, which would break on a
machine with a different username. The committed copy spells the home directory `__USERHOME__`, in
all five spellings that occur in practice — `C:\Users\Dan`, the JSON-escaped `C:\\Users\\Dan`, the
forward-slash `C:/Users/Dan`, the Git-Bash `/c/Users/Dan`, and the all-lowercase `c:\users\dan`
that Codex writes into `config.toml`'s project-trust keys (`__USERHOME_LC__` — the replacement is
case-sensitive, so the other four spellings cannot catch it). Pull substitutes the local home back.
A machine with the same username sees no difference; one with a different username still works.
The skill tree is committed as written, owner's home and all (nothing tokenises it since sync push
retired), so pull first folds that spelling — `$script:OwnerHome` in `lib/manifest.ps1` — into the
same tokens, then substitutes. The restore test scans for both homes.

## Line endings are pinned

`.gitattributes` says `* -text`: git converts nothing, in either direction. The committed trees
hold exactly the bytes a restore must materialize — some files CRLF, some LF, a couple mixed, and
all of that deliberate. Before the pin, the owner's global
`core.autocrlf=true` made a fresh clone materialize every LF file as CRLF, so a new machine
restored byte-different files while every git operation printed line-ending warnings. The
restore test's clone-fidelity check (below) is what watches for the conversion coming back.

## One skill tree

Until issue 214 the skills lived in two live directories — `~/.claude/skills` and `~/.agents/skills`
— joined by junctions, and the repo carried both plus a `skill-links.json` describing the links.
`Get-ChildItem -Recurse -File` does not traverse a reparse point, so a file copy walked straight
past them **without an error**: the repo carried 13 of 37 skills for its first eight commits and
nothing said so.

That arrangement existed because the machine was the source. It no longer is. `aac-skills/` is one
hand-edited tree, the packager builds the plugin from it, and pull writes it back as real
directories under `~/.claude/skills`. A machine restored before the cut still has junctions there;
`lib/personal.ps1` keeps the two readers it needs for them.

## Cloud sessions load the skills as an uploaded plugin

Claude Code cloud containers (claude.ai/code) never see this machine's `~/.claude` — no dotfiles
support, and user-scope plugin installs don't transfer. The only account-wide mechanism is plugin
sync: a plugin enabled on the claude.ai account downloads into every cloud session as
`<name>@synced`, whatever repo it runs against.

Cowork is different, and this paragraph has been wrong in both directions. The global
instructions reach it: Claude Code loads `~/.claude/CLAUDE.md` there, skipping only imports and
symlinked rules that resolve outside the session's working directory. So do the plugin's hooks —
proved 2026-09-18 on issue #228, when a Cowork session quoted the aac-skills SessionStart marker
with its own runtime values (`os=MINGW64_NT-10.0-26200 ... host=Dan-Inspiron15`) and its export
showed the PreToolUse gate denying tool calls. The hooks run on the Windows host from the desktop
app's plugin directory; the model's shell is a Linux sandbox exposed as `mcp__workspace__bash`,
not `Bash`. A 2026-09-03 test on an older build found no marker, and this paragraph said hooks do
not run there until 2026-09-18.

What that costs: any hook that exempts a command by the tool name `Bash` or `PowerShell`, or that
prints a Windows path to run with `py -3`, deadlocks in Cowork. The ask-matt gate was fixed for
this on 2026-09-21 (issue #608) and now takes its declaration from any shell tool. The marker hook
stays in the plugin as a standing probe so a future surface change is noticed.

`tools/build-cloud-plugin.py` packages the repo's `aac-skills/` tree into that shape:

```powershell
python3 tools/build-cloud-plugin.py   # rewrites marketplace/ and emits dist/ (gitignored)
```

It rewrites each `SKILL.md` to survive the claude.ai upload validator, which enforces three rules the local loader does not: frontmatter may
carry only `name`, `description`, `allowed-tools`, `license`, `metadata`, `compatibility` (anything
else — `disable-model-invocation`, `argument-hint`, `hidden` — moves under `metadata:` as strings);
descriptions may not contain XML tags (angle brackets are stripped, tag names kept); and the zip may
not ship a top-level `bin/` directory — that last one bites marketplace plugins repacked by hand,
not this script's output.

Upload at claude.ai → Customize → Plugins → Add → Upload plugin, and enable it. claude.ai stores a
copy, so **an edited or new skill reaches cloud sessions only after a rebuild and re-upload** — the
zip is a snapshot, not a live copy. The marketplace payload under `marketplace/` is the channel
that does update itself: a container installs it from master at session start.

The caveman suite (the `caveman@caveman` plugin and the `@caveman-ai/cli` proxy the desktop runs)
takes the same road into a cloud session of *this* repo: `.claude/hooks/caveman-bootstrap.sh`
installs the pinned plugin checkout, its twenty skills, the CLI with its signed binaries, the
local proxy and `caveman enable claude` at SessionStart, and `.claude/hooks/caveman-prompt.sh`
runs the plugin's mode tracker on every prompt. What it can and cannot do in a container, with
the probes behind each claim, is in `docs/caveman-cloud-2026-09-16.md`.

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

The checks, in short. The clone carries the exact bytes that were pushed — each working-tree file
hashed raw against the blob git stored, which is what catches a checkout quietly rewriting line
endings. Files landed; no `__USERHOME` token or real-home path survived; `settings.json`
still parses and every path in it points at a file that exists; `codex/config.toml` was restored
and every user-profile path in it — the lowercased trust keys included — points inside the fake
home; every skill restored with a readable `SKILL.md`; every file survives the round trip
byte-for-byte; nothing credential-shaped came
along; two overlapping runs each keep their own scratch directory; and the restored hooks and
skills **run** from the new home — `session-gate.js` passes its own test suite there,
`ask_matt_gate.py` lints, `session-check` reports on a repo. That last group is the difference
between proving bytes moved and proving the machine would work.

The personal-profile refresh is proven too: the test seeds a minimal `~/.claude-personal` in the
fake home — a personal pref and a stale hooks key — and asserts after the install that the hooks
are byte-equal to the work profile's, the settings keep the personal prefs with every hook command
rewritten onto `.claude-personal` paths that resolve, and every work skill was overlaid into the
personal profile byte for byte.

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

`-Fault missing|crlf|home-leak|secret|drift|broken-hook|collision|locked-scratch|lint-root|lint-mirror|sandbox-identity`
breaks one thing on purpose so the matching check can be watched going red. A check that has only
ever passed is not yet a check — the retired `dead-link` fault passed on its first attempt because
it deleted a directory nothing linked to.

What it does **not** prove: that Claude Code itself authenticates and boots from the restored
config. That needs `/login`, which is item 1 of the by-hand list `install.ps1` prints.

## The secret guard

`Assert-NoSecrets` refuses a tree holding a credential *value* — a JSON
`"refresh_token": "..."`, a PEM private key header, an `sk-ant-` key, a `ya29.` Google token. The
patterns match assignments, not words, on purpose: the global `CLAUDE.md` discusses `refresh_token`
in prose, and a guard that cries wolf on documentation is a guard someone turns off.

It is a backstop, not the mechanism. The whitelist is the mechanism.

## What this repo deliberately does not solve

Switching *accounts* on one machine is a different problem, solved separately in
`../claude-account-handoff` — that one moves `CLAUDE_CONFIG_DIR` between a work and a personal
profile. This repo is where the work profile is authored, and a pull refreshes the personal profile
*from* what it restores.

Personal memories reach this repo only through the shared `~/.claude` tree once the profiles
are linked (issue #9 decision (b) superseded 2026-09-23, see above); `sync.ps1` itself still
never reads `~/.claude-personal`.
