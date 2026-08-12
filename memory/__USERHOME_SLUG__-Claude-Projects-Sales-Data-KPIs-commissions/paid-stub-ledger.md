---
name: paid-stub-ledger
description: Paid Stub Ledger sheet freezes paid stubs immutable; sticky corrections + NET floor; how to freeze/repair
metadata: 
  node_type: memory
  type: project
  originSessionId: b4f29927-d81b-4cc7-93a5-05cb44ac0e73
---

Added a **Paid Stub Ledger** sheet (2026-07-09) so a paid stub's payment-schedule ledger is immutable, not just its register rows. Once a rep|stub is frozen there, `calculatePaymentSchedule` replays the snapshot verbatim — Carry-Over, Corrections from Prior Paid Stubs, and NET PAID never move after payment. Fixes the bug where marking a stub paid migrated its correction to the next open stub (double-count). NET PAID is floored at $0 (negatives still carry forward). Details in DECISIONS.md (2026-07-09 entry).

**Freeze workflow (Dan's chosen design):**
- Auto-freeze on **Mark Stub as Paid** going forward (freezes from a *pre-mark* schedule so the correction is captured before rows flip to Paid).
- Manual **Maintenance → Freeze Paid Stub Ledger…** for historical stubs — supports overwrite.
- **No auto-backfill.** The ~135 historical paid stubs were corrupted by the old bug and must be **repaired first, then frozen when ready**. Until frozen they still recompute live.

**Conflict alerts:** if a frozen stub's live recompute diverges from the snapshot, the snapshot is honored and the admin is emailed (`ADMIN_EMAIL` Script Property, deduped) + a Validation Report WARNING. Confirm `ADMIN_EMAIL` is set.

**PENDING hardening — design FINALIZED 2026-07-13, implementation in progress in a separate session.** Full design is captured in the repo: `CONTEXT.md` (glossary), `docs/adr/0001-0003`, `HARDENING-SPEC.md`, and a PRD + 6 sequenced issues under `.scratch/paid-stub-immutability/` (local-markdown tracker). Seam test harness at `tests/verify_ledger.js` (Node-VM over `computeAll`; 15/15 green). Core decisions: (ADR-0001) one per-rep **Running Balance = Σ(Actual Paid − Earned)**, self-settling, replacing the separate draw-carry AND Pay Stub Corrections; (ADR-0002) draw floor sacrosanct, unrecovered balance left open at termination; (ADR-0003) **re-itemize whole new deals** on the next open stub but carry only deltas/draws/write-offs through the balance (rep visibility). "Closed" = a frozen snapshot exists (freeze = the act of closing). Write-offs = operator Balance Adjustments (repurposed Pay Stub Corrections sheet). Conflict email retired → Validation Report line. Reconciliation source of truth = Rippling export (actual paid = Commission+Draw). Implement issues 01→06 in order, each in a fresh session; touches core carry/lock logic so verify at the `tests/verify_ledger.js` seam.

Builds on [[stub-sweep-incident]] (the row-level lock) and reuses the REST-API access pattern in [[sheet-rest-api-access]] for any live repair. Pay-month semantics: [[pay-stub-model]].
