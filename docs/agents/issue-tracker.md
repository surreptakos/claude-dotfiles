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
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
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

## Intake

Issue forms in `.github/ISSUE_TEMPLATE/` label everything `needs-triage` on arrival. That is the
intake guarantee: nothing enters the tracker unlabelled.

## Triage states

One state label per open issue: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-local-agent`, `ready-for-human`, `wontfix`.

`ready-for-local-agent` marks work a cloud container cannot do but a desktop session can, with no
person in the loop: an edit to the live `~/.claude` or `~/.codex` tree followed by
`sync.ps1 -Mode push`, a remote branch delete the session proxy refuses, the project-board sweep
that needs a project-scoped `gh` token, or an edit the auto-mode classifier blocks in a container.
`ready-for-human` is reserved for a person's judgment, credential or sign-off. A step a local
session can perform never carries `ready-for-human` (Dan, 2026-09-15).

`desktop-only` is a marker, not a state: it rides alongside a state label. Container-blocked work
an agent can still do is `ready-for-agent` + `desktop-only` - `ready-for-agent` is what puts it in
a fleet queue at all, `desktop-only` is what makes a *cloud* fleet run skip it instead of spending
an implement + verify cycle on work no container can do. In a repo without the label, a body or
comment line beginning `**Desktop-only.**` is the same marker; the ticket-fleet scout reads either
(issue 275, ruling of 2026-09-15). A `ready-for-local-agent` ticket carries it too, so the scout
reads one marker whatever the state label says.
