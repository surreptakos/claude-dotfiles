---
name: desk-channel-intake-progress
description: "Desk-channel build COMPLETE (prod live 2026-07-28); surviving empirical Desk/GAS write-path gotchas from the sandbox build"
metadata:
  node_type: memory
  type: project
  originSessionId: 3d49ce01-d0f0-448b-afa6-781fff136b93
  modified: 2026-08-25T14:14:24.388Z
---

**Status 2026-08-25: the desk-channel-intake feature is DONE and in production** (go-live 2026-07-28,
see [[intake-queue-live]]). The old per-issue progress list this memory held is superseded — the AP
department exists (`1073870000032818112`), prod cutover happened, and the suite is ~2k tests, not 134.
What survives here are the empirical gotchas from the sandbox build that are recorded nowhere else:

- **`PATCH /tickets/{id}` with `status='Closed'` silently no-ops** — the accepted spelling in this
  org is `'Closed or Done'`. No error, no change; verify by re-reading the ticket.
- **Write-back can silently no-op on a wrong `cf_` key** — Desk accepts unknown custom-field keys
  without error. Confirm by re-reading the field, never by HTTP status.
- **Thread-attachment download needs the `/content` suffix** on the attachment URL; without it the
  call returns metadata, not bytes.
- **Digest mail sends via `GmailApp.sendEmail`, not `MailApp`** — MailApp needs the narrower
  `script.send_mail` scope that is NOT in the manifest; GmailApp rides the granted `mail.google.com`.
  Comment at Digest.gs:166 documents it. Stale 2026-07-20 "no permission to call MailApp" ERROR lines
  may linger in old logs; they predate the fix.

See [[gas-verification-loop]] for the deploy/verify method, [[zoho-desk-token-scope]] for the token
story (sandbox portals came and went; token is prod-bound).
