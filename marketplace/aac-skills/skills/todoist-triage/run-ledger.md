# Run ledger — prior records, the queue, this run's record

Disclosed reference for [`SKILL.md`](SKILL.md) steps 1, 3 and 6. Run every command from the `aac-routines` checkout (the `Meta/aac-routines` project); the ledger commands resolve nowhere else. These commands and their JSON are plumbing; the status vocabulary rule governs what Dan reads.

## Pull the store (step 1, first)

`state/run-ledger/` is git-ignored, so a fresh checkout's ledger directory is empty until you fill it. The store is the Drive folder `aac-run-ledger`, beside `aacx-inbox`. Resolve and list it as in [`sources.md`](sources.md) § Drive mechanics, fetch the newest `aac-forgotten-tasks-*.json` and `todoist-triage-*.json` into `state/run-ledger/`, then stamp the pull — only if it happened:

```
python -m aac_routines.run_ledger remote                 # store, ledger dir, sync state
python -m aac_routines.run_ledger synced --count <files pulled>
```

A machine that mounts the folder as its ledger directory sets `AAC_ROUTINES_RUN_LEDGER_LOCAL` and has nothing to pull; `remote` then says `local`. Everywhere else, no marker means not pulled.

## Read the prior records

```
python -m aac_routines.run_ledger prior --routine todoist-triage
```

The first line names where the records came from; the rest name the record found for each routine under `state/run-ledger/` (`<routine>-<YYYYMMDDTHHMMSSZ>.json`) with its finish time, or say it is missing. Read the newest forgotten-tasks report too: `state/forgotten-tasks-reports/forgotten-tasks-<date>.md`.

Note each record's timestamp and filename; those lines go into status line 6 verbatim. A missing record is a stated gap, and which gap matters: `none found` is a claim about the store, made only by a run that reached it; a run that did not pull says `not synced`. Missing records change what the run can rule on; the run continues.

## Build the queue (step 3)

Dump the surfaced items — each with `topic_key`, `title`, `observed_at` when the evidence carries a date, `todoist_id` when the item already is a task — and a Todoist snapshot carrying the `Wontfix` project's tasks, then:

```
python -m aac_routines.run_ledger queue --routine todoist-triage \
    --surfaced <surfaced.json> --snapshot <todoist-snapshot.json> \
    --config config/task-capture.json
```

It filters through the forgotten-tasks dismissals file, the Wontfix project and the prior records' non-task rulings, in that order, and returns `queue`, `dismissed`, `stale_ledger_entries`, `prior_records_lines` and `coverage_gaps`.

- `queue` — what to propose from.
- `dismissed` — Dan already ruled: report it as already ruled, naming the ruling, and leave it out of the proposals and questions.
- `stale_ledger_entries` — **Todoist wins**: a ledger ruling never suppresses an item Todoist still shows live, so that item stays queued and the stale ruling goes in the report.
- Without `--snapshot` the Wontfix check did not run: state that Todoist was not read and Dan's Wontfix rulings went unapplied, as an unreachable surface.

## Append this run's record (step 6, after the report)

```
python -m aac_routines.run_ledger record --input <record.json>
```

Then upload the file to the `aac-run-ledger` folder with `mcp__Google-Drive__create_file` (`contentMimeType: application/json`, `disableConversionToGoogleType: true`, so Drive keeps it as JSON). The local copy dies with the session; tomorrow's run sees only the uploaded one.

The record names `todoist-triage` as its routine and holds only this run: `sources_read`, `sources_unreachable`, `prior_records_consumed`, `coverage_gaps`, and `rulings` on topics that never became tasks. It is append-only and carries no task state. `record` refuses an existing filename, and a record silent about the prior records — list them in `prior_records_consumed` or carry the matching "none found" line in `coverage_gaps`. A task-shaped ruling is the task in Wontfix, never a record entry.

**Only `ruled-out` suppresses.** `noted` is a log line and changes nothing about tomorrow's queue. Write `ruled-out` whenever Dan has ruled on a topic. `record` refuses a `noted` ruling whose reason speaks a dismissal, and prints how many of the record's rulings suppress — check that count matches what Dan ruled.
