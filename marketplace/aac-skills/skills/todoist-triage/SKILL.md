---
name: todoist-triage
description: Triage Dan's Todoist work tasks. Use for the daily or Friday pass, clearing the backlog, or deciding what to delegate.
metadata:
  modified: '2026-10-02T19:13:54Z'
  previous-modified: '2026-10-02T04:39:34Z'
  revision: '42'
  content-sha: 810c5906d5af
---

# todoist-triage

Dan rules the judgment calls; the skill clears the rest itself (the tiers, step 4). aac-routines (live) is intake only and leaves a task alone once created; this skill picks up from there. Labels are rulings: applied once, changed only when Dan says.

Each sibling file is read where its step points. A change to the Day Board page itself starts at [`day-board.md`](day-board.md) § Changing the board page.

## Scope

- `Current Work (max 10)` `6JHrw6mXXgrrWqxG` and `Work tasks backlog` `6XMPVX96VgH6vwHR`.
- The Todoist Inbox — `inbox_project_id` in aac-routines' `config/task-capture.json`, read every run. Triage an Inbox item where it sits; only the aac-routines router moves items out of it.
- The directs' shared projects are O3 agenda lists, read for context only: Steffi `6gQ3FMwQpP4hpqjX`, Rob `6gQ3Cj2Q8MxRGMG5`, Nick `6gQ3CWrr768p37PJ`, Mark `6gQ3FJRJrgvQ8GjR`. Lynne has none.

## Three axes: label says whose ball, project says which week, dates say the calendar

Every open task carries exactly one ball label, or it is in the triage queue.

| Ball on | Label |
|---|---|
| Dan | `do` |
| a direct | `to-lynne` `to-steffi` `to-nick` `to-rob` `to-mark` |
| an outside party (vendor, counsel, accountant, customer), or Dan's own work blocked on one | `chase` |
| nobody yet | none: the triage queue |

**Find the ball by reading the last move.** Whoever owes the next move in the source's most recent message holds the ball. A direct asking Dan three questions puts it on Dan (`do`), however much the topic looks like theirs. Dan's verbs (decide, approve, sign, show, answer, call counsel) put it on Dan. A direct's prep or scheduling around Dan's decision is a comment, not a label. `do` plus `to-NAME` together only when Dan rules and the direct then owns execution — rarely.

