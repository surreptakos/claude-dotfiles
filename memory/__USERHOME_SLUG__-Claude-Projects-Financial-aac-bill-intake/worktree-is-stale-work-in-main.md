---
name: worktree-is-stale-work-in-main
description: Sessions open in a stale git worktree; the real work is in the MAIN checkout on branch feat/prod-cutover
metadata: 
  node_type: memory
  type: project
  originSessionId: c8c14ce3-7dbd-4035-83fd-2079a4fd7529
  modified: 2026-07-28T18:52:32.065Z
---

Sessions for this project open with cwd set to
`.claude/worktrees/approval-relay-tickets-01-06-1634ac` (branch
`claude/approval-relay-tickets-01-06-1634ac`), but that worktree is **stale** — it sits many
commits behind. All real work lives in the MAIN checkout
`__USERHOME__\Claude\Projects\Financial\aac-bill-intake`.

As of 2026-07-28 that checkout sits on **`main`**: `feat/prod-cutover` was fast-forwarded into
`main` and both are pushed to `origin` (private repo `surreptakos/aac-bill-intake`) at `ea8b80f`.
Branch before starting new work — don't commit straight onto `main`.

**Why:** reading `gas/core.js` or `gas/Code.gs` from the worktree path returns pre-queue,
pre-ADR-0004 code and looks like the feature was never built. It also matches the standing rule
that Apps Script is pushed only from the main checkout, never a worktree.

**How to apply:** before reading or editing anything, `cd` to the main checkout path and confirm
with `git branch --show-current` (expect `feat/prod-cutover`) and `git log --oneline -3`. Note the
Bash tool resets cwd to the worktree between calls, so prefix each command with the absolute
`cd`. See [[intake-queue-live]].
