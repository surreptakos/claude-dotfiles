---
name: live-workbook-id-sa-readable
description: "The live AAC workbook is AAC_Deal_Snapshots_2026, id 1IZZkTMjRRUEPAwQutlkMD5W6oh8Tiy4zQyH5pgqtG7Q, already shared with the service account — read it directly instead of guessing at live state."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 83ee3ddd-d4d3-450c-bc41-19092153e8f4
  modified: 2026-07-29T15:29:28.160Z
---

Live workbook: **`AAC_Deal_Snapshots_2026`**, spreadsheet id **`1IZZkTMjRRUEPAwQutlkMD5W6oh8Tiy4zQyH5pgqtG7Q`**. Already shared with `gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com`, so the superadmin key at `~/.config/gpt-sheets-access-475817-853f8648243b.json` reads it over Sheets REST with no setup. Found by Drive `files.list` on `mimeType='application/vnd.google-apps.spreadsheet'` — that listing works too, and shows every AAC workbook.

**Why this matters:** the id lives only in Script Properties (`LIVE_SPREADSHEET_ID`), so it is not in the repo and there is no public Apps Script function that returns it. Without this note the reflex is to declare live state unknowable and hand the check to Dan. It is not unknowable — 49 tabs are readable in one call, including `Account_Register`, `Report_Records`, `Prior_Promise_Outcomes`, `RunLog`, and `Snapshots`.

**How to apply:** before claiming anything about live state — whether a seed ran, whether a trigger fired, whether a tab has rows — read the sheet. Two questions settled this way on 2026-07-29: `Account_Register` holds 1,158 accounts stamped `2026-06-29` (the seed ran, correctly dated), and `Report_Records` shows week `2026-07-27` published by `Dan Gatsakos (scheduled)` (the Wednesday trigger is armed). A `.scratch` note claiming the opposite had gone stale and would have shipped as fact. Related: [[nothing-lives-only-in-chat]], [[verify-deploy-via-exec-fetch]].
