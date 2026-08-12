---
name: stub-sweep-incident
description: 2026 month-end incident where marking a stub paid swept already-paid rows onto a future stub; root cause + fix
metadata: 
  node_type: memory
  type: project
  originSessionId: 296f1dcc-68b8-46e8-bcdd-dd053c61134a
---

On 2026-07-08, "Mark Stub as Paid" (then Run All) moved 88 already-paid commission rows (stubs 2026-02..06) onto the 2026-08 stub and flipped them to Scheduled, dropping Paid rows 135→47.

**Root cause:** The engine treats a register row as locked/immutable only when `datePaid instanceof Date` ([Core.js](../../Core.js) `readCommissionRegisterOutput`, ~line 9636, and `computeAll` lockedRows filter ~line 850). Those Feb–Jun `Date Paid` cells were stored as **plain `General`-format serial numbers** (getValues returns a Number, not a Date), so they failed the lock test. The open-stub clamp in `generateCommissionRegister` (~line 3631/4398) then pushed every "unlocked" row to `firstOpenStub` = month after the rep's latest *date-typed* paid stub. Marking 2026-07 (which writes a real Date) advanced first-open-stub to 2026-08. July rows survived because they were date-typed.

**Fix (deployed as clasp version 1, HEAD of script 1kt5rVEw…):** (1) added `_coerceSheetDate_` so `readCommissionRegisterOutput` converts numeric date serials → Date; (2) `writeCommissionRegister` `colFmt` now sets a date format on cols 13/15/16 (Date Earned/Scheduled/Paid) so future writes stay date-typed. Not yet committed to git (only clasp-pushed) unless done later.

**Recovery used:** direct Sheets API repair of the 88 rows (wrote correct stub + Paid + real dates), which made them date-typed and lock natively; the overnight daily trigger's Run All then preserved all 135 and regenerated Payment Schedule/statements correctly. See [[sheet-rest-api-access]] and [[pay-stub-model]].

**Lesson:** `instanceof Date` is the single lock signal; any path that lets a date cell become numeric re-opens this. A safety backup tab "Commission Register PRE-REPAIR BACKUP" was left in the workbook.
