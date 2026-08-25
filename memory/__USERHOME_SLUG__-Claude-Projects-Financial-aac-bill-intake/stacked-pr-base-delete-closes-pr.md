---
name: stacked-pr-base-delete-closes-pr
description: "Deleting a stacked PR's base branch makes GitHub close it forever — retarget to main FIRST; closed PRs cannot be retargeted or reopened"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c0ae4cca-d542-4149-a12d-f0cff9455c67
  modified: 2026-08-21T19:45:05.952Z
---

Deleting a branch that is the base of an open stacked PR makes GitHub CLOSE that PR, and a closed PR
refuses both `gh pr edit --base main` ("Cannot change the base branch of a closed pull request") and
`gh pr reopen` ("Could not open the pull request"). Happened 2026-08-21: closing PR 248
`--delete-branch` killed PR 252 (stacked on it), even though PR 252's own body warned about exactly
this. Recovery was a fresh PR (266) from the rebased head branch.

**Why:** GitHub never retargets; it closes. Closure is irreversible when the base is gone.

**How to apply:** before `gh pr close --delete-branch` or any branch delete, check
`gh pr list --base <branch>` for stacked PRs; retarget them to main (`gh pr edit N --base main`)
FIRST, then delete. And read a PR's body before acting on its branch — the warning was already
written there. See [[handed-off-work-is-yours]].
