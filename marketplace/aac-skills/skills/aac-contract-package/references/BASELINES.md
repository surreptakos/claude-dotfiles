# Active Alarm Baseline Clarifications and Exclusions — BASELINES.md

## How to use this file
This file holds the rules for Clarifications and Exclusions: the §0 length discipline, the relationship to the master agreements, site constraints, and the reviewer notes. **The bullet text itself lives in `clarifications.json`** (since 2026-09-18, Dan's ruling on issue 274): one copy, read by the builder and by the reviewer, with each bullet's applicability rule as `when` and its drafter instruction as `note`. Each section below points at its bullets by id. Use them as a starting point when building or reviewing Clarifications and Exclusions sections. Limit job-specific edits to facts supported by the actual job documents. Do not copy bullets that do not apply to the job. Do not invent bullets not supported by the documents.

When a baseline bullet conflicts with a job-specific condition, the job-specific condition controls. When a customer appears in **ACCOUNT-RULES.md**, that file controls for the items it lists.

A bullet's `when` and `note` in `clarifications.json` say when it applies and how to qualify it. They are internal — they never survive to a customer-facing export.

**Revision note — 2026-09-18 (ratified by Dan, clarifications.json resync, OPEN-DECISIONS item 23):** The validity bullet's Repair Service sentence is universal — Repair Service is contracted or T&M on nearly every agreement — and is omitted only on no-master accounts (ACCOUNT-RULES.md). The cybersecurity exclusion the builder's library carried without a source here is retired. `clarifications.json` is now the single copy of every bullet (it had lacked the Fire Alarm exclusions, the Access Control, Video, reused-equipment and new-construction section bullets); this page keeps the rules and points at the bullets by id, so the two can no longer drift.

**Revision note — 2026-08-26 (ratified by Dan, Commons-Krause compression review, OPEN-DECISIONS item 21):** Applicability tags added to four universal exclusions (core drilling, structural backing, other trades’ debris, existing-equipment removal) so they drop off jobs they do not fit. Additional-power-supplies bullet deleted from Access Control — the catch-all and the closing change-order bullet carry it. Deposit and credit-card fee merged into one payments bullet. Cabling-pathways assumption folded into the site-conditions bullet. Access bullet’s consequence clause moved behind a bracket — Commercial ¶13 governs delay consequences; accounts with no master append it. Software-licensing bullet compressed to one sentence. IT/network bullet tagged for cloud-hosted architectures. §0 target added for small single-system retrofits.

**Revision note — 2026-08-19 (ratified by Dan, wayfinder ticket #8):** Permit-fee clarification/exclusion pair ruled deliberate — both stay, exclusion bracket note records it. Rider for Additional Locations bullet deleted from Universal Clarifications: it was reviewer instruction, not customer-facing text; the do-not-question rule lives in pre-send item 14.

**Revision note — 2026-08-10:** Permit position corrected against the verified Commercial Security Master (we procure, Subscriber pays the fees). Training bounded. Assumptions-to-change-order bullet, site-cleanup exclusion, tax-exemption clarification, and network-equipment exclusion added. $5,000 deposit threshold named. Site constraints stated on the schedule; whether the estimate covered them is not a review question. **§0 added — length discipline, after these sections started running past thirty bullets.**

---

## 0) Length discipline

A schedule that runs thirty-six bullets is not more protective than one that runs twenty. It is harder to read, it hides the bullets that matter, and it invites the customer to negotiate line by line. Four rules keep the list honest.

### Rule 1 — One boundary, one bullet
Every responsibility boundary gets written once, not twice. If a clarification names who does something, do not also write an exclusion saying we do not do it.

Wrong, three bullets for one boundary:
> Clarification: "Network cabling must be installed, terminated, tested, and labeled by Subscriber's designated electrical or low-voltage contractor before Active Alarm Company begins camera installation."
> Exclusion: "Conduit, raceway, network cabling, camera-cable terminations, testing, labeling, patch cords, and network patching are excluded."
> Exclusion: "New or replacement junction boxes, back boxes, sleeves, supports, firestopping, conduit, pipe, or camera-mounting infrastructure are excluded."

Right, one bullet:
> Clarification: "Subscriber's designated electrical contractor will provide all conduit, raceway, back boxes, network cabling, terminations, testing, and labeling, and will complete that work before Active Alarm Company begins camera installation."

The clarification is the stronger of the two. It assigns the work to a named party. An exclusion only says the work is not ours, which leaves the customer to wonder whose it is.

### Rule 2 — The catch-all does the work
Every schedule ends with "Any item, task, service, material, or deliverable not specifically identified in the Scope of Work is excluded." That sentence already excludes everything not sold.

A specific exclusion therefore has to earn its place. Keep it only when at least one is true:
- it names the party who is responsible instead,
- the customer would reasonably expect the item to be included, or
- leaving it out has caused a dispute before.

An exclusion that merely restates the catch-all in narrower words comes out.

### Rule 3 — One topic, one bullet
Group by topic before writing. A lift, its travel path, floor protection, and who approves the method are one topic and get one or two bullets, not seven. The same goes for network dependencies, existing-equipment condition, and AHJ approvals.

### Rule 4 — Say an assumption once
Site conditions, Subscriber-provided information, and concealed conditions are one assumption. The closing change-order bullet supplies the consequence for all of them, so no individual assumption needs its own change-order tail.

### Target length
A single-system commercial schedule should land near **12 to 16 clarifications and 8 to 10 exclusions**. Two systems on one schedule do not double it — most of the universal set is shared. Past twenty-five bullets in either section, something is being said twice.

A small single-system retrofit — one or two openings or camera positions — should land near **10 to 12 clarifications and 5 to 6 exclusions** after inapplicable bullets are pruned.

### Reviewer instruction
When a section runs long, do not trim it bullet by bullet. Group the bullets by topic, find the topics carrying more than one bullet, and merge. Report the merge as a single instruction naming the bullets being replaced and the replacement text.

---

## Relationship to the master agreements
The Standard Commercial Security Agreement and the Standard Fire Alarm Agreement govern the legal relationship between Active Alarm Company and Subscriber. Where the master already addresses a topic — limitation of liability, indemnity, subrogation, hazardous conditions, subcontracting authorization, storage of materials, supplier-caused delays, **Subscriber-caused delay charges (Commercial ¶13)**, supersession of prior representations — do not duplicate that language in the schedule.

A customer has one applicable master agreement. Scheduled services become part of it upon signature.

**Commercial ¶13 already carries teeth on delay:** $1,000 per day for each business day the work is rescheduled or delayed by Subscriber or their contractors on less than 24 hours' notice, plus 5% of the Purchase Price if they delay installation more than one year. Do not restate, soften, or cap it on the schedule.

---

## Universal Baselines (apply to all installation types)

### Clarifications
Bullets: `clarifications.json` → `clarifications.universal` (validity, payments, labor_materials, training, warranty, access, permits, site_conditions, assumptions_closer) and `clarifications.conditional` (deposit, third_party_finance, prevailing_wage_not_subject, tax_exempt, customer_furnished, validity_no_master, access_no_master). Each bullet's `when` and `note` carry the drafter instructions that used to sit in brackets here.

### Exclusions
Bullets: `clarifications.json` → `exclusions.universal` (cosmetic, electrical, core_drilling, backing, other_trade_debris, existing_removal, periodic_maintenance, licensing, ahj_fees, catchall) and `exclusions.conditional` (detector_cleaning, submittals). The four tagged exclusions carry their applicability rule as `when`.

---

## Access Control Baselines

### Clarifications
Bullets: `clarifications.json` → `clarifications.by_system["Access Control"]` (network_ac, openings_condition, door_hardware, idf_conduit, software_licensing_ac) plus the conditional integration_existing_platform and maglock_egress, which the drafter adds when they apply.

### Reviewer checks specific to access control
- Every secured opening has a door position contact priced, or Sales has confirmed the omission.
- Credentials are priced or confirmed as not sold.
- An operable mechanical deadbolt left on a reader-controlled opening lets staff bypass the reader — confirm it is being removed or blanked.
- Every power supply, board, or controller named on the schedule carries a matching cost on the WU.

---

## Video Surveillance Baselines

### Clarifications
Bullets: `clarifications.json` → `clarifications.by_system["Video Surveillance"]` (network_video, recording_start, camera_placement, video_retention).

### Exclusions
Bullets: `clarifications.json` → `exclusions.by_system["Video Surveillance"]` (rack_ups).

---

## Intrusion Baselines

### Clarifications
Bullets: `clarifications.json` → `clarifications.by_system["Intrusion Alarm"]` (comm_path, programming).

---

## Fire Alarm Baselines

### Clarifications
Bullets: `clarifications.json` → `clarifications.by_system["Fire Alarm"]` (ahj_review, other_trades_fire). Permit procurement and fees follow the Universal permits bullet: Active Alarm Company files for and procures the permit; Subscriber pays the fees (its `note` carries the Fire Alarm master caveat).

### Exclusions
Bullets: `clarifications.json` → `exclusions.by_system["Fire Alarm"]` (ahj_reinspection, engineer_of_record, temporary_fire_alarm) plus the conditional submittals (confirm with Sales) and the detector_cleaning merge into periodic_maintenance.

---

## Reused / Taken-Over Equipment Addendum
Use when existing equipment is being reused, migrated, or taken over.

### Clarifications
Bullets: `clarifications.json` → `clarifications.reused_takeover` (existing_unverified, existing_nonfunctional).

### Exclusions
Bullets: `clarifications.json` → `exclusions.reused_takeover` (existing_troubleshooting).

---

## Site Constraints
A constraint is a condition the customer or the site imposes that limits how the work gets done: restricted work windows, mandatory loading dock or freight elevator use, escort or badging requirements, areas that must be closed, floor-protection or equipment-approval requirements, seasonal blackouts.

An assumption is a condition we believe is true. A constraint is a condition we have to work within.

Sales collects constraints before the job is estimated, the estimator prices them, and the schedule states them so the boundary sits on the face of the document. Whether the estimate covered a constraint is settled upstream and is not a review question.

State constraints in Clarifications, grouped by topic under Rule 3. Access equipment, its travel path, protection of finished surfaces, and who approves the method are **one topic** — write one or two bullets, not seven.

Example, one topic in two bullets:
> "Active Alarm Company will provide a narrow electric slab scissor lift with non-marking tires, together with standard floor protection and load-distribution panels along its travel path and operating area. Subscriber must approve the selected lift, access route, floor-loading capacity, and floor-protection method before operation, and the work areas must be closed to occupants and free of standing water during installation."
> "Specialized floor protection, structural analysis, alternate access equipment, additional mobilization, or extended lift rental required by site conditions or by delays not attributable to Active Alarm Company will be addressed by change order."

---

## New Construction / Active Construction Site Addendum
Use only when the site is under active construction or AAC is a subcontractor on a new build.

### Clarifications
Bullets: `clarifications.json` → `clarifications.new_construction` (construction_schedule, single_mobilization, surfaces_ready, rough_in_by_others); the builder applies them on `flags.new_construction`.

### Exclusions
Bullets: `clarifications.json` → `exclusions.new_construction` (as_builts, gc_coordination, site_safety_program, builders_risk).

---

## Elevator Monitoring Baselines
Elevator monitoring is a monitoring-only agreement on equipment Active Alarm Company did not install. Most install-related bullets do not apply. Include only what fits a monitoring-only deal.

---

## Notes for Reviewers
- Run §0 before anything else. Most over-long sections are one boundary written twice.
- "Others" and "Other" are never acceptable as a named responsible party. Name the party: Subscriber, Subscriber's designated contractor, Subscriber's designated fire alarm contractor, Subscriber's IT department.
- Prevailing wage on commercial jobs only; never residential.
- Warranty must always carve out customer-furnished and third-party-furnished equipment.
- **Permits: we procure, Subscriber pays.** Flag any schedule that excludes permit procurement.
- **Deposit threshold is $5,000.** A job over that without a deposit is a question for the rep.
- Training must be bounded to a session count.
- Check **ACCOUNT-RULES.md** before raising a finding. Several accounts carry standing exceptions to the bullets above.
