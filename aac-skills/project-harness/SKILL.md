---
name: project-harness
description: Install or upgrade the project harness (triage labels, issue forms, generated DASHBOARD.md, test gate, tracker audit, cloud bootstrap). Use when the user says "harness this repo" or starts a new project, asks to upgrade a harness, or has edited a harness template.
metadata:
  modified: "2026-10-02T23:10:00Z"
  previous-modified: "2026-10-02T15:39:25Z"
  revision: "53"
  content-sha: "33c19294a24d"
---

# Project Harness

Install **or upgrade** the organization harness. Every piece is idempotent: skip what exists, update
in place, add nothing twice. Where this file is ambiguous, the reference implementation is
`Sales Data KPIs/aac-cockpit` on the owner's machine.

Back this skill up to a temp directory before editing it: a copy anywhere under `~/.claude/skills/`
loads as a second skill with an identical description.

## 0 — Install or upgrade? Decide this first

```sh
cat docs/agents/harness-version.md 2>/dev/null; ls scripts/build-dashboard.js 2>/dev/null
```

- **Neither present → fresh install.** Continue to step 1.
- **Either present → UPGRADE. Go straight to step 7** and install only what that repo's version
  lacks; a `build-dashboard.js` with no marker file is **version 1**. Steps 1–6 read as a fresh
  install: run against an existing install they churn every file and revert hand-tuned
  configuration (a corrected test command, the comments explaining it) that detection cannot
  reproduce. Step 7 is machine-wide: one invocation, from any repo or none, upgrades every
  harnessed repo.
