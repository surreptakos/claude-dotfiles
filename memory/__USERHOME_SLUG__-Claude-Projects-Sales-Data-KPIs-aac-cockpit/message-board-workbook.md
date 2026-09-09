---
name: message-board-workbook
description: "Message Board Google Sheet ID and layout for cross-project deal history; the Deals tab is EMPTY — Leads / Jobs is the only populated history."
metadata:
  node_type: memory
  type: reference
  originSessionId: 1c78d8fe-b268-42ab-a748-2eee45b8d47f
  modified: 2026-09-04T01:43:58.240Z
---

Meta/message-board Google Sheet — 3-year AAC Leads/Jobs history, richer than Zoho for pre-Zoho and manual leads.

- **Workbook ID:** `1dBhSYwk1lHXAosMtbdQ4qI73Rb60BBiB4S6h42ruUQg` (title `Message Board`).
- **SA-readable** via `~/.config/gpt-sheets-access-475817-853f8648243b.json` (verified 2026-08-31 and again 2026-09-04).
- **Key tabs:**
  - `Leads / Jobs` (grid 1868×102, header row **2** not 1) — the ONLY populated history. Cols include `Lead #` (col D — join key), `Salesperson` (col K), `Lead Source` (col H), `Project Total` (col O).
  - `Deals` (grid 1935×122) — **EMPTY apart from its header row.** Do not plan an analysis around it.
  - `Users` (grid 168×15) — rep dropdown roster (not a schema table).

**The `Deals` tab carries no data (verified live 2026-09-04, Sheets REST as the service account).** A values read of `'Deals'!A1:E4000` returns exactly one row, the header (`Record Id`, `Deal Owner.id`, `Deal Owner`, `Quoted Project Total $`, `Deal Name`). The earlier note here said "1930 rows … Zoho-shaped mirror", which was the GRID row count read as a data-row count — the trap this file now exists to stop. A ticket-fleet run hit it on 2026-09-03 while building the house-account analysis for issue #545 and had to fall back to `Leads / Jobs`.

**A tab's `gridProperties.rowCount` is not a row count.** Google reports the allocated grid, empty rows included. Confirm population with a values read and count the rows that carry a value; `[[broken-join-looks-like-zero-coverage]]` is the same failure seen from the other end.

**Join rule:** message-board `Leads / Jobs` col D `Lead #` = Zoho `Deal Number`. Zoho row wins when both exist; message-board fills only where no Zoho match.

**Ruling from Dan (2026-08-31, tickets [[report-contract-convergence]] follow-ups #544/#545):** for any analysis that needs deal history, prefer Zoho where a match exists; fall back to message-board for older records.

Related: [[live-workbook-id-sa-readable]] is the live AAC 2026 snapshots workbook (`1IZZkTMjRRUEPAwQutlkMD5W6oh8Tiy4zQyH5pgqtG7Q`), a different sheet.
