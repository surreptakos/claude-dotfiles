---
name: osh-rfp-access
description: What an agent working in the osh-rfp repo (AAC's CVS Oak Street Health RFP record) can reach and when to read it - the keyed database and its recipes, sources/ and the scenario data/ folders, Outlook and SharePoint, Google Drive, Zoho Desk, the GitHub tracker and the Apps Script runner. Load at the start of any osh-rfp session, and before asking Dan whether a file, export or fact is on hand ("do you have the parts export?").
metadata:
  modified: '2026-10-01T23:03:48Z'
  previous-modified: none
  revision: '1'
  content-sha: 1c83069cfae6
---

# osh-rfp access

The osh-rfp sessions have reached the same sources again and again, and Dan has had to re-tell
each new session what it can read. This page lists them: each source, the instrument that reads
it, the questions it answers, and its known traps. **Read the source before asking Dan.** A
question goes to him only when it needs a ruling or a fact that no source below holds.

This skill ships in a public repo. File ids, account ids, figures and names stay in osh-rfp; this
page tells you where in osh-rfp to find them. The repo's own notes (`docs/agents/memory/`,
`record/*/data/sources.csv`) outrank this page. When they disagree, follow the note and fix this
skill (`aac-skills/osh-rfp-access/` in claude-dotfiles).

## Order of reading

1. **The keyed database**, if this clone has it, then the files in `sources/`, `record/*/data/`,
   `billpack/` and `record/desk/`. The files are what the repo already holds.
2. **Live state in its own system** (Desk, Outlook, Drive, the tracker, the runner) before any
   item goes to Dan. If the system shows an item done, record it as done; do not ask about it.
3. **Dan last**, only for a ruling or a fact none of the above holds (a subcontractor's headcount,
   a rate). A ticket body, an open-items row, a handoff or a README describes a source. It does not
   replace the source, so trace a figure back to its script and export before repeating it.

**Never open:** the sheets and the Airtable values on the never-open list (login information,
PW&EP users, the Smartsheet-to-Zoho linking sheet, the alarm-code database values;
`record/OSH-RFP-Tasks.md` task 24, ids in `record/OSH-RFP-H7.md`). Never copy an SSN, a date of birth,
an account or routing number, a password or a key into any file.

## Sources

