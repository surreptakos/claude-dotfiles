---
name: tracker-audit-tool
description: "tools/tracker-audit.js audits the live GitHub tracker for drift (unticked boxes on closed issues, dangling refs, board-vs-state disagreement); run it before claiming the tracker is clean."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 2aa5c0a3-0290-4648-b557-549aaaa45995
  modified: 2026-07-29T17:45:32.980Z
---

`node tools/tracker-audit.js` in aac-task-management audits the **live** tracker rather than the repo: closed issues carrying unticked acceptance boxes, references to numbers that don't exist, prose `Blocked by` disagreeing with native blocked-by edges, board status saying Done while the issue is open, and advisory "stale premise?" hits where an issue cites something since closed. Shipped 2026-07-29 (PRs #71, #72) after sitting unpushed in the main checkout from an earlier session.

**Why it matters:** it found what a whole day of careful merging missed — 15 issues closed with over a hundred unticked acceptance criteria (now #73), and two PRDs I reopened whose board cards still read Done. Reviews and green suites do not catch tracker drift; nothing else looks at it.

**Exit codes: 0 clean, 1 drift, 2 could not audit. A 2 is NOT a pass** — it means the audit itself failed (auth, wrong repo, an empty issue list that looks like success), so treat it as louder than a 1.

**What produces this drift, both worth knowing before the next batch of work:** `Closes #N` / `Fixes #N` in a PR body closes the issue the moment it merges, whether or not a single acceptance box was ticked — that alone accounts for the 15 findings above. And the Projects board **writes back to issues**: dragging a card to Done closes the issue, and closing an issue moves its card. So a card left on Done after a reopen is not cosmetic, it is a second source of truth disagreeing with the first (hit on 2026-07-29 when reopened PRDs #7/#8 still showed Done). If a batch of PRs is about to merge with `Closes` lines, either tick the boxes as part of the PR or expect to close them out afterward.

**How to apply:** run it before reporting the tracker in good order, and after any batch of closes or reopens. Two known false-positive shapes are already fixed (question-list checkboxes on `needs-info` issues, and references to pull requests — issues and PRs share one number space while `gh issue list` returns only issues). A finding it reports as advisory is a prompt to check, not a defect. See [[open-work-must-be-ticketed]].
