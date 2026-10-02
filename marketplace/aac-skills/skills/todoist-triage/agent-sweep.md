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

Ask only about a task that clearly passes: every wrong candidate costs Dan a click.

## Ask — always tier 2

One card per task: two cards would each replace the task's labels from a stale copy.

The question names what the agent would produce, from which inputs, and the skill it would use where one fits (`aac-contract-package`, `aac-sop`, `research`, `aac-house-writing-standard` for anything another person reads). One clause each.

Options are in `update-tasks` vocabulary. Labels are a full replacement, so every option starts from the task's current labels.

- **A task with no other question this run** gets its own card, ranked after every other tier-2 question, with two options: **An agent does it** (current labels plus `agent`) and **I'll do it** (current labels plus `no-agent`).
- **A task that already has a question this run** keeps that one card and gains two options built from the card's recommended ruling: **Agent: <ruling>** (the ruling plus `agent`) and **Me: <ruling>** (the ruling plus `no-agent`). The card's other options stay as they were and write no agent label; if Dan picks one, the next run asks the agent question on its own card. When the recommended ruling is a delete or a merge, pair the first option that keeps the task instead; when every option deletes or merges, leave the agent question for the next run — the board applies a delete or merge without writing labels.

Every option that writes `agent` says so in its label, so Dan never picks it unknowingly.

The agent does the legwork whoever holds the ball.

On the Day Board this is an ordinary `triage/<taskId>` card per [`day-board.md`](day-board.md) § Publish the run. The board's own **Rule out** button still moves the task to Wontfix — it kills the task, it is not the agent "no" — so the question text names **I'll do it** (or **Me: …**) as the way to keep the task and decline the agent.

A decline that arrives as a note is still a "no": on the board ([`day-board.md`](day-board.md) § Read the answers) or as prose in the session, the run writes `no-agent` on the task itself, then acts on the rest of the note.

## What the labels mean

None of them is a ball label: the ball stays where it was.

- `agent` — Dan approved the task for an agent; it waits for the launch.
- `agent-running` — the `agent-launcher` routine (or a fallback session) started its session; the task comment names the session handle (`claude attach <id>`).
- `agent-done` — the agent finished; its result is a comment on the task.
- `no-agent` — Dan's "no", landed durably so the sweep never asks again.

Any of them takes the task out of the sweep. Dan removes the label to reopen the question.

## Launch (owner ruling 2026-10-01, issue 1202)

The triage run never starts an agent, and neither does the Day Board. The launch path is the
`agent-launcher` desktop routine on the anchor PC: its prompt lives in the aac-routines registry
(`python scripts/desktop_routines.py show agent-launcher`) and `/setup-check` registers it there.
Every 30 minutes on weekdays, 8 AM to 6 PM, it reads every open task labelled `agent` and, per
task:

