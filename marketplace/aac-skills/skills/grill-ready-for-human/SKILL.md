---
name: grill-ready-for-human
description: Walk every ready-for-human ticket one at a time — grill for the ruling, land it as a comment, relabel or close.
metadata:
  disable-model-invocation: 'true'
  modified: '2026-09-14T22:40:59Z'
  previous-modified: '2026-09-10T15:58:50Z'
  revision: '2'
  content-sha: f115e39a346f
---

# Grill ready-for-human

Every `ready-for-human` ticket waits on a **ruling** only the owner can give. Walk the open queue in the current repo one ticket at a time: a ticket is finished when its ruling is on the tracker, and only then does the next one open.

## One ticket per grill

One ticket per turn: surface it, grill it, land it, move on. A batch ruling ("just close them all") is grilled as its own premise first — which ticket, what ruling, why the shared answer holds — because a batch ruling is unfinished work.

## Setup

- Repo: `gh repo view --json nameWithOwner --jq .nameWithOwner`.
- Queue: `gh issue list --repo <repo> --label ready-for-human --state open --json number,title,body,labels --limit 100`.
- Empty queue: report "no ready-for-human tickets" and stop.
- State the count, then surface only the ticket about to be worked.

## Per ticket

1. `gh issue view N --repo <repo> --comments` — body and every comment, before the grill opens. Prior comments carry earlier owner language and partial rulings.
2. Run `/grilling` scoped to this ticket's decision: relentless, one question at a time, facts looked up first (blast radius via `grep`, downstream dependents, related tickets via `gh issue list --search`).

   **Ask shape.** When the ticket enumerates 2-4 discrete options (an `Options:` block, a numbered list under "What to build"), ask with `AskUserQuestion` using those options, `(Recommended)` on the one you back, and each option's description naming its landing consequence ("closes as not planned", "relabels for an agent"). Prose questions are for surfacing options the ticket has not named yet; a yes/no goes either way.

   **Plain English.** The owner never opens the ticket and holds no coding context. The question body explains the ticket in real-world terms: every code symbol, filename, ticket number and jargon term becomes what it does for the owner. Options carry the trade-off in the same register. A technical term survives only where it names something the owner will touch (a UI label they click).
3. The pick is the ruling. Land it in the same turn, the pick being the confirmation — the owner has already answered (Dan, 2026-09-10). One more question only when the pick leaves a fork the ticket needs settled, or hinges on a result only the owner saw (a UI outcome, a test they ran).

## Land the ruling

Write the ruling to a temp file: verbatim quote plus one-sentence context (`from grill session <YYYY-MM-DD>`). Post with `gh issue comment N --repo <repo> --body-file <path>`.

Follow-through by ruling shape:

- **Unblocks an agent** → `gh issue edit N --add-label ready-for-agent --remove-label ready-for-human`.
- **Decision was the outcome / ships as-is** → `gh issue close N --reason completed`.
- **Not happening** → `gh issue edit N --add-label wontfix --remove-label ready-for-human` then `gh issue close N --reason "not planned"`.
- **Spawns child tickets** → keep `ready-for-human`, note the follow-up in the comment; owner runs `/to-tickets` next to publish the children.

Verify: `gh issue view N --json labels,state`. A tracker that does not reflect the ruling is a landing failure — retry until it does.

## Completion criterion

Every ticket open at start carries a landed ruling comment **and** a label/state reflecting it. Report each ticket's number and outcome (relabeled / closed-completed / closed-wontfix / kept-with-note).

## In a cloud container

A cloud session (claude.ai/code, Cowork) has no `gh`; `CLAUDE_CODE_REMOTE_SESSION_ID` set in the environment is the tell. Same steps, GitHub MCP instruments: read [`cloud.md`](cloud.md) for the substitution table before the first tracker call.
