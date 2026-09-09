---
name: pr-merge-from-worktree-needs-manual-branch-delete
description: "gh pr merge --delete-branch run inside a worktree merges on GitHub but then fails locally (\"'master' is already used by worktree\"), leaving the remote branch undeleted"
metadata: 
  node_type: memory
  type: project
  originSessionId: 256462ea-6b07-41a1-8f84-5bd1a21d6d26
  modified: 2026-09-09T14:53:30.921Z
---

Running `gh pr merge N --squash --delete-branch` from an agent worktree completes the squash merge
on GitHub, then errors with `fatal: 'master' is already used by worktree at <main checkout>` while
trying to check out master locally, and stops before deleting the remote branch (seen 2026-09-09,
PR #96).

**Why:** gh's post-merge cleanup checks out the base branch in the current checkout; in a worktree
that branch belongs to the main checkout.

**How to apply:** treat exit 1 from that command as "verify, then finish by hand": `gh pr view N`
confirms MERGED, then `git push origin --delete <branch>` removes the remote branch; the local branch
goes with the worktree. Related: [[concurrent-sessions-share-one-sync-push]].
