# Issue 117: Actions quota check after the 2026-09-09 issue-event restore — decision + evidence

**Status:** Read back on 2026-09-16 (the date the ticket gates on). The account-wide
`Refresh dashboard` rate across the six restored repos is **179.2 runs/day**, **3.09x** the
58 runs/day August 2026 baseline. **Decision: trim `issues.types` to `[opened, closed]`** in the
six restored workflows. The trim itself lands as one PR per external repo — delivery-stage work
that no container in this repo's fleet performs; this file is the recorded reading and ruling the
PRs cite.

## Window and method

Window: `2026-09-09T00:00:00Z` .. `2026-09-16T19:59:01Z` = **7.83 days**.

Per-repo run counts are exact, one call per repo:

```
gh api "repos/surreptakos/<repo>/actions/workflows/dashboard.yml/runs?created=%3E%3D2026-09-09&per_page=1" --jq '.total_count'
```

All six workflows are named `Refresh dashboard` and live at `.github/workflows/dashboard.yml`
(verified by reading each repo's file through the contents API in the same run).

## Per-repo `Refresh dashboard` run count

| Repo                  | Runs (2026-09-09 → 2026-09-16) | Runs/day |
|-----------------------|-------------------------------:|---------:|
| aac-bill-intake       |                            202 |     25.8 |
| aac-sales-commissions |                             16 |      2.0 |
| aac-routines          |                            843 |    107.6 |
| zoho-source-of-truth  |                            153 |     19.5 |
| aac-message-board     |                             12 |      1.5 |
| aac-sales-cockpit     |                            178 |     22.7 |
| **TOTAL**             |                       **1404** |**179.2** |

- August 2026 baseline: 58 runs/day (580 runs in ten days, the 2026-08-10 ruling).
- Ratio: **3.09x over**.
- Sensitivity: aac-routines carries this account's live ticket-fleet traffic and is 60% of the
  total. Drop it entirely and the remaining five still run **71.6 runs/day (1.23x over)**. The
  verdict does not depend on the noisiest repo.

## The account's Actions usage

The account-wide billing endpoint is not reachable from a fleet container. Verbatim:

```
$ gh api users/surreptakos/settings/billing/actions -i
HTTP/1.1 403 Forbidden
{"message":"This GitHub API path is not available: sessions are bound to their configured
repositories. Use repository-scoped endpoints (repos/{owner}/{repo}/...)."}
```

So account usage was measured the repository-scoped way instead, over every repo this session can
reach (`repos/<repo>/actions/runs?created=>=2026-09-09`, all workflows, not just the dashboard):

| Repo                  | All-workflow runs | Runs/day |
|-----------------------|------------------:|---------:|
| claude-dotfiles       |              2583 |    329.8 |
| aac-routines          |              1044 |    133.3 |
| aac-bill-intake       |               234 |     29.9 |
| aac-sales-cockpit     |               211 |     26.9 |
| zoho-source-of-truth  |               153 |     19.5 |
| aac-sales-commissions |                22 |      2.8 |
| aac-message-board     |                18 |      2.3 |
| **TOTAL**             |          **4265** |**544.5** |

Hosted minutes are not exposed per run in the list response, so billable minutes are estimated
from each run's `run_started_at` → `updated_at` span, rounded up to the minute the way GitHub
bills, over a 100-run sample per repo scaled to that repo's total:

- Six restored repos' `Refresh dashboard`: ~1777 billable minutes (~227 min/day), Linux runners.
- claude-dotfiles' own `Refresh dashboard`: 1381 runs, ~1.22 min/run, **`runs-on: windows-latest`
  bills at a 2x multiplier** → ~3370 billable minutes (~430 min/day). See the discovery below.

These are estimates, not the billing page's figure; the exact number is on
<https://github.com/settings/billing> and can only be read from the owner's own session. The
estimate is not load-bearing: the ticket's threshold is stated in runs/day, and the exact run
counts clear it by 3x on their own.

## Decision

**Trim.** The rate exceeds the August baseline on every reading taken since the restore — 195.9/day
(2026-09-11, 3 days in), 118.1/day (2026-09-14), 125.2/day (2026-09-16 01:16Z), 179.2/day (this
one, the full week the ticket asks for). No reading has come near 58/day, and account-wide usage
can only be larger than the six-repo slice, so no unread figure can overturn it.

## The change each PR makes

One file per repo, `.github/workflows/dashboard.yml`, one line — all six currently read the full
eight-type list (verified live in this run):

```diff
   issues:
-    types: [opened, closed, reopened, edited, labeled, unlabeled, assigned, unassigned]
+    types: [opened, closed]
```

Repos: aac-bill-intake, aac-sales-commissions, aac-routines, zoho-source-of-truth,
aac-message-board, aac-sales-cockpit.

What the trim gives up: a label, assign, reopen or body edit no longer refreshes that repo's
DASHBOARD.md on its own. The next push to the default branch, or the next issue open or close,
picks the change up — which in an agent session is minutes, since a labelled ticket is almost
always closed or pushed against in the same session. Re-adding a cron to cover the gap is the
regression issue 21 removed; the fix for a genuinely missing refresh is the missing event, not a
clock.

## Two workflows this ruling deliberately does not touch

- **claude-dotfiles' own `.github/workflows/dashboard.yml`** — not one of the six the ticket
  names, and its header (issue 21) makes `[labeled, unlabeled]` load-bearing here: those triggers
  are what replaced the 6am safety cron. It is nevertheless the account's largest Actions consumer
  by minutes (Windows runners, 2x). That is a separate ruling to make, with the cron history in
  front of it, not a line to slip into this ticket's trim.
- **`project-harness/templates/dashboard.yml`** — the harness template still ships the eight-type
  list, so a fresh install or re-harness re-seeds an untrimmed workflow even after the six PRs
  merge. Changing it is a harness version bump (UPGRADES.md row + `harness-version`), which is
  its own ticket.
