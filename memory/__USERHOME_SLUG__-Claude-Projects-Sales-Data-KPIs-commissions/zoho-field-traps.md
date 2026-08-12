---
name: zoho-field-traps
description: Zoho API-name/label mismatches that caused wrong conclusions — AAC_Projects.Owner is the PM, Project_Manager is the sales rep
metadata:
  type: reference
---

On `AAC_Projects`, field **labels and API names are crossed**: label "Project Manager" = API `Owner` (holds real PMs: Freeman, Henderson); label "Sales Rep" = API `Project_Manager` (holds reps: Rojek, Kolia); `User_4` ("Project Manager 0") is a dead duplicate, null on ~90%. Reading `Project_Manager` as PM wrongly concluded reps work as PMs — they never do.

Also: `Deals.Project_GPM` equals `Amount × markup/(markup+1)` on all 98 live deals (formula field, returns 0 at -100 markup — cannot carry absorbed cost). `Jobs_Billing.W_O` is a Connected Records relation, null on 121/122, COQL-only. CO deals CAN legitimately be New Logo + Self-Sourced (1-year new-logo window; rep can upsell a CO).
