---
name: apps-script-run-attribution-is-not-recoverable
description: Neither Cloud Logging nor processes.list can tell you which Apps Script function ran or whether a trigger ran it — record attribution at write time.
metadata: 
  node_type: memory
  type: reference
  originSessionId: 83ee3ddd-d4d3-450c-bc41-19092153e8f4
  modified: 2026-07-30T17:14:50.359Z
---

To know whether an Apps Script function was run by a trigger or by hand, **the code has to record it at write time.** Both after-the-fact routes were checked live on 2026-07-30 and both failed:

- **Cloud Logging** (GCP project `gpt-sheets-access-475817`, queried with the service account, HTTP 200 so the auth was fine): every entry is `resource.type="app_script_function"` with `function_name` and `invocation_type` both literally `"unknown"`, and there is **no `script_id` label at all**. More than one Apps Script project reports into this GCP project, so entries cannot even be attributed to a script — a 300-entry sample was entirely from the neighbouring Zoho Desk project.
- **Apps Script API `processes.list`** returns `processType` (TRIGGER / EDITOR / WEBAPP), which is exactly the answer — but it needs the `script.processes` scope, and the clasp grant does not have it (403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT`). Granted scopes are `script.projects`, `script.deployments`, `script.webapp.deploy`, `script.scriptapp`, `script.container.ui` — adding one means an interactive re-auth.

**How to apply:** design any audit column that claims provenance to derive it from the trigger event object the handler receives (present for a trigger, absent for a manual run) rather than hardcoding a label. This is not a claim that a function cannot be run — it always can, two ways ([[verify-deploy-via-exec-fetch]]). It is only about *attributing a past run*. Re-test rather than trusting this note if the shared GCP project changes or the clasp grant is re-authorized; the queries above are cheap to repeat. Related: [[verify-before-filing-cite-the-check]], [[live-workbook-id-sa-readable]].
