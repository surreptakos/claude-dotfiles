---
name: desk-provisioning-api-facts
description: "What the Zoho Desk REST API can and cannot provision for the AP channel (fields, choices, statuses, departments, writes) — verified live on sandbox 932165744"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3d49ce01-d0f0-448b-afa6-781fff136b93
  modified: 2026-07-28T14:30:10.088Z
---

Verified live 2026-07-20 against Desk sandbox `932165744` with a token carrying `Desk.settings.ALL`
+ `Desk.tickets.ALL` (see [[zoho-desk-token-scope]]). Base `https://desk.zoho.com/api/v1`.

**Works via API:**
- **Custom fields** — `POST /organizationFields?module=tickets` creates them. Read type enum from a
  live GET before creating. AP field api names (persisted in `DESK_AP_FIELD_MAP` Script Property):
  `cf_vendor_1, cf_invoice_number, cf_amount, cf_proposed_gl, cf_invoice_due_date, cf_confidence,
  cf_tier, cf_flags, cf_bill_bill_id, cf_linked_dispatch_ticket_id, cf_rejection_reason`. ("Due Date"
  label collides with a built-in system field → custom one is labeled "Invoice Due Date".)
- **Writing custom-field VALUES on a ticket** — `PATCH /tickets/{id}` body `{"cf":{"cf_apiName":value}}`
  → 200. Works even for a Picklist field with NO seeded choices (proven with `cf_tier='held'`). So the
  ENGINE can write any field value now; picklist choices only matter for a human UI dropdown.
- **Comments** — `POST /tickets/{id}/comments` `{content, isPublic}` → 200.
- **Contact/ticket create** — `POST /contacts`, `POST /tickets` (needs `subject, departmentId,
  contactId`) → 200.
- **Webhooks** — creatable with settings scope (throwaway test on default dept returned 200). The
  OAS "url ≤100 chars" cap is not enforced (111-char /exec URL stored verbatim).

**NOT possible via API (need Desk admin UI, or a different scope):**
- **Create a department** — `POST /departments` needs `Desk.basic.CREATE` too; with only settings
  scope it 403s FORBIDDEN once the payload is valid. Either add that scope (another grant re-mint) or
  create the one AP department in the UI (preferred — cheaper, avoids re-mint churn).
- **Seed picklist CHOICES** — choices are layout-scoped, not on the field. `POST /organizationFields`
  rejects `allowedValues`; `PATCH /organizationFields/{id}` rejects `allowedValues` as an extra param;
  layout `replaceValues` needs a non-empty `oldValue` anchor so it can't bootstrap a first choice.
  → seed the human-picked dropdowns (rejection-reason etc.) in the UI. Engine writes don't need them.
- **Create custom ticket STATUSES** — the built-in `status` field `replaceValues` 500s (its values
  carry a `statusType` the plain-string schema can't express). DESIGN CHOICE (ADR-0002 allows gates as
  a "stage/field"): model the AP gate state as a custom Picklist field the engine writes freely, NOT
  as native statuses — sidesteps this wall entirely. Native `status` stays Open/Closed.
- **Delete/trash a ticket** — `DELETE /tickets/{id}` → 405; `/moveToTrash` variants → 404/422 (param
  name unconfirmed). Left one harmless probe ticket in the throwaway sandbox; didn't chase it.
- **Deliver a secret/custom body with the ticket-create webhook** — NO, but **D5 IS SOLVED ANYWAY**
  (2026-07-27, live on prod): put the secret in the webhook's `url` QUERY STRING — the url is the one
  field Desk lets us shape, and Apps Script exposes it as `e.parameter`. Pair it with an independent
  check because a query secret can leak into logs: treat the payload as untrusted, mine it for
  candidate ids, re-read each from Desk, act only on one Desk confirms is an AP-department ticket.
  Second gotcha that mattered more than the auth: **Desk posts a JSON ARRAY of events, ticket at
  index 0** (`keys=["0"]`), so a handler reading `body.ticket.id` finds nothing regardless of auth.
  Desk also GETs the target before each POST — define a `doGet` or every delivery logs an error.
  `setupApWebhook(dry)` registers it; `dry` = resolve-and-log only.
  **Re-entrancy trap (2026-07-28):** our webhook has `ignoreSourceId: null` while both Zoho Flow
  webhooks on the org set it — so Desk fires `Ticket_Add` back at us for tickets OUR OWN API creates
  (every multi-invoice split child). Guarded by caching self-created ticket ids (`deskMarkSelfCreated_`
  / `deskIsSelfCreated_`, 1h) and skipping them in `deskNativeWebhook_`. If a proper `ignoreSourceId`
  value for our OAuth client is ever found, that is the cleaner fix.
  **Perf ceiling:** `processDeskTicket_` setup measured 61.8s (buildBillIndex 33.1s + buildVendors
  22.4s = 90%, both full-list pagination, both grow) against Apps Script's 6-min hard limit, with NO
  queue — a `doPost` that dies loses the delivery silently. Profiler: `deskTimeProfile(ticketId)`.
  Original finding below stands:
  Proven live on PROD 874367220
  2026-07-24 (`deskWebhookProbe`): a data-webhook's config has no params/payload/headers/auth field
  (keys: modifiedTime, subscriptions, includeEventsFrom, createdBy, isEnabled, name, createdTime,
  description, id, ignoreSourceId, type, url), and every workflow/automation endpoint 404s
  (`/automations`, `/workflows`, `/organizationWorkflows`, `/rules`, `/notifications`,
  `/settings/webhooks`). `/customFunctions?departmentId=…` exists but is a Deluge-in-UI primitive that
  still needs a UI Workflow Rule to fire. So `doPost`'s `body.secret` gate can only be fed by a **UI
  Workflow Rule → Webhook with a custom body** (paste the secret), or by redesigning `doPost` to
  authenticate via ticket re-fetch. This is decision **D5** in the prod-cutover ledger.

**PROD-vs-sandbox deltas (verified live on 874367220, 2026-07-24, via the `/exec` provisionAp run):**
- **Department create** unblocked on prod — the prod token carries `Desk.basic.ALL`; the AP dept
  already existed (id `1073870000032818112`), found by name.
- **All 12 custom fields created** on prod (same api names as sandbox, listed above + `cf_ap_stage`).
- **Custom statuses**: prod does NOT 500 like sandbox — it accepts them SERIALLY (one per call; the
  rest 422 "Schedule is in progress… try after some time"). Still cosmetic; gate state lives on
  `cf_ap_stage`. 2/5 added; rest drain on spaced re-runs.
- **Webhook `name`** — prod 422s special chars (the `->` arrow: "does not match the allowed values").
  Keep it alphanumeric + spaces. Sandbox didn't enforce this.

See [[gas-verification-loop]], [[zoho-desk-access]].
