# Day Board — the data contract and the page

Disclosed reference for [`SKILL.md`](SKILL.md) steps 1 and 4, and for any change to the board itself. The board is `https://claude.ai/artifact/PSr7LzYZqhtF8QHAyX8FGq`, read and written with the `ArtifactData` tool. `ArtifactData` unavailable is an unreachable surface, and the run continues.

## Read the answers (step 1)

`query` collection `triage` where `status == "answered"`. Each is a tier-2 answer Dan gave since the last run, with its Todoist write already done: `Rule out` moved the task into Wontfix, so it needs nothing more. Every board item is a task, so none goes in the run record. A `Note only` answer carries no write: act on the note as if he typed it in the session. An answer whose choice starts `Your note:` is a note Dan had the board read and apply on the spot, so its write is done like any other option's. A note on any answered card — Note only, the reason beside an option, or an applied note — that declines an agent means writing `no-agent` on the task. Leave `ruling_log` alone: the board's huddle draft reads it, and it is not consumed. Name the count on status line 2, then `delete` each consumed document. A card Dan undid is back at `status: "open"`: treat it as unanswered.

## Publish the run (step 4)

**Nothing confidential on the board (Dan, 2026-09-30).** Every field this run writes (`title`, `question`, `source.quote`, `options[].label`, `alarms`, and the `waiting` rows' `subject` and `ask`) is readable by anyone who can open the page. None of them may carry a pay, bonus, raise, salary, stipend or commission figure; a performance or annual review, a review audit, discipline or termination; sickness, medical or health detail, or a leave reason; or an identity number. Write the neutral form instead ("an HR form question", "Rob is out today", "4 leave requests wait on your approval"), and put `(personal message, not shown)` in `source.quote` when the newest message is itself personal. The Todoist task keeps its full title; only the board copy is neutral.

After tier 1 is applied and before the status, one `ArtifactData` `batch`:

- `triage_meta/latest` (`set`): `runId` (this record's stamp), `finishedAt` (ISO), `alarms` (the tier-3 lines, at most five plain sentences), `appliedCount` (tier-1 writes applied).
- `triage/<taskId>` (`set`), one per tier-2 question: `runId`, `taskId`, `title`, `question` (the one-clause reason), `source` (`{lastFrom, lastAt, quote}` — the thread's newest message as read this run, not the task description; the board flags a card without it), `status: "open"`, and `options` — the same substantive rulings the numbered question offers, each `{label, labels?, projectId?, dueString?, deadlineDate?, priority?, delete?, mergeInto?, mergeComment?}` in `update-tasks` vocabulary, with `content` when the ruling retitles a stale task. The board supplies Rule out (moves to Wontfix) and the reason box itself; leave both out of `options`. A card whose task title is itself confidential takes a neutral `title` ("HR task for Mark"); the page links the card to the task, so nothing is lost. An agent-sweep question is its own card or two options folded into the task's existing card, per [`agent-sweep.md`](agent-sweep.md) § Ask; Rule out still kills the task, and the agent "no" is the option that adds `no-agent`.

## The "Waiting on you" list (step 4, same batch)

This run owns it. The forgotten-tasks routine runs on Dan's desktop without board access; the task it creates overnight carries only `claude`, so it lands in this queue — that is the handoff.

1. Read `waiting` first.
2. For every open task whose source thread (read to its last message in step 3) ends with a named person asking Dan for something he has not answered, `set` `waiting/<taskId>`: `from` (that person), `subject` (thread subject), `receivedAt` (that last message's date), `link` (thread URL), `ask` (one clause), `todoistId`, `status: "open"`.
3. Skip a row Dan marked `done` unless the thread has a message newer than its `doneAt`.
4. `update` to `done` any open row whose task is gone or whose thread now ends with Dan.

The board shows a row whose task is also an open question once, as the question.

## Launch agents (Dan, 2026-09-30)

The triage panel's **Launch agents** button starts one cloud session per open task labelled `agent`, per [`agent-sweep.md`](agent-sweep.md) § Launch. It needs the `Claude Code Remote` connector (`create_session`) in the page's capabilities; without it the button reports the failure and nothing changes. A started session cannot be undone, so this button stores no undo record: to stop one, archive the session and put `agent` back or remove it.

## The huddle draft's evidence (issue 1039)

The huddle draft reads the huddle channel (`huddle__global__…`) and Sent Items (`outlook_sent__sent__…`) from today's newest export in `aacx-inbox`, per [`sources.md`](sources.md) § Exports. A live Teams or Outlook read covers only the span from that export's stamp to now, never more than one hour (aac-routines ADR 0010, "Live tail"); any span past that hour is named in the draft's "Could not read". Before the day's first export (08:15 CT on weekdays) the panel shows a waiting state, drafts nothing and makes no Microsoft 365 call. Granola and Todoist completions are read live, as before.

## Changing the board page (Dan, 2026-09-24)

The page source of record is [`day-board.html`](day-board.html). Edit that file and republish it to the board URL with the `capabilities` its header comment lists; build every change from that file, never from memory or the live page. Every button on it:

- stores what each Todoist write changed, so the card offers Undo;
- works without `confirm()` or `alert()`, which the artifact frame blocks silently.
