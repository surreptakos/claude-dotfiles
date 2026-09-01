---
name: grill-ready-for-human
description: Walk every ready-for-human ticket one at a time — grill for the ruling, land it as a comment, relabel or close.
disable-model-invocation: true
---

# Grill ready-for-human

Every `ready-for-human` ticket is waiting on a **ruling** only the owner can give. This walks the complete open queue in the current repo, one ticket at a time, and refuses to move on until the current ticket's ruling has landed on the tracker.

Leading words: **ruling** (what the ticket waits on) and **relentless** (borrowed from `/grilling`, which this runs per ticket).

## One ticket per grill

One ticket per turn. No queue-wide summary that lets the owner batch-close or batch-defer — a batch ruling is unfinished work. If the owner tries to short-circuit ("just close them all"), grill the batch premise itself before accepting it: which ticket, what ruling, and why the shared answer holds.

## Setup

- Detect repo from cwd: `gh repo view --json nameWithOwner --jq .nameWithOwner`.
- Fetch queue: `gh issue list --repo <repo> --label ready-for-human --state open --json number,title,body,labels --limit 100`.
- Empty queue → report "no ready-for-human tickets" and stop.
- State the count. Do not list every title. Surface only the ticket about to be worked.

## Per ticket

1. `gh issue view N --repo <repo> --comments` — read the body and every comment before opening the grill. Prior comments carry earlier owner language and partial rulings.
2. Run `/grilling` scoped to this ticket's decision. Facts are looked up (blast radius via `grep`, downstream dependents, related tickets via `gh issue list --search`). Decisions are the owner's alone. One question at a time. Recommended answer supplied per question. Do not act until the owner confirms shared understanding on the ruling.

   **Ask shape.** When the ticket body already enumerates the ruling's discrete options (2-4 choices — e.g. an `Options:` block or a numbered list under "What to build"), default to the `AskUserQuestion` tool with those exact options, and put `(Recommended)` on the option you back. Free-form prose questions are for turns where the options are still being surfaced — a first-principles trade the ticket hasn't named yet, or a scoping question that has to come before options exist. A single yes/no can go either way; a picker is fine there.

   **Plain-English framing — always.** The owner has zero coding context and never opens the GitHub ticket. Put the plain-English explanation of what the ticket is about, in real-world terms, into the **question body itself** — not the options. Translate every code symbol, filename, ticket number, and jargon term into what it does for the owner in the real world. Options carry the trade-off, still plain English, with the recommended one flagged. Preserve technical terms only where they name something the owner will touch (a UI label, a Todoist body line they read); everything internal stays translated. A picker whose options quote source paths and issue numbers is unusable — no answer possible, dismissal follows.
3. When a ruling lands, quote it back verbatim once and ask "landing this?" Wait for a clear yes.

## Land the ruling

Write the ruling to a temp file: verbatim quote plus one-sentence context (`from grill session <YYYY-MM-DD>`). Post with `gh issue comment N --repo <repo> --body-file <path>`.

Follow-through by ruling shape:

- **Unblocks an agent** → `gh issue edit N --add-label ready-for-agent --remove-label ready-for-human`.
- **Decision was the outcome / ships as-is** → `gh issue close N --reason completed`.
- **Not happening** → `gh issue edit N --add-label wontfix --remove-label ready-for-human` then `gh issue close N --reason "not planned"`.
- **Spawns child tickets** → keep `ready-for-human`, note the follow-up in the comment; owner runs `/to-tickets` next to publish the children.

Verify: `gh issue view N --json labels,state`. A tracker that does not reflect the ruling is a landing failure — retry until it does.

## Completion criterion

Every ticket open at start now carries a landed ruling comment **and** a label/state reflecting it. Report per-ticket outcome (relabeled / closed-completed / closed-wontfix / kept-with-note) plus the ticket number. A summary that reports "N grilled" without per-ticket outcomes is unfinished.

## In a cloud container: same duties, different instruments

A cloud session (claude.ai/code, Cowork) has no `gh` — `CLAUDE_CODE_REMOTE_SESSION_ID` set in the environment is the tell. Every step above still applies; only the tool changes. Do not report a step as impossible because its `gh` spelling failed — use the GitHub MCP equivalent, same shape as `orchestrator/ticket-fleet-cloud.js`:

| The step says | In a container use |
| --- | --- |
| `gh repo view --json nameWithOwner` | derive `<owner>/<repo>` from `git remote get-url origin` |
| `gh issue list --label ready-for-human --state open --json ...` | MCP `list_issues` (label: "ready-for-human", state: "open") |
| `gh issue view N --comments` | MCP `issue_read` (body) then its comments method for the thread |
| `gh issue list --search ...` | MCP `search_issues` |
| `gh issue comment N --body-file <path>` | MCP `add_issue_comment` |
| `gh issue edit N --add-label ... --remove-label ...` | MCP `update_issue` (labels) |
| `gh issue close N --reason completed` / `--reason "not planned"` | MCP `update_issue` (state: closed, state_reason: completed / not_planned) |
| `gh issue view N --json labels,state` | MCP `issue_read` (verify labels + state) |

Read-only checks can also go straight to REST — `curl https://api.github.com/repos/<owner>/<repo>/issues?labels=ready-for-human&state=open` — the session's egress proxy authenticates api.github.com, private repos included.

MCP write calls (comment, update, close) may raise a permission prompt; when the user typed `/grill-ready-for-human`, that prompt is the confirmation, not a reason to skip the step.
