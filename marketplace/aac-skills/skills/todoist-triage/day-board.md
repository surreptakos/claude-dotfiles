# Day Board — the data contract and the page

Disclosed reference for [`SKILL.md`](SKILL.md) steps 1 and 4, and for any change to the board itself. The board is `https://claude.ai/artifact/PSr7LzYZqhtF8QHAyX8FGq`, read and written with the `ArtifactData` tool. `ArtifactData` unavailable is an unreachable surface, and the run continues.

## Read the answers (step 1)

`query` collection `triage` where `status == "answered"`. Each is a tier-2 answer Dan gave since the last run, with its Todoist write already done: `Rule out` moved the task into Wontfix, so it needs nothing more. Every board item is a task, so none goes in the run record. A `Note only` answer carries no write: act on the note as if he typed it in the session. An answer whose choice starts `Your note:` is a note Dan had the board read and apply on the spot, so its write is done like any other option's. A note on any answered card — Note only, the reason beside an option, or an applied note — that declines an agent means writing `no-agent` on the task. Leave `ruling_log` alone: the board's huddle draft reads it, and it is not consumed. Name the count on status line 2, then `delete` each consumed document. A card Dan undid is back at `status: "open"`: treat it as unanswered.

## Publish the run (step 4)

**The board copy is verbatim (Dan, 2026-10-01: "I only need the huddle notes sanitized for confidential info, not my own tasks to rule on or anything else").** The confidential rule covers the generated huddle notes only, and the page's huddle gate enforces it there. Every field this run writes (`title`, `question`, `source.quote`, `options[].label`, `alarms`, and the `waiting` rows' `subject` and `ask`) carries the task title and the thread's words as they are, pay, health and leave detail included; never swap in a neutral form.

### Republish the page (every run; Dan, 2026-10-02)

Every run republishes the page before its batch, so a merged change to [`day-board.html`](day-board.html) is live by the next morning at the latest. Dan: "republish every single time".

1. Fetch master's copy into the session's scratch directory: `curl -fsSL https://raw.githubusercontent.com/surreptakos/claude-dotfiles/master/aac-skills/todoist-triage/day-board.html -o <scratch>/day-board.html` (`curl.exe` in Windows PowerShell, where `curl` is a different command). Master, not this skill's own copy: a plugin one version behind would publish an older page.
2. `Artifact` `read` the board URL; the tool refuses a publish to an artifact the session has not read.
3. `Artifact` publish that file with `url` set to the board URL and `capabilities` set to the JSON in the file's header comment. A conflict refusal means publish the same file again: the page is code only, and its state lives in its db.

Done when the publish returns a version. A failure at any step is a dark surface (status line 5), and the run goes on to the batch.

### The batch

After tier 1 is applied and the page is republished, before the status, one `ArtifactData` `batch`:

