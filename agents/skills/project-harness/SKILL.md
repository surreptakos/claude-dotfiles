---
name: project-harness
description: Bolt the production organization harness onto any repo — triage labels, issue forms, generated DASHBOARD.md + CI refresh, pre-commit test gate, ADR status lines, live tracker-drift audit, Projects board. Use when the user says "harness this repo", "set up the project harness", "make this repo organized like aac-cockpit", "upgrade the harness", or spins up a new project. Idempotent — safe to re-run, and carries a version marker so an existing install can be upgraded.
---

# Project Harness

Install **or upgrade** the organization harness proven on `aac-cockpit` (2026-07-28). Every piece is
idempotent: skip what exists, update in place, never duplicate. Reference implementation if anything here is
ambiguous: `Sales Data KPIs/aac-cockpit` on this machine.

**Step 0 decides which job this is. Read it before anything else** — most invocations after the first
are upgrades, and the install steps are not the right path for those.

> **Never back this skill up inside `~/.agents/skills/`.** A copied folder there is loaded as a
> second skill with an identical description, so skill selection has two indistinguishable
> candidates. Copy to a temp directory instead. (Hit while editing this skill on 2026-07-28.)

## 0 — Install or upgrade? Decide this FIRST

**Before anything else, check whether this repo is already harnessed:**

```sh
cat docs/agents/harness-version.md 2>/dev/null; ls scripts/build-dashboard.js 2>/dev/null
```

- **Either one present → this is an UPGRADE. Go straight to step 7** and do only what that repo's
  version lacks. Do not walk steps 1–6.
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
- **Test command** — detect in order: `package.json` `scripts.test`; a repo-documented command in AGENTS.md/CLAUDE.md/README (e.g. `node tests/run-all.js`); `pytest`/`cargo test`/`go test ./...` by manifest. If nothing detectable, ask the user; if the repo genuinely has no tests, the hook and the dashboard's test line are installed as no-ops with a `TODO` and you say so.
- **ADR dir** — `docs/adr/` or `doc/adr/` or none. None is fine (section skipped).
- **Deploy/CI workflow** — any existing `.github/workflows/*.yml` whose name suggests deploy/test; the dashboard reports the most deploy-like one, or skips.
- Existing labels, issue templates, `.githooks`, `DASHBOARD.md`, `docs/agents/` — to know what to skip or merge.
- Repo private? (`gh repo view --json isPrivate`) — private is expected; never suggest GitHub Pages for a private repo's dashboard.
- **Clasp repo?** `.clasp.json` at the root, in `gas/`, or in `src/`. Decides step 13 and the Releasing section of the session runbook.

## 2 — Confirm only genuine branches

Usually zero questions. Ask only when: the test command is undetectable, or the user might want the shared
cross-repo Projects board instead of per-repo (see step 6).

## 3 — Install

