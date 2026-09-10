---
name: "todoist-triage"
description: "Triage Dan's Todoist work projects. Use when Dan asks to triage tasks, clear the backlog, run the daily or Friday pass, or decide what to delegate."
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

`find-tasks` on both projects, `responsibleUserFiltering: "all"`, `limit: 100`, `cursor` until `hasMore` is false. Read the four shared projects for context. Open the source email or chat for any task whose title is a bare link. Done when both projects are exhausted and every link-only title has a source read.

### 2. Queue and alarms

Queue = open tasks with no ball label and no `no-sweep` or `merged`. Alarms, listed first: any task with a deadline inside 14 days, wherever it sits; any task with a deadline and no do date; any do date already past; `do` count in Current Work over 10; `to-NAME` task with a link-only title and no "Summary for handoff" comment; likely duplicates by normalized title. Done when every open task is either in the queue, alarmed, or carries a ball label.

### 3. Propose

One line per queue item: title, ball label, project (Current Work if this week, else backlog), do date if Dan should see it again on a day, deadline if the source names one, one-clause reason. Ask the four questions in order and stop at the first that fires: delete (done, superseded, informational, RECORD, recruiter pitch, or 90+ days old with no date, no source, no owner); delegate (ball on a direct; non-directs route to their manager, Palm/Chris/Art/Freeman to Rob, Amanda to Mark); defer (`do`, backlog, do date for the resurface); do (`do`, Current Work). Propose a priority change only for a deadline inside 7 days at p2 or lower. Every `to-NAME` proposal on a link-only title carries a "Summary for handoff" comment in the same batch: what the source said, who said it and when, the ask for that direct, and any file that needs re-sharing to them. Duplicates are merge proposals: survivor named, dup's unique text quoted. Done when every queue item and alarm has a line.

### 4. Ask

Order: alarms, do, delegate, defer, delete, merge, with counts. One `AskUserQuestion`: apply all, apply all except (Dan lists), rulings only. Dan's edits are literal and final. When a ruling rested on a premise the source contradicts, say so and propose the correction. Done when Dan has answered.

### 5. Write

`update-tasks` in batches of 25, touching only `labels` (full replacement, keep `claude` and other non-ball labels), `projectId` or `parentId` (one destination per call), `dueString` for the do date (non-recurring only; recurring tasks use `reschedule-tasks`), `deadlineDate` when the source names one, `priority` when approved. Merges: `add-comments` on the survivor, then `delete-object` on the dup. Summaries: `add-comments`, `notifyUsers: ["none"]`. Subtasks: `add-tasks` with `parentId`, only for a breakdown Dan dictated under a parent he owns; consolidation parents count as dictated when Dan asks to bundle. Titles and descriptions stay as written; descriptions carry the routine's `aac-source`/`aac-topic` dedupe markers. Routine-created duplicates nest under the survivor instead of being deleted, so the markers stay visible to the routine, and pick up a `merged` label (alongside `claude`) so a later pass can't mistake the nested duplicate for an untriaged queue item. Done when every approved line is applied and each failure is named.

### 6. Report

Counts changed, what Dan declined, alarms still open, `do` count in Current Work. Done when Dan can see the board state without opening Todoist.

## Cadence

On demand, plus the scheduled proposal (steps 1 through 3 only; no writes) weekdays at 8:00 AM. Writes happen only in a live session after step 4. The Friday run also proposes which backlog `do` items move up for the coming week.

## Filters (exist in Todoist, favorited)

Do (Current Work) · Triage queue · Chase board. Queries: `##Current Work (max 10) & @do`; both projects minus every ball label, `no-sweep`, and `merged`; every `to-*` plus `chase`.

