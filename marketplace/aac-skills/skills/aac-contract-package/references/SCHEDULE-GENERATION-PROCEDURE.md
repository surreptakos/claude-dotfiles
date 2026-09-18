# Schedule Generation Procedure — SCHEDULE-GENERATION-PROCEDURE.md

## Document control
- **Document type:** Governing procedure for creating a contract package from a job folder
- **Audience:** Sales Admin / drafters, GPT-assisted drafters, contract reviewers
- **Purpose:** PROMPT.md, the Living Standard, BASELINES, SOW-BASELINES, the Mapping Appendix, and DRAFTER-PRESEND all govern a package that already exists. This file governs producing one. It is the create-side companion to SCHEDULE-EDIT-PROCEDURE.md.
- **Created:** 2026-08-11
- **Status:** Sections 1, 6, 11, 11a and 12 ratified by Dan, 2026-08-19 (wayfinder ticket #4). Remaining sections draft. Section 3 was determined empirically from shipped schedules rather than from a prior written rule; it is flagged.

---

## 1. Source precedence

When two documents in a package disagree, resolve in this order. Each source is authoritative only for what its Governs column names; rank decides only when two sources speak to the same fact. Higher wins.

| Rank | Source | Governs |
|---|---|---|
| 1 | **Issued proposal** | Price, lease terms, RMR prices, anything the customer was quoted |
| 2 | Master agreement / ACCOUNT-RULES | Legal terms, account exceptions |
| 3 | BASELINES, SOW-BASELINES, Mapping Appendix | Clarification and exclusion text, SOW prose, RMR names and mapping |
| 4 | Work-up (newest by modified date) | Equipment, quantities, designation, labor, site facts |
| 5 | FSI worksheet | Inspection and Repair Service arithmetic |
| 6 | Sales checklist, site questionnaire, sub and supplier quotes | Everything else |
| — | Zoho CRM | Never authoritative. Validate against the above. |

**Where the proposal promises anything the master agreement does not permit, stop and escalate to the rep; never resolve it silently in either direction.** A cross-domain conflict has no winner in this table — it is a validation failure, not a precedence lookup.

Three rules follow from rank 1.

**Proposal pricing overrides the work-up and the FSI.** The proposal is what the customer saw and agreed to. Where the proposal and the work-up disagree on price, the schedule carries the proposal figure. Report the discrepancy to the rep in the handoff email; do not silently reconcile it and do not reprice the job.

**Multiple work-ups in one folder: the newest by modified date is the default source** for everything rank 4 governs, including when an older one has a visible system tab the newer one hides. When revisions disagree on price, assume the rep lost track rather than repriced (per Dan, 2026-08-13): reconcile the revisions line by line and figure out what changed before treating any figure as intentional. Whichever work-up reconciles to the proposal total governs labor hours, rates, and tab structure — even when it is older. The newest still governs equipment and scope unless the reconciliation shows silent drops there too. On the Riley Building job, a revision split labor across two tabs and silently dropped 17 hours; the older work-up was the one that reconciled to the proposal. The proposal total always governs price. The handoff email names which work-up served which purpose; there is no case where the drafter picks silently. (Ratified by Dan, 2026-08-19.)

**A prevailing wage checkbox is not evidence.** The flag on the work-up is frequently a template artifact. Judge from the field labor rate in the work-up's labor cost column (not the marked-up sell rate) against the approved labor costs table in `ESTIMATING-APPENDIX.md` §1. A field-tech cost matching the standard Field Tech rate is non-prevailing-wage; one matching the Prevailing Wage rate is prevailing wage. A field-tech cost matching neither, or a flag disagreeing with the rate, goes to the rep as a question — whether the job carries prevailing wage is an estimating decision, not the drafter's. (Ratified by Dan, 2026-08-19; costs table relocated to the Estimating Build appendix the same day, wayfinder ticket #7.)

---

## 2. Package composition

From `CONTRACT-PACKAGE-RULES.md`. Build every document on the applicable row; nothing is optional.

**Commercial, first job with this customer, or first job since we started using master agreements:**

- Schedule of Equipment and Services, carrying new equipment and services alongside **all existing services**
- Master Agreement, 5-year default term, listing all existing RMR
- Rider for Additional Locations
- Electronic Communication Disclosure
- Disclaimer Notice
- Drawing or placement plan showing device locations, for customer initials
- Onboarding forms: Emergency Contact List, IT forms, Billing Form
- **Credit application, when the deal is a lease**

**Commercial, any job after the master and rider are signed:** schedule, Electronic Communication Disclosure, Disclaimer Notice, drawing, onboarding forms, plus the Emergency Contact List when the system is monitored.

**Residential, every time:** master, schedule, rider, Cancellation Notice in three copies, Electronic Communication Disclosure, Disclaimer Notice, drawing, onboarding forms. No CCTV network form.

Two standing rules from the same source:

- **Service is always checked on every agreement.**
- **A combination fire and burglar panel requires both agreements signed.** Use the Security All-in-One for the intrusion equipment and services and the Fire All-in-One for the fire. State on the security contract that the intrusion system shares a panel with the fire system. The monitoring charge belongs on the fire contract and fire schedule, and both contracts state that the fire monitoring charge covers the intrusion system too.

---

## 3. Template locations

| Document | Path |
|---|---|
| Schedule | `P:\Jobs\_SALES .TEMPLATE FOLDER (DO NOT OVERWRITE THIS)\Equip & Svc Schedule Template.xlsx` |
| Commercial Fire master and rider | `P:\Agreements\New Agreements 8-22-19\Commercial Fire Package` |
| Commercial Security master and rider | `P:\Agreements\New Agreements 8-22-19\Commercial Security Package` |
| Residential | `P:\Agreements\New Agreements 8-22-19\Residential Security Package` |
| Baseline clarifications | `clarifications.json` is authoritative for the bullet text; BASELINES.md for the §0 rules. The docx in the template folder is a convenience copy. |
| FSI worksheet | `_SALES .TEMPLATE FOLDER\Source docs\Fire Repair & Inspection Template Rev.1.xlsx` |
| Lease calculator | `_SALES .TEMPLATE FOLDER\Lease Guide & Calculator Rev 1.xlsx` — **superseded 2026-08-24** for financed-deal payments (OPEN-DECISIONS item 18); route to `LEASE-PAYMENTS-POINTER.md`, which cites `SOP-LEAF-Financed-Installations.docx`. File stays retrievable under this name; do not rename or move it. |
| Onboarding forms | `P:\Contract Training\Customer Onboarding Forms` |

Copy the template into the job folder. Never draft in the template folder, and never overwrite a template.

A job folder often already holds an older copy of the schedule template, carried in when the folder was created. Check the modified date against the template folder and draft from the newer one.

---

## 4. Schedule cell map

Tab: `Equip & Services`. Rows shift as you insert equipment lines, so fill top to bottom and re-read the anchors after each insertion.

| Cell | Contents |
|---|---|
| A10 | Subscriber legal name and billing address, three lines |
| C10 | Site name and full address, three lines |
| G9 | `=TODAY()`, leave the formula |
| G10 | Sales representative |
| G11 | Prospect number: the Zoho deal's True_Lead_Number (Z-xxxx). Where no deal exists, create one in Zoho first — name it `<Customer>_<Site> - <System>` per the account's existing deals, owner = the sales rep, amount = the Purchase Price, stage = Contract Review, RMR and job-folder fields filled — then read the Z-number off the new record |
| A15 | Scope of work, opening `Active Alarm Company will ` |
| A19 | `EQUIPMENT AND LABOR` |
| Row 20 | Column headers |
| A21 / B21 / F21 / G21 | `-` / `Site: <name and address>` / unit price / extended price |
| B22 | `System: <approved system name>` |
| Rows 23-34 | Equipment lines, quantity in column A, description in column B |
| G35 | Purchase Price, `=SUM(G21:G34)` |
| G36 | Deposit amount |
| G37 | Balance due, `=G35-G36` |
| A39 | `SERVICES` |
| A41 / B41 | `-` / `Site: <name and address>` |
| B42 | `System: <approved system name>` |
| B43 / B46 / B50 | `New Services` / `Replacement Services` / `Existing Services` |
| Rows 44-52 | Service lines: quantity, description, unit monthly, extended monthly |
| G53 | Monthly Total, `=SUM(G41:G52)` |
| A56 | Clarifications and Exclusions, one rich-text cell, four runs |
| Rows 100+ | Signature block |

**Editing mechanics are governed by SCHEDULE-EDIT-PROCEDURE.md.** Never save a schedule through openpyxl or any other spreadsheet library. Use `scripts/xlsx_surgical.py`. A56 is rich text with four runs: bold `Clarifications`, body, bold `Exclusions`, body. Update runs 1 and 3 only. Line breaks inside the cell are `\r\n`; bullets are `• `.

**Multi-Site and multi-System layout.** *Amended 2026-09-10 (spec 215 stream B, ADR-0001); awaiting Dan's signature.* The cell map above shows the single-Site single-System base form. A Project spanning multiple Sites or Systems within one Contract family (SOW-BASELINES §3) repeats the Site and System blocks inside the same anchored regions, and every row anchor is located by its label — never by fixed row number — because block repetition shifts the row counts in the base map:

- **Equipment and Labor** carries one Site block per Site. The Site line (`-` in column A, `Site: <name and address>` in column B, that Site's unit and extended purchase price in F and G) opens the block. Below the Site line, one System sub-block per System: `System: <approved system name>` in column B, followed by that System's equipment lines (quantity in A, description in B, no per-line price in the default variant). The next Site starts a new Site line. `G35` still sums the whole Equipment and Labor range; deposit and balance derive from that sum unchanged.
- **Services** repeats the same Site-then-System sub-block structure. Inside each System sub-block the per-subgroup rows — `New Services`, `Replacement Services`, `Existing Services` — appear only for subgroups that carry lines for that System. A System with no service lines carries no System sub-block in the Services section; the Equipment sub-block is unaffected. `G53` sums the whole Services range.
- Cross-family Projects are not built as one schedule: the builder refuses with a split instruction (issue #10 ruling 1; SOW-BASELINES §3).

Worked two-system example, tokens only, drawn from `fixtures/golden/golden-17/expected/`:

```
                                          EQUIPMENT AND LABOR

Qty Description                                                    Unit Price   Extended Price

-   Site: SITE-17

    System: Intrusion Alarm

2   Wireless Door Transmitter

    System: Access Control

1   Mullion Smart Reader
    22/6 Stranded Shielded Riser Cable
    18/2 Stranded Unshielded Riser Cable
    Conduit & Electrical

                                                SERVICES

Qty Description                                                    Unit Monthly   Extended Monthly

-   Site: SITE-17

    System: Intrusion Alarm

    New Services

1   Alta Cloud Video with Analytics and 30 Days of Cloud Storage - Per Camera   $20.00   $20.00

    System: Access Control

    New Services

1   Alta Cloud Access Control, Premium Tier - Up to 1 Entry        $22.50         $22.50
```

The Site line carries the Site's extended price in the default variant; the Purchase Price at G35 sums every Site line across the block. On the line-item variant (§6), the Site line's price cells are cleared and each equipment line carries its own quantity × unit price = extended price.

---

## 5. Scope of work

Write it from SOW-BASELINES, filling the template for the system sold. Never copy proposal prose into the schedule. The proposal sells; the schedule is the contract. Translation through the SOW template is the firewall.

Determine the designation from the work-up and the proposal, not from the folder name. An existing system of the same type at the site means replacement or takeover, never new.

---

## 6. Work-up to Equipment and Labor translation

*Determined from shipped schedules, then ratified with amendments by Dan, 2026-08-19.*

**The price sits on the Site line, not on the equipment lines.** Row 21 carries the site and the full extended price in columns F and G. Individual equipment lines below it carry a quantity and a description and no price. This is why the schedule can list accessories and roll-ups without exposing a cost breakdown.

**Descriptions are plain English, never part numbers.** Resolve each line's schedule name in this order (ratified by Dan, 2026-08-19): (1) the work-up's own Description field, used when it passes muster — plain English, customer-recognizable, no bare part number; (2) the translation dictionary in `PART-TRANSLATIONS.md`; (3) the drafter proposes a plain name, and the addition enters the dictionary through a ratification PR; (4) no obvious plain name means a question for the rep — a raw part number never ships. The PartList snapshot in `fixtures/exports/` identifies parts (SKU, manufacturer, cost); it never names them. The table below shows the required style.

| Work-up line | Schedule description |
|---|---|
| `XR150DNFC-R` Fire Command Control Panel | Fire Alarm Control Panel |
| `263LTE-2` LTE Cell Communicator | Cellular Communicator |
| `630F-R` Remote Fire Command Center | Remote Annunciator |
| `1164-W` WLS Smoke Det w/Sync Sounder | Wireless Smoke Detector with Sounder |
| `1184-W` Wireless CO Detector | Wireless Carbon Monoxide Detector |
| `NP12-12` Valve Regulated SLA Battery | Battery Backup |

**Quantities come from the work-up, not the proposal.** The proposal routinely undercounts batteries, harnesses, and accessories. Where the two disagree on a quantity, the work-up governs and the discrepancy goes to the rep.

**These work-up lines never appear as schedule lines:** trip charges, freight, `MISC` roll-ups, tax, labor line items, supplier conduit and fittings sections, and anything with a blank quantity. They are inside the price on the Site line.

**Line-item variant, on request only.** The standard format above (price on the Site line, no per-line costs) is the default. When the customer asks for parts-and-labor line-item pricing and Sales approves the deviation (Dan approved it for the Riley Building job, 2026-08-13), the approval is recorded in the handoff email — who approved and when — and the rules are:

- Parts-list order: new equipment first (largest unit price first), then materials, then labor by category, then Subscriber-furnished equipment separated at the end under its own header line ("SUBSCRIBER-FURNISHED EQUIPMENT, REINSTALLED AT NO CHARGE:", qty "-", no prices, items beneath with quantity and description only).
- Every line's quantity times unit price equals its extended price exactly. No line rounds off.
- Unit prices come from the work-up: each tab's material cost times that tab's markup, and labor at the effective labor rate with hours as the quantity, one line per labor category.
- The lines sum to the proposal total exactly. One roll-up line (miscellaneous materials, connectors, freight) absorbs the work-up's rounding.
- Customer-furnished equipment lists with a quantity and description, an empty unit-price cell (not a dash, not a zero), and $0.00 extended.
- The Site line's price cells are cleared, not zeroed.

**Subcontracted mechanical and lockwork** appears as a description-only line with no cost broken out, per Mapping Appendix §4.

Every equipment line carries a quantity in column A.

---

## 7. Services section

Group under the Site line and the System line, then under `New Services`, `Replacement Services`, or `Existing Services`.

Use the schedule name from the RMR Items sheet, never the old or technical name. The name must match its price tier; if the price belongs to a different named tier, one of the two is wrong.

A replacement service names what it replaces, indented beneath it with the old price:

```
1   Commercial Smart Security Monitoring via Cellular Radio (Replaces existing services below)     49.00   49.00
              - Monitoring Service Of The Security System @ $38.50/mo.
```

Show the quantity basis on the schedule wherever pricing is per door, per camera, or per site.

**When no RMR is sold, the Services section reads `N/A`.** Never blank.

Repair Service and contracted Inspections carry the proposal price, validated per Mapping Appendix §3a; the FSI worksheet must be saved in the job folder's `Source docs`.

---

## 8. Pricing block

Purchase Price equals the **proposal** total. Deposit is 50% whenever the total exceeds $5,000, and $0.00 otherwise. Balance is the difference.

Confirm G35 holds `=SUM(G21:G34)` and not a formula pointing at a single empty cell. A $0.00 pricing block on a priced job is the most common defect on these schedules.

Any discount appears exactly once across the work-up, the schedule, and the agreement.

**Lease deals.** A lease routes to the Lease Agreement and requires a credit application. Repair Service and Inspections are priced and sold separately from the lease and stay on the schedule as RMR. Take lease payment and term from the proposal; where the lender's agreement states different terms, that is a question for the rep, not a silent correction. The documentation fee follows the contract value: $225 up to $25K, $325 to $50K, $425 to $75K, $525 to $100K, $625 above.

---

## 9. Clarifications and exclusions

The template ships with the unconditional universal set from `clarifications.json`. Add the conditional bullets the job earns:

| Bullet | Include when |
|---|---|
| 50% deposit | Total exceeds $5,000 |
| Tax exemption certificate | Nonprofit, school or park district, municipality |
| Customer-furnished equipment | The customer is furnishing equipment |
| Prevailing wage, affirmative form | Labor is priced at prevailing wage rates |
| Reused / taken-over equipment set | Designation is replacement or takeover |
| Site constraints | The site imposes a constraint |
| System-specific set | Per `clarifications.json` `by_system`, by system type |

Then run BASELINES §0. Group by topic, find topics carrying more than one bullet, merge. Target 12 to 16 clarifications and 8 to 10 exclusions on a single-system commercial schedule.

Never exclude permit procurement. We file and procure; Subscriber pays the fees.

---

## 10. Review gate

Draft, then send to Mark for review, noting the file location in the job folder. Mark may route it to Dan for final review. Only after approval does it go to Zoho Sign, using the template matching the contract type.

Run DRAFTER-PRESEND-CHECKLIST.md before handing off. Then run the package through the reviewer standard in PROMPT.md as a self-check.

---

## 11. Verification

Run `scripts/verify_package.py` against the job folder. It covers roughly 20 of the 35 pre-send items and exits non-zero on any failure.

```
python verify_package.py "<job folder>"          one package
python verify_package.py "<job folder>" --quiet   findings only
python verify_package.py "P:\Jobs" --sweep        the whole portfolio
```

Fix every FAIL. Judge every WARN. Each WARN judged acceptable gets one line in the handoff email saying why.

**When a finding looks surprising, check it against the source document before reporting it.** A verifier bug reads exactly like a package defect, and a tool that cries wolf gets ignored, which is worse than no tool. Three false-positive classes were found and fixed this way on the first day of use: a proposal carrying more than one "Total Investment" line, the Commercial Fire field map applied to a residential master, and "TBD" flagged in the two date fields where item 8 permits it.

Two behaviours worth knowing so a clean run is not misread:

- Anchors are located by searching for their labels, never by fixed row numbers. Rows get inserted and deleted per job.
- Formula values are recomputed from their ranges rather than read from Excel's cache, because a cached value is stale until Excel reopens the file.

A clean run does not mean the package is correct. It means nothing mechanically checkable is wrong. What the verifier does and does not cover is tracked in `docs/verifier-coverage.md` and the open tickets in the GitHub tracker; do not restate the coverage split here (Dan's rule 2026-08-25).

---

## 11a. The export pass

Added 2026-08-13 per Dan; expanded the same day after a second round of render findings.

After the verifier runs clean, run these steps in order. The deliverable that leaves the folder is the **PDF**, not the workbook.

**1. Stop-slop the schedule text.** Run the stop-slop pass over every cell the drafter authored: the SOW, equipment and service descriptions, job-specific clarifications. No em dashes anywhere on the schedule. Set off an aside with a colon, parentheses, or a comma instead. Governed bullet wording from clarifications.json is Dan's and stays as written unless he directs otherwise.

**2. Clean the grid.**
- Hide unused blank rows in the Equipment and Labor and Services sections. Hide, never delete: the pricing formulas sum fixed ranges, and deleting rows breaks them.
- No placeholder characters in price columns. A line with no price carries an empty cell, not a dash and not a zero. The Site line's price cells are cleared when the line-item variant is in use.
- Font sizes consistent across the schedule. The body standard is Calibri 11; the Subscriber and Site blocks ship at 10 in the template and get bumped to match. Measure on the render (pdftotext -bbox glyph heights), not by eye.
- Indents consistent: the Description column header and every item description carry the same indent, and no row's cell style carries a deeper indent than its neighbors (template rows 33-34 do; reset their styles to match the item rows).
- One blank line between the Clarifications block and the bold Exclusions header inside the merged cell.
- The Clarifications and Exclusions merged cell must be tall enough for all of its text. Excel clips what does not fit, and the clip is invisible in every cell-level check. Size the rows inside the merged range so the rendered text fits with margin — roughly 20 points per row across the merge on a full-length list — and confirm on the render.

**3. Convert and look.** Convert the workbook to PDF (LibreOffice headless where Excel is unavailable), render every page to an image, and look at each one. The verifier reads cell values; only a render shows what the customer will see. Look for clipped or overflowing rows (the SOW row especially), numbers printing without currency formatting, stray $0.00s, content pushed off the print area, cut-off clarifications.

**3a. Test the render totals.** Extract text from the PDF (pdftotext) and assert the pricing block and Monthly Total print the recomputed values: the Purchase Price once, the Deposit and Balance amounts twice each on a 50%-deposit job, the Monthly Total matching the service lines. The failure this catches: the builder leaves formula caches stale, LibreOffice renders the cache, and Balance and Monthly Total print $0.00 while every cell-level check passes (Riley Building, 2026-08-13). The fix is writing the recomputed value into the formula cell's cache before converting, keeping the formula so Excel still recalculates.

**4. Trim and deliver.** LibreOffice prints hidden tabs that Excel skips, and the footer's &N counts them, so "Page 1 of 4" prints on a two-page schedule. Convert from a render-only copy whose footer is pinned to the schedule's own page count ("Page &P of 2"), then strip the hidden-tab pages from the PDF (pypdf page extraction is fine here — the prohibition on spreadsheet libraries covers the workbook, not the PDF) so the deliverable carries only the schedule pages. Save the PDF in the job folder alongside the workbook. Serve the PDF.

Two LibreOffice conversion artifacts are not defects: the hidden-tab pages handled above, and stale cached formula values that Excel recalculates on open — the verifier recomputes those from their ranges, so trust it over the render for formula cells.

Fix what the eye catches, re-render, and look again until clean. This pass covers what a render can show; the final print check in Excel remains the drafter's.

**5. Clean up.** Delete every interim file the pass created: render images, temporary workbook copies, superseded PDFs, scratch exports. When a deliverable is re-issued, the superseded copy goes too (a locked file moves to `_to_delete\` until it can be deleted). When done, the job folder holds only the package documents, `_facts.json`, the source documents that were already there, and the `_to_delete\` backups; the scratch area holds only the current deliverables. Interim artifacts never ship and never linger.

---

## 12. The handoff email

The Output Contract in PROMPT.md governs the review email, where a reviewer edited someone else's file and the drafter needs to know what moved.

**When the drafter and the reviewer are the same person, the change list drops out.** There is nothing to report; the recipient opens the file. What remains is questions for the rep, what is still the recipient's work in imperative voice, and the conditionals with both branches carrying exact replacement text.

Everything else in the Output Contract still applies: questions first and numbered with one polite lead-in, no workup block when the workup is internally consistent, the customer named by entity or role and never by first name, no reasons and no sources in the instruction lists, and `write-like-dan` then `stop-slop` then cut, with the score shown before delivery.

---

## 13. Companion documents

PROMPT.md; Active Alarm Contract Package Review Living Standard; Schedule-to-Master Mapping Appendix; BASELINES.md; SOW-BASELINES.md; ACCOUNT-RULES.md; DRAFTER-PRESEND-CHECKLIST.md; SCHEDULE-EDIT-PROCEDURE.md; Contract Process Checklist.docx; `CONTRACT-PACKAGE-RULES.md`; RMR Items sheet (Drive; snapshot under `fixtures/google-drive/`).
