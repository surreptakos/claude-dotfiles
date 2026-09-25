---
name: grill-ready-for-human
description: Walk every ready-for-human ticket — read them all, ask every ruling in one batch, then land each as a comment and relabel or close.
metadata:
  disable-model-invocation: 'true'
  modified: '2026-09-25T14:33:53Z'
  previous-modified: '2026-09-25T14:16:40Z'
  revision: '6'
  content-sha: 5391df028645
---

# Grill ready-for-human

Every `ready-for-human` ticket waits on a **ruling** only the owner can give. Walk the open queue in the current repo in two phases, so the owner answers everything in one sitting and never waits on a landing:

1. **Ask.** Read every ticket first, then put all the questions to the owner in one batch.
2. **Land.** Land every ruling afterwards, without the owner in the loop.

## One ticket per question

Each question covers one ticket, and each ticket gets its own question. A batch ruling ("just close them all") is grilled as its own premise first — which ticket, what ruling, why the shared answer holds — because a batch ruling is unfinished work.

## Setup

- Repo: `gh repo view --json nameWithOwner --jq .nameWithOwner`.
- Queue: `gh issue list --repo <repo> --label ready-for-human --state open --json number,title,body,labels --limit 100`.
- Empty queue: report "no ready-for-human tickets" and stop.
- State the count.

## Phase 1: read every ticket, then ask in one batch

1. For every ticket in the queue, before any question goes out: `gh issue view N --repo <repo> --comments` — body and every comment. Prior comments carry earlier owner language and partial rulings. Look the facts up now (blast radius via `grep`, downstream dependents, related tickets via `gh issue list --search`), so no question waits on research.
2. Frame each ticket's question as `/grilling` would for that ticket's decision. Its one-question-at-a-time rule holds within a ticket's follow-ups, not across the queue: the first question for every ticket goes out in the batch.

   **Batch shape.** `AskUserQuestion` takes up to four questions per call, so a 20-ticket queue is five calls back to back, with no landing in between. One ticket per question.

   **Ask shape.** When the ticket enumerates 2-4 discrete options (an `Options:` block, a numbered list under "What to build"), use those options, `(Recommended)` on the one you back, and each option's description naming its landing consequence ("closes as not planned", "relabels for an agent"). Otherwise offer the options your research surfaced, `(Recommended)` on the backed one; the owner's free-text answer covers the rest. A yes/no goes either way.

   **Plain English.** The owner never opens the ticket and holds no coding context. The question body explains the ticket in real-world terms: every code symbol, filename, ticket number and jargon term becomes what it does for the owner. Options carry the trade-off in the same register. A technical term survives only where it names something the owner will touch (a UI label they click).
3. The pick is the ruling, the pick being the confirmation — the owner has already answered (Dan, 2026-09-10). A follow-up is warranted only when the pick leaves a fork the ticket needs settled, or hinges on a result only the owner saw (a UI outcome, a test they ran).

## Phase 2: land every ruling

Once the batch is answered, land every ruling in turn — comment, relabel or close, and any live action a ruling authorised — without asking the owner anything further. A ruling that opened a fork lands as far as it goes, and its follow-up question is held back.

Follow-ups go in a second, smaller batch at the end, after every landing, not interleaved with them; land those rulings the same way. Within one ticket's follow-ups, `/grilling`'s one-question-at-a-time rule applies.

### Landing one ruling

Write the ruling to a temp file: verbatim quote plus one-sentence context (`from grill session <YYYY-MM-DD>`). Post with `gh issue comment N --repo <repo> --body-file <path>`.

Follow-through by ruling shape:

- **Unblocks an agent** → `gh issue edit N --add-label ready-for-agent --remove-label ready-for-human`.
- **Decision was the outcome / ships as-is** → `gh issue close N --reason completed`.
- **Not happening** → `gh issue edit N --add-label wontfix --remove-label ready-for-human` then `gh issue close N --reason "not planned"`.
- **Spawns child tickets** → keep `ready-for-human`, note the follow-up in the comment, then run `/to-tickets` in this session to publish the children — publishing is agent work, not the owner's.

Verify: `gh issue view N --json labels,state`. A tracker that does not reflect the ruling is a landing failure — retry until it does.

## Completion criterion

Every ticket open at start carries a landed ruling comment **and** a label/state reflecting it. Report each ticket's number and outcome (relabeled / closed-completed / closed-wontfix / kept-with-note).

## In a cloud container

A cloud session (claude.ai/code, Cowork) has no `gh`; `CLAUDE_CODE_REMOTE_SESSION_ID` set in the environment is the tell. Same steps, GitHub MCP instruments: read [`cloud.md`](cloud.md) for the substitution table before the first tracker call.

## Across every repo: the rulings page

For the whole queue across all of the owner's repos, the ask is a published page instead of
`AskUserQuestion`, and a scheduled run lands what the owner submits: read
[`rulings-page.md`](rulings-page.md). The ruling shapes and the verify step above still govern
every landing it makes.
