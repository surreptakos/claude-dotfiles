# Active Alarm Contract Package Review Living Standard — Final

## Document control
- **Document type:** Governing internal standard / SOP
- **Audience:** Contract reviewers, Sales Admin, leadership, GPT-assisted reviewers
- **Purpose:** One authoritative standard for reviewing and building contract packages so the package reads as one coherent transaction.
- **Revision note:** Updated 2026-06-05 (SOW template regime, drafter checklist, entity verification, traceability thresholds, formatting semantics). Updated 2026-06-30 (open-ended-promise prohibition, drafter-instruction discipline, removal discipline, stop-slop pass). Updated 2026-08-10: SOW carries no itemized equipment list and no site address; traceability runs scope → equipment only; permit position corrected against the verified Commercial Security Master (we procure, Subscriber pays fees); training bounded; site constraints added; ¶13 delay charges added to the master-duplication list; §0 added (the estimate is settled before review); $5,000 deposit threshold named; master agreement language corrected. Second pass 2026-08-10: the reviewer now edits the schedule directly (§0a). Email specification moved to PROMPT.md so there is one copy of it. ACCOUNT-RULES.md and SCHEDULE-EDIT-PROCEDURE.md added as companions. **Updated 2026-08-11: §2(4a) added — the issued proposal is read-only and is never revised, re-titled, or re-issued. §13 no longer implies cleaning the proposal.** **Updated 2026-08-18: §0 estimating/oversight lists, §3a sub quote rules, and §16 escalation list moved to PROMPT.md per §18 (one copy, cross-reference the other); PROMPT.md Hard Stop now carries the merged escalation list.**

## 0) Where this review sits in the process
The estimator prices and approves the work before the package reaches review. Review the paperwork, not the estimate. Unit rates the issued proposal quotes are owned upstream, even where they disagree with the Mapping Appendix.

**The lists live in PROMPT.md ("Where this review sits in the process"), so the two documents cannot drift:** which estimating decisions are never re-opened, which oversights the review exists to catch, and how workup arithmetic differs from estimating judgment.

Ask Sales only what Sales alone can answer. Every question costs a rep a reply and a day. If the documents answer it, fix it. If the estimate itself looks wrong, raise it with the estimator directly.

## 0a) The reviewer edits the schedule
The review is not a list of changes for someone else to retype. The reviewer opens the schedule in the job folder, makes the changes, saves over it, and reports what changed.

Edits are minimal and surgical: only the cells that must change. Follow **SCHEDULE-EDIT-PROCEDURE.md** — back up first, never save through a spreadsheet library, run the verification gate, and do not attach a second copy of the workbook to anything.

## 0b) Account rules come first
Read **ACCOUNT-RULES.md** before reviewing any package. Where a customer carries a standing exception, that file overrides this standard, BASELINES, and the Mapping Appendix for the items it names. Never raise an item it covers as a finding or a question.

## How to use this standard
Start here for every review. Apply job-specific exceptions only when the job documents or leadership direction require them. Use the **Schedule-to-Master Mapping Appendix — Final** for service-selection and pricing-mapping rules.

## 1) Governing principles
1. Review the full package as one transaction. Do not approve documents that are individually clean but collectively inconsistent.
2. The schedule is the commercial source of truth unless directed otherwise.
3. Scope defines responsibility boundaries, not internal workflow and not sales narrative.
4. Assumptions must be explicit.
5. Customer-facing language contains only positions the company is willing to send.
6. Clarifications and exclusions are boundary controls, not a dumping ground.
7. Use only confirmed facts from the job documents, approved knowledge documents, and verified business rules.
8. Default to minimal, surgical changes.
9. Surface material issues explicitly.
10. If documents conflict and the conflict affects customer-facing language, escalate rather than guess.

