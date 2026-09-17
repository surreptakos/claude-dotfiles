---
name: project-harness
description: Bolt the production organization harness onto any repo — triage labels, issue forms, generated DASHBOARD.md + CI refresh, pre-commit test gate, ADR status lines, live tracker-drift audit, Projects board. Use when the user says "harness this repo", "set up the project harness", "make this repo organized like aac-cockpit", "upgrade the harness", or spins up a new project. Idempotent — safe to re-run, and carries a version marker so an existing install can be upgraded.
metadata:
  modified: '2026-09-17T01:54:06Z'
  previous-modified: '2026-09-17T00:00:35Z'
  revision: '20'
  content-sha: e75e643cc987
---

# Project Harness

> **Packaged copy.** A cloud session runs none of this machine's hooks, so the commands below
> call the plugin's own bundled scripts. Nothing is cached and `--refresh` does not apply:
> every run is fresh.

Install **or upgrade** the organization harness proven on `aac-cockpit` (2026-07-28). Every piece is
idempotent: skip what exists, update in place, never duplicate. Reference implementation if anything here is
ambiguous: `Sales Data KPIs/aac-cockpit` on this machine.

**Step 0 decides which job this is. Read it before anything else** — most invocations after the
first are upgrades, and step 7 is the whole upgrade path.

> **Never back this skill up inside `${CLAUDE_PLUGIN_ROOT}/skills/`.** A copied folder there is loaded as a
> second skill with an identical description, so skill selection has two indistinguishable
> candidates. Copy to a temp directory instead. (Hit while editing this skill on 2026-07-28.)

## 0 — Install or upgrade? Decide this FIRST

**Before anything else, check whether this repo is already harnessed:**

```sh
cat docs/agents/harness-version.md 2>/dev/null; ls scripts/build-dashboard.js 2>/dev/null
```

- **Either one present → this is an UPGRADE. Go straight to step 7** and do only what that repo's
  version lacks; step 7 carries the whole upgrade path.
- **Neither present → fresh install.** Continue to step 1. (A `build-dashboard.js` with no marker file
  means **version 1**, not unharnessed.)

Why this gate is first: the steps below read as a fresh install, and running them against an existing
install churns every file for nothing and can **destroy hand-tuned configuration** — step 3.3 would
regenerate a `CONFIG` block that someone had corrected by hand, silently reverting it. Two real
examples on this machine: `aac-bill-intake` needs an explicit `node --test <file> <file>` list because
`node --test gas/` does not work there, and both it and `aac-task-management` carry comments explaining
their test command. Detection would not reproduce any of that.

**Upgrading is machine-wide, not per-repo.** Step 7 begins by finding every harnessed repo, so invoking
this skill once — from any repo, or none — can upgrade all of them. There is no need to open a session
per repo.

## 1 — Explore (before touching anything)

- `git remote -v` — must be a GitHub repo for the tracker/CI pieces; if no remote, offer to `gh repo create` (private by default).
- **Test command** — detect in order: `package.json` `scripts.test`; a repo-documented command in CLAUDE.md/README (e.g. `node tests/run-all.js`); `pytest`/`cargo test`/`go test ./...` by manifest. If nothing detectable, ask the user; if the repo genuinely has no tests, the hook and the dashboard's test line are installed as no-ops with a `TODO` and you say so.
- **ADR dir** — `docs/adr/` or `doc/adr/` or none. None is fine (section skipped).
- **Deploy/CI workflow** — any existing `.github/workflows/*.yml` whose name suggests deploy/test; the dashboard reports the most deploy-like one, or skips.
- Existing labels, issue templates, `.githooks`, `DASHBOARD.md`, `docs/agents/` — to know what to skip or merge.
- Repo private? (`gh repo view --json isPrivate`) — private is expected; never suggest GitHub Pages for a private repo's dashboard.
- **Apps Script repo?** `.clasp.json` at the root, in `gas/`, or in `src/` — or `gas.json`, which means it already deploys itself. Decides step 13 and the Releasing section of the session runbook.

## 2 — Confirm only genuine branches

Usually zero questions. Ask only when: the test command is undetectable, or the user might want the shared
cross-repo Projects board instead of per-repo (see step 6).

