# claude-dotfiles

<!-- owner-account:begin — managed by claude-dotfiles/tools/owner-account-line.js; do not edit -->
Owner account: Dan-AAC (desktop app)
<!-- owner-account:end -->

The machine-local half of a Claude Code setup, under version control: global rules, skills, hooks,
plugin manifests, per-project memory. `README.md` explains the design; this file is what an agent
working *on* the repo needs to know.

## The one rule

**`claude/`, `codex/` and `memory/` are generated. Never hand-edit them.**

They are copies. Edit the real file in `~/.claude` or `~/.codex`, then:

```powershell
.\sync.ps1 -Mode push
```

A hand edit here is silently overwritten by the next push, and — worse — looks committed while the
machine it came from never changed. Hand-written: `sync.ps1`, `install.ps1`, `lib/manifest.ps1`,
`tests/`, `tools/`, `README.md`, `.gitignore`, `aac-skills/`, `orchestrator/`, `gas/` (the Apps Script
self-deploy package; `gas/README.md`), the `gas-*.yml` reusable workflows, and this file.
`agents/`, `claude/skill-links.json`, `marketplace/` and `.claude-plugin/marketplace.json` are
generated too — the packager (`tools/build-cloud-plugin.py`, run by every push) rebuilds them from
`~/.claude/skills` and `aac-skills/`. Edit `aac-skills/` directly; never edit `marketplace/`.

## Skill stamps

Every `SKILL.md` carries four keys under `metadata:` — `modified`, `previous-modified`, `revision`,
`content-sha` (`tools/skill-stamps.py`). The packager rotates them on every sync push when a
skill's content hash moved, and writes them back into the *source* file, so the live tree, the
mirror and the plugin all say the same thing. Never edit the four by hand and never bump one to
make a check pass: the hash is what makes the dates believable. The previous text of any skill
is `git log -p -- <skill>/SKILL.md`; the stamp tells you it is there to look for.

After editing anything under `aac-skills/` on a branch with no live tree (a cloud session), run
both, or CI (`skill-stamps.yml`) fails the branch:

```bash
python3 tools/skill-stamps.py stamp aac-skills
python3 tools/build-cloud-plugin.py --from-mirror --home 'C:\Users\Dan'
```

The second rebuilds `marketplace/` from the repo mirror instead of `~/.claude/skills`; `--home`
puts the owner's path back where the mirror holds `__USERHOME__` tokens, so the payload matches
one built on that machine. CI checks exactly that: a rebuild from the mirror must reproduce the
committed payload.

## Layout

- `lib/manifest.ps1` — the whitelist of what travels, the exclusions, the path templating, the secret
  guard. Adding something to the setup means adding it to `Get-DotfileItems` here, nowhere else.
- `sync.ps1 -Mode push|pull [-DryRun]` — push runs the packager (which stamps the live skills),
  then clears the mirrored trees so deletions propagate, then copies; pull backs up to
  `~/.claude-dotfiles-backup-<timestamp>` before writing, and never deletes.
- `install.ps1 [-DryRun]` — fresh machine: prerequisites, pull, then the manual list.
- `orchestrator/` — the cloud master orchestrator: `RUNBOOK.md`, `worker-cycle.md`,
  `ticket-fleet-cloud.js` (GitHub-MCP port of `.claude/workflows/ticket-fleet.js` — keep the two in
  lockstep). Hand-written, not synced to any machine; the master session reads it from this repo.

## Two invariants worth keeping

**Whitelist, not blocklist.** `sync.ps1` reads only the paths named in `Get-DotfileItems`. That is
what keeps `~/.claude/.credentials.json`, `~/.clasprc.json`, session transcripts and the plugin
cache out of the repo. A pattern-based sweep would eventually catch one of them. The `.gitignore` and
the secret guard are backstops behind that choice, not the mechanism.

**Home paths are tokens.** Hook commands in `settings.json` and every memory directory name carry
this machine's home path. Push rewrites it to `__USERHOME__` (one token per spelling that occurs;
see `ConvertTo-Tokens`) and pull substitutes the local home back. Any new script that copies a text
file must go through `Copy-OneFile`, or it will bake this machine's paths into the repo.

## Testing a change to the scripts

Run the restore test. It is the only thing here that checks the *pull* half end to end:

```powershell
powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1
```

It clones the pushed remote and installs it into a fake home under a different username, then runs
its checks — including executing the restored hooks from their new location. `-Fault <name>` makes a
chosen check fail on purpose. Add a check whenever you add something to the whitelist; a whitelist
entry with no assertion behind it fails silently.

Three sources, and the difference matters:

