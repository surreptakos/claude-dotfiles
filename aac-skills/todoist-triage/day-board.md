# Day Board — the data contract and the page

Disclosed reference for [`SKILL.md`](SKILL.md) steps 1 and 4, and for any change to the board itself. The board is `https://claude.ai/artifact/PSr7LzYZqhtF8QHAyX8FGq`, read and written with the `ArtifactData` tool. `ArtifactData` unavailable is an unreachable surface, and the run continues.

## Read the answers (step 1)

`query` collection `triage` where `status == "answered"`. Each is a tier-2 answer Dan gave since the last run, with its Todoist write already done: `Rule out` moved the task into Wontfix, so it needs nothing more. Every board item is a task, so none goes in the run record. A `Note only` answer carries no write: act on the note as if he typed it in the session. Name the count on status line 2, then `delete` each consumed document. A card Dan undid is back at `status: "open"`: treat it as unanswered.

## Publish the run (step 4)

After tier 1 is applied and before the status, one `ArtifactData` `batch`:

- `triage_meta/latest` (`set`): `runId` (this record's stamp), `finishedAt` (ISO), `alarms` (the tier-3 lines, at most five plain sentences), `appliedCount` (tier-1 writes applied).
- `triage/<taskId>` (`set`), one per tier-2 question: `runId`, `taskId`, `title`, `question` (the one-clause reason), `source` (`{lastFrom, lastAt, quote}` — the thread's newest message as read this run, not the task description; the board flags a card without it), `status: "open"`, and `options` — the same substantive rulings the numbered question offers, each `{label, labels?, projectId?, dueString?, deadlineDate?, priority?, delete?, mergeInto?, mergeComment?}` in `update-tasks` vocabulary, with `content` when the ruling retitles a stale task. The board supplies Rule out (moves to Wontfix) and the reason box itself; leave both out of `options`.

## The "Waiting on you" list (step 4, same batch)

This run owns it. The forgotten-tasks routine runs on Dan's desktop without board access; the task it creates overnight carries only `claude`, so it lands in this queue — that is the handoff.

1. Read `waiting` first.
2. For every open task whose source thread (read to its last message in step 3) ends with a named person asking Dan for something he has not answered, `set` `waiting/<taskId>`: `from` (that person), `subject` (thread subject), `receivedAt` (that last message's date), `link` (thread URL), `ask` (one clause), `todoistId`, `status: "open"`.
3. Skip a row Dan marked `done` unless the thread has a message newer than its `doneAt`.
4. `update` to `done` any open row whose task is gone or whose thread now ends with Dan.

The board shows a row whose task is also an open question once, as the question.

## Changing the board page (Dan, 2026-09-24)

The page source of record is [`day-board.html`](day-board.html). Edit that file and republish it to the board URL with the `capabilities` its header comment lists; build every change from that file, never from memory or the live page. Every button on it:

- stores what each Todoist write changed, so the card offers Undo;
- works without `confirm()` or `alert()`, which the artifact frame blocks silently.
