---
name: bill-notes-api-facts
description: "BILL bill notes are v2-only and permanent — SendMessage.json writes, List/Note.json reads, nothing deletes"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3484473e-d6e6-4af2-ab98-b0b0e9b219c9
  modified: 2026-07-30T18:04:19.441Z
---

BILL bill notes (the thread AP talks in, ~7,000 of them in prod) are reachable only through the v2 API.
The v3 sessionId works on v2 endpoints.

- Read: `POST {v2}/List/Note.json` with `filters:[{field:'objectId',op:'=',value:'<billId>'}]`. Rows
  carry the text under `note`, author under `usersId` only.
- Write: `POST {v2}/SendMessage.json`, `data = {objectId, message, isPublic:false}`. Text field is
  `message` on write, `note` on read. `Crud/Create/Note.json` is a trap: it ignores every field in
  `obj` and always answers "objectId: Required, note: Required".
- `@[~<userId>]` in the text is a real mention. BILL resolves it to the display name and notifies
  that person.
- **A posted note is PERMANENT.** No API call removes or edits one: `Crud/Delete/Note.json` reports
  success and leaves it in place, `Crud/Undelete` the same, `Crud/Update` 500s (BDC_1002). Dan
  confirms AP cannot clear one from the BILL web UI either. Get the wording right before the call —
  see [[bill-note-voice-approved]].
- v3 exposes notes nowhere: `GET /v3/bills/{id}` has no note field and every plausible path 404s.

All verified live against prod 2026-07-30. Full detail lives in the repo at `API_TRACE.md` §12, which
also corrects the v2 `approvalStatus` enum (4=APPROVING, 5=DENIED) — read status from v3.
