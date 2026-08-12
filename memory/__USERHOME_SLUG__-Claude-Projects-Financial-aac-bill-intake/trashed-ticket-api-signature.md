---
name: trashed-ticket-api-signature
description: A Recycle-Binned Desk ticket answers 200 on plain GET and /comments but 404s /threads and shows empty Attachments; check isTrashed before chasing endpoint errors
metadata: 
  node_type: memory
  type: project
  originSessionId: a26cd633-a291-4992-a7ce-6f91258c2b3e
  modified: 2026-08-07T13:44:18.618Z
---

Measured 2026-08-07 on AP-6 (1073870000033209430): a ticket in the Desk Recycle Bin still answers
200 on `GET /tickets/{id}` (with `isTrashed: true, isDeleted: true` in the body) and on
`/comments`, but `GET /tickets/{id}/threads` answers **404 URL_NOT_FOUND** and the Attachments tab
reads empty. A park alarm citing `GET threads -> 404` therefore means *look at `isTrashed` on the
plain GET first* — the pipeline already fetches it in `deskIdempotencyGate_`.

**Why:** the drain retries and parks on the symptom (threads 404) three layers downstream of the
condition (ticket binned). Diagnosis cost a session; one field read answers it.

**How to apply:** on any AP intake park, run `deskThreadsDiag(ticketId)` (threads HTTP +
Attachments tab) and read `isTrashed` off the ticket. Disposal: `queueDismissParked(ticketId)` is a
HUMAN act by contract ("I have handled this" — its own docstring); restore-from-bin + `enqueueDeskTicket`
+ `drainIntakeQueue` is the retry path. #79 tracks parking with the real reason. PR #78 made
threads-404 fall back to the Attachments tab (correct for tickets whose PDF lives only there).

See [[pollers-run-workday-only]], [[desk-ticket-ids-exceed-2p53]].
