---
name: pr-merge-from-worktree-needs-manual-branch-delete
description: "gh pr merge --delete-branch run inside a worktree merges on GitHub but then fails locally (\"'master' is already used by worktree\"), leaving the remote branch undeleted"
metadata: 
  node_type: memory
  type: project
  originSessionId: 256462ea-6b07-41a1-8f84-5bd1a21d6d26
  modified: 2026-09-14T21:19:44.745Z
---

Running `gh pr merge N --squash --delete-branch` from an agent worktree completes the squash merge
on GitHub, then errors with `fatal: 'master' is already used by worktree at <main checkout>` while
trying to check out master locally, and stops before deleting the remote branch (seen 2026-09-09,
PR #96).

**Why:** gh's post-merge cleanup checks out the base branch in the current checkout; in a worktree
that branch belongs to the main checkout.

**How to apply:** treat exit 1 from that command as "verify, then finish by hand": `gh pr view N`
confirms MERGED, then `git push origin --delete <branch>` removes the remote branch; the local branch
goes with the worktree.

**Update 2026-09-14 (PR #183):** claude-dotfiles now has `delete_branch_on_merge: true`
(`gh api repos/surreptakos/claude-dotfiles --jq .delete_branch_on_merge`), so a plain
`gh pr merge N --squash` from a worktree exits 0 and GitHub removes the head branch itself;
a manual `git push origin --delete` then fails with `remote ref does not exist`. Check
`git ls-remote --heads origin <branch>` before deleting by hand. The manual step still
applies in repos without that setting.

**Update 2026-09-21 (issue 637):** a cloud container cannot delete a remote branch at all. The
proxy refuses both instruments: `git push origin --delete <branch>` fails with
`error: RPC failed; HTTP 403`, and `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>`
answers `Write access to this GitHub API path is not permitted through this proxy.` Merging still
deletes the head branch, because `delete_branch_on_merge` is on; it is only a branch with no merge
behind it, such as an abandoned fleet attempt, that a container has to leave for the desktop.
