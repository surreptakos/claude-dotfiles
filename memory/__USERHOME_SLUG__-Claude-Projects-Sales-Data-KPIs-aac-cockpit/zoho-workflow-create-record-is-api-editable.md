---
name: zoho-workflow-create-record-is-api-editable
description: Workflow-rule create_record field mappings ARE readable and writable via the Zoho API; only the list endpoint hides them.
metadata: 
  node_type: memory
  type: reference
  originSessionId: cb11045a-f3c9-40ed-906f-93c6b5917caf
  modified: 2026-07-30T18:46:11.446Z
---

A workflow rule's `create_record` field mappings are fully available over the API, despite it being easy to conclude otherwise:

- `GET /crm/v8/settings/automation/workflow_rules/{id}` (**by id**) returns `conditions[].instant_actions.actions[].details.field_mappings`. The **list** form (`?module=Deals`) omits `actions` entirely even with `include_inner_details=true` — that omission is what makes it look like a platform gap.
- `PUT` to the same by-id URL works and **merges**, so a targeted body like `{"workflow_rules":[{"conditions": <full array>}]}` updates just the mappings without touching trigger, status or criteria.
- A rule's criteria lives under `conditions[].criteria_details`, **not** `conditions[].criteria` (which reads `null`). Resend `criteria_details` or you strip the criteria — for a Closed-Won rule that would make it fire on every edit.
- `PUT {"workflow_rules":[{}]}` returns 200 and is a no-op that still bumps `modified_by`/`modified_time`. An empty body is *not* a safe capability probe.
- `last_executed_time` is stale/unreliable — it lagged real executions by minutes. Don't use it to decide whether a rule fired; compare records instead.

Verified 2026-07-30 repointing "Closed Won Deals to AAC Projects" (`6551719000033549192`) from `Scope_of_Work` to `Scope_of_Work_v2`. Back the rule up to a file first and diff after, as in [[verify-before-filing-cite-the-check]].

**Scanning workflow_rules is NOT a complete reference search — it missed four live references.** Zoho's "Field Cannot Be Deleted" dialog is the only exhaustive list; it named 3 blueprint create-record transitions and a webhook that no API scan had surfaced. Separate surfaces to check by hand:
- **Blueprint transitions** — `/settings/blueprints?module=X` works (`/settings/automation/blueprints` 404s) and the by-id detail returns ~40KB, but the create-record **field mappings are absent from it**. Blueprint mappings are UI-only.
- **Webhooks** — `/settings/automation/webhooks/{id}` DOES expose the body. Zoho Flow ones (`source: zoho_flow_api`) carry a single ~12KB `user_defined_parameters` payload of merge fields. Change only the merge **value**; the JSON **key** is what the Flow maps on, so renaming it breaks the Flow. Updates are full-replacement, so treat with care.
- Reports and Zoho Flow definitions have no reachable endpoint at all.

So before reporting a field safe to retire, attempt the delete and read the dialog — do not infer completeness from a rules scan.

Module related-list columns and custom views are writable too, but `related_list_properties` has a trap. `PUT /settings/modules/{module}` needs `fields` as objects carrying **both api_name and id** (`[{api_name:'Stage', id:'…'}]`). Bare strings 500 even though reads return strings; objects with api_name **only** return 200 and read back correct, then **silently revert to the default `["Name","Owner"]`** a minute or two later — so verify after a 45s+ pause, never on the immediate read. With ids included it persists. `PUT /settings/custom_views/{id}?module=…` works even on a system-defined default view, and persists fine.

**Field and layout metadata are read-only here.** Any `PUT` to `/settings/fields…` or `/settings/layouts…` returns `INVALID_REQUEST_METHOD`, including a control that changes nothing — so field length/type and layout placement are UI-only. Field *creation* works (`POST /settings/fields?module=…`), and a textarea needs its size class in a sub-object: `{field_label, data_type:'textarea', textarea:{type:'large'}}` for 32,000 (`large`, ui_type 3; `small` is the 2,000 ceiling). Zoho auto-places a new field on the layout, but in the default section, not beside a related field. Deleting a field returns `NOT_ALLOWED "already used in other places"` while it sits on any layout — and since layout writes are closed, **deleting a placed field cannot be finished over the API**.
