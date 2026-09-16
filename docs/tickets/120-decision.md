# Issue 120 — the fifteen boxes, and the one that has no skill behind it

Ledger for the `writing-great-skills` pass over every Dan-authored skill. One commit per skill,
each revertable on its own.

## The ledger

| Skill | Tree | Commit | Words before → after |
|---|---|---|---|
| `project-harness` | `agents/skills/` | `b531a73` | 7000 → 4728 (+2303 in `UPGRADES.md`) |
| `session-check` | `agents/skills/` | `6029e18` | 237 → 227 |
| `session-start` | `agents/skills/` | `841e04c` | 822 → 777 |
| `session-end` | `agents/skills/` | `1d01223` | 3614 → 3438 |
| `aac-google-access` | staged (see below) | `b8ba3d4` | 955 → 932 |
| `claude-md-lint` | staged | `eac00a3` | 649 → 631 |
| `consistency-audit` | staged | `9b083d9` | 2044 → 1976 |
| `consolidate-memory` | staged | `37c1c91` | 491 → 453 |
| `maintain-repo` | staged | `2ef1407` | 403 → 333 |
| `update-cloud-plugin` | staged | `c3c7ce6` | 1245 → 1195 |
| `aac-contract-package` | `aac-skills/` | `a85b63c` | 1482 → 1480 |
| `aac-sop` | `aac-skills/` | `047acc5` | 3570 → 3473 |
| `gas-deploy` | `aac-skills/` | `7e2c5f4` | 769 → 809 |
| `software-decision` | `aac-skills/` | `b938455` | 1140 → 1069 |
| `writing` | gone | — | deleted 2026-09-14 by `518e63a` (#178) |

Counts are `wc -w` on the whole `SKILL.md`, frontmatter included. Totals for the fourteen that
exist: 24,421 → 21,521 words, with a further 2,303 disclosed out of `project-harness/SKILL.md`
into `UPGRADES.md`. `gas-deploy` grew by 40: its `## Never` list became three rails each stated as
the behaviour it protects, and positive phrasing costs a few words where a prohibition was terse.

Stamps and the plugin payload rotate once, in `42adc71`, the way CLAUDE.md's cloud-session rule
prescribes.

## `writing` has no skill behind it

The ticket's AAC team set names `writing`. Commit `518e63a` (2026-09-14, issue 178) deleted
`aac-skills/writing/` and `aac-skills/counterparty-redline/` on the owner's instruction — "remove
writing, writing-dan and counterparty-redline from aac-skills so the skill list stops offering
them" — along with their packaged copies. `aac-house-writing-standard` is the surviving AAC writing
skill and is outside this ticket's fifteen.

So the box is unreachable as written: the pass cannot run over a skill that no longer exists, and
re-creating one to satisfy a checkbox would reverse a deliberate deletion. The box needs the owner
to strike it, retarget it at `aac-house-writing-standard`, or close it as overtaken by #178.

## Six skills staged rather than landed

`aac-google-access`, `claude-md-lint`, `consistency-audit`, `consolidate-memory`, `maintain-repo`
and `update-cloud-plugin` are real directories inside `~/.claude/skills`. Their only copy in this
repo is the generated mirror `claude/skills/`, whose single writer is `sync.ps1 -Mode push` reading
the live tree. CLAUDE.md's cloud-session carve-out covers `aac-skills/` and `agents/skills/` and
stops there, and the issue body says so in its own words: "edit the live file (the repo's mirrored
copies are generated, so the change goes through a sync push)".

A cloud session has no live tree to edit. Hand-writing the mirror instead would leave a commit that
reads as delivered while the machine it came from never changed, and the next push from that
machine would silently revert it — the exact failure CLAUDE.md's one rule names.

The six rewrites therefore sit in `docs/tickets/120-personal-skills/` as complete `SKILL.md` files
with their `metadata:` blocks untouched, beside the copy-and-push procedure that lands them and
rotates their stamps. That folder's `README.md` carries the commands and the two files that hold
home-path tokens. Once they land, the mirror and the staged copies agree and the folder is deleted.

## What a cloud session could not verify

- **The restore test.** `tests/restore-test.ps1` is PowerShell and no `pwsh` exists in the
  container, so "restore test green on every commit" was checked on this branch only by the
  language-agnostic half: `node --test tools/*.test.js tests/*.test.js`,
  `python3 tools/skill-stamps.test.py`, `python3 tests/build-cloud-plugin.test.py`, and the two
  checks `skill-stamps.yml` runs. The pass touched documentation and one new `UPGRADES.md`; the
  only executable contract in range is `session-check/harness-version.js`'s read of
  `**Current version: 19.**`, whose 13 tests pass.
- **The cloud-plugin sweep.** Reporting current is a post-push state: the payload in this branch is
  rebuilt and reproducible, and the sweep stamps itself on the next `sync.ps1 -Mode push` from the
  main checkout.
