---
name: zoho-write-and-deploy-verify
description: "Zoho CRM write gotchas (trigger:[] to suppress workflows, skip_feature_execution max 2) and why clasp run-function runAllSilent says \"No response.\""
metadata: 
  node_type: memory
  type: reference
  originSessionId: 37ec1216-f0da-4898-bb5b-34436eec896e
  modified: 2026-07-30T18:10:25.175Z
---

Learned 2026-07-30 deploying the unmatched-Salesperson fix (see the repo's
`DECISIONS.md` → `2026-07-30`, and [[sheet-rest-api-access]]).

**Zoho CRM writes via the MCP `updateRecord` tool:**
- `trigger: []` (empty array) suppresses workflows, approvals and blueprints on the update. Use it
  when changing a field on a test/junk record so no customer-facing automation fires. Omitting
  `trigger` lets Zoho run all of them.
- `skip_feature_execution` accepts **max 2 items** — 3 returns
  `INVALID_DATA … "maximum_length": 2`. Pick the two that matter (`cadences`,
  `connected_workflows`).
- The AAC Zoho deal stages the commission engine treats as closed are only
  `Closed Won`, `Billing: Paid in Full`, `X-Jobs: Scheduled & Ready` (`ZOHO_CLOSED_STAGES`).
  `Closed Lost` is outside that set, so moving a junk deal there stops it re-syncing without
  deleting someone else's record.

**`clasp run-function runAllSilent` prints "No response." on success.** The function returns void,
so that is expected, not a failure. Verify the outcome by reading the sheets with the service
account (Validation Report error count, `Updated:` at B4 of each `Statement - <rep>` tab), never by
the clasp output.

**Sheets reads via the service account are occasionally flaky** — two statement tabs returned empty
on one pass and correct data on the next. Re-read before concluding a value is missing.
