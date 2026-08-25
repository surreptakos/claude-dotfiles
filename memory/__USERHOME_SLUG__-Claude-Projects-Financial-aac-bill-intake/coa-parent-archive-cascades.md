---
name: coa-parent-archive-cascades
description: BILL v3 chart-of-accounts — archiving a PARENT cascades archived:true to ALL children; restore does NOT cascade back; children invisible unless they carry coded history
metadata: 
  node_type: memory
  type: project
  originSessionId: 60c8fab0-4c41-42c2-b944-99f8760aba7c
  modified: 2026-08-22T19:31:20.722Z
---

Measured live in prod 2026-08-22 (issue 274 incident). `POST /v3/classifications/chart-of-accounts/{id}/archive` on a parent account cascades `archived: true` onto every child — archiving "Insurance" (0ca02BZMJPZSQVRdafpj) took down SEVEN children (Company Insurance, Group Medical, Liability Insurance, Auto Insurance, Life Insurance, West Bend, Work Comp). `POST .../restore` on the parent does NOT cascade back — each child must be restored by its own id.

**Why:** two of the seven (West Bend, Work Comp) had no coded history, so `previewProposedGlChoices.codedToButNoLiveAccount` never showed them — the recovery looked complete while 2 postable accounts were still missing. Only the postableAccounts ledger (151 expected vs 149 measured) exposed them.

**How to apply:** never archive a parent account by API. Before any chart archive, run `previewProposedGlChoices` for a postableAccounts baseline; after, verify the ledger balances exactly, not just `codedToButNoLiveAccount: []`. `coaArchivedRows` (Demo.gs, deployed) lists every archived row with `updatedTime` — filter on today's date to see exactly what an action archived. v3 exposes no parent linkage field, so cascade victims are identifiable only by updatedTime. Related: [[stubbed-dup-gate-diagnostic-trap]].
