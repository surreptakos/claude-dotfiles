---
name: desk-blueprint-api-facts
description: Zoho Desk Blueprint API — criteria is UI-only; response-only fields 500/422 the create; POST creates ACTIVE not draft
metadata: 
  node_type: memory
  type: reference
  originSessionId: 53abe6ea-c9c1-4c7f-81be-a658ee95927a
  modified: 2026-08-26T14:04:37.618Z
---

Measured live 2026-08-05 (`deskBlueprintBisect`, 4 rounds, on prod org 874367220) while installing #8:

- **`POST /blueprints` refuses `criteria` in every spelling with a bare 500** — on create, on status and
  `cf_ap_stage` alike, via PATCH after a bare create, and the documented draft cycle 404s on this
  edition. Criteria is **UI-only**, like custom statuses ([[desk-provisioning-api-facts]]).
- Response-only fields that break the create: `criteriaDetails` (500), explicit-null `after` (500),
  `displayValue` (422 named), `fromState`/`toState`/`usedStates` in `chartData.connectionDetails`
  (422 named). Send `after: {}`, `strictModeConfig: null`, `pattern: "1"` (not `"(1)"`), positions as
  fraction strings.
- **A successful POST creates an ACTIVE blueprint (`active:true, draft:false`)** — not a draft,
  despite UI-authored ones sometimes sitting `draft:true`.
- The only reliable schema documentation is a definition Desk itself accepted: `deskBlueprintDump(id)`
  reads one; the org's `AAC Service Ticket Lifecycle` was the reference artifact.
- **Enforcement is OFF for an API-created Blueprint and switches ON at editor Publish.** Pre-publish,
  direct API status writes on captured tickets went through (proved on AP-38 both directions);
  post-publish the same write answers **HTTP 403** and only the Blueprint's transitions move the
  ticket. A captured ticket refuses status writes in TWO shapes: 422 naming the blueprint, and a
  BARE 403 `FORBIDDEN` carrying no blueprint word — detect both (`blueprintRefusalOfStatus`;
  measured 2026-08-13). Perform via `POST /tickets/{id}/transitions/{transitionId}/perform` →
  `200 {"updatedState":"..."}` (the `/blueprint/transitions/.../perform` spelling is a 404);
  perform refuses ANY field envelope (`"An extra parameter 'cf' is found"`), so land cf via
  PATCH first and perform bare. Mandatory during-fields are still enforced on the perform.
  `deskSetGateStage_` carries the 403→transition fallback since 9f100a6.
- Ticket tags: `POST /tickets/{id}/associateTag {"tags":["name"]}` (creates the tag if new);
  `/tickets/{id}/tags` is GET-only; `dissociateTag` removes. PATCHing `tags` on the ticket is
  refused.
- **An API-created Blueprint renders its states floating disconnected in the editor** even though
  `connections` and the runtime (`GET /tickets/{id}/blueprint`) are whole. The editor's durable
  anchors — numbered `fromUuid`s (`"Awaiting Data-verify6"`) tied to `stateId`-bearing `stateDetails`
  rows — cannot be written via the API in any spelling (`fromState`/`toState` 422 on create AND
  patch; synthetic `name+'1'` uuids don't anchor). One-time UI redraw picking the EXISTING
  transitions fixes it permanently; until then an editor Save could drop the real connections.

**Why:** the OpenAPI spec actively lies about the create payload; guessing from it costs 500s with no
message. **How to apply:** build payloads by mimicking a dumped accepted artifact, bisect with
throwaway names, delete probes immediately.
