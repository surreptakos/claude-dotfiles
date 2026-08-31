# Active Alarm Baseline Clarifications and Exclusions — BASELINES.md

## How to use this file
These are approved baseline bullets by installation type. Use them as a starting point when building or reviewing Clarifications and Exclusions sections. Limit job-specific edits to facts supported by the actual job documents. Do not copy bullets that do not apply to the job. Do not invent bullets not supported by the documents.

When a baseline bullet conflicts with a job-specific condition, the job-specific condition controls. When a customer appears in **ACCOUNT-RULES.md**, that file controls for the items it lists.

Inline tags in brackets indicate when a baseline applies or how to qualify it. Bracket tags are internal — they never survive to a customer-facing export.

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
- Pricing is valid for 30 days; pricing is based on all work being performed Monday through Friday, 8:00 AM to 5:00 PM. Repair Service hours are governed by the master agreement. [Opens with "Pricing is valid for 30 days" — not "Quotation," not "Schedule." Anchors to the date of this schedule, never the proposal date. Include the Repair Service sentence only when Repair Service is sold.]
- A 50% deposit is required to initiate scheduling and procurement of material; the remaining balance will be due upon completion. Payments made by credit card with an amount in excess of $1,000.00 will be charged a 3.5% fee. [Deposit sentence: include whenever the total price exceeds **$5,000**. Fee sentence: always include.]
- Active Alarm Company will provide all labor and listed materials required to complete the installation.
- End-user training is included as one (1) training session at completion of the installation. Additional or repeated training sessions may be scheduled at Active Alarm Company's then-current service rates.
- One (1) year parts and labor warranty applies only to newly supplied equipment and Active Alarm Company's installation workmanship. Active Alarm provides no warranty coverage for equipment supplied by others.
- Pricing assumes any customer-furnished equipment is complete, compatible, and functional upon delivery to the site. [Only when the customer is furnishing equipment.]
- Subscriber must provide free, safe, and unobstructed access to all work areas for the duration of the installation. [Commercial ¶13 carries the delay consequences; do not restate or soften it here. On accounts with no master agreement (see ACCOUNT-RULES.md), append: “Delays caused by denied or restricted access may result in rescheduling and/or additional charges.”]
- Active Alarm Company will file for and procure the permits required by local law for the work described above. Permit fees are the responsibility of Subscriber. [Matches Commercial ¶12 and ¶27 and long-standing practice. Never write an exclusion that excludes permit procurement. Alarm-user permits and false-alarm registration remain Subscriber's under ¶27. For fire alarm, confirm against the Fire Alarm master.]
- Pricing assumes Subscriber is tax-exempt and will provide a tax exemption certificate prior to purchase of equipment. [Nonprofits, school districts, park districts, municipalities. Omit on taxable jobs.]
- Pricing assumes the project and related work are not subject to prevailing wage requirements under any local, state, or federal law. If prevailing wage obligations are found to apply, Subscriber must notify Active Alarm Company in writing within 48 hours so that revised pricing may be issued reflecting any additional wage-related costs. [Commercial only — never residential. Where the job is known to be prevailing wage and the pricing carries those rates, replace with an affirmative statement anchored to the date of this schedule.]
- Pricing is based on the drawings, specifications, and site conditions represented by Subscriber and on any pre-installation site walk, and assumes cabling pathways are accessible and free from obstruction. Concealed or materially different conditions discovered during installation are subject to change order. [One bullet covers Subscriber-provided information, site conditions, cabling pathways, and concealed conditions. Do not write a second or third version of this.]
- If any assumption stated above is or becomes untrue, the affected work will be addressed by change order. [Closing bullet. Supplies the consequence for every assumption above, so none of them needs its own change-order tail.]

### Exclusions
- Any painting, patching, drywall repair, or cosmetic restoration resulting from the installation is excluded.
- Any new electrical work required to provide power is excluded. Adequate power is assumed to be available near installation areas.
- Core drilling, saw cutting, structural penetrations, and slab penetrations requiring engineering review or structural trade work are excluded. Ordinary low-voltage device mounting and cable penetrations required for Active Alarm Company's included installation scope are not excluded by this item. [Only when the job's pathways make slab, masonry, or structural penetrations plausible.]
- Structural steel, backing, blocking, or framing beyond standard device mounting is excluded. Subscriber or Subscriber's designated contractor is responsible for providing adequate backing at all mounting locations. [Only when device weight or mounting surfaces make added backing plausible — operators, maglocks on hollow frames, large enclosures.]
- Removal of debris, materials, or conditions left by other trades is excluded. Active Alarm Company will remove debris generated by its own installation work. [Only when other trades are on site during the work.]
- Removal, disposal, or decommissioning of existing equipment not identified in this contract's scope is excluded. [Only when existing equipment sits in or near the scope — takeovers, replacements, decommissions.]
- Annual or periodic inspection, testing, and preventive maintenance beyond the initial commissioning and acceptance testing included in this contract are excluded. Recurring service programs are available under a separate agreement.
- Licensing, subscription, or license-renewal fees beyond the recurring services listed in the Services section are excluded.
- Permit fees, engineering fees, and inspection fees assessed by the authority having jurisdiction are excluded. [Fees only. Procurement is included per the clarification above. The permit-fee restatement of the clarification's boundary is deliberate — ratified 2026-08-19 (wayfinder ticket #8). §0 Rule 1 sweeps keep both bullets; do not flag this pair.]
- Any item, task, service, material, or deliverable not specifically identified in the Scope of Work is excluded. The absence of an explicit exclusion for any item does not imply inclusion. [Always last. This is the bullet that lets the rest of the list stay short.]

---

## Access Control Baselines

### Clarifications
- Network connectivity, IP addresses, and switch ports for headend equipment must be provided by Subscriber's IT department. Wireless access points, switches, routers, patch panels, and network configuration are Subscriber's responsibility. [List Subscriber-owned network gear only as the job's architecture requires. On cloud-hosted systems with no headend server, the bullet reduces to connectivity and switch ports for the door controllers.]
- Pricing assumes existing doors, frames, hinges, and surfaces are in suitable condition to accept new access control hardware. Repairs or modifications needed to make the openings compatible may require a change order.
- Subscriber's designated door hardware contractor will provide and install all mechanical and electrified locking hardware not expressly listed in the Equipment and Labor section, including locksets, exit devices, closers, electric strikes, magnetic locks, and electrified locksets, and will complete any door or frame modification required.
- Subscriber's designated contractor will provide conduit and cabling from the secured openings to the IDF.
- Software licenses, cloud subscriptions, and software maintenance fees are included only where expressly listed in the equipment and services section; Subscriber is responsible for maintaining active licensing for continued system operation.
- Where integration with an existing access control platform, database, or third-party system is required, compatibility is assumed based solely on information provided prior to the proposal date. Active Alarm Company does not warrant compatibility with undocumented configurations, non-standard firmware, or end-of-life equipment. [Only when integrating with a third-party system.]
- Where magnetic locks are installed, Subscriber's designated fire alarm contractor is responsible for all fire-alarm-side work required for code-compliant egress: raceway and wiring from the nearest fire alarm connection point to the lock power supply, a set of normally closed dry contacts, and wiring from those contacts to the power supply. Active Alarm Company will terminate that interface wiring at the lock power supply and program the power supply to release the locks on fire alarm activation. All fire alarm modification, programming, testing, and certification remain the fire alarm contractor's responsibility.

### Reviewer checks specific to access control
- Every secured opening has a door position contact priced, or Sales has confirmed the omission.
- Credentials are priced or confirmed as not sold.
- An operable mechanical deadbolt left on a reader-controlled opening lets staff bypass the reader — confirm it is being removed or blanked.
- Every power supply, board, or controller named on the schedule carries a matching cost on the WU.

---

## Video Surveillance Baselines

### Clarifications
- Subscriber's IT department will provide network connectivity, IP addresses, sufficient bandwidth, available switch ports, and the required PoE capacity. Network switches, routers, internet service, and network configuration are Subscriber's responsibility.
- Recording begins at system cutover. Migration of historical video is not included.
- Camera placement is based on the site survey and drawings on file. Final mounting positions, heights, and aiming will be determined in the field; material deviations will be addressed by change order.
- Video retention will vary based on scene activity, resolution settings, and available storage. Active Alarm Company makes no guarantee of a minimum retention duration. [Omit when the schedule sells a fixed cloud-storage term as a licensed service — the license sets the retention.]

### Exclusions
- NVR/DVR rack space and UPS power protection for recording equipment must be provided by Subscriber unless expressly listed in the equipment section.

---

## Intrusion Baselines

### Clarifications
- Phone line, IP, or cellular communication path required for monitoring must be provided and maintained by Subscriber unless expressly listed in the equipment section.
- Panel programming will be completed to Subscriber's stated operational requirements at the time of installation. Changes to zone assignments, user codes, schedules, or system behavior requested after turnover may be subject to a service call charge.

---

## Fire Alarm Baselines

### Clarifications
- All work is subject to AHJ review and approval. AHJ-required changes beyond the approved scope will be addressed by change order.
- Permit procurement and fees follow the Universal baseline: Active Alarm Company files for and procures the permit; Subscriber pays the fees. [Confirm against the Fire Alarm master and the "Fire Alarm System to Code" option. The Commercial Security master has been verified; the Fire Alarm master has not.]
- Subscriber's designated contractors are responsible for sprinkler system work, HVAC duct work, elevator recall wiring, kitchen hood suppression interfaces, agent-release wiring, and voice evacuation or mass notification work, unless expressly listed in the Scope of Work.

### Exclusions
- Drawings and submittals required by the AHJ or Subscriber are excluded unless expressly listed. [Confirm with Sales before applying.]
- Re-inspection or re-test fees assessed by the AHJ for failures attributable to conditions outside Active Alarm Company's scope are excluded.
- Engineer-of-record fees or plan revision costs required to satisfy AHJ comments resulting from code changes or interpretive positions postdating Active Alarm Company's original submission are excluded.
- Temporary fire alarm systems required during construction or phased occupancy are excluded.
- Routine cleaning of detectors and other periodic preventive maintenance are excluded unless expressly listed as a recurring service.

---

## Reused / Taken-Over Equipment Addendum
Use when existing equipment is being reused, migrated, or taken over.

### Clarifications
- Active Alarm Company has not verified the condition, compatibility, or functionality of existing equipment prior to signing. Acceptance of existing equipment is not a representation of its condition, and Active Alarm provides no warranty coverage for it.
- Existing equipment found to be non-functional, non-compliant, or incompatible during takeover or integration will be brought to Subscriber's attention prior to proceeding, and resolution will be addressed by change order.

### Exclusions
- Troubleshooting, repair, replacement, or relocation of existing equipment not listed in the equipment section is excluded and will be addressed on a time-and-material basis if required.

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
- Pricing is based on the construction schedule and site conditions represented at the time of quoting. Delays in the general construction schedule, or delays caused by other trades, that affect Active Alarm Company's ability to mobilize or complete work may result in rescheduling and/or revised pricing.
- Rough-in and trim-out are priced as a single mobilization sequence. Extended phase separation requested by Subscriber or required by the construction schedule may result in additional mobilization charges.
- Pricing assumes finished surfaces, above-ceiling access and support structure, and power rough-ins will be complete and available at the time of scheduled installation.
- Conduit installation, back-box setting, wire rough-in, concrete embedment, underground conduit sleeves, and in-slab rough-in performed by other trades are Subscriber's responsibility unless expressly listed.

### Exclusions
- As-built drawings, record drawings, and O&M manuals are excluded unless expressly listed.
- General contractor coordination meetings, BIM clash detection, and pre-construction submittal participation are excluded unless expressly listed and priced.
- Site-specific safety training, site badging fees, and general-contractor-imposed safety program requirements are excluded unless expressly listed.
- Builder's risk insurance, installation floater, and contractor-required bonds are excluded unless expressly listed.

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
