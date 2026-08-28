# claude-dotfiles

The machine-local half of a Claude Code setup, under version control: global rules, skills, hooks,
plugin manifests, per-project memory. Built 2026-08-12. `README.md` explains the design; this file is
what an agent working *on* the repo needs to know.

## The one rule

**`claude/`, `codex/` and `memory/` are generated. Never hand-edit them.**

They are copies. Edit the real file in `~/.claude` or `~/.codex`, then:

```powershell
.\sync.ps1 -Mode push
```

A hand edit here is silently overwritten by the next push, and — worse — looks committed while the
machine it came from never changed. Only `sync.ps1`, `install.ps1`, `lib/manifest.ps1`,
`tests/restore-test.ps1`, `README.md`, `.gitignore` and this file are hand-written. `agents/` and
`claude/skill-links.json` are generated too.

## Layout

- `lib/manifest.ps1` — the whitelist of what travels, the exclusions, the path templating, the secret
  guard. Adding something to the setup means adding it to `Get-DotfileItems` here, nowhere else.
- `sync.ps1 -Mode push|pull [-DryRun]` — push clears the mirrored trees first so deletions propagate;
  pull backs up to `~/.claude-dotfiles-backup-<timestamp>` before writing, and never deletes.
- `install.ps1 [-DryRun]` — fresh machine: prerequisites, pull, then the manual list.

## Two invariants worth keeping

**Whitelist, not blocklist.** `sync.ps1` reads only the paths named in `Get-DotfileItems`. That is
what keeps `~/.claude/.credentials.json`, `~/.clasprc.json`, session transcripts and the 10 MB plugin
cache out of the repo. A pattern-based sweep would eventually catch one of them. The `.gitignore` and
the secret guard are backstops behind that choice, not the mechanism.

**Home paths are tokens.** `settings.json` hard-codes `C:\Users\<you>\...` in five hook commands, and
each memory directory is named after its project's absolute path. Push rewrites the home directory to
`__USERHOME__` in all four spellings that occur — raw, JSON-escaped, forward-slash, Git-Bash — and
slugs to `__USERHOME_SLUG__`; pull substitutes the local home back. Verified byte-identical on a
round trip, and valid JSON after a rewrite to a different username. Any new script that copies a text
file must go through `Copy-OneFile`, or it will bake this machine's paths into the repo.

## Testing a change to the scripts

Run the restore test. It is the only thing here that checks the *pull* half end to end:

```powershell
powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1
```

It clones the pushed remote and installs it into a fake home under a different username, then runs
its checks — including executing the restored hooks from their new location. `-Fault <name>` makes a
chosen check fail on purpose. Add a check whenever you add something to the whitelist; a whitelist
entry with no assertion behind it is how 24 skills went missing without a single error message.

It is safe to run twice at once. The scratch root carries a per-run id because the script deletes
it whole, and a shared one made two overlapping runs fail on a repo that was fine. `-Fault
collision` pins both to one root and shows that failure again.

Two more traps, both of which made a green run report `tests FAIL` to the session hooks:

- The final `Remove-Item` of the scratch can lose a race with a child process left over from the
  last check, and `$ErrorActionPreference = 'Stop'` then ends the script non-zero. Tidying up must
  never decide the verdict — `-Fault locked-scratch` holds the clone open and the run must still
  exit 0.
- A failure seen by a hook has no output anywhere: `session-check` runs the suite through
  `execFileSync` and prints only `tests FAIL`. Detail goes to `%TEMP%\restore-test-failures`.

The suite also used to restore itself: check 9 runs the restored `session-check` inside the clone,
and `session-check` runs whatever `.claude/session.json` names as the test command — this suite.
About four scratch directories per run, with nested processes outliving their parents and holding
the clone open, which is the lock behind the trap above. The constant scratch root had hidden it,
because the nested run deleted its own parent's directory. `RESTORE_TEST_ACTIVE` stops the descent:
a run that finds it set reports `pass 0` / `fail 0` and exits 0, so check 9 still gets a real
`session-check` run. Leave that variable alone in anything the suite spawns.

Three sources, and the difference matters:

- `-From origin` (default) clones the remote. The only one that answers "would a new machine work?"
- `-From local` clones this checkout's committed state, so **commit first** or your change is absent.
- `-From worktree` copies what `git ls-files` currently sees — staged changes included, no network.
  This is what the pre-commit hook and CI run; the other two would test the wrong commit or fail to
  authenticate against a private remote from inside a runner.

Three traps that cost time here, all Windows PowerShell 5.1:

- `DirectoryInfo.Target` is a `string[]`, not a string — binding it to a `[string]` parameter throws
  "cannot convert value to type System.String".
- `@(Get-Content x -Raw | ConvertFrom-Json)` does not reliably enumerate: a 22-entry file can arrive
  as one element whose every property is an array. Use `Read-JsonArray`.
- `$ErrorActionPreference = 'Stop'` turns git's stderr into a terminating error, and git writes
  line-ending warnings there. That broke `-Commit` between the add and the commit.

