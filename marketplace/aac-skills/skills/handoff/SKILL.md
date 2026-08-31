---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
metadata:
  argument-hint: What will the next session be used for?
  disable-model-invocation: 'true'
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Any open human-action item or undecided decision the doc mentions must cite its tracker ticket. If no ticket exists, create one first (via `/triage` or `/to-tickets`, labeled `ready-for-human` when the action is a human's) — a handoff document is a continuation aid for the next agent, not a tracking system, and an owner action living only in a handoff doc, a PR comment, or a session reply is invisible to the owner (measured 2026-08-24: a PR-gating UI rename went unseen until the owner tripped over it).

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
