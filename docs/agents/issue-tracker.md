# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## From a cloud session (no GraphQL)

A claude.ai/code or Cowork container reaches this tracker through the Anthropic proxy, which
refuses three `gh` code paths (first two confirmed 2026-09-15, issue 163; the third 2026-09-16,
issue 416):

- **Every GraphQL call** — `gh issue list`, `gh issue view` and the other `--json` spellings above
  — answers HTTP 403 with a message pointing at REST. Use `gh api repos/<owner>/<repo>/issues...`
  REST paths, or the GitHub MCP tools, for those conventions. A refused spelling is never evidence
  that the step is impossible; it is a cue to switch instrument, as `/triage` and `/to-tickets`
  already say.
- **Every REST call whose target repo is not attached to the session** answers HTTP 403 "not
  enabled for this session", with `add_repo` as the remedy.
- **Every search path** — `gh api search/issues`, and `search/*` generally — answers HTTP 403
  "sessions are bound to their configured repositories", even for the attached repo. There is no
  search instrument to switch to: page
  `gh api 'repos/<owner>/<repo>/issues?state=open&per_page=100&page=N'` one page at a time and
  filter the result locally. Dedupe checks before filing an issue are the usual caller.

`gh auth status` reports "The token in GH_TOKEN is invalid." in these containers while `gh api`
calls against the attached repo succeed: the proxy, not `gh`'s own auth, is what gates access.
Do not read that line as a broken credential.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed. **Sequencing is not blocking**: a `## Blocked by` line that reads `Merge after #N` says only that this should land after #N. It takes no native edge, the frontier query still treats the ticket as startable, and `tools/tracker-audit.js` raises no `ungated-dependency` finding for it — every other line under that heading is still read as a gate.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.

## Dashboard

`DASHBOARD.md` is the live view — open issues, PRDs and their decomposition state, triage counts,
pipeline health. It is **generated**. Never edit it by hand; edit `scripts/build-dashboard.js`.

`.github/workflows/dashboard.yml` regenerates it on every push to `master`, every issue event, and a
daily tick, then force-pushes the fresh commit to the dedicated `dashboard` branch — **never to
master**. The stable read URL is
<https://github.com/surreptakos/claude-dotfiles/blob/dashboard/DASHBOARD.md>. Master carries a copy
too, but it is a static snapshot that CI no longer updates, so read the dashboard branch for the
live view. The split exists because dashboard commits landing on master were the single largest
source of state3 (both-diverged) hard-blocks in the freshness classifier: DASHBOARD.md is not part
of the sync manifest, yet every `chore: refresh dashboard` push advanced origin and flipped
already-drifted live copies into state3 (issue 20, 2026-08-26).

Run `node scripts/build-dashboard.js` locally to check your changes, then discard the result —
committing a local copy collides with the bot's on the dashboard branch and turns the next push
into a rebase conflict on a file nobody authored.

The workflow runs on `windows-latest`. The test command is a PowerShell script that restores a
Windows profile; nothing about it runs on Linux.

## Before trusting the tracker

```bash
node tools/tracker-audit.js
```

Reads live GitHub state for the drift no file-level test can see: prose `Blocked by #N` with no
native dependency edge, closed issues with unticked acceptance boxes, a `#N` that is neither issue
nor PR, missing or conflicting triage labels, an open issue whose Projects card says Done, an open
issue on no board.

Exit 0 clean, 1 drift, **2 could not audit**. Two is not a pass — it means `gh` could not see the
tracker, and a query returning nothing must never read as health.

Read that code from the **unpiped** command. A pipeline reports its last stage's status, so piping
the audit anywhere throws its verdict away and hands back the pager's zero:

```bash
node tools/tracker-audit.js | tail      # 0 — tail's code, whatever the audit found
node tools/tracker-audit.js; echo $?    # 1 — the audit's own
```

Both are real runs against this repo on 2026-09-16, when the audit had six drift findings. To keep
the output *and* the code, redirect instead of piping: `node tools/tracker-audit.js > out.txt; echo
$?`. Reading a piped zero as a pass is how a ledger comes to record "exits 0 with 0 drift findings"
about a tracker that had drift (issue 437).

## Who ticks the acceptance boxes

Not the agent that opens the PR. A ticked box claims the work shipped, and it ships at merge — so
`.github/workflows/tick-acceptance-boxes.yml` runs `tools/tick-acceptance-boxes.js` on the
`pull_request_target` closed+merged event, ticks every box the audit would report on each issue the
PR's closing keywords name, appends `— verified in PR #N` to each, and comments on the issue saying
so. Without it every fleet-delivered ticket closes as a fresh `[closed-with-open-boxes]` finding
(issue 438: eleven in one wave). The script is idempotent and takes `--pr <n>` by hand, so a PR that
merged before the workflow existed is back-filled by running it — `--issue <n>` forces a ticket whose
verifying PR wrote `Refs` rather than `Closes`.

Two things a by-hand back-fill runs into. There is no search instrument to find which PR closed a
given ticket (`search/*` is refused, above): page
`gh api 'repos/<owner>/<repo>/pulls?state=closed&per_page=100&page=N'` and match each body with the
script's own `closingRefs`. And from a container the `--apply` run itself can be refused by the
auto-mode classifier as `[External System Writes]` even though the same write through the GitHub MCP
tools goes through with no prompt (seen 2026-09-16 mid-sweep, issue 438) — a refusal there says
nothing about the ticker.

## Intake

Issue forms in `.github/ISSUE_TEMPLATE/` label everything `needs-triage` on arrival. That is the
intake guarantee: nothing enters the tracker unlabelled.

## Triage states

One state label per open issue: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-local-agent`, `ready-for-human`, `wontfix`.

`ready-for-local-agent` marks work a cloud container cannot do but a desktop session can, with no
person in the loop: an edit to the live `~/.claude` or `~/.codex` tree followed by
`sync.ps1 -Mode push`, a remote branch delete the session proxy refuses, or an
edit the auto-mode classifier blocks in a container (a project-board sweep is no longer one: the
Board sweep job runs it, claude-dotfiles issue 216).
`ready-for-human` is reserved for a person's judgment, credential or sign-off. A step a local
session can perform never carries `ready-for-human` (Dan, 2026-09-15).
