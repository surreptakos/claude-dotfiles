---
name: pay-stub-model
description: How AAC commission pay stubs are keyed and dated
metadata: 
  node_type: memory
  type: reference
  originSessionId: 296f1dcc-68b8-46e8-bcdd-dd053c61134a
---

Pay Stub Key is `YYYY-MM` = the **pay month**, which is the **month AFTER** the earn/credit month. A commission credited in June pays on the July stub (`2026-07`). Pay date = **2nd Friday** of the stub month (`getPayDate` advances credit month +1 then takes 2nd Friday; `secondFridayOf` takes 2nd Friday of a known stub month). Quarterly kickers pay on the 2nd Friday of the first month of the following quarter.

So "month-end commissions" for June earnings are the `2026-07` stub (pays ~July 10). This is why marking `2026-07` was the correct key, not an operator error. See [[stub-sweep-incident]].
