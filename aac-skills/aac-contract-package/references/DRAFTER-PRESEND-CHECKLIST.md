# Active Alarm Drafter Pre-Send Checklist — DRAFTER-PRESEND-CHECKLIST.md

## Document control
- **Document type:** Standing completion and export QA checklist (companion to Living Standard §3 and §14)
- **Audience:** Drafters (Sales Admin); reviewers verify at final QA only
- **Purpose:** Routine completion mechanics live here, not in review emails. Review emails carry decisions and document defects only (Living Standard §17). An item on this list appears in a review email only when it is found failed at final QA.
- **Revision note — 2026-08-11:** The issued proposal is read-only. Removed from the item 26 sweep list and scoped out of item 32. Nothing on this checklist ever prescribes a proposal edit or re-issue.
- **Revision note — 2026-08-10 (rev. 2):** Item 24 notes the subcontracted lockwork exception — a description-only line with no cost breakout, per the reversed Mapping Appendix §4 note.
- **Revision note — 2026-08-10:** Added the Zoho items, the foreign-document check, the quantity-column check, the rider header/body check, and the discount-applied-once check, all from recurring review findings (Terrence Blake Z-4148, Clearbrook 1405 Wescott, CPD Fosco Park Z-4184).

## Before you start
Read **ACCOUNT-RULES.md**. Where the customer carries a standing exception, that file overrides this checklist for the items it names. Accounts with no master agreement skip section B entirely.

The issued proposal is out of scope for this checklist. It has already reached the customer, and it is not revised, re-titled, re-issued, or swept. Where it disagrees with the schedule, the schedule governs and the correction lands on the schedule.

## A) Identity and entity
1. Legal entity verified on the **state Secretary of State** business entity search — Illinois: https://apps.ilsos.gov/businessentitysearch/. Third-party aggregators (OpenCorporates etc.) may be used to *discover* candidate entities and jurisdictions, but never as the verification source: every fact that lands in the package (legal name, status, assumed names) is confirmed on the SOS record itself.
2. Where an active assumed name is registered, subscriber name format is: **"[Legal Entity], an Illinois corporation, d/b/a [Registered Assumed Name]"** — assumed name spelled exactly as registered.
3. Subscriber name identical on the master agreement, the schedule's Subscriber block, and the rider. Site name and address consistent across all documents. The Zoho account name is not authoritative — where Zoho and the schedule disagree, use the registered name so it matches the existing master and rider.
4. One package = one Zoho deal = one job folder. After any consolidation, the Prospect # on the schedule matches the surviving Zoho deal.

## B) Master agreement completion
5. Date filled; matches the schedule date or is explicitly reconciled.
6. Telephone No. and Cell Phone No. (page 1) and Subscriber's Email Address (page 5) populated from the Zoho contact record.
7. Purchase Price / Down Payment / Balance match the schedule pricing block exactly. No-deposit deals: Down Payment $0.00, full balance due on completion (see section G).
8. Approximate start and substantial-completion dates filled if provided; "TBD" is acceptable in those two fields only. No "TBD" or "Other (Describe): TBD" left anywhere else on the agreement.
9. Billing frequency checked — **Quarter Annually** unless the customer requested otherwise in writing.
10. ¶2 service boxes follow the schedule's services.
11. ¶4 recurring amounts itemized in their own boxes per Mapping Appendix §1 rule 6; the **IN LIEU OF** line is not used for itemized services (correct only on the Other / See Schedule route). Box amounts sum to the schedule's Monthly Total.
12. ¶5 term filled and equal to the rider term.
13. If 4(b)(i) per-call service is selected: the Subscriber initial line is flagged on the signing copy. This happens when the package is sent for signature; it is never a review finding and never an instruction in a review email.
14. Rider: subscriber name and agreement date match the master; term filled. **The rider header and the rider body are the same form** — a Commercial Security header on a residential rider body means the wrong form was pulled. (The Rider for Additional Locations is standard with every new master package — do not question its presence.)

