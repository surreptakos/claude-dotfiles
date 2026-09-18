---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
metadata:
  modified: "2026-09-01T23:47:09Z"
  previous-modified: "2026-08-25T14:57:11Z"
  revision: "1"
  content-sha: "959ae6570b25"
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

The document must preserve, as its own sections, all six of the following (a handoff is client-side compaction, and Fable 5.1 drops constraints and exact details from a summary unless told what to keep): (1) any difficulties or problems that came up, and how they were handled or resolved; (2) any possibilities, options, or approaches that were raised, tried, or set aside, and why; (3) anything that was asked for, decided, agreed, ruled out, or established as a preference, constraint, or boundary, stated exactly; (4) exactly where things stand now, what has been covered, settled, or completed so far; (5) anything still open, unresolved, promised, or expected to happen next; (6) specific details that would be hard to reconstruct (names, numbers, dates, exact wording, links, ticket and PR numbers, run ids), kept exactly. Be complete on these six even at the cost of length; keep everything else concise. Weight the two voices differently: keep what the user said, asked for, shared, or established close to their own words; your own explanations and reasoning can be condensed to what they concluded or produced, as long as nothing in the six items is dropped.

Any open human-action item or undecided decision the doc mentions must cite its tracker ticket. If no ticket exists, create one first (via `/triage` or `/to-tickets`, labeled `ready-for-human` when the action is a human's) — a handoff document is a continuation aid for the next agent, not a tracking system, and an owner action living only in a handoff doc, a PR comment, or a session reply is invisible to the owner (measured 2026-08-24: a PR-gating UI rename went unseen until the owner tripped over it).

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