| Source | Instrument | Answers | Read before asking Dan |
| --- | --- | --- | --- |
| Keyed database (osh-rfp #110) | Built by the script named in #110 (planned `python3 tools/build-db.py`), queried with `sqlite3` or Python `sqlite3`; the recipe queries are in the recipe file the script's header names | Joins across exports: which sites bill what, name-only invoices, the Desk tickets for a site, the bills for a work order. Keys: site code and street address, invoice number, Desk ticket number, work order number, BILL.com bill id. Every row names its source file and row | Rebuild after a source file lands; never edit the database by hand. If this clone has no database yet, read the files below directly with the same keys |
| `sources/` exports | `openpyxl` / `pandas` for `.xlsx` and `.xls`, the `csv` module for `.csv` | AlarmBiller S4 and S6 exports: sites, systems, customers, active and cancelled RMR, invoices with paid dates, closed and open work orders, technician time, credits, open appointments, the **item price list (`OSH-S6-Items.xlsx`) and the part catalog (`OSH-S6-Parts.xlsx`)**. Also the CVS RFP files, the four OSH contracts, BILL memo and note exports, Info Sheet tab copies (`sources/infosheet/`) and saved Outlook threads (`sources/outlook/`) | `record/OSH-RFP-S6-Findings-2026-09-28.md` says what each S6 export holds; the join-key table is in `docs/agents/memory/info-sheet-answers-before-people.md` |
| Scenario `data/` folders | the `csv` module (DictReader in, DictWriter out) | `record/OSH-Loss-Scenario/data/`, `record/OSH-Win-Scenario/data/`, `record/Books-Reconciliation/`: model inputs, open items (`open_items.csv`), assumptions, Desk staged-parts evidence, and `sources.csv`, the S-tag register giving every source's location and as-of date | Figures change only through the scenario scripts; `python3 tools/verify-all.py` must pass |
| BILL.com pack and Desk pull | `billpack/*.csv`, `record/desk/*.csv`; `tools/desk_pull.py` re-pulls Desk read-only | Oak Street vendor bills (`osh-bills-matched.csv`, the owner-ruled exceptions), the Desk ticket-to-site map | `billpack/osh-bills-unclaimed.csv` is the org-wide remainder and is **not** Oak Street |
| Outlook, OneDrive, SharePoint | Microsoft 365 connector: `outlook_email_search`, `sharepoint_search`, `sharepoint_folder_search`, `read_resource` | A thread, attachment or workbook a person would otherwise be asked to find; the latest state of an email exchange | Search before asking for a path. Record what you find with its URL or path (`name-the-source-location`) |
| Google Drive and Sheets | Drive connector (`search_files`, `read_file_content`, `download_file_content`); the Sheets API through the `aac-google-access` skill for full tabs | The OSH Security & Fire Info Sheet (DATABASE tab: per-site vendors, monitoring holder, camera and door counts), the RMR Items workbook's OSH RMR Worksheet tab (OSH list rates, S2), site tabs, checklists, jobs reporting sheets | Ids are in the `info-sheet-answers-before-people` note, `record/OSH-RFP-H7.md` and `sources.csv`. Never copy code, password or network columns |
| Zoho Desk | Zoho Desk connector: `searchTickets` with `ticketNumber`, then `getTicket`, `getTicketComments`, `getTicketConversations` by id | Service department: what happened on a ticket, staged parts (shelf codes WI1 to WI5 in comments), whether an item is closed. AP department: fields the bill intake extracted (vendor, amount, invoice number, BILL bill id, work order number) | Department and account ids are in `info-sheet-answers-before-people`. Tickets tie to work orders through `cf_aac_work_order_number` |
| GitHub tracker | `gh` in the clone (issues on `surreptakos/osh-rfp`); `node tools/tracker-audit.js` before trusting it (exit 2 is not a pass) | Rulings, open `ready-for-human` and `ready-for-agent` work, what a session already filed | Read the board's workflows before filing a ticket about a board setting; settings are live state |
| Apps Script runner | `gas` CLI from claude-dotfiles (`gas run surreptakos/aac-bill-intake billMemosExport` or `billNotesExport`, `gas status surreptakos/aac-bill-intake`); the `gas-deploy` skill | Fresh BILL.com memo and note exports, AP intake state | Read the runner's last verdict before saying a pull "is running"; until a verdict comes back, call it "queued" |

## Known traps (each from an osh-rfp memory note)

- **Desk ticket number is not the ticket id.** People and records cite the ticket number (five
  digits, e.g. 48517). `getTicket` takes the 19-digit internal id and returns `URL_NOT_FOUND` for a
  number. Look the number up with `searchTickets` (`ticketNumber`), then use the returned `id`.
- **Drive downloads arrive as base64.** `download_file_content` returns the file as one base64
  string. Decode it to bytes and write it to a file (an `.xlsx` is a zip) before parsing. Never try to
  read the string as text. For a Google-native file pass `exportMimeType` (`text/csv` for one sheet),
  or use `read_file_content` when a text rendering is enough. `read_file_content` can truncate a
  large file. A truncated read is not the file, so pull the full tab through the Sheets API instead.
  In `search_files` the query field is `title`, not `name`.
- **CRLF files.** `record/*/out/**` and `record/*/data/**` are `-text`: they check out exactly as
  committed, and the csv-module rows in them end in CRLF. Do not normalize them. A Windows clone made
  before the rule shows them as modified when their content is unchanged; delete the tracked files and
  `git checkout --` the folders once. Scenario scripts pass `encoding='utf-8'` and `newline='\n'`
  (`newline=''` for a csv writer) and print paths with `.as_posix()`.
- **A comma inside a CSV cell** is written through `csv.writer`, never by hand. The verifiers
  fail any row whose field count differs from the header's.
- **Parts on a work order** come from three sources: BILL.com bills (bought for the job),
  AlarmBiller parts lines (billed to the customer) and Desk comments (staged from stock).
- **OSH list rates** come from S2's OSH RMR Worksheet tab, never from the AlarmBiller item catalog.
- **A bare five-digit number** in a BILL memo is as often a zip code as a work order. Match on the PO
  box or a tagged number ("WO 40949").
- **A dated note records a past state.** A memory note or comment that says a runner, grant or
  ticket was in some state on some date tells you nothing about now, so read the live system again.

## Worked example: "do you have the parts export?"

Answer from this page and the database. Do not ask Dan:

> Yes. `sources/OSH-S6-Parts.xlsx` is the AlarmBiller part catalog, with cost and rate per Part Code;
> `sources/OSH-S6-Items.xlsx` is the item price list, by Item Code. In the keyed database the part
> catalog is the table keyed on Part Code (the recipe file has the query). For parts used on a
> particular work order, I also check the BILL.com bills, the AlarmBiller parts lines and the Desk
> staged-parts comments (`record/OSH-Loss-Scenario/data/desk_staged_parts_2026-09-30.csv`).

Then open the file and confirm the row count and columns before quoting either.
