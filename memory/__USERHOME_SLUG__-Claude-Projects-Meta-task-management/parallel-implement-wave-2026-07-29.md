---
name: parallel-implement-wave-2026-07-29
description: "2026-07-29 parallel wave shipped all 16 open tickets + 4 bugs in one day via 9 worktree agents; lessons: concurrent green PRs can combine red (schema dup), replay reviews catch what unit tests miss."
metadata: 
  node_type: memory
  type: project
  originSessionId: 2aa5c0a3-0290-4648-b557-549aaaa45995
  modified: 2026-07-29T16:01:49.243Z
---

**2026-07-29 parallel implementation wave** (Dan: "implement from here, maximizing parallel runs"): 9 background agents in isolated worktrees + reviewer passes shipped **15 PRs (#37–#52)** covering every open ticket (#10–#17, #29–#35) and bug (#18–#20; #21 closed superseded by #15/#16). PRDs #7/#8 closed complete; #9/#27/#28 open on owner gates only (Graph `--login` + orchestrator acceptance; O3 cutover sign-off; dates.yaml + first personal brief). Main checkout deployed at 680 tests green; live db migrated (`domain` columns, backup `data/aac.db.pre-domain-20260729-110023.bak`).

**Why:** the whole backlog fit one day because blockers were shallow (3 waves) and lanes had disjoint code; the two same-file groups (O3 render #29–31, surfacer #10/#11) ran as serial chains inside single agents.

**How to apply:**
- **Concurrent green PRs can combine red.** #39 and #40 each added `items.domain` to schema.sql; each passed alone, merged master broke 315 tests, discovered by a third agent's worktree. Per-branch pre-push is not a master gate — check for semantically overlapping hunks before parallel merges, and tell in-flight agents to re-merge master immediately after any merge touching shared files (see [[always-commit-merge-deploy]]).
- **Replay reviews beat unit suites for predicates.** The #20 hygiene fix passed all tests but the live-store replay (read-only `.backup` copy) exposed a NEW false positive ("Sign + schedule..." lawn task). Replaying old-vs-new over the real open set is cheap and decisive; do it for any classifier/predicate change.
- **Reviewers can be confidently wrong** — the PR #39 reviewer "proved" a test must fail by conflating `todoist_tasks.project_id` (board) with `items.project_id` (aacx project). Run the disputed test before bouncing work back.
- Sweep-safe parallel work: agents forbidden from main checkout + live db; live verification via `sqlite3 .backup` copies opened `mode=ro`; merges to origin are safe while the sweep runs (its checkout doesn't pull mid-run); only the fast-forward + live ALTERs wait for the run to finalize — or to be provably done (brief found SENT in Gmail, store idle, run_log finalize just never fired — a recurring abandoned-finalize pattern).
