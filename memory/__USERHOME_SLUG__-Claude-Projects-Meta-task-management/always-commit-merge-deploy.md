---
name: always-commit-merge-deploy
description: "Dan's standing rule — always commit, merge to master, and deploy at the end of any piece of work. Never leave a commit sitting on a branch waiting to be asked."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2aa5c0a3-0290-4648-b557-549aaaa45995
  modified: 2026-07-28T21:49:06.680Z
---

Finish every piece of work by **committing, merging to `master`, and deploying** — without being asked. Deploy in this repo means fast-forwarding the main checkout `__USERHOME__\Claude\Projects\Meta\task-management` (`git fetch` + `git merge --ff-only origin/master`), because that is the tree the scheduled `daily-morning-update` sweep runs from. A merged PR alone is not deployed.

**Why:** Dan said "ALWAYS COMMIT, MERGE. DEPLOY" after I triaged bug 02, committed locally, and then offered to open a PR instead of just doing it. Work parked on a branch is invisible to the sweep and to the frontier scan, which is the same failure mode as [[open-work-must-be-ticketed]] — the value is real only once it is on master and in the deployed checkout.

**How to apply:** push the branch, open the PR, `gh pr merge <n> --merge`, then fast-forward the main checkout and confirm from there (full test suite; for pipeline changes also `aacx surface` / `golive-status` / `golive-actions`). If the working branch was already merged, a fresh PR for the new commits is the normal path, not a question to ask. Docs-only changes get the same treatment. Do not stop at "say the word and I'll open a PR".
