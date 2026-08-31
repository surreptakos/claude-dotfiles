---
name: message-board-workbook
description: "Message Board Google Sheet ID and layout for cross-project deal history (3-year, richer than Zoho)."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 1c78d8fe-b268-42ab-a748-2eee45b8d47f
  modified: 2026-08-31T16:14:00.291Z
---

Meta/message-board Google Sheet — 3-year AAC Leads/Jobs history, richer than Zoho for pre-Zoho and manual leads.

- **Workbook ID:** `1dBhSYwk1lHXAosMtbdQ4qI73Rb60BBiB4S6h42ruUQg` (title `Message Board`).
- **SA-readable** via `~/.config/gpt-sheets-access-475817-853f8648243b.json` (verified 2026-08-31, this session).
- **Key tabs:**
  - `Leads / Jobs` (1868 rows, header row **2** not 1) — cols include `Lead #` (col D — join key), `Salesperson` (col K), `Lead Source` (col H), `Project Total` (col O).
  - `Deals` (1930 rows, header row 1) — Zoho-shaped mirror: `Deal Number`, `Deal Owner`, `Account Name`, `Quoted Project Total $`, `Deal Source`, `Customer Referrer`, `Employee Referrer`, `Created Time`.
  - `Users` (168 rows) — rep dropdown roster (not a schema table).

**Join rule:** message-board `Leads / Jobs` col D `Lead #` = Zoho `Deal Number`. Zoho row wins when both exist; message-board fills only where no Zoho match.

**Ruling from Dan (2026-08-31, tickets [[report-contract-convergence]] follow-ups #544/#545):** for any analysis that needs deal history, prefer Zoho where a match exists; fall back to message-board for older records.

Related: [[live-workbook-id-sa-readable]] is the live AAC 2026 snapshots workbook (`1IZZkTMjRRUEPAwQutlkMD5W6oh8Tiy4zQyH5pgqtG7Q`), a different sheet.