## C) Schedule completion
15. Headings exact: "SCHEDULE OF EQUIPMENT AND SERVICES"; "EQUIPMENT AND LABOR."
16. One Site line per site; one system header per system; no duplicated Site lines on a single-site job.
17. Every equipment line carries a quantity in the Qty column. Where a kit bundles a component (a panel kit that includes one keypad), the quantity shown is what is being **added**, and the scope and the WU agree on the total.
18. Every recurring line shows quantity, basis, unit price, and extended price; a recurring subtotal / Monthly Total is present.
19. No part numbers; approved system names only (see SOW-BASELINES.md §3).
20. SOW conforms to SOW-BASELINES.md — canonical opener verbatim with both cross-references ("at the site listed above, as itemized in the Equipment and Labor section"), designation token, **no equipment itemization and no site address in the SOW**. No square brackets or placeholder text anywhere in the package. The SOW is written from the template, never copied from the proposal.
21. Clarifications and Exclusions complete per `clarifications.json` (BASELINES.md points at each section's bullets), and the list passes BASELINES §0 length discipline — one boundary, one bullet; one topic, one bullet. Deposit bullet present **only** when the total price exceeds **$5,000**. Validity bullet opens with the words **"Pricing is valid for 30 days"** and anchors to the date of this schedule — never "Quotation is valid," never "date of proposal." Drop the Repair Service sentence on accounts with no master agreement.

## D) Pricing reconciliation
22. Purchase Price on the schedule equals the WU total. No formula pointing at an empty cell; no $0.00 in the pricing block on a priced job.
23. Any discount appears **exactly once** across the WU, the schedule, and the master agreement. A discount taken on the WU and again on the schedule under-prices the job.
24. Every equipment line on the schedule carries a matching cost on the WU. A line on the schedule with no cost behind it was either missed in pricing or does not belong on the schedule. Subcontracted mechanical/lockwork scope is the one exception — it appears as a description-only line with no cost broken out, per Mapping Appendix §4.
25. Zoho: the markup reflects the final markup on the WU summary page, including any discount. Zoho deal name covers every system in the package. Subcontractor Used is set correctly, with the sub's paperwork status noted where the answer is Yes.

## E) Sweep verification
26. When any instruction removes or changes a term package-wide ("remove X from the schedule, the clarifications, the master agreement, and any other places"), write down every location checked and confirm each one:
    - schedule pricing block
    - schedule Clarifications and Exclusions
    - SOW text
    - master agreement fields and checkboxes
    - rider
    - Zoho fields

    A sweep is not done until the location list is. The issued proposal is not a sweep location — it stays as sent.

## F) Export and file QA
27. Hide or remove workbook tabs not applicable to the deal before export (e.g., Covered Equipment / Covered Sites / CO templates when no Repair Service or Inspections are sold, or on any account that does not use them per ACCOUNT-RULES). Where a template tab **is** used, clear any counts carried over from another job before filling it.
28. Print area covers all content; the Clarifications and Exclusions block is fully visible — no cut-off rows, hidden rows, or truncated cells.
29. Headers and footers per corporate standard; spelling and grammar pass; consistent spacing.
30. File name reflects **every** system in the package and the site.
31. No strikethrough, highlighting, or markup colors in schedule or agreement exports. Presentation formatting (struck prices, colored totals) belongs to proposals only.
32. **Foreign-document check.** Job folders accumulate files that belong to other customers and other jobs — a rider PDF from another account, a template carrying another site's device counts, an old proposal. Confirm every document **still going out** names this Subscriber and this site. Anything that does not stays out of the outgoing package. The already-issued proposal is not part of this check.
33. Attachments: drawings/placement plans attached to the outgoing package; riders reference the governing master agreement by title and date; Covered Equipment Addenda attached when Repair Service or Inspections are sold; FSI worksheet on file in Source docs for any Repair Service or Inspection RMR.

## G) Execution capture (at signing)
34. Signer printed name and title; Tax ID / EIN; Subscriber initials wherever flagged (e.g., per-call service line); signature dates.

## H) No-deposit deals
35. Pricing block shows $0.00 down with full balance on completion; Clarifications contain no deposit bullet; master agreement Down Payment reads $0.00. Run the E-26 sweep with "deposit" as the term.