## 3 — Install

1. **Labels** (`gh label create`, tolerate exists): the five triage roles `needs-triage`/`needs-info`/`ready-for-agent`/`ready-for-human`/`wontfix`, plus `prd` (#5319e7) and `chore` (#fef2c0). Reuse GitHub defaults (`bug`, `enhancement`, `documentation`) as they come. `prd` carries its own contract: a PRD issue is a first-class container (problem + locked decisions + sub-issue checklist) with its own reading of the five states and a close-with-children rule. The `triage-labels.md` seed in `setup-matt-pocock-skills` carries the lifecycle table — step 7 must land it in `docs/agents/triage-labels.md`.
2. **Issue forms** — copy `templates/issue-forms/*` to `.github/ISSUE_TEMPLATE/`. They label `needs-triage` on arrival; that's the intake guarantee. Substitute `TEST_COMMAND` in `ticket.yml`'s "Done when" description with the repo's real test command (same substitution as the hook).
3. **Dashboard generator** — copy `templates/build-dashboard.js` to `scripts/build-dashboard.js` and fill the `CONFIG` block at the top (testCommand, adrDir, deployWorkflow) from step 1's findings. **If the file already exists, PRESERVE its existing `CONFIG` verbatim** — splice the old block into the new template rather than re-deriving it; a hand-corrected test command and the comments explaining it are exactly what detection cannot reproduce. The splice, CRLF-tolerant because repo copies on Windows are CRLF and the template is LF (a `\n};\n` pattern silently fails to match):
   ```js
   const cfgRe = /const CONFIG = \{[\s\S]*?\r?\n\};\r?\n/;
   const mine = fs.readFileSync(P, 'utf8').match(cfgRe);        // P = scripts/build-dashboard.js
   if (!mine) throw new Error('no CONFIG in repo copy');        // fail loud; never fall through to the template's
   fs.writeFileSync(P, fs.readFileSync(T, 'utf8').replace(cfgRe, mine[0]));
   ```
   Then assert the values survived (`grep` the title and test command) before moving on — a splice that silently produced the template's placeholder `REPO_TITLE` renders a perfectly valid dashboard for the wrong repo.
4. **Dashboard workflow** — copy `templates/dashboard.yml` to `.github/workflows/dashboard.yml` (push to default branch + issue events + manual; force-pushes the regenerated `DASHBOARD.md` to a dedicated `dashboard` branch, never back to the default branch, so CI cannot advance origin on a file that has nothing to do with source state — claude-dotfiles issue 20, ported here as v15). The default branch stays untouched by CI; the artifact reads at a stable GitHub URL: `https://github.com/<owner>/<repo>/blob/dashboard/DASHBOARD.md`. Two substitutions the template marks inline:
   - **Default branch.** `main` appears twice (`push.branches`, `checkout.ref`); on a `master` repo the un-substituted workflow never fires and the failure is silent — no run, no error. Read it from `git symbolic-ref refs/remotes/origin/HEAD`.
   - **Test environment.** The job only has Node. If `testCommand` is another language, add the runtime setup and the dependency install (the template carries a commented Python example), and install the FULL set the suite imports — optional extras included. Symptom of getting this wrong: CI's health line says `FAILING — 1 error in ~2s` (collection/import error) while the suite is green locally, because local happens to have the extra installed (hit on aac-task-management: a test imports a script whose module top imports `anthropic`, which lives in a non-dev extra).
5. **Pre-commit test gate** — copy `templates/pre-commit` to `.githooks/pre-commit`, substitute the test command, add a one-line `.githooks/README.md`, then `git config core.hooksPath .githooks`. Time the suite first; if it exceeds ~60s, put it in a pre-push hook instead of pre-commit and say so.
6. **ADR status lines** — if an ADR dir exists, ensure every ADR has a `**Status:**` line after its title (default `accepted.`; superseded ones must say by what). The dashboard reads these.
7. **Tracker + agents config** — if `docs/agents/issue-tracker.md` is absent, run the `setup-matt-pocock-skills` flow (GitHub tracker) or write the GitHub variant directly; add the Dashboard section pointing at `DASHBOARD.md` and the issue forms.
8. **Live tracker audit** — copy `templates/tracker-audit.js` to `tools/tracker-audit.js`. No substitutions: it infers the repo from `gh repo view`. It reads live GitHub state (prose `Blocked by #N` with no native dependency edge, closed issues with unticked acceptance boxes, a `#N` that is neither an issue nor a PR, missing/conflicting triage labels, an open issue whose Projects card says Done, an open issue on no board at all, plus two advisory checks) — the drift no file-level test can see. Exit 0 clean / 1 drift / **2 could not audit**; preserve that third code in any edit, because a tracker query returning nothing must never read as a pass.
   - It needs the network and an authenticated `gh`, so it lives at the command line, optionally as a CI step (a separate workflow, or a job in `dashboard.yml` kept clear of the test job) — a commit gate that needs the network breaks committing offline, which keeps it out of `.githooks/pre-commit`.
   - Record it in `docs/agents/issue-tracker.md` as the thing to run before trusting the tracker.
   - In `claude-dotfiles` itself the template is **generated** from `tools/tracker-audit.js` by `tools/build-harness-tracker-audit.js`; never hand-edit `templates/tracker-audit.js` there. Fix the repo copy, re-run the generator, and `tools/tracker-audit-template.test.js` goes green (issue 336).
9. **Harness version marker** — copy `templates/harness-version.md` to `docs/agents/harness-version.md` and set the date. A one-line `harness-version: N` in a dedicated file, rather than a constant in `scripts/build-dashboard.js`: the marker has to be readable with one `cat` in every harnessed repo, and aac-cockpit's dashboard script predates the template's `CONFIG` block, so a constant there would need the script restructured before the version could be read. **Current version: 27.** The `/session-start` check reads this marker every session and STOPs when the repo is behind (issue 139), so close an out-of-date harness before writing code — a repo without the v27 cloud bootstrap hook is exactly that state, and the STOP line is the only thing that says so.
10. **Deploy-safety check** — if the repo has a packaging/deploy step that sweeps files (clasp, docker COPY, npm files field), confirm `scripts/`, `.githooks/`, `tools/`, `.github/` are excluded. This bit aac-cockpit: clasp would have pushed Node tooling into Apps Script.
    - While here, make sure the harness's own files are excluded too — including `.caveman.json` from step 14.
11. **CLAUDE.md** — add/refresh a short block: dashboard is generated (never hand-edit), hook activation command, tracker pointer, `node tools/tracker-audit.js`, and the session commands from step 12.
12. **Session checks** — copy `templates/session.json` to `.claude/session.json`, substituting `TEST_COMMAND` (same value as the hook and `ticket.yml`). Copy `templates/session-runbook.md` to `docs/runbooks/session.md`; if the repo does not deploy, delete that template's Releasing section as its comment says.
    - **PRESERVE an existing `.claude/session.json` verbatim.** Identical hazard to step 3.3's `CONFIG` block, and for the identical reason: this file carries the hand-corrected test command and the repo's release gates, and detection cannot reproduce either. Merge in missing keys; never regenerate the file.
    - The engine lives once at `${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js` rather than per repo, and `~/.claude/hooks/session-gate.js` runs it from the global `SessionStart` / `SessionEnd` / `UserPromptSubmit` hooks — so a harnessed repo gets the checks without anyone invoking a skill. `/session-start` and `/session-end` only re-print the cached result. Vendoring a copy into every repo would give five copies to drift, and a duplicated skill folder makes skill selection ambiguous (see this file's header).
    - Fill `releaseGates` with what the repo actually gates on — `node tools/canary.js` where it exists, `[]` otherwise; never `clasp-auth` for a self-deploying repo. They run at `--end`.
13. **Self-deploy (gas)** — an Apps Script repo adopts the gas package instead of a clasp credential: follow the `gas-deploy` team skill (claude-dotfiles `gas/README.md`): `gas init` (prefills `preserve` from the live script), `gas vendor`, the `deploy.yml` template with the repo's test command, one `gasEnsureTrigger_();` line in an existing trigger, then the one-time `gas push` + `gas seed`. The script then pulls every merge from GitHub and no credential exists in CI or on a machine. `templates/clasp-auth.js` is legacy — copy it to `tools/clasp-auth.js` only for a repo the owner explicitly keeps on clasp, and then:
    - **It is AAC-hardcoded on purpose.** `CLIENT_ID` and `ACCOUNT` name the private OAuth client in `gpt-sheets-access-475817` and the account owning the bound scripts. A non-AAC repo needs both edited; there is no detection that could infer them, and a wrong guess yields a tool that confidently validates the wrong credential. Say so at handoff rather than installing it silently into a non-AAC project.
    - Why it is worth a step: it checks the grant's **scopes**, not merely that it refreshes.

14. **Session output intensity** — copy `templates/caveman.json` to `.caveman.json` at the repo root.
    - The caveman plugin's SessionStart hook resolves its level as `CAVEMAN_DEFAULT_MODE` env > repo-local
      `.caveman.json` / `.caveman/config.json` (walking up from cwd) > user config
      (`%APPDATA%\caveman\config.json`, or `$XDG_CONFIG_HOME`/`~/.config` elsewhere) > `full`.
    - **The repo file is the one that survives.** A user-level config lives on one machine and in no history,
      so a repo that depends on the level being `ultra` gets `full` on any other checkout and nobody notices —
      the session just reads more verbosely. Pinning it in the repo makes the intent reviewable.
    - Default here is `ultra` (Dan, 2026-08-02). Keep an existing file's value if the repo already carries one;
      only add the file where it is missing.
    - If the repo has a packaging step that sweeps root files (the gas deployable set, docker COPY), exclude it — same list as
      step 10 (`gas.json` `exclude` mirrors what `.claspignore` used to say).
    - A repo still on clasp keeps the old rule: `~/.clasprc.json` is shared by every clasp project on the machine, so a bare `clasp login` produces a credential that pushes fine here while silently breaking Gmail and Drive work in another repo; wire `prepush` to `node tools/clasp-auth.js --quiet` where there is a `package.json`. A self-deploying repo has nothing credential-shaped to wire.

15. **Ticket fleet** — the fleet is served by the `aac-skills` plugin; the harness copies no
    script. In a session with the plugin installed (step 16 makes that so), invoke it via the
    Workflow tool with `scriptPath = ${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/ticket-fleet.js`
    and the three required contract args `contractVersion: 2`, `runId` (`printf %x $(date +%s)`,
    held across a resume) and `invocationId` (`printf %x%x $(date +%s) $$`, fresh on every launch,
    never equal to `runId`) - the workflow runtime forbids `Date.now()`/`Math.random()`, so the
    caller mints both ids, and a launch missing any of the three is refused with a
    contract-mismatch error naming the version on both sides. One script serves local and cloud sessions - it picks between
    the `gh` CLI and the GitHub MCP tools at run time (a cloud container sets
    `CLAUDE_CODE_REMOTE_SESSION_ID`, or has no `gh` on PATH).
    - **A repo needing a forked script keeps its own `.claude/workflows/ticket-fleet.js` copy**
      (hand-tuned prompts, extra phases like aac-routines' auth/cleanup, aac-cockpit's
      `PROMPT_CONTRACT`) and calls it by name; otherwise `scriptPath` at the plugin copy is the
      default and the repo carries no fleet file. A fork goes stale the moment the plugin's
      contract moves: `node tools/ticket-fleet-contract.js <fork>` in `claude-dotfiles` says
      which forks are behind, and the ripple table in the ticket-fleet SKILL.md lists them.
    - **First run in a repo: pass `deliver: false`** (verify-only dry run) before letting the
      fleet push branches and open PRs.

16. **Cloud bootstrap hook + plugin + auto-mode posture** — one command delivers all three, and it
    is the whole cut-over of a repo to cloud sessions (issue 218, spec #207):
    `node ${CLAUDE_PLUGIN_ROOT}/skills/project-harness/templates/add-cloud-plugin.js <repo-root>`.
    - **The bootstrap hook is the one per-repo artefact** (issue 163). The script copies
      `templates/session-start.sh` to `<repo>/.claude/hooks/session-start.sh`, marks it
      executable, and prepends one `hooks.SessionStart` entry
      (`$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh`, timeout 120) so it runs before any
      hook that needs gh, the skills or the rules text. In a container
      (`CLAUDE_CODE_REMOTE=true`) the hook shallow-clones dotfiles master, installs gh from the
      pinned tarball onto PATH through `$CLAUDE_ENV_FILE`, copies the `aac-skills` payload into
      `${CLAUDE_PLUGIN_ROOT}/skills/`, merges the payload's hooks manifest into the container's user settings
      so governance fires on prompt 1, writes the marker session-check reads, and emits one
      sub-2KB `additionalContext` line. A local session exits 0 immediately. **No repo carries
      skill content** — the payload comes from master at session start, and the hook body itself
      is generated in `claude-dotfiles` from the `.claude/hooks/session-start.sh` that repo runs
      (`tools/build-harness-bootstrap-hook.js`), so the delivered body is the exercised one.
    - **The plugin declaration** (`extraKnownMarketplaces`, `enabledPlugins`) makes a cloud
      session install `aac-skills` at startup where the marketplace route cannot.
    - **The posture** (`permissions.defaultMode` `auto` + the blanket `permissions.allow`, and the
      widened `autoMode.allow` ruling — Dan, 2026-09-15, issue 245) keeps an unattended session
      (cloud or Routine master) sanctioned to run every action its work requires, destructive and
      irreversible included, instead of the classifier parking it.
    - The script creates `.claude/settings.json` when absent (equivalent to copying
      `templates/claude-settings.json`) and otherwise merges only those keys plus
      `hooks.SessionStart`, leaving everything else verbatim. It detects an already-wired hook by
      the command path, never by a tag, so a repo whose entry predates this step (claude-dotfiles)
      gains no duplicate. Then confirm it still parses:
      `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"`.
    - **Idempotent, and prove it: run it twice and the second run prints
      `already delivered: ...` and leaves `git status` clean.** That is the acceptance criterion of
      issue 218, and it is the reason the template is a byte-identical copy of the hook rather than
      a copy with a generated banner.
    - **PRESERVE an existing `.claude/settings.json`.** Same hazard as step 12's session.json: repo
      copies carry hand-built `permissions` allowlists (aac-bill-intake, aac-contract-builder) and
      `hooks` (aac-sales-cockpit, claude-dotfiles). Never regenerate the file; the script only adds
      keys and unions arrays. An existing `permissions.defaultMode` (e.g. `bypassPermissions` on a
      desktop-only repo, or `acceptEdits` if a repo chose that) is preserved unchanged; only
      absence gets filled with `auto`.
    - **The widened autoMode.allow ruling** (Dan, 2026-09-15, issue 245) supersedes the 2026-09-14
      acceptEdits ruling and the narrow prose rules that followed it. Recorded on master in
      `docs/cloud-permission-posture-2026-09-15.md`; the 2026-09-14 doc is retained and marked
      superseded so history is legible.
    - Why here and not at the account or the environment: cloud sessions read only the repo. The
      claude.ai account-level plugin sync returns zero plugins for the account even with the plugin
      enabled there (`plugins_sync_no_changes count:0` in the session diag log), and the cloud
      environment setup script runs before the session's git credentials exist, so
      `claude plugin marketplace add` fails there on the private clone. Declared in project settings,
      Claude Code clones the marketplace itself after credentials are wired up. Verified 2026-09-09 in
      a cloud container (claude-dotfiles#100): a fresh startup with only these two keys loaded all 56
      skills and ran the plugin's SessionStart hook.
    - A local session that already has `aac-skills@claude-dotfiles` installed at user scope is
      unaffected; the key names the same plugin id.

## 4 — Verify every install

- `node verify-dashboard-parse.js` (in this skill folder) — proves the dashboard's test-health line
  reports pass/fail counts rather than whatever the runner printed last. Run it after ANY edit to
  `templates/build-dashboard.js`. It exits 2 if the template was restructured enough that the check
  can no longer find what it inspects, which is a signal to read before trusting.
- `node scripts/build-dashboard.js` locally — DASHBOARD.md renders, sections with no data degrade to "n/a"/"None".
- **Read the health line it produced.** A wrong line renders perfectly. Expect "N passing, N failing" — a duration, a `}`, or a bare timing string means the
  parse missed this runner's summary shape. Then break a test on purpose, regenerate, and watch the
  line go red before you restore it: a monitor you have only ever seen pass is not yet a monitor.
- Compare the local health line against CI's. A lower count in CI usually means tests skipped
  because their fixtures are git-ignored — legitimate, but the line must SAY skipped rather than
  quietly reporting a smaller pass count.
- `node --check tools/tracker-audit.js`, then **run it**: `node tools/tracker-audit.js`. Exit 1 on an
  existing repo is the expected result, not a failure of the install — read the findings and hand them
  to the owner rather than fixing them as part of the harness work. Exit 2 means it could not see the
  tracker (`gh auth status`, wrong repo, dependencies endpoint unavailable); that is not a pass, and it
  is the one outcome you must never report as clean.
- Commit everything (the new hook fires — that's its first test), push, `gh run watch` the dashboard workflow to success, `git pull` the bot commit.
- **Expect `DASHBOARD.md` to conflict eventually, and resolve it by regenerating, never by picking
  a side.** Two writers commit that file: you locally, and the CI bot. Run a local generate, push
  later, and the rebase stops on `UU DASHBOARD.md` where both versions are equally "right" and
  neither is authoritative. `node scripts/build-dashboard.js && git add DASHBOARD.md` then continue.
  Simplest habit: after the initial install, stop generating it locally and let CI own it — run the
  script only to check output, and discard the result.
- **Session checks** — `node ${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js` from the repo. It must find the test command (via `.claude/session.json` or `npm test`) and report the tracker audit; a `no test command detected` line means the substitution did not land. On a clasp repo, confirm the Apps Script section reports the credential rather than `no tools/clasp-auth.js`.
- Let the next real issue exercise the issue-event trigger.
- **Cloud plugin** — `.claude/settings.json` parses and carries `enabledPlugins["aac-skills@claude-dotfiles"]`
  plus the `claude-dotfiles` marketplace. The real test is a fresh cloud session on the repo: its
  skill list shows `aac-skills:` entries and the plugin's SessionStart hook prints its marker line.
- **Cloud bootstrap hook** — `.claude/hooks/session-start.sh` is present and executable, one
  `hooks.SessionStart` entry names it, and a second `add-cloud-plugin.js` run prints
  `already delivered` with nothing to commit. It exits 0 in a local session (no
  `CLAUDE_CODE_REMOTE`), so running it here proves nothing beyond that; the real test is one cloud
  session on the repo quoting the `AAC-BOOTSTRAP MARKER` line, `gh --version`, one
  `gh api repos/<owner>/<repo>` call, and session-check's `Cloud bootstrap` block reading `ok`.

## 5 — Projects board (optional but default-yes)

Requires the `project` token scope (`gh auth status`; if missing, `gh auth refresh -s project` — the user
completes the device code in their own browser; never enter their credentials).

- Per-repo board: `gh project create --owner <user> --title "<repo title>"`, link it, add open issues.
- OR the shared board (one board, every repo's issues): ask once; `gh project item-add <n>` works cross-repo.
- Record the item-add convention in `docs/agents/issue-tracker.md`.
- **The "Auto-add to project" workflow is the difference between a board that maintains itself and a
  queue of manual adds nobody remembers.** Adding today's open issues at install time is a snapshot,
  not a subscription: every issue created afterward needs a manual `gh project item-add`, and
  `tracker-audit.js` reports each one as `not-on-board`. Observed on aac-cockpit 2026-07-29 — seven
  issues filed in one session, every one off the board. It is **owner-only** (project Settings →
  Workflows), so **hand it to the owner as an explicit action at handoff**; a doc line saying the
  toggle exists is not the same as it being on. Three things verified there the same day, each of
  which had already produced a wrong conclusion:
  - **Linking a project to a repo is NOT auto-add.** Separate features, and linking is the visible
    one — it puts the board in the repo's Projects tab and makes `repository.projectsV2` return it,
    so it reads as sufficient. An issue filed with linking active and the workflow off landed on no
    board at all.
  - **Enabling it is not one click.** A first toggle attempt still left a new issue off the board
    through 60s of polling; the filter and scope have to be right, not merely present. After the fix,
    a card appeared in under 8 seconds.
  - **The toggle is readable, the filter is not.** `projectV2 { workflows(first: 20) { nodes { name enabled } } }`
    over GraphQL returns each built-in workflow with its `enabled` flag (verified 2026-09-09); `gh project`
    has no subcommand for it. The repo filter behind "Auto-add to project" is exposed nowhere, and a
    wrong filter is the failure that matters: 2026-08-20 to 2026-08-26 the auto-add on two other repos'
    boards also matched aac-sales-cockpit and pulled 52 of its issues onto them. So `enabled: true` is
    a precondition, not the verification: file an issue and check `gh issue view <n> --json projectItems`,
    and check that it landed on *only* the intended board. If `not-on-board` findings reappear later,
    re-check the workflow rather than assuming it held.
  - Auto-add catches only issues created **after** it was enabled, so the manual `item-add` stays the
    backfill path for an existing queue.
- **The board WRITES BACK to issues. Moving a card is not a read-only act.** Setting a card to `Done`
  fires the board's Done→closed workflow and **closes the issue**; closing an issue moves its card to
  `Done`; reopening moves it to `In Progress`. Learned by accidentally closing a live issue while
  testing a drift check on 2026-07-29. Never nudge a card to see what happens — it edits the tracker.
- **`gh issue view --json projectItems` does not return the item id**, only `status` and `title`. To
  edit a card you need the `PVTI_…` id, which comes from GraphQL on the project node
  (`node(id:"PVT_…"){... on ProjectV2{items(first:100){nodes{id content{... on Issue{number}}}}}}`).
  Passing the empty string `gh issue view` yields gets you
  `Could not resolve to a node with the global id of ''`.
- **`repository.projectsV2` only lists projects LINKED to the repo.** An owner-level board holding
  that repo's issues does not appear there, so discovery through it reports "no board" for a board
  full of cards. Infer board use from the issues instead: if any issue carries a `projectItems`
  entry, a board is in play.
- **Verify an add with `gh issue view <n> --json projectItems`, not `gh project item-list`.**
  Observed 2026-07-28 on a user-owned board: `item-add` succeeded and returned the issue JSON,
  while `item-list` reported `totalCount: 0` for the same board. `issue view` showed the card
  present with status `Todo`. A false zero from a listing tool is indistinguishable from "the add
  did nothing", so it burns retries. `item-add` is idempotent per issue — a repeat does not create
  a second card.
- **Bulk adds drop silently — space them and verify the count.** Also observed 2026-07-28
  (aac-task-management): 15 back-to-back `item-add` calls each exited 0 and returned the issue
  JSON, yet only 2 cards landed on the board. Re-adding the missing 13 with ~1s between calls
  landed all of them. So after any bulk add, verify the total independently (GraphQL on the
  project node: `node(id:"<PVT_...>") { ... on ProjectV2 { items(first:N){ totalCount } } }`, or
  `issue view --json projectItems` per issue) and re-add whatever is missing — idempotency makes
  the retry safe.

## 6 — Migrating an existing repo's backlog

If the repo has a legacy tracker (markdown TODOs, `.scratch/`, stale issue files): classify before importing, because statuses
lie. Judge each item against the code first (SHIPPED / SUPERSEDED / OPEN, with evidence — spawn an agent for
bulk), file GitHub issues only for the genuinely OPEN, and mark the legacy location read-only archive in the
tracker doc. On aac-cockpit this turned ~90 tickets into 4 issues.

## 7 — Upgrading an existing install

A repo harnessed at an older version does not get new capabilities by itself. This is the path.

**1. Find the harnessed repos.** The reliable signal is `scripts/build-dashboard.js` sitting next to
`docs/agents/issue-tracker.md`; either alone gives false hits. Two traps:

- **Paths with spaces.** `find` output fed to an unquoted `for` word-splits, and one repo really does
  live under `Sales Data KPIs/` — an unquoted sweep reports it as three nonexistent directories, which
  is how a scan concluded aac-cockpit was missing its tracker doc when the file was there all along.
  Use `-print0` and quote every expansion:

  ```sh
  find "$HOME/Claude/Projects" -path '*/scripts/build-dashboard.js' \
       -not -path '*/.claude/worktrees/*' -print0 |
    while IFS= read -r -d '' f; do
      r=$(dirname "$(dirname "$f")")
      [ -f "$r/docs/agents/issue-tracker.md" ] && echo "$r"
    done
  ```
- **Agent worktrees.** `.claude/worktrees/*` holds full copies of the repo, so an unfiltered sweep
  returns dozens of hits for two repos. Exclude them and upgrade the primary checkout only.

**2. Read the version.** `cat docs/agents/harness-version.md` → `harness-version: N`. **File absent
means version 1** (pre-marker), not "unharnessed".

**3. Install only what that version lacks**, then bump the marker's number and date. A full re-run
churns every file for nothing and can revert hand-tuned configuration, per step 0.

The rows are in [`UPGRADES.md`](UPGRADES.md) — one per version, saying what it added and which
step installs it. Read the rows above the repo's number and re-run only those steps.

A row can mean "re-copy a file you already have". The marker answers *what a repo lacks*, and a
template that changed is something the repo lacks just as much as a file it never had — so bump the
version whenever a template changes materially, not only when a step is added. Anything else and a
repo sits at the current version holding an old file, which is the exact drift the marker exists to
stop.

### Changing a template means sweeping, in the same session

**A version bump is not propagation.** Bumping the marker records that older installs are behind; it
does nothing to them. Every repo stays stale until someone runs the sweep, and nobody wakes up wanting
to run a sweep.

**Diff before re-copying, even when the CONFIG splice preserved CONFIG.** Repos
customize the template BODY too, and their own tests can pin those customizations:
aac-task-management's `build-dashboard.js` carries a `CONFIG.milestonesDoc` feature its unit tests
assert on (the sweep's re-copy broke its pre-push suite, which is the only reason it was caught),
and aac-bill-intake carries a load-bearing Open-PRs section born from a real incident, which the
same sweep silently deleted and pushed (2026-08-21, restored same day). Before re-copying into any
repo, diff the repo copy against the PREVIOUS template revision — if anything beyond CONFIG and the
changed region differs, hand-apply the delta to the repo's copy instead of re-copying. The v11 sweep
measured how normal divergence is: FIVE of nine repos carried hand-extended `tracker-audit.js`
bodies (aac-bill-intake, aac-routines, aac-task-management, aac-cockpit, zoho-source-of-truth) —
"this template has no CONFIG so it copies verbatim" was already false for the majority. And **pull
before diffing**: zoho's divergence existed only on origin (a merged PR the local clone hadn't
pulled), so the local diff read clean and the clobber surfaced as a stash conflict. Also check
whether the repo already implements the new check under its own name before porting it —
aac-cockpit's `landed-but-open` pair is a superset of v11's `possibly-delivered?`, so that repo got
only the `unmilestoned` half.

So the bump and the sweep are one action, not two: **after any material template edit, immediately run
the step-1 find command, read every marker, and upgrade whatever is behind.** Measured on 2026-07-29
after the v4 edit — four harnessed repos, two of them still on v3, both silently holding the older
`build-dashboard.js`.

Note *why* the sweep has to live here rather than in the repos: **a stale repo cannot detect its own
staleness.** Its `tracker-audit.js` and its marker are both old, so any self-check compares an old
number against an old constant and reports health. Nothing local to a repo can know a newer template
exists. Detection is only possible from the skill, looking across installs — which is what makes
skipping the sweep permanent rather than merely delayed.

Worth saying plainly at handoff which upgrades are code (an agent re-copies a file) and which are
owner actions no tooling can perform — the Projects auto-add workflow being the standing example.
Mixing them into one list is how the owner-only half gets read as done.

**4. Verify and hand off.** `node --check` the new script, run `node tools/tracker-audit.js`, and give
the owner its findings. On a repo with tracker history, expect exit 1 — that IS the point of the
upgrade. Leave the drift with the owner: the audit is read-only, and closing an issue or adding a
dependency edge is their judgment. Commit the tooling only, one commit, hooks honoured.

## What this deliberately does not do

- No branch protection / PR-required flow — solo direct-push repos are the norm; offer it only when multiple
  agents/people commit in parallel.
- No GitHub Pages for dashboards (private repos leak).
- No auto-close bots — closing an issue is a judgment.
