# Sources — where todoist-triage evidence comes from

Disclosed reference for [`SKILL.md`](SKILL.md) step 1 and every ruling in step 3. Every ruling rests on a source read here; a source that fails to read is an **unreachable surface** for the status (step 6), and the rulings that depended on it are `unknown`.

## Drive mechanics

Both the exports and the run-record store live in Google Drive, read with the same two tools:

- Folder id: `mcp__Google-Drive__search_files` with `title contains '<folder>' and mimeType = 'application/vnd.google-apps.folder'`.
- Contents: `parentId = '<id>'` (add `and modifiedTime > '<recent>'` for the exports).
- The query field is `title`; `name` is rejected as an unsupported field.
- The tool has no `orderBy`: sort the returned `modifiedTime` values yourself, newest first.
- Read a file with `mcp__Google-Drive__read_file_content`.

## Exports (the primary reader)

Rule from the message and thread bodies Power Automate exports to Drive; live-connector snippets fill the tail only. The folder is `folder_name` in aac-routines' `config/m365-exports.json` — today **`aacx-inbox`**. Each file is named for its **source**: `<source>__<key>__<YYYY-MM-DDTHHMM>.json` — `outlook_inbox__inbox__2026-09-17T2016.json`, `outlook_sent__sent__...`, `teams__nick__...`, `calendar__global__...`. Search by source name; a search for the routine's name finds nothing and proves nothing about the exports.

Sync them first, from the aac-routines checkout: `python scripts/sync_m365_exports.py --profile todoist-triage --lookback-days 7 --output <run-dir>/snapshot.json`, with `<run-dir>` outside the repository (aac-routines issue 605). `todoist-triage` is triage's own profile in `config/m365-exports.json` and the only one it syncs (aac-routines issue 609). Read the newest file per source. The newest stamp is the tail-window start.

## Thread reuse

Last evening's forgotten-tasks run read its shortlisted threads in full; its report's `Threads read` section names each with the time of its last message (aac-routines issue 606). Build this run's threads from the snapshot, then plan, from the aac-routines checkout:

```
python scripts/capture_prefilter.py build --snapshot <run-dir>/snapshot.json --out-dir <run-dir>
python -m aac_routines.thread_reuse plan --report <forgotten-tasks-report.md> --threads <run-dir>/threads.jsonl [--thread <id> ...]
```

The report is the newest forgotten-tasks report: `python -m aac_routines.run_ledger report-latest` prints it, and exit 1 means fetch it from the `aac-run-ledger` Drive folder. Each thread comes back `reused` (no newer message: the report's blocks stand, do not open it), `reopen` (a newer message: read it in full) or `read` (never read last evening: read it). `extract` lists the threads to pass to `capture_prefilter extract`. With no report from the previous evening, omit `--report`: every thread is read, and the plan carries the gap. Paste the plan's `lines` into the status, its first line into the record's `sources_read` and its gap into `coverage_gaps`.

## Live tail

Fill exactly the window "newest export stamp → now", at most one hour (aac-routines ADR 0010, point 3; the Day Board's huddle draft reads the same window). Wide live sweeps drew Microsoft Graph 429s, and the hourly exports put every run within an hour of one. A longer tail, an unexported source or a truncation hole is a coverage gap named in the status, never a live sweep. Read the window from:

- Gmail — `mcp__Gmail__search_threads`
- Teams — `mcp__ms365__chat_message_search`, `mcp__ms365__teams_list_channel_messages`
- Meeting notes — Granola
- Todoist history — `python -m aac_routines.completed_task_events --date-from <tail start> --date-to <now>` from the aac-routines checkout, never the Todoist connector's activity read (aac-routines issue 639). ISO datetimes, `Z` or an offset; `--day yesterday` reads a whole local day. Exit 1 makes Todoist history unreachable

Log every connector that fails or returns no access.

## Systems of record (Dan, 2026-09-18, issue 204)

Notification mail from a system whose state lives in its own portal proves an event was raised, not that it is still outstanding. Read the system, or file the mail.

- **Readable — rule from the system.**
  - Leave Dates: `python -m aac_routines.leave_dates pending` from the aac-routines checkout, before any leave item is ruled on (`out` too when the week's absences matter). `awaiting_me` is Dan's queue, `requested` is every open request company-wide, `out` says who is out. A `hello@leavedates.com` mail with no matching `awaiting_me` row is filed. Exit 2 makes Leave Dates unreachable.
  - Zoho Desk tickets: `python3 tools/zoho-rest.py get https://desk.zoho.com/api/v1/tickets/<id>` from the claude-dotfiles repo.
  - A failed read makes the item `unknown`, naming that surface; the mail never stands in.
- **Mail carries the state.** ExcalTech tickets: every transition (opened, updated, resolved) is mailed and replies travel by mail, so the newest mail in the thread is the evidence.
- **Fenced — no readable surface.** Rippling (pay-run approvals, assigned tasks), Bill.com (bills, vendor credits), Zoho Flow failure alerts, the `sec-portal.io` quarantine digest, Intuit Data Protect backup alerts, Microsoft 365 admin alerts, vendor status mail (Brivo, RingCentral, Avigilon Alta), Smartsheet report mail. File the mail as informational: it becomes no task, no "outstanding" ruling, and no approve, pay or release proposal. A task Dan typed about one of these is triaged as his words.
