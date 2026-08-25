---
name: project-value-rationale
description: "The full \"why does this exist next to BILL\" case — where each argument lives, plus the two roadmap items documented nowhere"
metadata: 
  node_type: memory
  type: project
  originSessionId: f0043044-66c7-4292-8ce8-e143c7e88547
  modified: 2026-08-25T17:03:51.423Z
---

For any "what's the point / is this worth it" question, the rationale is layered across sources —
answering from CLAUDE.md + session memories alone gives only the mechanism layer (that mistake was
made 2026-08-25 and the owner caught it).

**Read `docs/adr/0002-desk-is-the-ap-interface.md` Context first.** It holds the business case:
- BILL seats are expensive; most of the team has no BILL login; everyone lives in Zoho Desk. Routing
  approvals to individuals via Desk avoids per-seat BILL cost (owner phrasing: "hundreds per month").
- Measured rot of the manual process, 2026-07-17: 37 bills pending ($94k), 21 denied-and-ignored
  ($58k), 38 past due ($75k), 166 invoices stuck in BILL's Inbox — because the one AP clerk was on
  leave. Bus factor is the strongest rebuttal to "AP Admin inbox review handles it".
- BILL Inbox is API-unreachable dead end; BILL has no reminders, escalation, or vendor-facing
  comms (owner hand-built a shame spreadsheet before this).
- ~90–100% of AP is subcontractor service work that already has a Desk dispatch ticket; the
  coordinator who owns it is who can judge the invoice.

Other layers: work-order linking + ticket-owner routing (ADR-0010), Desk approves every bill
(ADR-0009), self-learning rules proved against history before applying (ADR-0006/0007/0008 —
already designed, not future vision), unit economics (~390 bills/month from data/bills-2025.csv,
4,653 rows), dup/BEC/amount money gates (CLAUDE.md; $4,474.38 ADI spaced-number pair is the
exhibit).

**Documented NOWHERE but stated by owner 2026-08-25 as roadmap:** pricing audits at intake
(data/rate-analysis is groundwork), subcontractor portal for submitting invoices — captured as
issues 327 and 328, deliberately unspecified. Owner also wants "direct link to AAC project or Desk
ticket" surfaced as a feature (NOT tracked by those issues — do not claim it is). Capture as
tickets only when owner says build ([[capture-dont-build-on-credits]]).

**External-review correction 2026-08-25 — never claim BILL lacks AP features.** BILL's AP product
advertises invoice capture, approval routing, reminders, duplicate detection, and automated
coding; a guide paragraph claiming it "doesn't read invoices, code them, remind anyone, or catch
mistakes" was ruled false and replaced. The approved framing is the INTEGRATION gap: AAC needed a
workflow connected to Zoho Desk, work orders, ownership rules, and AAC's own coding history.
Related: the payment poll checks `paymentStatus: PAID` + `dueAmount: 0`, not settlement — 702 of
6,676 paid bills are PAID_OFFLINE (PaymentPoll.gs), so never write "payment has cleared".