Then `-DryRun` on both scripts, then a real `push` — it is idempotent and the repo's git status shows
exactly what moved. For the templating, round-trip a real file:

```powershell
. .\lib\manifest.ps1
$o = [System.IO.File]::ReadAllText("$env:USERPROFILE\.claude\settings.json")
(ConvertFrom-Tokens -Text (ConvertTo-Tokens -Text $o -UserHome $env:USERPROFILE) -UserHome $env:USERPROFILE) -ceq $o
```

To exercise the secret guard, plant a file holding a JSON `refresh_token` key whose value is twenty
junk characters, run `Assert-NoSecrets`, and delete it. The guard matches credential *values*, not
the words — prose in the global `CLAUDE.md` names `refresh_token`, and a guard that fires on
documentation gets disabled. Writing that example out as a literal JSON pair is enough to trip it,
which is how this paragraph got its current wording.

## The harness

Installed 2026-08-12, version in `docs/agents/harness-version.md`.

- `DASHBOARD.md` is **generated**. Never hand-edit it; edit `scripts/build-dashboard.js`. CI owns the
  artifact — run the script locally to check output, then discard it.
- `.githooks/pre-commit` runs the restore test before every commit. Activate in a fresh clone with
  `git config core.hooksPath .githooks`.
- Tracker conventions: `docs/agents/issue-tracker.md`. Run `node tools/tracker-audit.js` before
  trusting the tracker — exit 2 means it could not audit, which is not a pass.
- Session runbook: `docs/runbooks/session.md`. Release here is the push to `origin/master`.

## The freshness loop (issue 12)

Sessions in this repo must never run against stale or divergent governance copies. Every
`sync.ps1 -Mode push` and `-Mode pull` writes a stamp to
`~/.claude/hook-state/dotfiles-sync/state.json` (git-ignored runtime state, per-user, not carried in
the mirror). `tools/dotfiles-freshness.ps1` reads that stamp, fetches origin, and classifies:

- **synced** or **unknown (no stamp)** — silent.
- **state1** (origin ahead, live matches stamp) — auto-installs (`git pull --ff-only` +
  `sync.ps1 -Mode pull`), reports the commits landed.
- **state2** (live edited since last sync, origin not ahead) — session-start auto-captures
  and pushes (`sync.ps1 -Mode push -Commit "chore: session-start capture"` then `git push`;
  fixed commit prefix so history is grep-able). Pairs with the state1 auto-resolver: together
  they make state3 impossible outside a real merge conflict. Failure is non-blocking: the
  hook falls back to the old advisory with the failure reason appended, and the session
  continues. Session-end still reports state2 for edits made *during* the session. Set
  `DOTFILES_AUTO_PUSH=0` to disable the auto-push (advisory-only, previous behavior).
  The origin-ahead-ineligible variant (behind>0, live clean — a feature branch or worktree)
  stays a manual-pull advisory; pushing would not help.
- **state3** (both directions diverged) — HARD BLOCK: `UserPromptSubmit` hook exits 2 with the
  resolution commands on stderr (documented Claude Code mechanism for refusing a prompt).
  Resolution order: push live first, `git pull --rebase`, `git push`, then `sync.ps1 -Mode pull`.

The three hook entries live in **`.claude/settings.json`** (project-level, hand-written) and invoke
`tools/dotfiles-freshness-hook.js`. Nothing in this feature lives in the generated `claude/` mirror —
that is deliberate. An earlier attempt at this issue put the hooks inside the mirror without the live
`~/.claude` counterparts and the next routine `sync.ps1 -Mode push` would have wiped them.

Auto-pull is guarded twice: the classifier requires `-not $liveDrift` for state1, and
`install-state1` mode re-classifies before running anything. Auto-push is guarded the same
way, and by the same shape: `push-state2` mode re-classifies and refuses unless state=state2,
liveDrift=true, behind=0, ahead=0, AND isWorktree=false. The ahead/isWorktree half of that
list matches install-state1's `-not $repo.isWorktree` clause and is not decorative - this
repo runs many concurrent agent worktrees, each on its own feature branch, and a SessionStart
hook fired inside one of those must NEVER auto-commit dotfiles-sync work onto the wrong
branch (it would pollute the ticket's diff). Tests: `tools/dotfiles-freshness-hook.test.js`
(Node, 12 cases including state2 auto-push success, auto-push failure fallback, the
origin-ahead-ineligible variant, and the worktree / ahead>0 guards that refuse the auto-push
outright) and `tests/dotfiles-freshness.tests.ps1` (PowerShell, 25 assertions including all
four states, the stamp round-trip, push-state2's state3 refusal, and push-state2's worktree
refusal). Both run inside `tests/restore-test.ps1` as part of the standard test suite.

## Related

- `../claude-account-handoff` — moves *accounts* on one machine (`CLAUDE_CONFIG_DIR`). Different
  problem: this repo moves one profile between machines.
- The project half of a new-machine setup is written up in the commissions repo at
  `docs/runbooks/new-machine.md`.
