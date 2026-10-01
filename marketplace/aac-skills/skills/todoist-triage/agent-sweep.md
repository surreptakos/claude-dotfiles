# Agent sweep — tasks an agent could do

Disclosed reference for [`SKILL.md`](SKILL.md) steps 3 and 4. Dan, 2026-09-30: triage "should also sweep todoist for anything that can be done by an agent … and ask me if it should be done by an agent on my day board".

## Which tasks

Everything open in scope (Dan, 2026-09-30: "more than just the do tasks. my todoist inbox. everything really"): Current Work, the backlog and the Inbox, whatever the ball — `do`, a direct, `chase`, or none yet. Skip only:

- `no-sweep`, `merged`, and anything in Wontfix;
- a task already carrying `agent`, `agent-running`, `agent-done` or `no-agent` — Dan has answered it;
- a not-work Inbox item — it stays untouched, per step 2;
- a task this run deletes or merges in tier 1;
- the directs' shared projects — O3 agenda lists, read for context only (Scope).

## The test

A task is agent-doable when all three hold. Read the source thread to its last message first, as for any ruling.

1. **The deliverable is a thing, not an act.** A draft (email or Teams reply, memo, SOP, contract package, report), a research answer, a data pull, a spreadsheet or document, code or a ticket in an AAC repo, a Todoist cleanup.
2. **The inputs are reachable from a session** — the source thread, Drive or SharePoint files, Zoho, Todoist, the repositories — and the task or its source names them.
3. **Nothing in it needs a person.** No decision, approval, signature, payment, phone call, meeting or site visit, and nothing sent under anyone's name. An agent drafts; a person sends.

A task that is part judgment, part legwork qualifies for the legwork only: the question names that half, and the ball holder keeps the rest.

Not sure it passes? Leave it out. Every wrong candidate costs Dan a click.

## Ask — always tier 2

Never applied without asking. One card per task, never two: two cards would each replace the task's labels from a stale copy.

The question names what the agent would produce, from which inputs, and the skill it would use where one fits (`aac-contract-package`, `aac-sop`, `research`, `aac-house-writing-standard` for anything another person reads). One clause each.

Options are in `update-tasks` vocabulary. Labels are a full replacement, so every option starts from the task's current labels.

- **A task with no other question this run** gets its own card, ranked after every other tier-2 question, with two options: **An agent does it** (current labels plus `agent`) and **I'll do it** (current labels plus `no-agent`).
- **A task that already has a question this run** keeps that one card and gains two options built from the card's recommended ruling: **Agent: <ruling>** (the ruling plus `agent`) and **Me: <ruling>** (the ruling plus `no-agent`). The card's other options stay as they were and write no agent label; if Dan picks one, the next run asks the agent question on its own card. When the recommended ruling is a delete or a merge, pair the first option that keeps the task instead; when every option deletes or merges, leave the agent question for the next run — the board applies a delete or merge without writing labels.

Every option that writes `agent` says so in its label, so Dan never picks it unknowingly.

The agent does the legwork whoever holds the ball.

On the Day Board this is an ordinary `triage/<taskId>` card per [`day-board.md`](day-board.md) § Publish the run. The board's own **Rule out** button still moves the task to Wontfix — it kills the task, it is not the agent "no" — so the question text names **I'll do it** (or **Me: …**) as the way to keep the task and decline the agent.

