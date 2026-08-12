---
name: intake-queue-live
description: "2026-07-28 go-live — AP intake runs unattended in BILL PRODUCTION; four triggers installed, /exec is enqueue-only"
metadata: 
  node_type: memory
  type: project
  originSessionId: 35ef26be-db88-471c-ae34-1852e3b84f8a
  modified: 2026-07-29T15:39:52.990Z
---

On 2026-07-28 Dan authorized full go-live of the durable intake queue. The pipeline now runs
unattended against **BILL production** (`billEnv: 'PRODUCTION'` — confirm with `clasp run
intakeSweepPreview`, which prints it).

Four triggers are installed (verify with `clasp run listInstalledTriggers`, never assume):
`drainIntakeQueue` 5m, `runRelayPoll` 15m, `runPaymentPoll` 1h, `runWeeklyDigest` weekly.
`processInbox` is deliberately NOT installed — the Desk webhook is the intake route, and the Gmail
poller would be a second bill-creating path over the same mail.

**Why:** the relay and payment pollers had never been scheduled before this — they only ran when
invoked by hand, so "mark Ready to Pay and the bill gets approved" was not actually automatic. The
git history does not record trigger state, so this is not derivable from the repo.

**How to apply:** the /exec deployment (`AKfycbyJ3WCbQj7V…`, @41) is enqueue-only — a webhook records
the ticket and returns; nothing processes inline any more. To run intake directly for verification
use `processDeskTicketLive` or `drainQueueOnce` (drains without sweeping), NOT the webhook. Before
the first drain in any environment run `intakeSweepPreview` — it is read-only and shows which real
tickets a sweep would turn into payables. The first live sweep found 6 tickets and every one came
back DUPLICATE, so zero bills were created; do not assume that holds next time.

Quota was measured on 2026-07-29 (issue #11) and it is **over the ceiling, not near it: 248 min/day
against 90.** Roughly 5x the ~50 min/day install estimate. Method that worked: Cloud Logging
(`script.googleapis.com/console_logs` in `gpt-sheets-access-475817`) grouped by the `process_id`
label — the Apps Script `processes` API returns 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` because the
clasp token lacks `script.processes`.

**`runPaymentPoll` has never completed a single run since go-live** — every hourly execution dies at
the 6-minute ceiling, so paid detection has never worked, and it burns 144 of those 248 minutes doing
nothing. Filed as issue #25. Fixing it drops the total to ~104; widening the relay poll to 30 min gets
under 90. The alternative is a Workspace account (360 min/day ceiling).

**Google is not enforcing the ceiling today** — the 5-minute drain fired 274 times in 24h with zero
gaps at 2.8x the limit and no quota error anywhere in the logs. Treat that as a limit that can start
applying without warning, not as headroom. See [[clasp-run-autonomy]] and [[gas-verification-loop]].
