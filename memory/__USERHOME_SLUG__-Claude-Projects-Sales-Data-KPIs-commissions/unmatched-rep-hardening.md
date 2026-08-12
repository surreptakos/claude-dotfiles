---
name: unmatched-rep-hardening
description: 2026-07-30 auto-run fix is shipped and merged; the Split Credit Partner ERROR is load-bearing and must not get the same severity downgrade
metadata: 
  node_type: memory
  type: project
  originSessionId: 37ec1216-f0da-4898-bb5b-34436eec896e
  modified: 2026-07-30T18:10:46.216Z
---

The 2026-07-30 nightly auto-run block (Zoho test deal Z-4195, an unrecognized Salesperson) is
**fully closed**: fix deployed to the live Apps Script, PR #1 merged as `c3ad8cc`, Z-4195 moved to
`Closed Lost` in Zoho and its Transactions row deleted, `runAllSilent` verified clean (0 errors, 87
transactions, all 11 statements current). Full record in the repo's `DECISIONS.md` → `2026-07-30`.

**The one thing not to get wrong.** The remaining follow-up looks like "do the same severity change
for Split Credit Partner." It is not the same, and doing it would ship a silent underpayment bug.
An unmatched *Salesperson* drops the deal's only transaction — nobody is credited, and it is loud.
An unmatched *partner* is a **second, synthetic** transaction (`ld + '-SP'`), so dropping it leaves
the primary rep on their own reduced `splitPct` and nothing reassigns the orphaned share: on a
50/50 deal, half the credit silently vanishes. The run-blocking ERROR in `validateInputs` is
currently the **only** guard against that, so it stays until the comp owner decides where an
orphaned share goes (primary absorbs / uncredited but reported / keep blocking). That is a policy
question, not an engineering one.

Open work lives in `.scratch/unmatched-rep-hardening/` (PRD + issues 01–03): 01 the policy decision
(`needs-info`), 02 the `if (thing && …)` backstop-no-op architecture pass, 03 the `code-review` on
the PR #1 diff that was skipped before merge.

Related: [[zoho-write-and-deploy-verify]], [[sheet-rest-api-access]], [[running-balance-build]].