## 2) Review hierarchy and source priority
1. Customer identity, legal entity, site, system type, term, and billing structure must align across the package.
2. The schedule governs the commercial transaction.
3. Master agreement selections follow the scheduled services and company rules.
4. Riders, addenda, covered-equipment sheets, drawings, and proposal / WU materials support the schedule rather than override it.
4a. **The issued proposal is read-only.** It records what the customer was told. It is never revised, re-titled, re-issued, or swept, and no review output prescribes a change to it. Read it to establish facts and to find conflicts. Where it conflicts with the schedule, the schedule governs and the correction lands on the schedule. A proposal title naming a system its body does not sell is a stale title, not a scope conflict. Where the schedule matches the proposal on a rate but disagrees with the Mapping Appendix, the proposal governs the rate; the reviewer flags the mapping mismatch rather than correcting it. See PROMPT.md.
5. AHJ comments, permits, and plan reviews control inspection wording and approval conditions.
6. If a conflict remains unresolved, escalate to a Sales Rep question and recommend the redline.

## 3) What every reviewer must verify first

### Transaction identity
- Legal entity names and addresses identical across all components.
- Verify the entity on the state Secretary of State search (Illinois: https://apps.ilsos.gov/businessentitysearch/). Third-party aggregators (OpenCorporates etc.) may serve as a discovery aid for candidate entities and jurisdictions, never as the verification source — every package fact is confirmed on the SOS record. Where an assumed name is registered: "[Legal Entity], an Illinois corporation, d/b/a [Registered Assumed Name]," spelled exactly as registered.
- Site addresses and names consistent across the schedule, agreement, rider, addenda, CRM, and proposal / WU.
- Dates aligned or explicitly reconciled.
- System types named correctly using approved names.
- Term length matches across all documents.
- Billing frequency checked in the master agreement; default **Quarter Annual**.
- Email addresses and phone numbers present on the master agreement.

### Contract structure
- Separate systems into separate deals and packages when company rules require it.
- Fire, Elevator, and Security each require their own deal and package when sold as distinct systems.
- Residential structure differs from commercial; the residential agreement covers burglar and fire together.
- A customer has one applicable master agreement. Scheduled services become part of it upon signature. Riders reference it by title and date. Some accounts have no master at all — see ACCOUNT-RULES.

## 3a) Subcontractor quote handling
**The sub quote rules live in PROMPT.md ("Sub Quote Handling"), so the two documents cannot drift.** In brief: internal reference only, sub work is AAC's work from the customer's perspective, sub pricing rolls into the AAC installation price and is never broken out.

## 4) Hard-stop approval checks
Do not approve if:
- Legal entity names or addresses do not match.
- System type, site, term, billing frequency, deposit structure, recurring pricing, or totals conflict.
- The package uses the wrong contract structure.
- RMR quantities, names, or prices are blank, shifted, or unsupported.
- Required addenda, drawings, riders, FSI support, or coverage schedules are missing.
- Scope promises work not listed, priced, assigned, or supported by drawings.
- Clarifications or exclusions contradict listed equipment, labor, or services.
- Customer-facing text contains unresolved internal questions.
- Clarifications are cut off, hidden, or unreadable in the export.

## 5) Scope of Work drafting standard

### Required standard
- Every scope opens with the canonical sentence in SOW-BASELINES.md §1: **"Active Alarm Company will furnish, install, program, and test a [designation] [system type] at the site listed above, as itemized in the Equipment and Labor section."** (Trailing "of this schedule" dropped 2026-08-17 per Dan; quote aligned 2026-08-19.)
- Both cross-references are fixed. The Site box carries the address and the Equipment and Labor section carries the itemized list; the scope points to them instead of repeating either.
- Exactly one designation — new, replacement, takeover, or addition — determined from the job documents. A site with an existing system of the same type is not "new."
- The scope names the system, what it covers, and the counts that define the responsibility boundary.
- The scope describes the deliverable, not project history or sales narrative.
- Quantities and commitments reconcile with the WU / estimate.
- Recurring services are acknowledged so operational and billing scope stay aligned.
- New, existing, reused, taken over, replaced, removed, or reprogrammed components are called out where that affects responsibility or coverage.
- Access control identifies the doors secured. Fire alarm identifies system elements, inspection responsibilities, and third-party integration boundaries.
- The training commitment is bounded; the session count lives in the training bullet in `clarifications.json`.

### What not to do
- **No site address.** The Site box has it.
- **No equipment itemization.** Mounts, adapters, covers, illuminators, injectors, power supplies, batteries, wire, hardware, freight, and roll-ups appear only in EQUIPMENT AND LABOR.
- No filler or narrative introductions.
- No work promised that is not listed, priced, or assigned.
- No unresolved internal questions in customer-facing scope.
- No invalid system names. Use "Audio/Visual," "Intrusion Alarm," "Video Surveillance."
- The word "proposal" never appears in a schedule SOW.
- No inferred electrified hardware.
- No part numbers anywhere on the schedule.
- The schedule SOW is written from the SOW-BASELINES template, never copied from the proposal.

## 6) Equipment, labor, service, and consistency rules

### Device traceability rule
Traceability runs one direction: **scope → equipment.** Every device or system element named in scope appears in Equipment and Labor with a quantity and an identified owner. Flag any that does not.

The reverse does not apply. Equipment and Labor will always carry accessories, mounts, wire, and roll-ups the scope does not name, and that is correct.

Three artifacts, three thresholds: Equipment and Labor contains everything sold; the SOW is prose naming the system, coverage, and boundary counts; the placement plan contains only independently placed, customer-visible devices.

### Schedule content controls
- Headings exact: **"SCHEDULE OF EQUIPMENT AND SERVICES"** and **"EQUIPMENT AND LABOR."**
- Services broken down by system and status when relevant.
- No blending separately priced recurring services into one vague line.
- Every recurring line specifies a quantity basis.
- A recurring subtotal is present.
- No approval when RMR quantities or pricing fields are blank or misaligned.

### Coverage and addenda
- The schedule identifies all components taken over, reused, migrated, removed, or reprogrammed.
- Counts and types of existing devices verified.
- Drawings show new versus existing where that matters.
- A Covered Equipment Addendum is required for Repair Service, and for Inspections unless the same list applies and the schedule says so. Some accounts do not use these — see ACCOUNT-RULES.
- All devices under Repair Service appear in the addendum, including reused hardware.
- If reused equipment is not covered, state that in Clarifications or Exclusions.

## 7) Schedule-to-master agreement controls
- Selections follow the schedule.
- Approved service names only. **"Service Agreement"** is not valid; use **"Repair Service."**
- Repair Service means parts and labor unless clarifications state narrower.
- Billing frequency default **Quarter Annual**.
- Each recurring price in its own box; no **"In lieu of…"** for itemized services.
- Existing services shown only when a new master is being sent.
- Riders reference the governing agreement by date and title.
- Contact information complete.

## 8) Clarifications and exclusions standard

Every schedule includes an **Assumptions and Clarifications** section, readable in the export. **Run BASELINES §0 length discipline before anything else** — most over-long sections are one boundary written twice.

Clarifications state assumptions, preserve approved boilerplate, identify coverage limits, state site constraints, and assign responsibilities. Exclusions remove ambiguity and define true out-of-scope work without contradicting listed equipment, labor, or services.

### Assumptions versus constraints
An **assumption** is a condition we believe true and priced against. A **constraint** is a condition the customer or site imposes that limits how the work gets done: restricted work windows, mandatory dock or freight elevator use, badging or escort requirements, closed areas, floor-protection or equipment-approval requirements.

Sales collects constraints before estimating, the estimator prices them, and the schedule states them so the boundary sits on the face of the document. Whether the estimate covered a constraint is settled upstream and is not a review question.

Assumptions are written as statements of fact. The section closes with one bullet naming the consequence when an assumption fails.

### Always include or consider
- Prevailing-wage disclaimer on commercial jobs; never residential.
- Deposit language when the total exceeds **$5,000**.
- Standard access language, required on every commercial job.
- A bounded training commitment.
- Site constraints, stated plainly.
- Coverage limitation for reused or taken-over equipment.
- **Permits:** Active Alarm files for and procures the permits required by local law; Subscriber pays the fees. Matches Commercial ¶12 and ¶27 and long-standing practice. Alarm-user permits and false-alarm registration remain Subscriber's. For fire alarm, confirm against the Fire Alarm master.
- The change-order consequence bullet.
- AHJ-driven changes beyond approved scope as extra work.

### Never do this
- Do not exclude work the schedule includes without a precise qualifier.
- **Do not exclude permit procurement.** Fees, engineering fees, and inspection fees stay excluded.
- No open-ended company promises: indefinite guarantees, warranty-like commitments with no time bound, training with no session count.
- Do not hide unresolved contradictions in customer-facing clarifications.
- Do not duplicate bullets.
- Do not leave copied customer-specific clauses in place unintentionally.
- Do not duplicate master provisions — limitation of liability, indemnity, subrogation, hazardous conditions, subcontracting authorization, storage of materials, supplier-caused delays, **Subscriber-caused delay charges (Commercial ¶13)**, supersession. ¶13 already carries $1,000 per business day for reschedules on under 24 hours' notice plus 5% of the Purchase Price after a year. Do not restate, soften, or cap it.
- Do not use "others," "Other," or "by others." Name the party.

## 9) Responsibility-boundary review
Assign the boundary between Contractor and: Customer/Subscriber, IT/Network, Electrician, Sprinkler contractor, Locksmith and door hardware, AHJ.

Test: Who provides power, circuits, panel labeling, network drops, internet, access, lifts, patching, ceiling restoration, cabling pathways, programming data, customer-owned devices? Who files the permit and who pays for it (we file, they pay)? What constraints does the site impose, and does the schedule state them? Who owns field devices furnished by another trade? Who is responsible for existing hardware condition and reused hardware coverage? Who coordinates inspection? What happens if the AHJ requires more than the approved scope?

## 10) Pricing and reconciliation rules
- WU final total matches the schedule and CRM values.
- RMR names, quantities, and amounts align with the WU and the approved pricing source.
- Split payment amounts sum exactly to the total.
- A deposit is required when the total exceeds **$5,000**; pricing block, clarifications, and master Down Payment agree.
- No pricing field or RMR quantity blank or shifted.
- Any discount appears exactly once across the WU, schedule, and agreement.
- Every equipment line on the schedule carries a matching cost on the WU.

Adequacy of the estimate is not reviewed here. See §0.

### Residential / special pricing
- Residential discount applies only when the residential customer pays the same standard rate as the comparable commercial service.
- The WU must show the **$250 discount** when given. It is **$50 per year of contract term**.
- Documented consistently in Quotewerks, WU, Zoho, and the schedule.

## 11) Existing, takeover, reuse, and replacement rules
- Verify which devices and services are existing versus new.
- Verify whether the schedule shows only the delta or re-states existing services.
- Narrow warranty language when taking over rather than furnishing.
- No warranty promised on parts merely taken over.
- Covered equipment, inspection basis, and repair service basis match actual reused counts.
- An FSI worksheet exists for any Repair Service or Inspection RMR, unless ACCOUNT-RULES says otherwise.

## 11a) Customer-furnished equipment rules
- List customer-furnished items in Equipment and Labor labeled "(provided by [Customer Name])."
- Itemize specific devices; no broad "Customer will provide all required hardware."
- The Clarifications bullet names the same specific items.
- Warranty carves out customer-furnished equipment explicitly.
- Add the clarification that customer-furnished equipment is assumed complete, compatible, and functional on delivery.

## 12) Technical and drafting rules that reveal copy-paste errors
- Part numbers on the schedule.
- Equipment itemization or the site address repeated inside the Scope of Work.
- Invalid system names or inconsistent service labels.
- Cabling contradictions.
- Solid cable specified for security; only fire uses solid cable.
- Mixed plenum and non-plenum on one job.
- Stale site information, customer name, system type, date, or equipment counts from another job.
- A document title, filename, or header naming a system its body does not sell.
- Documents belonging to another customer sitting in the folder and reaching the outgoing package.
- Inspection or approval language inconsistent with the permit / AHJ documents.

## 13) Attachment and support-document requirements
Drawings, floor plans, camera and device layouts where needed; riders tied to the governing agreement; Covered Equipment Addenda where required; WU cleaned of non-applicable tabs. Confirm each referenced attachment exists in the folder rather than assuming it does.

## 14) Formatting and export QA
Clarifications visible and printable; print area covers all content; no cut-off tables or hidden content; headers and footers per standard; consistent spacing; no spelling errors; no workbook clutter in customer-facing exports. Formatting semantics are content — strikethrough, color, and highlighting carry meaning and must be verified on the rendered export. Routine QA executes against **DRAFTER-PRESEND-CHECKLIST.md**.

## 15) Reviewer decision order
1. Right contract structure for this customer, system, and location?
2. Same customer, site, system, term, and billing across all documents?
3. Does the schedule reflect the equipment, labor, and recurring services sold?
4. Do agreement selections and rider structure follow from the schedule?
5. Does the scope describe the deliverable and the recurring services, without repeating the equipment list or the address?
6. Are third-party responsibilities, permit responsibility, and approval boundaries assigned?
7. Are the site's constraints stated?
8. Do clarifications and exclusions remove ambiguity without contradicting the schedule or the master, and does the list pass BASELINES §0?
9. Do pricing fields, deposit, discount, and recurring charges agree across documents?
10. Are all required attachments present in the folder?
11. Is the export readable, printable, and free of hidden or stale content?

## 16) Internal escalation rules
**The escalation list lives in PROMPT.md ("Hard Stop"), so the two documents cannot drift.** Stop and escalate rather than guessing when anything on that list holds.

## 17) Reviewer output
The deliverable is the edited schedule plus one email. **The email specification lives in PROMPT.md, Output Contract.** It is specified in one place so the two documents cannot drift.

Reviewer-notes mode, used only when explicitly requested instead of the email, returns: Review Checklist; Unknowns/Inconsistencies; Assumptions made; Scope redlines; Clarifications and Exclusions redlines; Additional agreement redlines. Label each unknown and additional redline **Hard stop**, **Needs answer**, or **Cleanup**. For each redline state the current issue, the proposed redline, and why.

## 18) Standardization and continuous improvement
- Do not reinvent clarifications and exclusions per job.
- Maintain baselines in **BASELINES.md**, SOW templates in **SOW-BASELINES.md**, account exceptions in **ACCOUNT-RULES.md**, the drafter checklist in **DRAFTER-PRESEND-CHECKLIST.md**, and the edit method in **SCHEDULE-EDIT-PROCEDURE.md**.
- Where a review settles a rule, land it in the governing document the same week. A rule that lives only in an email thread gets re-litigated.
- Where two documents would carry the same rule, put it in one and cross-reference from the other.

## 19) Companion documents
- **PROMPT.md** — run order, checks, and the email Output Contract
- **ACCOUNT-RULES.md** — account-level exceptions; read first
- **Schedule-to-Master Mapping Appendix — Final**
- **BASELINES.md** — the §0 length discipline and the clarification and exclusion rules; the bullet text is in **clarifications.json**
- **SOW-BASELINES.md** — SOW templates and the canonical opener
- **SCHEDULE-EDIT-PROCEDURE.md** — how to edit the workbook without damaging it
- **DRAFTER-PRESEND-CHECKLIST.md** — drafter completion and export QA
- **Commercial Security Master Agreement (Rev. 1)** — verified 2026-08-10. ¶12 one-year warranty from date of installation and Active procuring permits required by local law; ¶13 delay charges; ¶14 testing and Subscriber possession once installed; ¶24 subcontracting; ¶27 Subscriber responsibility for permit fees and alarm permits. No training clause, no acceptance definition.
- **Standard Fire Alarm Agreement** — not yet verified; confirm permit and warranty provisions before relying on the commercial positions.

## 20) Open items

Open rulings and their status live in `OPEN-DECISIONS.md`. Do not restate them here.