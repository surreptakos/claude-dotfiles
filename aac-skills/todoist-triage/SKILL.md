---
name: "todoist-triage"
description: "Triage Dan's Todoist work projects. Use when Dan asks to triage tasks, clear the backlog, run the daily or Friday pass, or decide what to delegate."
metadata:
  modified: "2026-09-16T03:54:16Z"
  previous-modified: "2026-09-15T19:42:45Z"
  revision: "3"
  content-sha: "febd9b2084f7"
---

# todoist-triage

Dan rules; the skill reads, proposes, and writes once after approval. aac-routines (live) is intake only and never touches a task after creating it; this skill picks up from there. Labels are rulings, applied once, changed only when Dan says.

## Scope

- `Current Work (max 10)` `6JHrw6mXXgrrWqxG` and `Work tasks backlog` `6XMPVX96VgH6vwHR`.
- Shared direct projects are O3 agenda lists; read for context, never delegate into them. Steffi `6gQ3FMwQpP4hpqjX`, Rob `6gQ3Cj2Q8MxRGMG5`, Nick `6gQ3CWrr768p37PJ`, Mark `6gQ3FJRJrgvQ8GjR`. Lynne has none.

## Three axes: label says whose ball, project says which week, dates say the calendar

Every open task carries exactly one ball label, or it is in the triage queue.

| Ball on | Label |
|---|---|
| Dan | `do` |
| a direct | `to-lynne` `to-steffi` `to-nick` `to-rob` `to-mark` |
| an outside party (vendor, counsel, accountant, customer), or Dan's own work blocked on one | `chase` |
| nobody yet | none: the triage queue |

The project carries the week. Current Work = this week, capped around 10 `do`. Backlog = later.

Dates carry the calendar, and Todoist's two date fields mean different things. The **do date** (Todoist's "due date" field) is Dan's plan: the day he intends to work it or look at it again; movable without penalty. A backlog `do` with a do date is deferred work that resurfaces on that day; without one it is an open pool the Friday pass draws from. The **deadline** (Todoist's "deadline" field) is the world's constraint: the day after which something bad happens (IDFPR, tax extension, lien). Dan does not move it; it moves him. Set a deadline only when the source names one.

`claude` marks routine-created tasks and stays on. `no-sweep` marks tasks Dan runs himself; skip them. `merged` marks a routine-created duplicate nested under its survivor after a merge — its `aac-source`/`aac-topic` stays live in the description for the routine to match against, but the task itself carries no ball and is not re-triaged; the survivor holds the ball for both.

**Wontfix is a ruling, and it is Dan's to file.** A task-shaped ruling lives as the task itself sitting in the `Wontfix` Todoist project (`wontfix_project_id` in the routine repository's `config/task-capture.json`), not in any run record. One ruling covers both routines: this skill's queue and the `aac-forgotten-tasks` guard read Wontfix through the same matcher with the same evidence bound, so an item Dan has ruled out stays suppressed on both sides until evidence newer than the ruling arrives, and then it resurfaces. Neither routine writes to Wontfix. Never move, complete or delete a task there, and never propose a write into it — Dan puts an item in Wontfix and Dan takes it out.

**Find the ball by reading the last move.** Open the source and read the most recent message. Whoever owes the next move holds the ball. A direct asking Dan three questions puts the ball on Dan (`do`), however much the topic looks like theirs. Dan's verbs (decide, approve, sign, show, answer, call counsel) put the ball on Dan. A direct's prep or scheduling around Dan's decision is a comment, not a label. `do` plus `to-NAME` together only when Dan rules and the direct then owns execution, rarely.

Priority sorts within a ball, never sets it. The 10-item `do` cap in Current Work is Dan's rule; when he exceeds it, report the count.

## Standing rulings (Dan, 2026-09-02)

- HR, Rippling, and registered-agent configuration: Dan. Verification from records can go `to-lynne`.
- Markup and margin work: `chase` until Accounting Freedom finishes the books.
- Safety manual: adoption `to-rob`; carrier loss-control reviews the text (`chase`).
- Contractors license exam: Dan, dated.
- WIN-PAK and legacy-platform conversions: Mark.
- Job descriptions, pay bands, employee pricing for AAC services, retention metrics, vendor price lists that feed RMR pricing, and any regulatory or insurance signature: Dan.
- Handoffs to directs happen in O3s. Draft a message only when Dan asks.

## Standing rulings (Dan, 2026-09-10)