1. **Labels** (`gh label create`, tolerate exists): the five triage roles `needs-triage`/`needs-info`/`ready-for-agent`/`ready-for-human`/`wontfix`, plus `prd` (#5319e7) and `chore` (#fef2c0). Reuse GitHub defaults (`bug`, `enhancement`, `documentation`) — don't recreate. `prd` is not a mere tag: a PRD issue is a first-class container (problem + locked decisions + sub-issue checklist) with its own reading of the five states and a close-with-children rule. The `triage-labels.md` seed in `setup-matt-pocock-skills` carries the lifecycle table — step 7 must land it in `docs/agents/triage-labels.md`.
2. **Issue forms** — copy `templates/issue-forms/*` to `.github/ISSUE_TEMPLATE/`. They label `needs-triage` on arrival; that's the intake guarantee. Substitute `TEST_COMMAND` in `ticket.yml`'s "Done when" description with the repo's real test command (same substitution as the hook).
3. **Dashboard generator** — copy `templates/build-dashboard.js` to `scripts/build-dashboard.js` and fill the `CONFIG` block at the top (testCommand, adrDir, deployWorkflow) from step 1's findings. **If the file already exists, PRESERVE its existing `CONFIG` verbatim** — splice the old block into the new template rather than re-deriving it; a hand-corrected test command and the comments explaining it are exactly what detection cannot reproduce. The splice, CRLF-tolerant because repo copies on Windows are CRLF and the template is LF (a `\n};\n` pattern silently fails to match):
   ```js
   const cfgRe = /const CONFIG = \{[\s\S]*?\r?\n\};\r?\n/;
   const mine = fs.readFileSync(P, 'utf8').match(cfgRe);        // P = scripts/build-dashboard.js
   if (!mine) throw new Error('no CONFIG in repo copy');        // fail loud; never fall through to the template's
   fs.writeFileSync(P, fs.readFileSync(T, 'utf8').replace(cfgRe, mine[0]));
   ```
   Then assert the values survived (`grep` the title and test command) before moving on — a splice that silently produced the template's placeholder `REPO_TITLE` renders a perfectly valid dashboard for the wrong repo.
4. **Dashboard workflow** — copy `templates/dashboard.yml` to `.github/workflows/dashboard.yml` (push to default branch + issue events + daily tick + manual; commits `DASHBOARD.md` back with `[skip ci]`). Two substitutions the template marks inline:
   - **Default branch.** `main` appears twice (`push.branches`, `checkout.ref`); on a `master` repo the un-substituted workflow never fires and the failure is silent — no run, no error. Read it from `git symbolic-ref refs/remotes/origin/HEAD`, don't assume.
   - **Test environment.** The job only has Node. If `testCommand` is another language, add the runtime setup and the dependency install (the template carries a commented Python example), and install the FULL set the suite imports — optional extras included. Symptom of getting this wrong: CI's health line says `FAILING — 1 error in ~2s` (collection/import error) while the suite is green locally, because local happens to have the extra installed (hit on aac-task-management: a test imports a script whose module top imports `anthropic`, which lives in a non-dev extra).
5. **Pre-commit test gate** — copy `templates/pre-commit` to `.githooks/pre-commit`, substitute the test command, add a one-line `.githooks/README.md`, then `git config core.hooksPath .githooks`. Time the suite first; if it exceeds ~60s, put it in a pre-push hook instead of pre-commit and say so.
6. **ADR status lines** — if an ADR dir exists, ensure every ADR has a `**Status:**` line after its title (default `accepted.`; superseded ones must say by what). The dashboard reads these.
7. **Tracker + agents config** — if `docs/agents/issue-tracker.md` is absent, run the `setup-matt-pocock-skills` flow (GitHub tracker) or write the GitHub variant directly; add the Dashboard section pointing at `DASHBOARD.md` and the issue forms.
8. **Live tracker audit** — copy `templates/tracker-audit.js` to `tools/tracker-audit.js`. No substitutions: it infers the repo from `gh repo view`. It reads live GitHub state (prose `Blocked by #N` with no native dependency edge, closed issues with unticked acceptance boxes, a `#N` that is neither an issue nor a PR, missing/conflicting triage labels, an open issue whose Projects card says Done, an open issue on no board at all, plus two advisory checks) — the drift no file-level test can see. Exit 0 clean / 1 drift / **2 could not audit**; preserve that third code in any edit, because a tracker query returning nothing must never read as a pass.
   - It needs the network and an authenticated `gh`, so it does **NOT** go in the pre-commit hook — a commit gate that needs the network breaks committing offline. It is a command, optionally a CI step (separate workflow or a job in `dashboard.yml`, never the test job).
   - Record it in `docs/agents/issue-tracker.md` as the thing to run before trusting the tracker.
9. **Harness version marker** — copy `templates/harness-version.md` to `docs/agents/harness-version.md` and set the date. A one-line `harness-version: N` in a dedicated file, rather than a constant in `scripts/build-dashboard.js`: the marker has to be readable with one `cat` in every harnessed repo, and aac-cockpit's dashboard script predates the template's `CONFIG` block, so a constant there would need the script restructured before the version could be read. **Current version: 8.**
10. **Deploy-safety check** — if the repo has a packaging/deploy step that sweeps files (clasp, docker COPY, npm files field), confirm `scripts/`, `.githooks/`, `tools/`, `.github/` are excluded. This bit aac-cockpit: clasp would have pushed Node tooling into Apps Script.
    - While here, make sure the harness's own files are excluded too — including `.caveman.json` from step 14.
11. **AGENTS.md** — add/refresh a short block: dashboard is generated (never hand-edit), hook activation command, tracker pointer, `node tools/tracker-audit.js`, and the session commands from step 12. Preserve and update an existing CLAUDE.md when the repository also uses Claude Code.
12. **Session checks** — copy `templates/session.json` to `.claude/session.json`, substituting `TEST_COMMAND` (same value as the hook and `ticket.yml`). Copy `templates/session-runbook.md` to `docs/runbooks/session.md`; if the repo does not deploy, delete that template's Releasing section as its comment says.
    - **PRESERVE an existing `.claude/session.json` verbatim.** Identical hazard to step 3.3's `CONFIG` block, and for the identical reason: this file carries the hand-corrected test command and the repo's release gates, and detection cannot reproduce either. Merge in missing keys; never regenerate the file.
    - The engine itself is **NOT** installed per repo. It lives once at `~/.agents/skills/session-check/check.js` and is invoked by the `$session-start` and `$session-end` skills. Vendoring a copy into every repo would give five copies to drift, and a duplicated skill folder makes skill selection ambiguous (see this file's header).
    - Fill `releaseGates` with what the repo actually gates on — `node tools/clasp-auth.js --quiet` and `node tools/canary.js` where those exist, `[]` otherwise. They run at `--end`.
13. **Clasp credential gate** — for a clasp repo (`.clasp.json` at the root, in `gas/`, or in `src/`), copy `templates/clasp-auth.js` to `tools/clasp-auth.js`.
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
    - If the repo has a packaging step that sweeps root files (clasp, docker COPY), exclude it — same list as
      step 10. `~/.clasprc.json` is shared by every clasp project on the machine, so a bare `clasp login` — which authorizes clasp's own OAuth client with narrower defaults — produces a credential that pushes fine in the repo you are standing in while silently breaking Gmail and Drive work in another. Nothing local to the affected repo can see it.
    - Where the repo has a `package.json`, also wire `prepush` to `node tools/clasp-auth.js --quiet` so a dead credential stops the deploy instead of failing inside clasp with a bare `invalid_grant` (message-board does this). Without one, the gate is the session check plus the release runbook.

## 4 — Verify (never skip)

- `node verify-dashboard-parse.js` (in this skill folder) — proves the dashboard's test-health line
  reports pass/fail counts rather than whatever the runner printed last. Run it after ANY edit to
  `templates/build-dashboard.js`. It exits 2 if the template was restructured enough that the check
  can no longer find what it inspects, which is a signal to read before trusting.
- `node scripts/build-dashboard.js` locally — DASHBOARD.md renders, sections with no data degrade to "n/a"/"None".
- **Read the health line it produced; do not just confirm the file rendered.** A wrong line renders
  perfectly. Expect "N passing, N failing" — a duration, a `}`, or a bare timing string means the
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
- **Session checks** — `node "$HOME/.agents/skills/session-check/check.js"` from the repo. It must find the test command (via `.claude/session.json` or `npm test`) and report the tracker audit; a `no test command detected` line means the substitution did not land. On a clasp repo, confirm the Apps Script section reports the credential rather than `no tools/clasp-auth.js`.
- File nothing fake to test issue events; the daily tick and next real issue cover it.

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
  - **There is no way to READ whether it is on.** GitHub exposes project workflows through neither
    GraphQL nor `gh`. So the only verification is to file an issue and check
    `gh issue view <n> --json projectItems`. Write the acceptance that way; never "confirm the setting
    looks enabled." If `not-on-board` findings reappear later, re-check the workflow rather than
    assuming it held.
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

If the repo has a legacy tracker (markdown TODOs, `.scratch/`, stale issue files): do NOT bulk-import. Statuses
lie. Classify each item against the code first (SHIPPED / SUPERSEDED / OPEN, with evidence — spawn an agent for
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
       -not -path '*/.claude/worktrees/*' -not -path '*/.codex/worktrees/*' -print0 |
    while IFS= read -r -d '' f; do
      r=$(dirname "$(dirname "$f")")
      [ -f "$r/docs/agents/issue-tracker.md" ] && echo "$r"
    done
  ```
- **Agent worktrees.** `.claude/worktrees/*` or `.codex/worktrees/*` can hold full copies of the repo, so an unfiltered sweep
  returns dozens of hits for two repos. Exclude them and upgrade the primary checkout only.

**2. Read the version.** `cat docs/agents/harness-version.md` → `harness-version: N`. **File absent
means version 1** (pre-marker), not "unharnessed".

**3. Install only what that version lacks**, then bump the marker's number and date. Do not re-run the
whole install; steps 1–7 are idempotent but re-running them churns files for nothing.

| Version | Date | What it added | Re-run |
|---|---|---|---|
| 1 | 2026-07-28 | Triage labels, issue forms, `scripts/build-dashboard.js` + `dashboard.yml`, pre-commit test gate, ADR status lines, `docs/agents/` tracker + triage docs, Projects board | steps 1–7 |
| 2 | 2026-07-29 | `tools/tracker-audit.js` (live tracker drift audit) and this version marker | steps 8–9 |
| 3 | 2026-07-29 | `tracker-audit.js` gains Projects-board checks (`board-says-done`, `not-on-board`), PR-aware reference checking, and two false-positive fixes. **Same step, newer file** — a v2 repo has the tool but a stale copy | step 8 (re-copy the template, overwriting) |
| 4 | 2026-07-29 | `build-dashboard.js` gains the **From PRD** column (decomposition seen from the child's side) and a header warning not to commit locally regenerated `DASHBOARD.md`. **Same step, newer file** | step 3 (re-copy `build-dashboard.js`, re-apply the repo's `CONFIG`) |
| 5 | 2026-07-29 | Projects auto-add guidance rewritten from three verified findings (linking ≠ auto-add; enabling is not one click; the setting cannot be read, only tested) and the sweep made part of any template change. **Docs only — no file to re-copy**, but the owner action is real: enable Auto-add on each board and verify by filing an issue | step 5 (hand the owner the toggle; no repo files change) |
| 6 | 2026-07-30 | `dashboard.yml` stages with `git add -N` before diffing. Without it `git diff --quiet -- DASHBOARD.md` is blind to an **untracked** file, so on a repo with no dashboard yet the workflow printed "Dashboard unchanged", exited 0, and never created the artifact — a green run with nothing to show for it. Every fresh install was affected. **Patch, do NOT re-copy** | insert the two lines by hand — `dashboard.yml` carries per-repo test-environment setup (task-management's `setup-python` + `pip install -e ".[dev,classify]"`, message-board and aac-cockpit's `setup-node`), and a wholesale copy destroys it and reverts the default-branch substitution. Same hazard as step 3.3's `CONFIG` block |

| 8 | 2026-08-02 | `.caveman.json` at the repo root, pinning session output intensity to `ultra` (Dan, 2026-08-02). Without a repo file the level comes from a user config that exists on one machine and in no history, so the same repo reads `full` on another checkout and nothing says why | step 14 (add the file only where it is missing; keep an existing value) |

| 7 | 2026-08-01 | Session checks: `.claude/session.json` + `docs/runbooks/session.md`, and `tools/clasp-auth.js` on clasp repos. The credential gate is the load-bearing part — it verifies the grant's SCOPES, not just that it refreshes, and `~/.clasprc.json` is shared machine-wide, so a bare `clasp login` in one repo silently narrows what every other one can do. Two of four clasp repos had no such gate | steps 12–13 (preserve any existing `.claude/session.json`) |

A row can mean "re-copy a file you already have". The marker answers *what a repo lacks*, and a
template that changed is something the repo lacks just as much as a file it never had — so bump the
version whenever a template changes materially, not only when a step is added. Anything else and a
repo sits at the current version holding an old file, which is the exact drift the marker exists to
stop.

### Changing a template means sweeping, in the same session

**A version bump is not propagation.** Bumping the marker records that older installs are behind; it
does nothing to them. Every repo stays stale until someone runs the sweep, and nobody wakes up wanting
to run a sweep.

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
upgrade. Do **not** fix the drift as part of the upgrade: the audit is read-only, and closing an issue
or adding a dependency edge is the owner's judgment. Commit the tooling only, one commit, hooks honoured.

## What this deliberately does not do

- No branch protection / PR-required flow — solo direct-push repos are the norm; offer it only when multiple
  agents/people commit in parallel.
- No GitHub Pages for dashboards (private repos leak).
- No auto-close bots — closing an issue is a judgment.
