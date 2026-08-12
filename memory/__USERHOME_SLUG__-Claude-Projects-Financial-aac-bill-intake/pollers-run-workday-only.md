---
name: pollers-run-workday-only
description: "Three AAC intake pollers skip outside Mon-Fri 06:00-18:00 Central — idle evenings and weekends are correct, not an outage"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2a00f6ee-651c-4223-ba58-ae5ed5d4e0a6
  modified: 2026-08-02T18:22:58.404Z
---

Dan gated the AAC bill-intake pollers to the workday. Three handlers return
`{ok: true, skipped: 'business-hours'}` and do nothing outside **Mon–Fri 06:00–18:00
America/Chicago**:

- `drainIntakeQueue` (IntakeQueue.gs) — so queue rows sit `queued` with `attempts: 0` all evening and
  all weekend
- `runPaymentPoll` (PaymentPoll.gs)
- `runRelayPoll` (Relay.gs) — deliberate: it decides when money moves, so approvals wait for Monday
  morning rather than going out over the weekend

`runWeeklyDigest` is NOT gated. The window lives in `core.js`
(`BUSINESS_HOURS_START` 6, `BUSINESS_HOURS_END` 18, `BUSINESS_DAYS`, `outsideBusinessHours`), and
`businessHoursOverride(true)` suspends it.

**Why:** an idle pipeline out of hours looks exactly like a dead one. On 2026-08-02 (a Sunday) three
AP tickets sat queued for ~10 hours — AP-77 for the longest — and it read as a stopped drain. It was
the gate working. Ruling that out took reading the source, because
[[intake-queue-live]]'s health check could not say so.

**How to apply:** before calling a quiet queue or an unprocessed ticket an incident, check the day
and hour in Central. Outside the window, expect zero drains. When testing on an evening or a weekend,
use `drainQueueOnce` — it has no business-hours gate and no sweep — rather than waiting on the
trigger or concluding the trigger is broken. Related: [[gas-verification-loop]].