- ThreatLocker (ExcalTech approval requests for scripts on Dan's machines): ignore. Do not triage or alarm; when the routine creates one, propose Delete in the same pass and delete on approval. Other ExcalTech tickets are still triaged normally.

## Procedure

### 1. Read

Load the two prior run records first, then the exports, then the live tail.

- **Prior run records.** Read the newest `aac-forgotten-tasks` run record and the previous `todoist-triage` run record before building the queue. Run, from the `aac-routines` checkout (the `Meta/aac-routines` project — the ledger commands resolve nowhere else):

  ```
  python -m aac_routines.run_ledger prior --routine todoist-triage
  ```

  It prints one line per routine, naming the record it found under `state/run-ledger/` (one JSON file per run, `<routine>-<YYYYMMDDTHHMMSSZ>.json`) with the time that run finished, or saying `none found`. Read the newest forgotten-tasks report alongside them: `state/forgotten-tasks-reports/forgotten-tasks-<date>.md`. Note each record's timestamp and filename; both lines go into the report in step 6 verbatim, and "none found" is a stated gap, never silence. Missing records are not a stop — they change what the run can rule on.
- **Exports (primary source of source material).** Every ruling rests on the message and thread bodies exported to Google Drive by the `aac-forgotten-tasks` routine, not on live-connector snippets. In a cloud session, pull them with `mcp__Google_Drive__search_files` (query `name contains 'aac-forgotten-tasks' and mimeType != 'application/vnd.google-apps.folder'`, `orderBy: 'modifiedTime desc'`), then `mcp__Google_Drive__read_file_content` on the newest bundle. Record its modified time — that is the tail-window start.
- **Live tail (tail-fill only).** Fill the window "newest export stamp → now" from Gmail (`mcp__Gmail__search_threads`), Teams (`mcp__ms365__chat_message_search`, `mcp__ms365__teams_list_channel_messages`), meeting notes (Granola), and Todoist history (`find-activity`). Never widen this window past the export stamp; never let the connectors stand in as the primary reader. Any connector that fails or returns no access is recorded and carried into step 6 as an unreachable surface.
- **Todoist queue.** `find-tasks` on both projects, `responsibleUserFiltering: "all"`, `limit: 100`, `cursor` until `hasMore` is false. Read the four shared projects for context. Open the source email or chat for any task whose title is a bare link.

Done when both run records are located or their absence recorded, the newest export is read, the tail window is fetched from every reachable connector (and every failure is logged), both projects are exhausted, and every link-only title has its source read.

### 2. Queue and alarms

Queue = open tasks with no ball label and no `no-sweep` or `merged`. Alarms, listed first: any task with a deadline inside 14 days, wherever it sits; any task with a deadline and no do date; any do date already past; `do` count in Current Work over 10; `to-NAME` task with a link-only title and no "Summary for handoff" comment; likely duplicates by normalized title. Done when every open task is either in the queue, alarmed, or carries a ball label.

### 3. Propose

**Build the queue through the ledger, not by hand.** Dump the surfaced items — each with `topic_key`, `title`, `observed_at` when the evidence carries a date, and `todoist_id` when the item already is a Todoist task — and a Todoist snapshot carrying the `Wontfix` project's tasks, then run from the same checkout:

```
python -m aac_routines.run_ledger queue --routine todoist-triage \
    --surfaced <surfaced.json> --snapshot <todoist-snapshot.json> \
    --config config/task-capture.json
```

It reads the prior records first, then filters through the forgotten-tasks dismissals file, the Wontfix project and the non-task rulings the prior records carry, in that order, and returns `queue` (what to propose from), `dismissed`, `stale_ledger_entries`, `prior_records_lines` and `coverage_gaps`. A `dismissed` item is suppressed: it is not re-proposed and not re-asked, because Dan already ruled on it — report it as already ruled, naming the ruling it rests on. **Todoist wins:** a ledger ruling can never suppress an item Todoist still shows as a live task, so that item stays in the queue and the ruling comes back in `stale_ledger_entries` for the report. Omitting `--snapshot` does not skip the Wontfix check quietly — the run states that Todoist was not read and that Dan's Wontfix rulings went unapplied that pass, and that line is an unreachable surface for step 6.

**Since-task-created check, before any ruling.** For every queue and alarm item, sweep from the task's creation date to now for a resolution: mail, Teams, meeting notes, Todoist activity and comments. A resolution is found by opening the referenced thread and reading it to its last message — never by keyword search alone. A keyword search finds a topic; only the last message tells you whether the topic is still open.

Worked example (2026-09-15 miss): Dan reversed the "short O3 agenda" decision. A keyword search on "short" hit the earlier "make it short" line and would have ruled the item done. The last message of the thread — "I know I asked you to make it short, but I'm reversing course" — was the actual state. Rule from the last message, not the first hit. Every ruling records which thread was read and which message id was its last.

If a surface the item depends on could not be read (a connector failed, the export is missing, or the thread predates the export window and the tail connector for it is unreachable), do not assert a ruling. Mark it `unknown`, name the missing surface, and carry it into step 6 so Dan sees exactly which surface was dark.

One line per queue item: title, ball label, project (Current Work if this week, else backlog), do date if Dan should see it again on a day, deadline if the source names one, one-clause reason. Ask the four questions in order and stop at the first that fires: delete (done, superseded, informational, RECORD, recruiter pitch, or 90+ days old with no date, no source, no owner); delegate (ball on a direct; non-directs route to their manager, Palm/Chris/Art/Freeman to Rob, Amanda to Mark); defer (`do`, backlog, do date for the resurface); do (`do`, Current Work). Propose a priority change only for a deadline inside 7 days at p2 or lower. Every `to-NAME` proposal on a link-only title carries a "Summary for handoff" comment in the same batch: what the source said, who said it and when, the ask for that direct, and any file that needs re-sharing to them. Duplicates are merge proposals: survivor named, dup's unique text quoted. Done when every queue item and alarm has a line, and every `unknown` names the unreachable surface it depended on.

### 4. Ask

Order: alarms, do, delegate, defer, delete, merge, with counts. One `AskUserQuestion`: apply all, apply all except (Dan lists), rulings only. Dan's edits are literal and final. When a ruling rested on a premise the source contradicts, say so and propose the correction. Done when Dan has answered.

### 5. Write

`update-tasks` in batches of 25, touching only `labels` (full replacement, keep `claude` and other non-ball labels), `projectId` or `parentId` (one destination per call), `dueString` for the do date (non-recurring only; recurring tasks use `reschedule-tasks`), `deadlineDate` when the source names one, `priority` when approved. Merges: `add-comments` on the survivor, then `delete-object` on the dup. Summaries: `add-comments`, `notifyUsers: ["none"]`. Subtasks: `add-tasks` with `parentId`, only for a breakdown Dan dictated under a parent he owns; consolidation parents count as dictated when Dan asks to bundle. Titles and descriptions stay as written; descriptions carry the routine's `aac-source`/`aac-topic` dedupe markers. Routine-created duplicates nest under the survivor instead of being deleted, so the markers stay visible to the routine, and pick up a `merged` label (alongside `claude`) so a later pass can't mistake the nested duplicate for an untriaged queue item. Done when every approved line is applied and each failure is named.

### 6. Report

Output contract, in this order:

1. **Deadline-inside-24 h items first.** Every task with a deadline in the next 24 hours goes at the top, before any other section, so it is the first thing Dan reads.
2. **Prior run records read.** Name the `aac-forgotten-tasks` run record and the previous `todoist-triage` run record that step 1 loaded — timestamp and filename each. For either that was missing, say "none found" plainly, so Dan sees the run built its queue without it.
3. **Unreachable surfaces.** List every connector or export step 1 could not read this run. Beside each `unknown` ruling, name the surface it depended on. Every `unknown` from step 3 appears here, tied to the surface that was dark.
4. **Counts changed, what Dan declined, alarms still open, active-list count over cap.**

Vocabulary: plain English throughout. No internal names in the body — nothing like `aac-forgotten-tasks`, `aac-routines`, `aac-source`/`aac-topic`, `ball`, `queue`, `do`/`to-*`/`chase`, `merged`, `no-sweep`, the `claude` label, project ids, connector or MCP tool names, or "step N of the procedure". Say what happened and what needs Dan's attention in words a reader outside this skill would understand. The prior-run-records line is the one exception: it may spell the record filenames so Dan can go find them.

**Then append this run's record.** After the report, from the `aac-routines` checkout:

```
python -m aac_routines.run_ledger record --input <record.json>
```

The record names `todoist-triage` as its routine and holds only what happened this run — `sources_read`, `sources_unreachable`, `prior_records_consumed`, `coverage_gaps`, and `rulings` on topics that never became tasks. It is append-only and carries no task state: a filename that already exists is refused, and so is a record silent about the prior records, which must either list them in `prior_records_consumed` or carry the matching "none found" line in `coverage_gaps`. A task-shaped ruling never goes in it; that one is the task Dan put in Wontfix. These commands and their JSON are the skill's plumbing, not report text — the vocabulary rule above governs what Dan reads.

Done when Dan can see the board state without opening Todoist, knows which surfaces were dark and which rulings that made unknown, and this run's record is appended.

## Cadence

On demand, plus the scheduled proposal (steps 1 through 3 only; no writes) weekdays at 8:00 AM. Writes happen only in a live session after step 4. The Friday run also proposes which backlog `do` items move up for the coming week.

## Filters (exist in Todoist, favorited)

Do (Current Work) · Triage queue · Chase board. Queries: `##Current Work (max 10) & @do`; both projects minus every ball label, `no-sweep`, and `merged`; every `to-*` plus `chase`.

