# claude-dotfiles

<!-- owner-account:begin — managed by claude-dotfiles/tools/owner-account-line.js; do not edit -->
Owner account: Dan-AAC (desktop app)
<!-- owner-account:end -->

The Claude Code setup itself, under version control: global rules, skills, hooks, plugin manifests.
`README.md` explains the design; this file is what an agent working *on* the repo needs to know.

## The edit path

**This repo is the source. Nothing in it is generated from a live `~/.claude` tree** (issue 214
retired the `claude/`, `codex/` and `memory/` mirrors and `sync.ps1 -Mode push` with them).

Edit `aac-skills/<name>/` for a skill and `profile/` for the consumer profile — the global rules
text, `settings.json`, the hook scripts, the Codex half. Do it on a branch, run the two commands
below, commit, and merge: **the merge to master is the release**, and it is what a cloud container
installs; a desktop takes the skills and rules with `claude plugin update` (pull restores the rest).

Generated, and never hand-edited: `marketplace/`, `.claude-plugin/marketplace.json` and the
`aac-skills/project-harness/templates/` files the two generators own. `DASHBOARD.md` too — see
the harness section.

This repo's memory notes are hand-written at `docs/agents/memory/` with `MEMORY.md` as the index,
and the plugin's SessionStart hook (`tools/repo-memory-load.js`) injects that index, so cloud
sessions have them too. Add a note there and commit — that commit is the whole publish; pull runs
`tools/repo-memory-pointer.js`, which empties the PC copy to a pointer so the two cannot diverge.

## Skill stamps

Every `SKILL.md` carries four keys under `metadata:` — `modified`, `previous-modified`, `revision`,
`content-sha` (`tools/skill-stamps.py`). The packager rotates them whenever a skill's content hash
moved and writes them back into the source file, so the tree and the plugin say the same thing.
Never edit the four by hand and never bump one to make a check pass: the hash is what makes the
dates believable. The previous text of any skill is `git log -p -- <skill>/SKILL.md`; the stamp
tells you it is there to look for.

After editing anything under `aac-skills/`, run both, or CI (`skill-stamps.yml`) fails the branch:

```bash
python3 tools/skill-stamps.py stamp aac-skills --home 'C:\Users\Dan'
python3 tools/build-cloud-plugin.py --home 'C:\Users\Dan'
```

`--home` names the owner's home on both (their default too: `OWNER_HOME` in
`tools/skill-stamps.py`, never the running user's home, issue 492): the stamper folds it into the
sync tokens before hashing. CI checks that a rebuild reproduces the committed payload, `diff -r`
over the whole of `marketplace/aac-skills`, `plugin.json` included: the plugin version follows the
payload, not the clock, so only a moved payload takes a fresh UTC stamp (issue 432).
`.claude-plugin/marketplace.json` repeats that version and is outside the check.

Both commands stamp, and so does a second edit after them: run them as often as you like, the
commit still carries one revision bump. A rotation is measured from the last *committed* stamp,
never from an intermediate one, so `previous-modified` names the published version (issue 363).

## Layout

- `aac-skills/` — every skill, one tree, hand-edited. The packager builds the plugin payload from
  it, and that plugin is how a desktop gets the skills too: pull no longer writes `~/.claude/skills`
  (issue 734), so a skill named by short name must ship in the payload.