**The project carries the week.** Current Work = this week, capped around 10 `do` (Dan's rule; when he exceeds it, report the count). Backlog = later. Priority sorts within a ball and never sets it.

**Dates carry the calendar.** The **do date** (Todoist's "due date") is Dan's plan — the day he intends to work it or look again — and moves freely. A backlog `do` with a do date resurfaces that day; without one it sits in the pool the Friday pass draws from. The **deadline** (Todoist's "deadline") is the world's constraint — the day after which something bad happens (IDFPR, tax extension, lien). Set one only when the source names it; it moves Dan, Dan leaves it where it is.

**Other labels.** `claude` marks routine-created tasks and stays on. `no-sweep` marks tasks Dan runs himself; skip them. `merged` is retired (Dan, 2026-09-21): a task still carrying it is a nested duplicate from an older pass — propose it as a merge like any other. `agent`, `agent-running`, `agent-done` and `no-agent` track the agent sweep (step 3, [`agent-sweep.md`](agent-sweep.md)) and never change the ball.

**Wontfix is where a task-shaped ruling sticks.** It is the `Wontfix` Todoist project (`wontfix_project_id` in the routine repository's `config/task-capture.json`). This skill's queue and the `aac-forgotten-tasks` guard read it through the same matcher with the same evidence bound, so a ruled-out item stays suppressed on both sides until evidence newer than the ruling arrives, then resurfaces (ADR 0009 in the routine repository).

- File one in the same turn Dan rules an item done, dead, not his, or not to be raised again: title, the ruling and its date, the `aac-topic` key, and the regenerating source to suppress. Then delete the live task. Both are one `wontfix` entry in step 5's plan.
- Dan's word is the only trigger. An item that merely looks stale to you stays in the queue.
- A task already in Wontfix is Dan's to take out: leave it unmoved, uncompleted, undeleted.

## Procedure

### 1. Read

In this order:

1. **Prior run records** — pull the store, then read the newest `aac-forgotten-tasks` record and the previous `todoist-triage` record, per [`run-ledger.md`](run-ledger.md) § Pull the store and § Read the prior records.
2. **Exports** — the newest file per source from the `aacx-inbox` folder, per [`sources.md`](sources.md) § Exports. Record the newest stamp. Then plan which threads to re-open, per [`sources.md`](sources.md) § Thread reuse.
3. **Leave Dates** — `pending` before any leave item is ruled on ([`sources.md`](sources.md) § Systems of record).
4. **Live tail** — the window from the newest export stamp to now, at most one hour, per [`sources.md`](sources.md) § Live tail. The connectors fill the tail; the exports stay the primary reader.
5. **Todoist** — from the Todoist mirror, never a Todoist connector read (aac-routines issue 609): `python -m aac_routines.todoist_mirror sync` once from the aac-routines checkout, then `python -m aac_routines.todoist_mirror tasks --project-id <id>` for Current Work, the backlog and the Inbox (`current_work_project_id`, `backlog_project_id`, `inbox_project_id` in `config/task-capture.json`), each task with its comments. The mirror holds every collaborator's tasks, so there is no paging or filtering to set. Read the four shared projects the same way, for context. A failed sync or an unreadable mirror makes Todoist unreachable, never an empty board. Open the source email or chat for every task whose title is a bare link.
6. **Board answers** — per [`day-board.md`](day-board.md) § Read the answers.

Done when both run records are located or their gap recorded in the right words, the newest export per source is read, the tail window is fetched from every reachable connector with every failure logged, the mirror is synced and all three projects are read from it, every link-only title has its source read, and every answered board card is consumed.

### 2. Queue and alarms

Queue = open tasks with no ball label and no `no-sweep` or `merged`, minus not-work items.

Alarms, listed first: a deadline inside 14 days, wherever the task sits; a deadline with no do date; a do date already past; `do` count in Current Work over 10; a `to-NAME` task with a link-only title and no "Summary for handoff" comment; likely duplicates by normalized title.

**Not work stays put.** An Inbox item that reads personal or outside Dan's work — errands, family, household, anything with no AAC thread behind it — stays in the Inbox exactly as it is. The run's one act on it is naming it in the status (line 2); which Inbox items become work at all is the router's call.

Done when every open task is queued, alarmed, carrying a ball label, or named as not work.

### 3. Propose

Build the queue through the ledger's `queue` command, per [`run-ledger.md`](run-ledger.md) § Build the queue. Read [`rulings.md`](rulings.md) before the first ruling and apply every standing ruling it names; read [`sources.md`](sources.md) § Systems of record before ruling on any system notification.

**Rule from the last message.** For every queue and alarm item, sweep from the task's creation date to now — mail, Teams, meeting notes, Todoist activity and comments — and open each referenced thread to its last message. Every ruling records which thread was read and its last message id.

**Dark surface → `unknown`.** When a surface the item depends on could not be read (a connector failed, the export is missing, or the thread predates the export window and its tail connector is unreachable), mark the item `unknown` and name the surface.

One line per item, set per the three axes: title, ball label, project, do date, deadline, one-clause reason. Ask four questions in order and stop at the first that fires:

1. **Delete** — done, superseded, informational, RECORD, recruiter pitch, or 90+ days old with no date, no source and no owner.
2. **Delegate** — ball on a direct, per [`rulings.md`](rulings.md) § Delegation.
3. **Defer** — `do`, backlog, a do date for the resurface.
4. **Do** — `do`, Current Work.

Propose a priority change only for a deadline inside 7 days at p2 or lower. Duplicates are merge proposals: survivor named, the duplicate's unique text quoted.

**Agent sweep.** Then sweep every open task in Current Work, the backlog and the Inbox, whatever its ball, for work an agent could do, per [`agent-sweep.md`](agent-sweep.md). Each candidate is a tier-2 question.

Then give every line a tier (step 4). A tier-1 line names its kind and its proof in one clause; a line whose proof takes more than one clause is tier 2.

Done when every queue item and alarm has a line and a tier, every tier-1 line names its proof, every `unknown` names its surface, and every swept task is either an agent question or left out.

### 4. Tier, apply, ask (Dan, 2026-09-21)

Every ruling lands in exactly one tier.

**Tier 1 — apply without asking.** Exactly two kinds:

- **A delete the source proves.** The thread read to its last message shows the thing happened or is settled; or Dan already ruled the topic out and this is a stray copy made since; or the system of record contradicts the premise (a Leave Dates row that does not exist, a ticket the portal shows closed).
- **An exact-duplicate merge.** Same topic or normalized title as a survivor that already carries a ball and, where the work is dated, a date — and the duplicate adds nothing beyond text the merge comment carries over verbatim.

**Tier 2 — ask every one, in the same turn as the status.** Everything else, including a ruling that *nearly* qualifies: whose ball it is when a name is involved, anything with a deadline, evidence contradicting an existing label, a delete resting on a title, an absence of evidence or age alone, every `unknown`, and every agent-sweep candidate. Rank by consequence, dated items first. Every question is asked this run; in a scheduled run the questions wait in the session and the notification brings Dan to them.

Ask in plain numbered prose — it works in every session type, where a picker tool silently vanishes from some. Each question names the item, the one-clause reason, and **substantive rulings** to choose between — the ball on a named person, the date, delete, defer — and leaves Dan room for his reason, the half of the answer that stops the item returning.

**Every "no" lands durably before the run ends:** the task into Wontfix when task-shaped, `ruled-out` in the run record when the topic never became a task, and `no-agent` on the task when the no answers the agent sweep — the task stays live. A ruling that exists only in the transcript is lost.

**Tier 3 — tell.** Deadlines, past-due counts, the cap, coverage. They go in the status (step 6) and nowhere in the questions.

**Publish to the Day Board** after tier 1 is applied and before the status: the run meta, one card per tier-2 question, and the "Waiting on you" list, in one batch per [`day-board.md`](day-board.md). The board copy is verbatim; the confidential rule covers the generated huddle notes only (issue 1192). The board is a second place to answer; the numbered questions are still asked.

Done when every ruling carries a tier, tier 1 is applied, the board batch is written (or its failure logged), and Dan has answered the tier-2 questions.

### 5. Write

Tier 1 is written without asking; tier 2 after Dan answers, his edits literal and final. Every write lands in Todoist's history, visible and reversible — that is what makes tier 1 safe.

Every write goes through the aac-routines guard, as one plan file (aac-routines issue 609): `python -m aac_routines.todoist_guard triage --plan <plan.json> --mirror state/todoist-mirror.json` from the aac-routines checkout. Never a write through the Todoist connector, of any kind: an update, a reschedule, a comment, a delete, a new project or a new task. The plan is a JSON list of rulings; its shape is in aac-routines' `src/aac_routines/triage_writer.py`.

- **`update`** touches only: `labels` (full replacement — keep `claude` and other non-ball labels), `project_id` (Inbox moves belong to the router), `do_date`, `deadline` when the source names one, `priority` when approved. A `do_date` on a recurring task is refused and the rest of the update still goes: the task keeps its recurrence, and the status names it for Dan to move in Todoist.
- **`delete`** — a task whose delete the source proves.
- **`wontfix`** — Dan's in-session ruling on a live task (Wontfix, above): the entry's `title`, and a `ruling` carrying the ruling, its date and the task's `aac-source`/`aac-topic` markers verbatim. The guard files it in the Wontfix project, then deletes the live task only after the entry landed.
- **`merge`** — the survivor, the duplicate, and a comment carrying the duplicate's unique text and its `aac-source`/`aac-topic` markers copied verbatim (both routines match a marker as a plain substring, so a paraphrase breaks dedupe). The guard refuses a comment that drops a marker, and deletes the duplicate only after the comment landed — every merge, routine-created duplicates included.
- **Keep tasks flat** (Dan, 2026-09-21): the guard refuses a `parent_id`, for a merge or a breakdown. A breakdown Dan dictates that needs tracking is a **`breakdown`**: its own Todoist project and the tasks in it; anything smaller stays one task.
- The guard refuses any write to a task already in Wontfix. Exit 1 lists each refusal and failure: name them in the status. Exit 2 means the plan or the mirror could not be read and nothing was written.
- Titles and descriptions stay as written. The dedupe markers live in a task comment; a task created before that ruling carries them in its description.

Done when every tier-1 and approved tier-2 line is applied and each failure is named.

### 6. Status (Dan, 2026-09-21)

A contract: six lines at most, the first the thing Dan would act on today. Numbers in concrete units ("3", never "several"). Shaped right when the first and last lines alone tell him what needs him and what changed.

1. **What needs him today**, or "nothing today" in those words. A deadline inside 24 hours goes here and only here.
2. **What was applied without asking**, by count and kind — "deleted 3 settled items, merged 2 duplicates" — plus the board-answer count, and personal Inbox items named by title as left alone.
3. **What is about to be asked** — the count and subjects of the questions that follow in this turn.
4. **What is coming**, ranked, at most three: deadlines inside 14 days and past do dates, each with its day count. The only place tier-3 material appears.
5. **What was dark** — which surface failed and which ruling it made `unknown`. Present only when a surface failed.
6. **Where the run records came from** — the two filenames, or plainly which was missing: "none found" only when the store was read and held nothing, "the store was never read this run" when the pull did not happen.

Write in plain English a reader outside this skill would follow: no internal names (`aac-forgotten-tasks`, `aac-routines`, the markers, ball/queue, label names, project ids, connector or tool names, step numbers). Line 6 may spell the record filenames. A task or ticket named anywhere in the output carries its link, per [`agent-sweep.md`](agent-sweep.md) § Links, not ids.

Then the tier-2 questions. **The last line of the output is the Day Board URL,** `https://claude.ai/artifact/PSr7LzYZqhtF8QHAyX8FGq` (Dan, 2026-09-23), and the notification ends with it too — even when the board write failed, beside the line naming the board dark.

**Then append and upload this run's record**, per [`run-ledger.md`](run-ledger.md) § Append this run's record.

Done when the status follows the six-line order, every tier-2 question is asked, the board link closes the output, and this run's record is appended and uploaded.

## Cadence

On demand, plus a scheduled run weekdays at 8:30 AM America/Chicago — a desktop scheduled task since 2026-09-23, with the cloud Routine paused; exactly one of the two runs. 8:30 catches the day's first Power Automate export (08:15 CT, landing 08:16), whose 48-hour mail window carries the overnight mail. The scheduled run is the full pass, steps 1 to 6. The Friday run also asks which backlog `do` items move up for the coming week — a tier-2 question like any other.

## Filters (in Todoist, favorited)

Do (Current Work) · Triage queue · Chase board. Queries: `##Current Work (max 10) & @do`; both projects minus every ball label, `no-sweep`, and `merged`; every `to-*` plus `chase`.