- `-From origin` (default) clones the remote. The only one that answers "would a new machine work?"
- `-From local` clones this checkout's committed state, so **commit first** or your change is absent.
- `-From worktree` copies what `git ls-files` sees — staged changes included, no network. This is
  what the pre-commit hook runs.

Rules the suite depends on:

- Tidying up must never decide the verdict. The final scratch delete can lose a race with a child
  process and `$ErrorActionPreference = 'Stop'` would end the run non-zero; `-Fault locked-scratch`
  proves it still exits 0.
- The scratch root carries a per-run id; two overlapping runs on one root fail on a fine repo
  (`-Fault collision` shows it).
- `RESTORE_TEST_ACTIVE` stops the suite restoring itself: check 9 runs the restored `session-check`,
  which runs this suite, which finds the variable set and reports `pass 0` / `fail 0`. Leave the
  variable alone in anything the suite spawns.
- A failure seen by a hook prints only `tests FAIL`; detail is in `%TEMP%\restore-test-failures`.

Windows PowerShell 5.1 traps:

- `DirectoryInfo.Target` is a `string[]`, not a string — binding it to a `[string]` parameter throws
  "cannot convert value to type System.String".
- `@(Get-Content x -Raw | ConvertFrom-Json)` does not reliably enumerate a JSON array. Use
  `Read-JsonArray`.
- `$ErrorActionPreference = 'Stop'` turns git's stderr (line-ending warnings included) into a
  terminating error.

Then `-DryRun` on both scripts, then a real `push` — it is idempotent and git status shows exactly
what moved. Round-trip a real file through `ConvertTo-Tokens` / `ConvertFrom-Tokens` for the
templating. To exercise the secret guard, plant a file holding a JSON `refresh_token` key whose value
is twenty junk characters, run `Assert-NoSecrets`, and delete it. The guard matches credential
*values*, not the words — prose here names `refresh_token`, and a guard that fires on documentation
gets disabled.

## The harness

Version in `docs/agents/harness-version.md`.

- `DASHBOARD.md` is **generated**. Never hand-edit it; edit `scripts/build-dashboard.js`. CI owns the
  artifact — run the script locally to check output, then discard it.
- `.githooks/pre-commit` runs the restore test before every commit. Activate in a fresh clone with
  `git config core.hooksPath .githooks`.
- Tracker conventions: `docs/agents/issue-tracker.md`. Run `node tools/tracker-audit.js` before
  trusting the tracker — exit 2 means it could not audit, which is not a pass.
- `node tools/claude-md-lint.js <CLAUDE.md>` checks a CLAUDE.md against the concision paradigm
  (would removing this line cause a mistake?). Findings are prompts to ask that question, not
  verdicts; `<!-- claude-md-lint-ignore -->` above a line keeps a deliberate one. The restore
  suite gates this file and `claude/CLAUDE.md` (the mirror of `~/.claude/CLAUDE.md`) on
  unsuppressed findings, with the file and line named in the failure. `size` warns only so a
  slow creep is visible without going red; the mirror also warns on `volatile`, `code-derivable`
  and `tutorial` because it quotes counterexamples that trip those regexes.
- Session runbook: `docs/runbooks/session.md`. Release here is the push to `origin/master`.

## The freshness loop

Sessions here must never run against stale or divergent governance copies. Every sync push and pull
stamps `~/.claude/hook-state/dotfiles-sync/state.json`; `tools/dotfiles-freshness.ps1` reads the
stamp, fetches origin and classifies (states and resolution commands are documented in that file).
Origin ahead auto-installs; live edited auto-captures and pushes (`DOTFILES_AUTO_PUSH=0` makes it
advisory); both diverged is a hard block — the `UserPromptSubmit` hook exits 2 with the resolution
order on stderr: push live first, `git pull --rebase`, `git push`, then `sync.ps1 -Mode pull`.

Two things about it are deliberate:

- The hook entries live in **`.claude/settings.json`** (project-level, hand-written), not in the
  generated `claude/` mirror. Hooks placed inside the mirror without live `~/.claude` counterparts
  are wiped by the next push.
- Auto-pull and auto-push both re-classify before acting, and auto-push (`push-state2`) refuses
  unless live has drifted, origin is not ahead, nothing is unpushed, **and the checkout is not a
  worktree**. This repo runs many concurrent agent worktrees on feature branches; a SessionStart hook
  inside one must never auto-commit dotfiles-sync work onto a ticket's branch.

## Related

- `../claude-account-handoff` — moves *accounts* on one machine (`CLAUDE_CONFIG_DIR`). Different
  problem: this repo moves one profile between machines.
- The project half of a new-machine setup is written up in the commissions repo at
  `docs/runbooks/new-machine.md`.