An answer that arrives as a note (the board's Note only, the reason typed beside any option, or prose in the session) and declines the agent is still a "no": the run writes `no-agent` on the task itself, then acts on the rest of the note.

## What the labels mean

None of them is a ball label: the ball stays where it was.

- `agent` — Dan approved the task for an agent; it waits for the launch.
- `agent-running` — the board launched its session; the task comment names the session link.
- `agent-done` — the agent finished; its result is a comment on the task.
- `no-agent` — Dan's "no", landed durably so the sweep never asks again.

Any of them takes the task out of the sweep. Dan removes the label to reopen the question.

## Launch (Dan, 2026-09-30)

The triage run never starts an agent. Dan does, with the Day Board's **Launch agents** button, once he has answered the day's cards. One click finds every open task labelled `agent`, starts one Claude Code cloud session per task (Default environment, `aac-routines` checkout, auto permission mode), swaps `agent` for `agent-running`, and comments the session link on the task. A task whose session did not start keeps `agent` and is named on the board. The launch prompt only points here: it names the task and this section below.

**The button cannot start sessions on Dan's account (2026-09-30, confirmed 2026-10-01).** On
2026-10-01 every `create_session` call rejected `blocked_by_policy` ("Your organization blocks this
Claude Code Remote call"): the runtime contract defines that code as a tool in the manifest that
org policy blocks for this viewer. The account's Connectors page (Customize, Yours) lists no
`Claude Code Remote` connector and the directory has none to add; the Team organization's admin settings
(Active Alarm, read 2026-10-01) have Cloud sessions, Remote Control, Routines and Enable artifact
connectors all on, list no `Claude Code Remote` connector and offer none in the directory, so no
organization toggle changes the block. It is platform policy for artifact pages calling that connector (claude-dotfiles issue
1162 holds the reading and the decision). Claude Code's settings reference (code.claude.com,
read 2026-10-01) has no key that reaches an artifact page's connector call: `disableRemoteControl`,
`disableClaudeAiConnectors` and `deniedMcpServers` govern Claude Code on the device, and this PC
sets none of them. What a session or routine on the desktop can do instead is create the cloud
session itself: `claude --cloud "<task description>"` (optionally `--environment <id>`) or the
claude.ai remote-trigger API. Until a launch path exists, a Claude Code session
launches them when Dan asks ("launch my agent tasks"): read every open task labelled `agent`,
start one background agent per task on this section's "Run an approved task" steps, and swap
`agent` for `agent-running` with a comment naming the session as each starts. Never report an
agent as started without that label swap on the task.

Every record mentioned in a reply to Dan, in a launch report, in an agent's result or in a draft
he will paste elsewhere carries its link in its own system of record, never a bare id or number
(Dan, 2026-10-01: "I need links to the todoist items referenced, not the IDs"; same day, on a Teams
draft that said `#43850`: "your message to Nick links to github instead of linking to zoho desk",
because the Claude app renders `#<number>` as a GitHub issue link). Todoist tasks:
`https://app.todoist.com/app/task/<id>`; the v1 REST task object carries no `url` field, so build it
from the id. Zoho Desk tickets: the ticket's `webUrl`, from
`tools/zoho-rest.py get "https://desk.zoho.com/api/v1/tickets/search?ticketNumber=<n>&orgId=874367220"`
in claude-dotfiles (the Desk connector's `searchTickets` ignored `ticketNumber` on 2026-10-01 and
returned the whole list). Drive files: the document link.

## Run an approved task

The session the board starts works one Todoist task:

1. Run `python3 .claude/hooks/check_payload.py`. A `STOP` naming the dotfiles credential means `add_repo` `surreptakos/claude-dotfiles`, then carry on.
2. Read the task, its comments, and its source thread to the last message.
3. Do the legwork the card described. Load `aac-house-writing-standard` for anything another person reads, and the skill the card named.
4. Leave the result where the ball holder works: a comment on the task with the draft inline, or a link to an Outlook draft or a Drive file the session made. Never send, file, sign, approve or pay anything.
   To revise a Google Doc an agent made (Dan's answers to fold in, a second pass), rewrite that Doc in place: `python3 <claude-dotfiles>/tools/google-rest.py doc-replace <docId> <file.md>`, after sharing it Editor with the service account, per `aac-google-access` § *Revising a Google Doc in place*. The Drive connector's `update_file` cannot change a Doc's text, and a "v2" beside the first leaves Dan two documents for one piece of work (issue 1216).
5. Swap `agent-running` for `agent-done` on the task, keeping every other label.
6. If the work cannot be done from what the session can reach, say why in the comment and swap `agent-running` for `no-agent`, so the task is Dan's again.
