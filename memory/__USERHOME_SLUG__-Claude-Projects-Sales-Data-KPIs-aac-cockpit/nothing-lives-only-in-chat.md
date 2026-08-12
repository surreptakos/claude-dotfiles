---
name: nothing-lives-only-in-chat
description: "Dan's rule — every action item or reminder aimed at him must be filed in GitHub Issues, never left in chat prose."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83ee3ddd-d4d3-450c-bc41-19092153e8f4
  modified: 2026-07-29T15:14:35.421Z
---

Dan operates on the assumption that he remembers **nothing** between sessions and will mostly reply "continue" / "implement" / "yes". Stated 2026-07-29.

So: any human step, prerequisite, open question, or reminder I surface must be written into the actual GitHub issue tracker at the moment I raise it — a new issue or a comment on the relevant one. Chat prose does not count as recording it. Same for build ordering and blocking relationships: they go on the umbrella issue, not just in a reply.

**Why:** he cannot act on what he cannot find, and chat is not searchable to him. A "you'll need to run X" in a reply is functionally the same as never saying it. This is also the drift he consolidated the repo to kill — the tracker is the only tracker, so anything living outside it is a leak.

**How to apply:** while answering, keep a list of every item that needs Dan or a future agent. Before replying, file each one. Prefer `ready-for-human` for owner actions and `needs-info` when blocked on someone else, so `DASHBOARD.md`'s "Needs your attention" surfaces them without him asking. Then tell him what was filed and what the first step is — a plan he has to re-derive is a plan that dies. Related: [[report-contract-convergence]], [[project-harness-skill]].