1. Starts one local background session with `claude --bg --model claude-opus-5-5` from the
   `aac-routines` checkout. `claude --cloud` refuses a non-interactive terminal ("--cloud requires
   an interactive terminal", 2026-10-02), so no unattended routine can use it. The prompt only points here: it names the task with its Todoist link and says to
   follow "Run an approved task" below for that one task.
2. Started: swaps `agent` for `agent-running`, keeping every other label, and comments the session
   handle on the task.
3. Not started: the task keeps `agent` and gains a comment with the exact error; the next run
   tries it again.

The run record names every session started and every start that failed; a run that finds no
`agent` task writes none. The method lives in aac-routines `src/aac_routines/agent_launcher.py`.

The board's **Launch agents** button only counts and links: [`day-board.md`](day-board.md)
§ Launch agents has why it starts nothing.

**Fallback, for a PC without the routine.** A Claude Code session launches the tasks when Dan asks
("launch my agent tasks"): read every open task labelled `agent`, start one background session per task
on "Run an approved task" (`claude --bg --model claude-opus-5-5 --dangerously-skip-permissions
"<prompt>"` from the `aac-routines` checkout), and swap `agent` for `agent-running` with a comment naming the session as each starts.
A task whose session did not start keeps `agent` and gains a comment with the error. Report an
agent as started only once the label swap is on its task.

**Every launched agent runs on Opus 5.5** (Dan, 2026-10-02: "stop launching them in fable, use opus
5.5"). Name the model on every launch command; a bare `claude --bg` or `--cloud` inherits the
launching session's model, which on 2026-10-02 was Fable. Launch each task once: a start whose
outcome you could not read (no handle printed) counts as started until a listing proves otherwise,
so the same task never gets a second session.

## Links, not ids

Every record mentioned in a reply to Dan, in a launch report, in an agent's result or in a draft
he will paste elsewhere carries its link in its own system of record, never a bare id or number
(Dan, 2026-10-01: "I need links to the todoist items referenced, not the IDs"; same day, on a Teams
draft that said `#43850`: "your message to Nick links to github instead of linking to zoho desk",
because the Claude app renders `#<number>` as a GitHub issue link). Todoist tasks:
`https://app.todoist.com/app/task/<id>`; the v1 REST task object carries no `url` field, so build it
from the id. Zoho Desk tickets: the ticket's `webUrl`, from the `tools/zoho-rest.py` call under
[Connector quirks](#connector-quirks-2026-10-01). Drive files: the document link.

## Run an approved task

The session works one Todoist task, named in its prompt by its link. It is either a background session the launcher starts from the `aac-routines` checkout (§ Launch) or a background agent a desktop Claude Code session starts in its own checkout (claude-dotfiles on 2026-10-01).

**What it reaches.** Todoist through the Todoist connector or REST v1 (`https://api.todoist.com/api/v1`, bearer `TODOIST_API_KEY`, else the token in `~/.config/aac/todoist_api_token`); Zoho through `tools/zoho-rest.py` in claude-dotfiles (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`) or the Desk and CRM connectors; mail, Teams, calendar and SharePoint through the Microsoft 365 connector; Drive, Fathom and Granola through theirs. A connector's tool names carry a per-session id, so find them with ToolSearch. Never report a credential missing before listing the environment's variable names (names only, never values).

1. **Check the payload — in the `aac-routines` checkout only.** Run `python3 .claude/hooks/check_payload.py`; a `STOP` naming the dotfiles credential means `add_repo` `surreptakos/claude-dotfiles`, then carry on. The script exists only there: in claude-dotfiles on 2026-10-01 it failed `can't open file ... .claude/hooks/check_payload.py: No such file`. A desktop agent in any other checkout skips it, and instead lists the environment's variable names and confirms the keys above that the task needs.
2. Read the task, every comment on it, and its source thread to the last message before writing anything (REST: `GET /tasks/<id>`, `GET /comments?task_id=<id>`); a meeting, by its Fathom transcript (§ Meeting content).
3. Do the legwork the card described. Load `aac-house-writing-standard` for anything another person reads, and the skill the card named. Confidential material (pay figures, health, leave, discipline, customer identifiers) goes in the draft only where the task asks for it (a comp memo carries pay bands), and stays in the task comment or Drive file: never in a chat reply, a report or a repository.
4. Leave the result where the ball holder works: **one** comment on the task with the draft inline in Markdown or, when the draft is long, a link to a Drive file the session made (`create_file`), every record in it linked (§ Links, not ids). Post it with `add-comments` or `POST /comments` `{"task_id": "<id>", "content": "<text>"}`. Never send, file, sign, approve or pay anything; never create an Outlook draft under Dan's name; never change any other Todoist task.
   To revise a Google Doc an agent made (Dan's answers to fold in, a second pass), rewrite that Doc in place: `python3 <claude-dotfiles>/tools/google-rest.py doc-replace <docId> <file.md>`, after sharing it Editor with the service account, per `aac-google-access` § *Revising a Google Doc in place*. The Drive connector's `update_file` cannot change a Doc's text, and a "v2" beside the first leaves Dan two documents for one piece of work (issue 1216).
5. Swap `agent-running` for `agent-done`, keeping every other label. Labels are a full replacement: read the task's current labels, drop `agent-running`, add `agent-done`, and write the whole list back (`update-tasks` `labels`, or `POST /tasks/<id>` `{"labels": [...]}`).
6. If the work cannot be done from what the session can reach, say exactly why in the comment (the error line, the missing source) and swap `agent-running` for `no-agent` the same way, so the task is Dan's again.
7. Report to whoever started the session: the task link, what was posted (the comment, or the Drive file's link), which swap ran, and anything not done with its exact error.

## Meeting content (Fathom)

A task whose input is a meeting reads the meeting, not its recap email (issue 1215). The call that
returns a transcript, run 2026-10-01 from a desktop Claude Code session on a meeting
`search_meetings` found:

1. `search_meetings` (`{"query": "<topic words>", "recorded_by": "anyone"}`) or `list_meetings`.
   Each hit prints `id: <n>` and `url: https://fathom.video/calls/<m>`. The `id` is the
   recording_id; the number in the URL is a call id, a different number.
2. `get_meeting_transcript` with the id as a JSON integer, unquoted:
   `{"recording_id": 123456789, "url": "<the hit's url>"}`. It returns the whole transcript, each
   turn linked to its timestamp. `get_meeting_summary` takes `{"recording_id": 123456789}`.

A quoted id fails. On 2026-10-01 (session ba3aee66) three agents passed it as a string and every
summary and transcript call was rejected with:

```
Invalid arguments: value at /recording_id is not an integer
```

Holding only a Fathom link, `get_recording_by_url` (`{"url": "<link>"}`) returns the recording_id.
No Fathom API key is in the desktop environment, so the connector is the only path. Where it still
rejects an integer id, the Fathom recap email in Outlook is the fallback: it carries the summary but
not the transcript, so the result says the transcript was not read.

## Connector quirks (2026-10-01)

Hit by the nine background agents of session ba3aee66. Each names the exact error and the call that worked.

- **Zoho Desk connector `searchTickets`** ignored `ticketNumber` and returned the whole ticket list, with no error. Working: `tools/zoho-rest.py get "https://desk.zoho.com/api/v1/tickets/search?ticketNumber=<n>&orgId=874367220"` in claude-dotfiles returns the one ticket with its `webUrl`.
- **Todoist REST v1 completed tasks** since 2025-01-01 in one call: `HTTP Error 400: Bad Request`. Working: 90-day windows (`since` and `until` at most 90 days apart), joined; 2,481 tasks that day.
- **Microsoft 365 `outlook_email_search` and `chat_message_search`** reject `maxResults` (`Unrecognized key(s) in object: 'maxResults'`) and a string `offset` (`Expected number, received string`). Working: `limit` (25 at most) and a numeric `offset`, `0` first and then the response's `nextOffset`.
- **Gmail `search_threads`** rejects `maxResults` too: `Invalid JSON payload received. Unknown name "maxResults": Cannot find field.` Working: `pageSize` (50 at most) and `pageToken`.
- **Drive `update_file`** cannot change a Google Doc's text: `Unknown name "contentMimeType"`, `Unknown name "textContent"`; it takes only `title` and `parentId`. Working: a new file through `create_file`, linked per step 4. To edit a Doc in place, use `google-rest.py doc-replace` per step 4 (issue 1216).