- `profile/` — what a desktop consumer needs beyond the skills: `profile/claude/CLAUDE.md` (the
  global rules, and the one source the payload's rules text is copied from; pull does not restore
  it - a desktop gets the rules from the plugin hook and pull writes `global-pointer.md` to
  `~/.claude/CLAUDE.md`, which must never carry the rules' first line, issue 732), `settings.json`,
  `hooks/` and `tools/` (the packager's source only: pull does not restore them, and
  `settings.json` names no script the plugin ships, issue 733), `agents/`, the plugin manifests,
  and `profile/codex/`.
- `lib/manifest.ps1` — the whitelist of what pull writes, the exclusions, the path templating, the
  secret guard. Adding something to the setup means adding it to `Get-DotfileItems` here.
- `sync.ps1 -Mode pull [-DryRun]` — backs up to `~/.claude-dotfiles-backup-<timestamp>` before
  writing, and never deletes. `-Mode push` prints why it is retired and exits 2. On a fresh
  machine `install.ps1 [-DryRun]` wraps it: prerequisites, pull, then the manual list.
- `orchestrator/` — the master orchestrators. `LOCAL-RUNBOOK.md` is live (desktop, under
  `master-watchdog.ps1`); `RUNBOOK.md` holds the shared rules and the paused cloud venue (ADR
  0001). The fleet itself is served by the `aac-skills` plugin at
  `aac-skills/ticket-fleet/ticket-fleet.js`, one script for local and cloud sessions (it picks
  between `gh` and the GitHub MCP tools at run time). The master reads the runbooks from this repo.

## Two invariants worth keeping

**Whitelist, not blocklist.** `sync.ps1` writes only the paths named in `Get-DotfileItems`, so a
pull cannot clobber `~/.claude/.credentials.json`, `~/.clasprc.json` or the plugin cache, and
nothing outside that list is ever read back. A pattern-based sweep would eventually catch one of
them. The `.gitignore` and the secret guard are backstops behind that choice, not the mechanism.

**Home paths are tokens.** Hook commands in `settings.json` carry the owner's home path. The
committed copy spells it `__USERHOME__` (one token per spelling that occurs; see
`ConvertFrom-Tokens`) and pull substitutes the local home back. Skills are committed naming the
owner's home literally; pull folds `$script:OwnerHome` into the tokens first (issue 582). Any new
script that copies a text file must go through `Copy-OneFile`, or it will bake one machine's paths
into a restore.

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

The restore test is the gate on the *pull* half, the way the bootstrap test is the gate on what a
container gets. `windows-restore-test.yml` runs it on every pull request and push that touches a
PowerShell file — on a real Windows PowerShell 5.1, in both `-From worktree` and default mode — so
a branch is gated whether or not anyone runs it by hand. On the desktop that is:

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
  the mode the CI job runs first, so a change to the suite itself is what gets tested.

Rules the suite depends on (each has a `-Fault` that proves it): tidy-up never decides the verdict
(`locked-scratch`); the scratch root carries a per-run id (`collision`); `RESTORE_TEST_ACTIVE` stops
the suite restoring itself, so leave the variable alone in anything the suite spawns; a hook sees
only `tests FAIL`, detail is in `%TEMP%\restore-test-failures`.

Windows PowerShell 5.1 traps: `DirectoryInfo.Target` is a `string[]`; `Get-Content -Raw |
ConvertFrom-Json` does not reliably enumerate a JSON array; with `$ErrorActionPreference = 'Stop'`
git's stderr warnings become terminating errors.

Then `-DryRun` on the pull, then a real one — it is idempotent and the backup directory shows
exactly what moved. Round-trip a real file through `ConvertTo-Tokens` / `ConvertFrom-Tokens` for
the templating. To exercise the secret guard, plant a file holding a JSON `refresh_token` key whose
value is twenty junk characters, run `Assert-NoSecrets`, and delete it. The guard matches credential
*values*, not the words — prose here names `refresh_token`, and a guard that fires on documentation
gets disabled.

## The harness

Version in `docs/agents/harness-version.md`.

- `DASHBOARD.md` is **generated**. Never hand-edit it; edit `scripts/build-dashboard.js`. CI owns the
  artifact — run the script locally to check output, then discard it.
- The two code generators (`tools/build-fleet-inline.js`, `tools/build-harness-tracker-audit.js`)
  are gated by `generated-code.yml` alone: edit a source, run the generator, commit both (issue 487).
- Tracker conventions: `docs/agents/issue-tracker.md`. The audit is a job — `tracker-audit.yml`
  runs it on every issue event and push, and the session report reads that run; exit 2 means it
  could not audit, which is not a pass.
- `node tools/claude-md-lint.js <CLAUDE.md>` checks a CLAUDE.md against the concision paradigm
  (would removing this line cause a mistake?). Findings are prompts to ask that question, not
  verdicts; `<!-- claude-md-lint-ignore -->` above a line keeps a deliberate one. The restore
  suite gates this file and `profile/claude/CLAUDE.md` (the global rules text) on unsuppressed
  findings, naming the file and line. `size` warns only so a slow creep shows without going red;
  the global rules also warn on `volatile`, `code-derivable` and `tutorial`, which their
  counterexamples trip on purpose. The exit code follows that split (issue 337): warn-only
  findings print and exit 0; `--warn-only a,b` replaces the per-file set.
- Session runbook: `docs/runbooks/session.md`. Release here is the push to `origin/master`.

## Related

- `../claude-account-handoff` — moves *accounts* on one machine (`CLAUDE_CONFIG_DIR`). Different
  problem: this repo is where one profile is authored.
- The project half of a new-machine setup is written up in the commissions repo at
  `docs/runbooks/new-machine.md`.
