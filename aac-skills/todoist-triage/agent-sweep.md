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
from the id. Zoho Desk tickets: the ticket's `webUrl`, from the `tools/zoho-rest.py` call under
[Connector quirks](#connector-quirks-2026-10-01). Drive files: the document link.

## Run an approved task

The session works one Todoist task, named in its prompt by its link. It is either a cloud session the board starts (`aac-routines` checkout, Default environment) or, while the button is blocked, a background agent a desktop Claude Code session starts in its own checkout (claude-dotfiles on 2026-10-01).

**What it reaches.** Todoist through the Todoist connector or REST v1 (`https://api.todoist.com/api/v1`, bearer `TODOIST_API_KEY`, else the token in `~/.config/aac/todoist_api_token`); Zoho through `tools/zoho-rest.py` in claude-dotfiles (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`) or the Desk and CRM connectors; mail, Teams, calendar and SharePoint through the Microsoft 365 connector; Drive, Fathom and Granola through theirs. A connector's tool names carry a per-session id, so find them with ToolSearch. Never report a credential missing before listing the environment's variable names (names only, never values).

1. **Check the payload — in the `aac-routines` checkout only.** Run `python3 .claude/hooks/check_payload.py`; a `STOP` naming the dotfiles credential means `add_repo` `surreptakos/claude-dotfiles`, then carry on. The script exists only there: in claude-dotfiles on 2026-10-01 it failed `can't open file ... .claude/hooks/check_payload.py: No such file`. A desktop agent in any other checkout skips it, and instead lists the environment's variable names and confirms the keys above that the task needs.
2. Read the task, every comment on it, and its source thread to the last message before writing anything (REST: `GET /tasks/<id>`, `GET /comments?task_id=<id>`).
3. Do the legwork the card described. Load `aac-house-writing-standard` for anything another person reads, and the skill the card named. Confidential material (pay figures, health, leave, discipline, customer identifiers) goes in the draft only where the task asks for it (a comp memo carries pay bands), and stays in the task comment or Drive file: never in a chat reply, a report or a repository.
4. Leave the result where the ball holder works: **one** comment on the task with the draft inline in Markdown or, when the draft is long, a link to a Drive file the session made (`create_file`). Post it with `add-comments` or `POST /comments` `{"task_id": "<id>", "content": "<text>"}`. Never send, file, sign, approve or pay anything; never create an Outlook draft under Dan's name; never change any other Todoist task.
5. Swap `agent-running` for `agent-done`, keeping every other label. Labels are a full replacement: read the task's current labels, drop `agent-running`, add `agent-done`, and write the whole list back (`update-tasks` `labels`, or `POST /tasks/<id>` `{"labels": [...]}`).
6. If the work cannot be done from what the session can reach, say exactly why in the comment (the error line, the missing source) and swap `agent-running` for `no-agent` the same way, so the task is Dan's again.
7. Report to whoever started the session: the task link, what was posted (the comment, or the Drive file's link), which swap ran, and anything not done with its exact error.

## Connector quirks (2026-10-01)

Hit by the nine background agents of session ba3aee66. Each names the exact error and the call that worked.

- **Zoho Desk connector `searchTickets`** ignored `ticketNumber` and returned the whole ticket list, with no error. Working: `tools/zoho-rest.py get "https://desk.zoho.com/api/v1/tickets/search?ticketNumber=<n>&orgId=874367220"` in claude-dotfiles returns the one ticket with its `webUrl`.
- **Todoist REST v1 completed tasks** since 2025-01-01 in one call: `HTTP Error 400: Bad Request`. Working: 90-day windows (`since` and `until` at most 90 days apart), joined; 2,481 tasks that day.
- **Microsoft 365 `outlook_email_search` and `chat_message_search`** reject `maxResults` (`Unrecognized key(s) in object: 'maxResults'`) and a string `offset` (`Expected number, received string`). Working: `limit` (25 at most) and a numeric `offset`, `0` first and then the response's `nextOffset`.
- **Gmail `search_threads`** rejects `maxResults` too: `Invalid JSON payload received. Unknown name "maxResults": Cannot find field.` Working: `pageSize` (50 at most) and `pageToken`.
- **Drive `update_file`** cannot change a Google Doc's text: `Unknown name "contentMimeType"`, `Unknown name "textContent"`; it takes only `title` and `parentId`. Working: a new file through `create_file`, linked per step 4. Editing a Doc in place waits on claude-dotfiles issue 1216.
