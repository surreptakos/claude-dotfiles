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

Read the newest file per source. The newest stamp is the tail-window start.

## Live tail

Fill exactly the window "newest export stamp → now", from:

- Gmail — `mcp__Gmail__search_threads`
- Teams — `mcp__ms365__chat_message_search`, `mcp__ms365__teams_list_channel_messages`
- Meeting notes — Granola
- Todoist history — `find-activity`

The window starts at the export stamp. Log every connector that fails or returns no access.

## Systems of record (Dan, 2026-09-18, issue 204)

Notification mail from a system whose state lives in its own portal proves an event was raised, not that it is still outstanding. Read the system, or file the mail.

- **Readable — rule from the system.**
  - Leave Dates: `python -m aac_routines.leave_dates pending` from the aac-routines checkout, before any leave item is ruled on (`out` too when the week's absences matter). `awaiting_me` is Dan's queue, `requested` is every open request company-wide, `out` says who is out. A `hello@leavedates.com` mail with no matching `awaiting_me` row is filed. Exit 2 makes Leave Dates unreachable.
  - Zoho Desk tickets: `python3 tools/zoho-rest.py get https://desk.zoho.com/api/v1/tickets/<id>` from the claude-dotfiles repo.
  - A failed read makes the item `unknown`, naming that surface; the mail never stands in.
- **Mail carries the state.** ExcalTech tickets: every transition (opened, updated, resolved) is mailed and replies travel by mail, so the newest mail in the thread is the evidence.
- **Fenced — no readable surface.** Rippling (pay-run approvals, assigned tasks), Bill.com (bills, vendor credits), Zoho Flow failure alerts, the `sec-portal.io` quarantine digest, Intuit Data Protect backup alerts, Microsoft 365 admin alerts, vendor status mail (Brivo, RingCentral, Avigilon Alta), Smartsheet report mail. File the mail as informational: it becomes no task, no "outstanding" ruling, and no approve, pay or release proposal. A task Dan typed about one of these is triaged as his words.
