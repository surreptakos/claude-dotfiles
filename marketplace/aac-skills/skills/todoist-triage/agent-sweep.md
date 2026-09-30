# Agent sweep — tasks an agent could do

Disclosed reference for [`SKILL.md`](SKILL.md) steps 3 and 4. Dan, 2026-09-30: triage "should also sweep todoist for anything that can be done by an agent … and ask me if it should be done by an agent on my day board".

## Which tasks

Every open task in scope whose ball is on Dan (`do`). Skip:

- a queue task, a `to-NAME` task and a `chase` task — the ball is not yet Dan's to hand over; a queue task is swept on the first run after Dan gives it `do`;
- a task that already has a tier-2 question this run — one card per task, because two cards would each replace the task's labels from a stale copy; it is swept on the next run;
- `no-sweep`, `merged`, and anything in Wontfix;
- a task already carrying `agent` or `no-agent` — Dan has answered it;
- a not-work Inbox item;
- a task this run deletes or merges in tier 1.

## The test

A task is agent-doable when all three hold. Read the source thread to its last message first, as for any ruling.

1. **The deliverable is a thing, not an act.** A draft (email or Teams reply, memo, SOP, contract package, report), a research answer, a data pull, a spreadsheet or document, code or a ticket in an AAC repo, a Todoist cleanup.
2. **The inputs are reachable from a session** — the source thread, Drive or SharePoint files, Zoho, Todoist, the repositories — and the task or its source names them.
3. **Nothing in it needs Dan himself.** No decision, approval, signature, payment, phone call, meeting or site visit, and nothing sent under his name. An agent drafts; Dan sends.

A task that is part judgment, part legwork qualifies for the legwork only: the question names that half, and the ball stays with Dan for the rest.

Not sure it passes? Leave it out. Every wrong candidate costs Dan a click.

## Ask — always tier 2

Never applied without asking. Each candidate is one tier-2 question, ranked after every other tier-2 question.

The question names what the agent would produce, from which inputs, and the skill it would use where one fits (`aac-contract-package`, `aac-sop`, `research`, `aac-house-writing-standard` for anything another person reads). One clause each.

Two options, in `update-tasks` vocabulary. Labels are a full replacement, so both copy the task's current labels:

- **An agent does it** — current labels plus `agent`.
- **I'll do it** — current labels plus `no-agent`.

On the Day Board this is an ordinary `triage/<taskId>` card per [`day-board.md`](day-board.md) § Publish the run. The board's own **Rule out** button still moves the task to Wontfix — it kills the task, it is not the agent "no" — so the question text names **I'll do it** as the way to keep the task and decline the agent.

An answer that arrives as a note (the board's Note only, or prose in the session) and declines the agent is still a "no": the run writes `no-agent` on the task itself, then acts on the rest of the note.

## What the labels mean

`agent` and `no-agent` are not ball labels: the ball stays where it was. `agent` says Dan approved the task for an agent; `no-agent` is his "no", landed durably so the sweep never asks again. Either one takes the task out of the sweep for good. Dan removes the label to reopen the question.

This run does not start the agent. An `agent` task waits for a session to pick it up, and the result comes back to Dan as a draft or a task comment — never sent, filed or signed by the agent.
