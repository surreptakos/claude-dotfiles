---
name: owner-actions-are-tickets
description: "Owner rebuke 2026-08-24 — a human-action item buried in a PR comment, HANDOFF, FOLLOW-UPS, or session reply is uncaptured; it must be a ready-for-human ticket the moment it is discovered"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 60c8fab0-4c41-42c2-b944-99f8760aba7c
  modified: 2026-08-25T00:00:34.684Z
---

Owner, 2026-08-24, after finding PR 295's merge was gated on a 49-choice Desk-UI rename that lived
only in the PR's hold comment, HANDOFF's owner queue, and session replies: "How would I have ever
known that there were open items for me?" — then: "you also need to fix any skill that would have
led to the same issue of burying a task in a PR, handoff, or session reply. If I didn't see that
and call it out, it wouldn't have been caught anywhere."

**Why:** the owner works from one queue — `gh issue list --label ready-for-human --state open` (and
the DASHBOARD it feeds). Anything not in that query does not exist to them. PR comments, HANDOFF,
FOLLOW-UPS.md and replies are agent-facing artifacts; "captured there" is captured nowhere.

**How to apply:** the moment a step only a human can perform surfaces (UI operation the API cannot
do, credential mint, judgment call, manual verification), create the `ready-for-human` issue THEN —
not at session end, never only as a note. "Already tracked" means an open tracker issue, nothing
else. Enforcement landed 2026-08-24: session-end sweep category 7 + tightened "already tracked"
definition, handoff skill ticket-citation rule, to-tickets human-half splitting, ticket-fleet
`[ready-for-human]` discovery routing (35a424e), repo rule atop CLAUDE.md Agent skills, audit
automation ticketed as issue 315. See [[triage-not-solve-midturn-reports]],
[[handed-off-work-is-yours]].
