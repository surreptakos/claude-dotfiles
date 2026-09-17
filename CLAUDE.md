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

This repo's own memory notes are the one exception to `memory/`: they are hand-written at
`docs/agents/memory/` with `MEMORY.md` as the index, and the plugin's SessionStart hook
(`tools/repo-memory-load.js`) injects that index, so cloud sessions have them too. Add a note
there and commit — that commit is the whole publish; both sync modes run
`tools/repo-memory-pointer.js`, which empties the PC copy to a pointer so the two cannot diverge.

## Skill stamps

Every `SKILL.md` carries four keys under `metadata:` — `modified`, `previous-modified`, `revision`,
`content-sha` (`tools/skill-stamps.py`). The packager rotates them on every sync push when a
skill's content hash moved, and writes them back into the *source* file, so the live tree, the
mirror and the plugin all say the same thing. Never edit the four by hand and never bump one to
make a check pass: the hash is what makes the dates believable. The previous text of any skill
is `git log -p -- <skill>/SKILL.md`; the stamp tells you it is there to look for.

After editing anything under `aac-skills/` — or under the `agents/skills/` or `claude/skills/`
mirrors — on a branch with no live tree (a cloud session), run both, or CI (`skill-stamps.yml`)
fails the branch:

```bash
python3 tools/skill-stamps.py stamp aac-skills agents/skills claude/skills --home 'C:\Users\Dan'
python3 tools/build-cloud-plugin.py --from-mirror --home 'C:\Users\Dan'
```

The second rebuilds `marketplace/` from the repo mirror instead of `~/.claude/skills`. `--home`
names the owner's home on both (their default too: `OWNER_HOME` in `tools/skill-stamps.py`, never
the running user's home, issue 492): the stamper folds it into the sync tokens before hashing, and
the packager puts it back where the mirror holds `__USERHOME__` tokens. CI checks that a rebuild
from the mirror reproduces the committed payload, `diff -r` over the whole of
`marketplace/aac-skills`, `plugin.json` included: the plugin version follows the payload, not the
clock, so only a moved payload takes a fresh UTC stamp (issue 432).
`.claude-plugin/marketplace.json` repeats that version and is outside the check.

Both commands stamp, and so does a second edit after them: run them as often as you like, the
commit still carries one revision bump. A rotation is measured from the last *committed* stamp,
never from an intermediate one, so `previous-modified` names the published version (issue 363).

## Layout

- `lib/manifest.ps1` — the whitelist of what travels, the exclusions, the path templating, the secret
  guard. Adding something to the setup means adding it to `Get-DotfileItems` here, nowhere else.
- `sync.ps1 -Mode push|pull [-DryRun]` — push runs the packager (which stamps the live skills),
  then clears the mirrored trees so deletions propagate, then copies; pull backs up to
  `~/.claude-dotfiles-backup-<timestamp>` before writing, and never deletes.
- `install.ps1 [-DryRun]` — fresh machine: prerequisites, pull, then the manual list.
- `orchestrator/` — the cloud master orchestrator: `RUNBOOK.md`, `worker-cycle.md`. The fleet
  itself is served by the `aac-skills` plugin at `aac-skills/ticket-fleet/ticket-fleet.js`, one
  script for local and cloud sessions (it picks between `gh` and the GitHub MCP tools at run
  time). Hand-written, not synced to any machine; the master session reads it from this repo.

## Two invariants worth keeping

**Whitelist, not blocklist.** `sync.ps1` reads only the paths named in `Get-DotfileItems`. That is
what keeps `~/.claude/.credentials.json`, `~/.clasprc.json`, session transcripts and the plugin
cache out of the repo. A pattern-based sweep would eventually catch one of them. The `.gitignore` and
the secret guard are backstops behind that choice, not the mechanism.

**Home paths are tokens.** Hook commands in `settings.json` and every memory directory name carry
this machine's home path. Push rewrites it to `__USERHOME__` (one token per spelling that occurs;
see `ConvertTo-Tokens`) and pull substitutes the local home back. Any new script that copies a text
file must go through `Copy-OneFile`, or it will bake this machine's paths into the repo.

**Keep `.claude/session.json` and `.claude/settings.json` as CRLF blobs (issue 87).** `.gitattributes`
pins them with `-text` so git does no EOL conversion, and the stored blob is CRLF so a Windows
text-mode writer's re-serialization (Claude Code at session start, VS Code default save, PowerShell
5.1 `Get-Content` + `Set-Content`) is byte-identical to the blob and `git status` stays clean. Do
not "normalize" them to LF: an LF blob reopens the phantom ` M` on a fresh worktree.

## The bootstrap gate

`.github/workflows/bootstrap-test.yml` is the **bootstrap gate**: the one end-to-end check on what
a cloud container gets. `tests/bootstrap-test.sh` runs `.claude/hooks/session-start.sh` into an
empty home and asserts the payload's skills, the governance hook entries merged into user settings,
the rules text, gh on the PATH the hook exported, and session-check exit 0 with its payload-version
line. Any change to the bootstrap hook, the plugin payload or session-check adds an assertion there.
`tests/bootstrap-test.sh --fault missing-hook-entry` must exit non-zero — CI runs that too, because
a gate never seen to fail is not known to work.

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

Rules the suite depends on (each has a `-Fault` that proves it): tidy-up never decides the verdict
(`locked-scratch`); the scratch root carries a per-run id (`collision`); `RESTORE_TEST_ACTIVE` stops
the suite restoring itself, so leave the variable alone in anything the suite spawns; a hook sees
only `tests FAIL`, detail is in `%TEMP%\restore-test-failures`.

Windows PowerShell 5.1 traps: `DirectoryInfo.Target` is a `string[]`; `Get-Content -Raw |
ConvertFrom-Json` does not reliably enumerate a JSON array, use `Read-JsonArray`; with
`$ErrorActionPreference = 'Stop'` git's stderr warnings become terminating errors.

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
- `.githooks/pre-commit` runs the restore test and both code generators' `--check` before every
  commit. Activate in a fresh clone with `git config core.hooksPath .githooks`. The generators
  (`tools/build-fleet-inline.js`, `tools/build-harness-tracker-audit.js`) are also checked by
  `generated-code.yml`, which sees the commits that hook does not (issue 487).
- Tracker conventions: `docs/agents/issue-tracker.md`. The audit is a job — `tracker-audit.yml`
  runs it on every issue event and push, and the session report reads that run; exit 2 means it
  could not audit, which is not a pass.
- `node tools/claude-md-lint.js <CLAUDE.md>` checks a CLAUDE.md against the concision paradigm
  (would removing this line cause a mistake?). Findings are prompts to ask that question, not
  verdicts; `<!-- claude-md-lint-ignore -->` above a line keeps a deliberate one. The restore
  suite gates this file and `claude/CLAUDE.md` (the mirror of `~/.claude/CLAUDE.md`) on
  unsuppressed findings, naming the file and line. `size` warns only so a slow creep shows
  without going red; the mirror also warns on `volatile`, `code-derivable` and `tutorial`, which
  its counterexamples trip on purpose. The exit code follows that split (issue 337): warn-only
  findings print and exit 0; `--warn-only a,b` replaces the per-file set.
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
