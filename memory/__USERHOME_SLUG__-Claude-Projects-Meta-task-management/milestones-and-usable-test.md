---
name: milestones-and-usable-test
description: "M0-M5 milestones gate \"is it usable yet\"; usable means the manual routine it replaced got switched off. Target is M1."
metadata: 
  node_type: memory
  type: project
  originSessionId: 4e698a6c-aabd-4d8b-ae77-bbdbc50a06f0
  modified: 2026-07-30T01:22:53.748Z
---

Set 2026-07-29 because the repo hit 41 open issues with **zero** milestones — no
stopping condition, and no answer to "can I use this yet." Six GitHub milestones
M0–M5, 25 issues assigned, definition in `docs/MILESTONES.md`. **Current target:
M1 (brief is trustworthy)** — Dan's own choice.

**Usable = the manual routine it replaced gets switched off.** "Output looks good"
fails because whoever built it grades it. Three gates: unattended for N runs →
spot-checked against the source systems → switched off. Gate 3 is why #68 (delete
the five O3 prep tasks) and #67 (retire the Claude sweep) are exit criteria, not
chores. A milestone whose gate-3 ticket is open is not done, however green the code.

**Freeze rule:** new tickets land **unmilestoned**; never widen an open milestone,
or the exit line moves as fast as the work does. #101 was filed unmilestoned the
same day for exactly this reason.

**Why M0 is first despite shipping nothing visible:** gate 1 is a
consecutive-clean-run count and the instrument is broken — `run_log`'s `ended_at`
is set by the *next* run starting, newest row NULL (#63, reproduced live).

**Ordering insight worth keeping:** silence and absence are indistinguishable
here. Weekly Wrap and O3 last rendered 2026-07-17 and nothing reported it — the
renderers are tested, so stale meant unrun, not broken. Same shape as #88 (no
Teams group `chatId` registered anywhere, so group chats are dark and the brief
looks identical). That class of hole is what M1 closes, and it is why "looks fine"
is not evidence.

Related: [[verify-inferences-against-the-store]], [[three-queues-not-colours]],
[[open-work-must-be-ticketed]], [[always-commit-merge-deploy]].