- **The owner asks for the skill to run on a repo whose marker is current → run it anyway, as a
  verification pass** (Dan, 2026-10-01: "Run it again as if you had none and needed to do every
  single step"). A current marker says it was bumped, not that every piece matches its template
  (that day osh-rfp read v37 with a stale `tools/tracker-audit.js`, no Projects board and a red
  tracker audit). So walk steps 1–6 against the live repo: diff every template the repo carries
  (with `TEST_COMMAND`, `DEFAULT_BRANCH` and the `CONFIG` splice applied) and apply only the
  differences under `MERGING-TEMPLATES.md`, run every check in step 4 and report each line, and do
  step 5. "Nothing to do" is a finding of that pass,
  never of the marker read alone.

## 1 — Explore (before touching anything)

Done when every item below has an answer.

- `git remote -v` — the tracker/CI pieces need a GitHub repo; with no remote, offer `gh repo create`
  (private by default).
- **Default branch** — `git symbolic-ref refs/remotes/origin/HEAD`; a cloud clone may have no
  `origin/HEAD`, so fall back to `git remote show origin`. Steps 3.4 and 3.8b substitute it.
- **Test command** — detect in order: `package.json` `scripts.test`; a command documented in
  CLAUDE.md/README (e.g. `node tests/run-all.js`); `pytest`/`cargo test`/`go test ./...` by manifest.
  Undetectable → ask. A repo with no tests gets the hook and the dashboard's test line as no-ops with
  a `TODO`, said aloud, and that TODO filed as a `ready-for-agent` ticket: writing a suite is agent
  work, and `ready-for-human` is reserved for a step an agent cannot perform (credential, owner
  ruling, UI-only action).
- **ADR dir** — `docs/adr/`, `doc/adr/`, or none (section skipped).
- **Deploy/CI workflow** — the most deploy-like `.github/workflows/*.yml`; the dashboard reports it,
  or skips.
- Existing labels, issue templates, `.githooks`, `DASHBOARD.md`, `docs/agents/` — what to skip or
  merge.
- **Visibility** — `gh repo view --json isPrivate`; private is expected (see Scope limits).
- **Apps Script repo?** `.clasp.json` at the root, in `gas/` or in `src/` — or `gas.json`, meaning it
  already deploys itself. Decides step 3.13 and the session runbook's Releasing section.

## 2 — Confirm only genuine branches

Ask only when the test command is undetectable, or when the user might want the shared cross-repo
Projects board instead of a per-repo one (step 5). Otherwise proceed without questions.

## 3 — Install

1. **Labels** (`gh label create`, tolerate exists): the five triage roles `needs-triage` /
   `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`, the sixth state
   `ready-for-local-agent` (desktop-only work with no person in the loop; the triage, to-tickets and
   session-check skills and the dashboard's TRIAGE list use it), plus `prd` (#5319e7) and `chore`
   (#fef2c0); reuse GitHub's defaults (`bug`, `enhancement`, `documentation`). A `prd` issue's
   container lifecycle is the `triage-labels.md` seed in `setup-matt-pocock-skills`, which 3.7 lands
   in `docs/agents/triage-labels.md`.
2. **Issue forms** — copy `templates/issue-forms/*` to `.github/ISSUE_TEMPLATE/` (they label
   `needs-triage` on arrival: the intake guarantee). Substitute `TEST_COMMAND` in `ticket.yml`'s
   "Done when" with the repo's test command.
3. **Dashboard generator** — copy `templates/build-dashboard.js` to `scripts/build-dashboard.js` and
   fill its `CONFIG` block (testCommand, adrDir, deployWorkflow) from step 1. **An existing file
   keeps its `CONFIG` verbatim**: splice the old block into the new template. The regex is
   CRLF-tolerant because Windows repo copies are CRLF and the template is LF:
   ```js
   const cfgRe = /const CONFIG = \{[\s\S]*?\r?\n\};\r?\n/;
   const mine = fs.readFileSync(P, 'utf8').match(cfgRe);        // P = scripts/build-dashboard.js
   if (!mine) throw new Error('no CONFIG in repo copy');        // fail loud; never fall through to the template's
   fs.writeFileSync(P, fs.readFileSync(T, 'utf8').replace(cfgRe, mine[0]));
   ```
   Then `grep` the title and test command to prove they survived: a splice that yields the
   template's `REPO_TITLE` renders a valid dashboard for the wrong repo.
4. **Dashboard workflow** — copy `templates/dashboard.yml` to `.github/workflows/dashboard.yml`. It
   force-pushes `DASHBOARD.md` to a dedicated `dashboard` branch, so CI never advances the default
   branch; the artifact reads at `https://github.com/<owner>/<repo>/blob/dashboard/DASHBOARD.md`.
   Two substitutions, marked inline:
   - **Default branch** — `main` appears twice (`push.branches`, `checkout.ref`). Left wrong, the
     workflow never fires and nothing reports it.
   - **Test environment** — the job has only Node. For another language add the runtime setup and
     install the FULL dependency set the suite imports, optional extras included (the template
     carries a commented Python example). Tell-tale: CI's health line reads `FAILING — 1 error in ~2s`
     (an import error) while the suite is green locally.
5. **Pre-commit test gate** — copy `templates/pre-commit` to `.githooks/pre-commit`, substitute the
   test command, add a one-line `.githooks/README.md`, then `git config core.hooksPath .githooks`.
   Stage the hook executable: `git add .githooks/pre-commit && git update-index --chmod=+x
   .githooks/pre-commit`. A Windows checkout runs `core.fileMode=false`, so `git add` alone records
   100644 whatever the disk bit says, and git on Linux skips the gate with only `hint: The
   '.githooks/pre-commit' hook was ignored because it's not set as executable.` (issue 1021; v30
   fixed the same trap for the bootstrap hook). Time the suite first; over ~60s, make it a pre-push
   hook instead and say so. Done when `git ls-files -s .githooks/pre-commit` reads `100755`.
6. **ADR status lines** — give every ADR a `**Status:**` line after its title (default `accepted.`;
   a superseded one names its successor). The dashboard reads these.
7. **Tracker + agents config** — if `docs/agents/issue-tracker.md` is absent, run the
   `setup-matt-pocock-skills` flow (GitHub tracker) or write the GitHub variant directly; add a
   Dashboard section pointing at `DASHBOARD.md` and the issue forms.
8. **Live tracker audit** — copy `templates/tracker-audit.js` to `tools/tracker-audit.js`, no
   substitutions (it infers the repo from `gh repo view`). It audits live GitHub state no file-level
   test can see: prose `Blocked by #N` without a native dependency edge, closed issues with unticked
   boxes, dangling `#N`, missing/conflicting triage labels, Projects-board mismatches.
   - **Exit codes: 0 clean, 1 drift, 2 could not audit.** Preserve the third in any edit; exit 2 is
     never a pass, because an empty tracker query must not read as clean.
   - It needs the network and an authenticated `gh`, so it runs at the command line or in CI (3.8b);
     keep it out of `.githooks/pre-commit` so committing works offline.
   - Record it in `docs/agents/issue-tracker.md` as the thing to run before trusting the tracker.

   8b. **The job that runs it** — copy `templates/tracker-audit.yml` to
   `.github/workflows/tracker-audit.yml`, `templates/tracker-audit-job.js` to
   `tools/tracker-audit-job.js`, and `templates/tracker-audit-job.test.js` to
   `tools/tracker-audit-job.test.js`. session-check reads this workflow's latest run on the
   default-branch head; without it, every session warns `no .github/workflows/tracker-audit.yml`.
   - **Substitute `branches: [DEFAULT_BRANCH]`** in the `push` trigger (step 1's default branch). The
     workflow's first step runs the installed test, so an un-substituted copy turns every run red.
     Run `node --test tools/tracker-audit-job.test.js` by hand afterwards: a repo suite that skips
     `tools/*.test.js` never runs it.
   - **Keep the file name `tracker-audit.yml`** — the `TRACKER_JOBS` entry in session-check's
     `check.js` looks for exactly that.
   - The runner spawns the repo's `tools/tracker-audit.js` and propagates its exit code; both
     non-zero codes fail the run.
9. **Harness version marker** — copy `templates/harness-version.md` to
   `docs/agents/harness-version.md` and set the date. **Current version: 39.** `/session-start` reads this marker every session and
   STOPs when the repo is behind (issue 139): upgrade an out-of-date harness before writing code.
10. **Deploy-safety check** — if a packaging/deploy step sweeps files (clasp, gas, docker COPY, npm
    `files`), exclude `scripts/`, `.githooks/`, `tools/`, `.github/` and `.caveman.json` from it.
11. **CLAUDE.md** — add or refresh a short block: the dashboard is generated (edit the script, not
    the file), the hook activation command, the tracker pointer, `node tools/tracker-audit.js`, and
    the session commands from 3.12.
12. **Session checks** — copy `templates/session.json` to `.claude/session.json`, substituting
    `TEST_COMMAND` (same value as the hook and `ticket.yml`). Copy `templates/session-runbook.md` to
    `docs/runbooks/session.md`; for a repo that does not deploy, delete its Releasing section as its
    comment says.
    - **An existing `.claude/session.json` is preserved verbatim** — it carries the hand-corrected
      test command and the repo's release gates. Merge in missing keys only.
    - Fill `releaseGates` with what the repo actually gates on: `node tools/canary.js` where it
      exists, `[]` otherwise; `clasp-auth` only for a repo still on clasp, never a self-deploying
      one. They run at `--end`.
    - The engine is the session-check skill's `check.js`, shipped once in the `aac-skills` plugin
      and run by the plugin's `SessionStart` / `SessionEnd` / `UserPromptSubmit` hooks through its
      `session-gate.js`; `/session-start` and `/session-end` only re-print its result. The repo gets
      config only, never a vendored engine.
13. **Self-deploy (gas)** — an Apps Script repo adopts the gas package: follow the `gas-deploy` skill
    (claude-dotfiles `gas/README.md`) — `gas init` (prefills `preserve` from the live script),
    `gas vendor`, the `deploy.yml` template with the repo's test command, one `gasEnsureTrigger_();`
    line in an existing trigger, then the one-time `gas push` + `gas seed`. The script then pulls
    every merge from GitHub, with no credential in CI or on a machine. Only for a repo the owner
    explicitly keeps on clasp, follow [`CLASP-LEGACY.md`](CLASP-LEGACY.md) instead.
14. **Session output intensity** — copy `templates/caveman.json` to `.caveman.json` at the repo root
    (default `ultra`, Dan 2026-08-02); a repo file already present keeps its value. The repo file is
    what survives: the caveman hook falls back to a machine-local user config, so a checkout without
    it silently runs at `full`.
15. **Ticket fleet** — served by the `aac-skills` plugin; the harness copies no script. With the
    plugin installed (3.16), invoke it via the Workflow tool with
    `scriptPath = ${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/ticket-fleet.js` and the three required
    contract args `contractVersion: 2`, `runId` (`printf %x $(date +%s)`, held across a resume) and
    `invocationId` (`printf %x%x $(date +%s) $$`, fresh on every launch, never equal to `runId`). The
    workflow runtime forbids `Date.now()`/`Math.random()`, so the caller mints both ids; a launch
    missing any of the three is refused with a contract-mismatch error. One script serves local and
    cloud sessions, choosing `gh` or the GitHub MCP tools at run time.
    - **A repo needing a forked script keeps its own `.claude/workflows/ticket-fleet.js`** (hand-tuned
      prompts, extra phases) and calls it by name; every other repo carries no fleet file. A fork goes
      stale when the plugin's contract moves: `node tools/ticket-fleet-contract.js <fork>` in
      claude-dotfiles says which forks are behind, and the ripple table in the ticket-fleet
      `INTERNALS.md` lists them.
    - **First run in a repo: pass `deliver: false`** (verify-only) before letting the fleet push
      branches and open PRs.
16. **Cloud bootstrap hook + plugin + auto-mode posture** — one command is the whole cut-over of a
    repo to cloud sessions: `node "<skill base directory>/templates/add-cloud-plugin.js" <repo-root>`.
    Its header documents the three deliveries and the merge rules; the `_comment` in
    `templates/claude-settings.json` records why they live in project settings, and the posture
    ruling is the latest `docs/cloud-permission-posture-*.md` on claude-dotfiles master. The rules
    that bite:
    - **A repo's own `session-start.sh`** that lacks the `aac-bootstrap` marker keeps it
      byte-for-byte; the bootstrap lands beside it as `session-start-bootstrap.sh` and that path is
      wired instead.
    - **The plugin set** is read out of `templates/claude-settings.json`: the set
      `profile/claude/settings.json` runs on the desktop minus its LSP and travel plugins (Dan,
      2026-09-29, issue 1018). A plugin the repo already lists keeps its value.
    - **Existing `.claude/settings.json` is preserved**: the script only adds keys and unions arrays,
      sets `permissions.defaultMode: auto` only where it is absent, and detects an already-wired
      hook by command path, so a pre-existing entry gains no duplicate.
    - **Done when:** the file parses
      (`node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"`), and a
      second run prints `already delivered: ...` and leaves `git status` clean.

## 4 — Verify every install

Done when every line below holds.

- `node scripts/build-dashboard.js` renders `DASHBOARD.md`; sections with no data degrade to
  "n/a"/"None".
- **The health line reads "N passing, N failing".** A duration, a `}` or a bare timing string means
  the parse missed this runner's summary. Break a test on purpose, regenerate, watch the line go red,
  then restore.
- The local health line matches CI's. A lower CI count usually means tests skipped on git-ignored
  fixtures; the line must SAY skipped.
- `node --check tools/tracker-audit.js`, then run it. Exit 1 on an existing repo is expected: hand the
  findings to the owner instead of fixing them as harness work. Exit 2 (`gh auth status`, wrong repo,
  dependencies endpoint unavailable) is reported as a failure.
- `git ls-files -s .githooks/pre-commit` reads `100755` (3.5).
- Commit everything (the new hook fires — its first test), push, `gh run watch` the dashboard
  workflow to success. Let the next real issue exercise the issue-event trigger.
- **After the install, CI owns `DASHBOARD.md`**: run the script only to check output, then discard
  it. On a rebase conflict on it, regenerate (`node scripts/build-dashboard.js && git add
  DASHBOARD.md`) and continue — neither side is authoritative.
- session-check's `check.js`, run from the repo, finds the test command and reports the tracker
  audit; `no test command detected` means the substitution did not land.
- **Cloud** — `.claude/settings.json` enables every plugin and marketplace
  `templates/claude-settings.json` declares, `aac-skills@claude-dotfiles` included; the bootstrap
  hook file reads `100755` in `git ls-files -s`, and one `hooks.SessionStart` entry names it.
  Locally the hook proves only that it exits 0; the real test is a fresh cloud session on the repo
  showing `aac-skills:` skills, the `AAC-BOOTSTRAP MARKER` line, `gh --version`, one
  `gh api repos/<owner>/<repo>` call, and session-check's `Cloud bootstrap` block reading `ok`.

## 5 — Projects board (optional, default yes)

Only the owner's explicit "no board" skips this step. The board needs the `project` token scope
(`gh auth status`). When it is missing, get it in the same turn: start
`gh auth refresh -h github.com -s project` as a background task, hand the owner the one-time code
(it expires in ~15 min) to complete in their own browser, wait on the task, and re-mint the code if
it lapses. In aac-nexus (2026-10-01) an agent let the code expire and recommended skipping the
board; the owner overruled it.

- Per-repo board: `gh project create --owner <user> --title "<repo title>"`, link it, add open issues.
  Or the shared board (one board, every repo): ask once; `gh project item-add <n>` works cross-repo.
- Record the item-add convention in `docs/agents/issue-tracker.md`.
- **Hand the owner the "Auto-add to project" workflow as an explicit handoff action** (project
  Settings → Workflows; owner-only). Without it every later issue is `not-on-board`.
- **Moving a card writes to the tracker**: `Done` closes the issue, closing moves the card to `Done`,
  reopening moves it to `In Progress`. Change a card only when you mean that change to the issue.
- Before any other `gh project` work — verifying auto-add, editing a card, bulk adds, counting — read
  [`PROJECTS-BOARD.md`](PROJECTS-BOARD.md); its listing tools report false zeros.

## 6 — Migrating an existing repo's backlog

A legacy tracker (markdown TODOs, `.scratch/`, stale issue files) has lying statuses, so classify
before importing: judge each item against the code (SHIPPED / SUPERSEDED / OPEN, with evidence — spawn
an agent for bulk), file GitHub issues only for the OPEN ones, and mark the legacy location a
read-only archive in the tracker doc.

## 7 — Upgrading an existing install

**1. Find the harnessed repos** — `scripts/build-dashboard.js` beside `docs/agents/issue-tracker.md`
(either alone gives false hits). The loop is NUL-delimited and quoted because a repo lives under
`Sales Data KPIs/`; it upgrades primary checkouts only (agent worktrees are full copies) and skips
repos archived on GitHub, whose push would be refused:

```sh
find "$HOME/Claude/Projects" -path '*/scripts/build-dashboard.js' \
     -not -path '*/.claude/worktrees/*' -print0 |
  while IFS= read -r -d '' f; do
    r=$(dirname "$(dirname "$f")")
    [ -f "$r/docs/agents/issue-tracker.md" ] || continue
    if [ "$(cd "$r" && gh repo view --json isArchived -q .isArchived)" = true ]; then
      echo "skip $r: archived on GitHub - read-only, the upgrade's push would be refused" >&2
      continue
    fi
    echo "$r"
  done
```

Name every skipped archived repo at handoff; unarchiving is the owner's call.

**2. Read the version** — `harness-version: N` in `docs/agents/harness-version.md`; no file means
version 1.

**3. Install only what that version lacks**, then bump the marker's number and date. The rows are in
[`UPGRADES.md`](UPGRADES.md), one per version with the step that installs it: re-run only the steps
of rows above the repo's number. A row can mean "re-copy a file you already have". **Before
re-copying any template a repo already carries, read [`MERGING-TEMPLATES.md`](MERGING-TEMPLATES.md)**
— most repos extend template bodies, and an extended copy takes a three-way merge.

**4. Verify and hand off.** `node --check` the new script and run `node tools/tracker-audit.js` as in
step 4; its drift stays with the owner, since closing an issue or adding a dependency edge is their
judgment. Commit the tooling only, one commit, hooks honoured. Hand off two separate lists: code
upgrades (done by the agent) and owner actions no tooling can perform (the Projects auto-add toggle
is the standing example). Done when every repo from 7.1 is at the current version or named as
skipped.

### Changing a template means sweeping, in the same session

The marker answers what a repo lacks, and a changed template is lacking just as much as a missing
file. So **bump the version whenever a template changes materially**, then immediately run the step-7
sweep: find every install, read every marker, upgrade whatever is behind. A bump alone records
staleness without fixing it, and a stale repo cannot detect its own staleness — its audit and marker
are both old — so only this skill, looking across installs, can close the gap. In claude-dotfiles,
`generated-code.yml` fails any `templates/` change that leaves the number alone (issue 933).

Editing the templates in claude-dotfiles:

- **Generated templates** — edit the source, re-run the generator, commit both.
  `tools/build-harness-tracker-audit.js` generates `templates/tracker-audit.js`,
  `tracker-audit-job.js` and its test from `tools/`; `tools/tracker-audit-template.test.js` pins
  them, and pins `templates/tracker-audit.yml` to the repo's own workflow, from which it differs
  only by the `proof` job and the branch placeholder. `tools/build-harness-bootstrap-hook.js`
  generates `templates/session-start.sh` from `.claude/hooks/session-start.sh`.
- **`templates/build-dashboard.js`** — after any edit, `node verify-dashboard-parse.js` (in this
  skill folder) passes. Exit 2 means the template moved past what the check inspects: read it
  before trusting.

## Scope limits

- Repos push directly to the default branch; offer branch protection / a PR-required flow only when
  several agents or people commit in parallel.
- Dashboards live on the repo's `dashboard` branch; GitHub Pages would publish a private repo's
  dashboard.
- Issues close by human judgment; no bot closes one.