- `triage_meta/latest` (`set`): `runId` (this record's stamp), `finishedAt` (ISO), `alarms` (the tier-3 lines, at most five plain sentences), `appliedCount` (tier-1 writes applied).
- `triage/<taskId>` (`set`), one per tier-2 question: `runId`, `taskId`, `title`, `question` (the one-clause reason), `source` (`{lastFrom, lastAt, quote}` — the thread's newest message as read this run, not the task description; the board flags a card without it), `status: "open"`, and `options` — the same substantive rulings the numbered question offers, each `{label, labels?, projectId?, dueString?, deadlineDate?, priority?, delete?, mergeInto?, mergeComment?}`, the field names the page writes with, with `content` when the ruling retitles a stale task. The board supplies Rule out (moves to Wontfix) and the reason box itself; leave both out of `options`. An agent-sweep question is its own card or two options folded into the task's existing card, per [`agent-sweep.md`](agent-sweep.md) § Ask; Rule out still kills the task, and the agent "no" is the option that adds `no-agent`.

## The "Waiting on you" list (step 4, same batch)

This run owns it. The forgotten-task capture never writes to the board; the task it creates carries only `claude`, so it lands in this queue — that is the handoff.

1. Read `waiting` first.
2. For every open task whose source thread (read to its last message in step 3) ends with a named person asking Dan for something he has not answered, `set` `waiting/<taskId>`: `from` (that person), `subject` (thread subject), `receivedAt` (that last message's date), `link` (thread URL), `ask` (one clause), `todoistId`, `status: "open"`.
3. Skip a row Dan marked `done` unless the thread has a message newer than its `doneAt`.
4. `update` to `done` any open row whose task is gone or whose thread now ends with Dan.

The board shows a row whose task is also an open question once, as the question.

## Launch agents (issue 1202)

The triage panel's **Launch agents** button starts nothing and writes nothing: it counts the open tasks labelled `agent`, links each, and says the `agent-launcher` routine starts them within 30 minutes, per [`agent-sweep.md`](agent-sweep.md) § Launch. The page calls no session connector: on 2026-10-01 every `Claude Code Remote` `create_session` call from the page rejected `blocked_by_policy` ("Your organization blocks this Claude Code Remote call"), and no account or organization toggle lifts it (issue 1162 holds the reading and the decision). To stop a started session, archive it and put `agent` back or remove it.

## The huddle draft's evidence (issue 1039)

The huddle draft reads the huddle channel (`huddle__global__…`) and Sent Items (`outlook_sent__sent__…`) from today's newest export in `aacx-inbox`, per [`sources.md`](sources.md) § Exports. A live Teams or Outlook read covers only the span from that export's stamp to now, never more than one hour (aac-routines ADR 0010, "Live tail"); any span past that hour is named in the draft's "Could not read". Before the day's first export (08:15 CT on weekdays) the panel shows a waiting state, drafts nothing and makes no Microsoft 365 call. Granola and Todoist completions are read live, as before: the page reads completions in the browser, its own surface. A triage run that needs who completed what reads it with `python -m aac_routines.completed_task_events`, per [`sources.md`](sources.md) § Live tail (aac-routines issue 639).

GitHub is the fifth source (issue 1199): the GitHub connector's `search_pull_requests` and `search_issues` return the pull requests merged and issues closed in `surreptakos` repos since Dan's last post, live. Each row is report evidence on its own, like a board ruling, so a day of repository work and nothing else still drafts a report; a report line from it carries evidence starting `GitHub` that names each PR or issue as `repo#number`, shown under "What each line rests on". A connector failure is named under "Could not read".

## The huddle drafter learns from Dan's edits (issue 848, Dan 2026-10-01)

"Wherever my huddle notes differed, that's a lesson for you." The loop is aac-bill-intake's (its ADRs 0006 to 0008), and every step is page code:

1. **Detect.** Each draft first compares Dan's last post with the draft he worked from: the newest passing `huddle_drafts` row from his post's day saved before he posted. Code diffs it line by line per section (cut, added, edited). A confidential line is never compared.
2. **Propose.** Claude proposes at most five general lessons, each citing the changes it comes from. Code refuses a lesson with the wrong fields, more than 200 characters, a confidential detail, no cited change, or the same text as any lesson Dan already has, kept or dropped. Each one that passes is `huddle_lessons/<post stamp>-<n>` with `status: "proposed"`. `huddle_feedback/<post stamp>` logs the compare, refusals included, so each post is compared once.
3. **Confirm.** A proposal is inert. The panel's "Lessons from your edits" list offers Keep and Drop, and Dan's Keep is the only write that sets `status: "confirmed"`. Neither a model nor a session confirms one.
4. **Feed.** Every draft, line repair and coverage prompt carries the kept lessons, oldest first, inside his rules and the gate. A proposed or dropped lesson never reaches a prompt.

The first lessons come from Dan's 2026-09-30 post against the 11:31 draft that day; his post matched the 12:37 redraft word for word. They are in [`huddle-lessons-seed.json`](huddle-lessons-seed.json): once the page is republished, a session passes its `writes` to one `ArtifactData` `batch`, and they wait for his Keep like any other proposal.

## Changing the board page (Dan, 2026-09-24)

The page source of record is [`day-board.html`](day-board.html). A button that writes is not done until a test drives its click through the page script and asserts the write (`tests/day-board-*.test.js`); a button that calls a connector is not done until one real call from the published page has succeeded or its failure copy names the fallback (Dan, 2026-09-30: "Apply my note" wrote nothing and "Launch agents" called a connector the account does not have). Edit that file and republish it to the board URL with the `capabilities` its header comment lists; build every change from that file, never from memory or the live page. Every button on it:

- stores what each Todoist write changed, so the card offers Undo;
- works without `confirm()` or `alert()`, which the artifact frame blocks silently;
- moves a recurring task's do date with the connector's reschedule call, date only, because a task update would replace its due string and wipe the repeat. A `dueString` the page cannot read as a date (it reads today, tomorrow, a weekday, Oct 5, 10/5, in 3 days, next week) changes nothing on a recurring task and shows the error on the card.
