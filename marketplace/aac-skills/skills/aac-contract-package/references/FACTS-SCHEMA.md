# FACTS-SCHEMA — the `_facts.json` deal record

## Document control

- **Status:** Active, v1.0. Ratified by Dan Gatsakos on 2026-09-10 (spec session, issues #123 and #215, stream A). Governed by CLAUDE.md hard rule 1: this file and its companion schema change only as a Dan-ratified PR.
- **Companion file:** `facts.schema.json` (same folder) — the machine-checkable JSON Schema.
- **Authority:** every governed value cites another file under this folder. This document never restates a standard (hard rule 1); if a summary here disagrees with the reference it cites, the reference wins.
- **Shape:** the record is a tree — one `customer`, a list of `sites`, and per site a list of `systems`. A single-site single-system record is the same tree with one element in each list. The `deal` block carries the commercial envelope (rep, prospect, work-order, package situation, term, paid-by). Bullet-selection flags stay top-level. This shape is what three tools read: the extractor emits it, the builder consumes it, the pre-build gate validates it.

## How to read this file

- **Field** — the JSON path (`customer.subscriber_name`, `sites[].price`, `sites[].systems[].equipment[].qty`).
- **Type** — the JSON Schema type in `facts.schema.json`.
- **Required** — Required means the schema marks the field required at its position in the tree; Optional means the schema does not require it. Conditional means required only under another field's value (e.g. `deal.package_situation` when `deal.commercial` is true).
- **Authority** — the reference file that governs the value. Wording lives there, not here.
- **Notes** — validation and defaulting guidance.

---

## `customer` — Required (object)

Identity of the subscribing entity. Cited in the master, the schedule header, and the rider. Per-site identity (name, address) lives inside `sites[]`, not here — one Customer can carry multiple Sites.

| Field | Type | Required | Authority | Notes |
|---|---|---|---|---|
| `customer.subscriber_name` | string | Required | `DRAFTER-PRESEND-CHECKLIST.md` (A.1 legal-entity verification); `SCHEDULE-GENERATION-PROCEDURE.md` (schedule cell map) | Verified against the state Secretary of State record per the ingestion spec §8 Q3 (resolved 2026-08-19); aggregators may discover, not verify. Consumed by the schedule (`A10`), the master `.Text2`, and the rider `Text17777`. |
| `customer.billing_address` | string | Required | `SCHEDULE-GENERATION-PROCEDURE.md` (schedule cell map) | Newlines separate lines; the schedule joins on `\r\n`, the master joins on `, `. |
| `customer.phone` | string \| null | Optional | `SCHEDULE-GENERATION-PROCEDURE.md` (master field map) | Populated on the Commercial Fire master `.Text3`; empty string acceptable elsewhere. |
| `customer.cell` | string \| null | Optional | as above | Master `.Text6`. |
| `customer.email` | string \| null | Optional | as above | Master `.Text5`. Format is annotated (`format: email`) — see Q1 Resolved. |
| `customer.entity_verified` | boolean | Optional | `DRAFTER-PRESEND-CHECKLIST.md` (A.1) | Provenance field. Read by the pre-build gate — see Q2 Resolved. |
| `customer.assumed_name` | string \| null | Optional | `DRAFTER-PRESEND-CHECKLIST.md` (A.1, A.2) | If set, the schedule renders `"<subscriber_name>, <article> <state_of_incorporation> corporation, d/b/a <assumed_name>"`. |
| `customer.state_of_incorporation` | string \| null | Conditional (required at build time when `customer.assumed_name` is set; otherwise Optional) | `DRAFTER-PRESEND-CHECKLIST.md` (A.1 verification source; A.2 assumed-name phrasing) | Full US state or jurisdiction name as it appears on the Secretary of State record. Missing while `assumed_name` is set is a build-time error, not a silent default — ratified 2026-08-25. |

---

## `sites` — Required (array of object)

One entry per Site the Project touches. A single-site record has exactly one entry. Multi-site builds land in stream B (issue #218); stream A's builder refuses more than one entry and points at that ticket. `minItems: 1`.

| Field | Type | Required | Authority | Notes |
|---|---|---|---|---|
| `sites[].site_name` | string | Required | `SCHEDULE-GENERATION-PROCEDURE.md` | Used in the schedule header cells and in every output filename. |
| `sites[].site_address` | string | Required | `SCHEDULE-GENERATION-PROCEDURE.md` | Newlines separate lines; the first line (comma-stripped) is the filename slug. |
| `sites[].price` | number | Required | `SCHEDULE-GENERATION-PROCEDURE.md` §1 (source precedence — issued proposal outranks work-up); `MAPPING-APPENDIX.md` §3a (price validation) | Numeric only per Q4 Resolved; a string price is rejected at schema time. Written to the schedule's site line and to `F21`/`G21` for a single-site build. |
| `sites[].price_source` | string | Optional | `SCHEDULE-GENERATION-PROCEDURE.md` §1 | Provenance field read by the pre-build gate — see Q2 Resolved. |
| `sites[].deposit` | number \| null | Optional | `BASELINES.md` (the $5,000 deposit rule) | `null` means "derive": `50%` of price when `price > 5000` and `deal.paid_by == "subscriber"`, otherwise `0`. Explicit `0` is not the same as `null`. |
| `sites[].systems` | array | Required | `SOW-BASELINES.md`; `MAPPING-APPENDIX.md` | One entry per System sold at this Site. Same-family multi-System is a single schedule per the spec, stream B. `minItems: 1`. |

### `sites[].systems[]` — object

| Field | Type | Required | Authority | Notes |
|---|---|---|---|---|
| `sites[].systems[].system` | string | Required | `SOW-BASELINES.md` (approved system names) | The raw system string as the packet says it. The schema does not enumerate approved names (that would restate `SOW-BASELINES.md`); the pre-build gate reads the governing file at run time and refuses unapproved names — Q6 Resolved. |
| `sites[].systems[].designation` | string | Required | `SOW-BASELINES.md` (designation tokens) | Consumed by `build_sow`; interacts with `flags.equipment_reused` in `select_bullets`. |
| `sites[].systems[].scope` | object | Optional (empty acceptable) | `SOW-BASELINES.md` (§7.1–§7.12 SOW templates and coverage sentence rules); `SCHEDULE-GENERATION-PROCEDURE.md` (§4 no-re-enumeration rule) | `coverage_sentence` (string) and `extra_sentences` (array of string). Both default to empty when the block is omitted — Q7 Resolved. |
| `sites[].systems[].equipment` | array | Required | `SCHEDULE-GENERATION-PROCEDURE.md` (work-up to Equipment-and-Labor translation); `PART-TRANSLATIONS.md` (§6 resolution order) | Items: `qty` (number) and `description` (string). `maxItems: 50` matches the builder's expanded template cap (issue 38) — Q5 Resolved. |
| `sites[].systems[].services` | array | Optional | `MAPPING-APPENDIX.md` (RMR names, price tiers); `SOW-BASELINES.md` | Items: `qty`, `description`, `unit`, `kind` (`new`/`replacement`/`existing`). Per-subgroup `maxContains` caps match the builder's grouped-fill caps (5/10/5) — Q5 Resolved. The schema does not enumerate service names (that would restate `MAPPING-APPENDIX.md` §3); the pre-build gate reads the governing file at run time — Q6 Resolved. Absent `kind` defaults to `new` and the pre-build gate warns. |

---

## `deal` — Required (object)

The commercial envelope of the deal — who sold it, under what shape, for how long, and who pays. Per-System scope, equipment and services live under `sites[].systems[]`, not here.

| Field | Type | Required | Authority | Notes |
|---|---|---|---|---|
| `deal.rep` | string | Required | `SCHEDULE-GENERATION-PROCEDURE.md` (schedule cell map, `G10`) | Sales rep name as it appears on the schedule. |
| `deal.prospect` | string \| integer | Required | `SCHEDULE-GENERATION-PROCEDURE.md` §4; ingestion spec §4 | The Zoho `True_Lead_Number` (Z-xxxx). Written to `G11` via `str(...)`. Ingestion validates against Zoho, does not trust it. |
| `deal.work_order` | string \| integer \| null | Optional | `SCHEDULE-GENERATION-PROCEDURE.md` §4 | Optional until sold; not present on the schedule cell map today. |
| `deal.package_situation` | string enum (`"initial"` \| `"subsequent"`) | Conditional (Required when `deal.commercial == true`; ignored when residential) | `CONTRACT-PACKAGE-RULES.md` (commercial vs. residential composition) | Human-set; Zoho's master-sent checkboxes are cross-checked but not trusted (hard rule 5). Drives the composition of the delivered package in stream B; the builder in stream A carries but does not yet route on it. |
| `deal.commercial` | boolean | Optional | `BASELINES.md` (prevailing wage; commercial vs. residential) | When `true` and `flags.prevailing_wage` is `false`, `select_bullets` adds the "not subject to prevailing wage" clarification. |
| `deal.term_years` | integer \| number | Conditional (required when the sold system carries a term — currently Fire Alarm) | `MAPPING-APPENDIX.md` (master term); `SOW-BASELINES.md` | Rendered as `"{n} years"` on the master `.Text16` and as `str(...)` on the rider `Text37777`. Not read for non-term systems. |
| `deal.paid_by` | string (`"subscriber"` \| `"lender"`) | Optional (defaults to `"subscriber"`) | `BASELINES.md` (third-party finance clarification); `SOP-LEAF-Financed-Installations.docx` | When `"lender"` and `deal.lender` is set, `select_bullets` picks the third-party-finance clarification. Also gates the automatic 50% deposit rule with `sites[].price > 5000`. |
| `deal.lender` | string \| null | Optional (required when `deal.paid_by == "lender"` for the third-party clarification to fire) | as above | Formatted into the clarification text. |
| `deal.inspections_per_year` | string \| integer \| null | Optional | `MAPPING-APPENDIX.md` (Inspection RMR) | Rendered onto the master `.Text13`. Empty string falls back to `"one (1)"` when Inspection RMR is present. |

---

## `flags` — Optional (object)

Boolean toggles that drive conditional bullet selection and one agreement checkbox. `flags` may be absent — an omitted block defaults to every flag `false`, per Q7 Resolved.

| Field | Type | Required | Authority | Notes |
|---|---|---|---|---|
| `flags.prevailing_wage` | boolean | Optional | `BASELINES.md` (prevailing wage clarification and labor-rate rule); ingestion spec §3 | `false` on a commercial deal drops the "not subject" clarification. |
| `flags.tax_exempt` | boolean | Optional | `BASELINES.md` (tax-exempt clarification) | Adds the tax-exempt clarification. |
| `flags.customer_furnished_equipment` | boolean | Optional | `BASELINES.md` | Adds the customer-furnished clarification. |
| `flags.no_master_agreement` | boolean | Optional | `ACCOUNT-RULES.md` (no-master accounts); `clarifications.json` `validity_no_master`, `access_no_master` | The schedule never refers to a master: the validity bullet drops its Repair Service sentence and the access bullet carries the delay clause (Dan, 2026-09-18, OPEN-DECISIONS item 23). |
| `flags.new_construction` | boolean | Optional | `clarifications.json` `new_construction` groups | Adds the New Construction / Active Construction Site addendum bullets. |
| `flags.detector_cleaning_discussed` | boolean | Optional | `BASELINES.md` (periodic maintenance / detector cleaning) | When `true`, `select_bullets` swaps the universal periodic-maintenance exclusion for its merged detector-cleaning variant. |
| `flags.submittals_excluded_confirmed` | boolean | Optional | `BASELINES.md` (submittals exclusion) | Adds the submittals exclusion. |
| `flags.equipment_reused` | boolean | Optional | `BASELINES.md`; `SOW-BASELINES.md` (replacement/takeover); SKILL.md hard stops (reused equipment left unaddressed) | With `designation` in `{"replacement","takeover"}`, appends the reused/takeover bullet block. |
| `flags.fire_alarm_to_code` | boolean | Optional | `MAPPING-APPENDIX.md` (Commercial Fire mapping) | Feeds the "to code" checkbox on the Fire master. |

---

## `job_clarifications` — Optional (array)

Per-job bullets not covered by the library. Each item is either a bare string or `{ "order": <int>, "text": <string> }`. Missing `order` defaults to `L["_job_clarification_default_order"]` (`40` when unset).

| Field | Type | Required | Authority | Notes |
|---|---|---|---|---|
| `job_clarifications[]` | string \| `{order?: number, text: string}` | Optional | `clarifications.json` (bullet wording lives here, not in the record); `BASELINES.md` §0 (length discipline) | Order values collide with library orders by design; leave gaps for insertion. |

---

## `held` — Optional (array of string)

Pending questions parked until answered. Not written into any document; the builder echoes them at the end of a build. Governed by SKILL.md's "no placeholder edits" rule and the ingestion spec §5 output contract.

| Field | Type | Required | Authority | Notes |
|---|---|---|---|---|
| `held[]` | string | Optional | SKILL.md ("No placeholder edits"); ingestion spec §5 (hold queue) | One line per held item. |

---

## Open questions — Ledger

Every question tracked in the v0.1 draft is resolved here or explicitly deferred to a downstream stream. The 2026-09-10 spec session (issue #123's spec ratification, published as `docs/specs/215-pilot-build-plan.md` for issue #215) is the ruling source; live Deals field types are recorded in the same spec.

1. **Q1 — `customer.email` format enforcement.** Should the schema enforce `"format": "email"`, or leave format checking to a pre-build validator?

   **Resolved 2026-09-10 (spec session, issue #215 stream A):** the schema carries only the `format: "email"` annotation. Enforcement stays a pre-build-gate warning per stream C (issue #219). The rationale in the spec's stream A block: "email is annotated, not enforced" — a lender's odd address must never block a build.

2. **Q2 — Fields present but unread.** Do `customer.entity_verified` and `sites[].price_source` (was `pricing.price_source`) belong in the schema, and which validator reads each?

   **Resolved 2026-09-10 (spec session, issue #215 stream A):** both provenance fields stay in the schema and are read by the pre-build gate (stream C, issue #219). The spec's stream A block: "the two provenance fields stay and the gate reads them".

3. **Q3 — Jurisdiction rendering when `customer.assumed_name` is set.**

   **Resolved 2026-08-25 (Dan, in chat), carried forward 2026-09-10:** required-when-assumed-name, no Illinois default, full state names only. Runtime check stays the enforcement point until the schema is locked; the spec's stream A block: "Jurisdiction rendering keeps the 2026-08-25 ruling".

4. **Q4 — `pricing.price` accepts strings today.** Should the schema forbid string prices?

   **Resolved 2026-09-10 (spec session, issue #215 stream A):** numeric only. The spec's stream A block: "prices are numbers, never strings". The tree schema encodes `sites[].price` as JSON type `number`; string prices are rejected at ingest.

5. **Q5 — Row caps in the schema.** Should `equipment` and `services` carry `maxItems`?

   **Resolved 2026-09-10 (spec session, issue #215 stream A):** yes — `maxItems: 50` on equipment and per-subgroup `maxContains` (5/10/5) on services, matching the builder's grouped-fill caps (PR #153). The spec's stream A block: "equipment and per-subgroup service counts carry the template's caps in the schema".

6. **Q6 — RMR description matching: schema-level enum, or leave it to the builder?**

   **Resolved 2026-09-10 (spec session, issue #215 stream A):** neither the system-name enum nor the service-name enum belongs in the schema — enumerating them would restate `SOW-BASELINES.md` and `MAPPING-APPENDIX.md` in a third place (violating hard rule 1). The pre-build gate (stream C, issue #219) reads the governing files at run time and refuses unapproved names. The spec's stream A block: "service names and system names are not enumerated in the schema".

7. **Q7 — Top-level required set diverges from `.get()` guards.** Should `scope` and `flags` be Required or Optional?

   **Resolved 2026-09-10 (spec session, issue #215 stream A):** both are Optional; an omitted block defaults to empty. The spec's stream A block: "scope and flags may be absent and default to empty". The builder normalises a missing `flags` or `scope` at read time.

8. **Q8 — Zoho field semantics (carried from ingestion spec §8.2).** `Effective_Agreement_Term`, `Invalid_System_Types_Found`, and `True_Lead_Number` semantics needed confirmation against a live Deals schema export before the validators encoded them.

   **Live Deals field types recorded in the spec (verified 2026-09-10, spec session, issue #215 stream D):** "Field types were verified against the live Deals schema on 2026-09-10 (formula fields, read-only; effective term is in months; system types is a multi-select whose values include cross-family combinations, which the gate must parse rather than trust)". Stream D wave 2 (Zoho lookups, warnings only) reads these and never trusts them (hard rule 5).

9. **Q9 — Precedence ownership (carried from ingestion spec §8.1).** Which document owns source precedence?

   **Resolved 2026-09-10 (spec session, issue #215 stream A):** `SCHEDULE-GENERATION-PROCEDURE.md` §1 owns source precedence and this schema cites it; the ingestion spec cites it too so one document governs. The spec's stream A block: "source precedence is owned by the generation procedure §1 and the ingestion spec cites it".

10. **Q10 — FSI worksheet as required input (carried from ingestion spec §8.4).** Is the FSI worksheet required on every deal carrying Repair Service or Inspection RMR, or only when that RMR is sold on this Project?

    **Resolved 2026-09-10 (spec session, issue #215 stream C):** only when this Project sells Repair Service or an Inspection. The spec's stream C block: "FSI worksheet absent when a service line on this Project is Repair Service or an Inspection". Stream C (issue #219) implements the trigger.
