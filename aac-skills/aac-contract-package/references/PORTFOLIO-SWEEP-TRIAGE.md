# Portfolio Sweep Triage — 2026-08-20

Classifies each of the 22 recurring patterns in [`PORTFOLIO-SWEEP.md`](PORTFOLIO-SWEEP.md) (dated snapshot 2026-08-11) into one of three buckets. The triage is the input to the pilot's three-metric scorecard (issue #41 ruling 7):

- **(a) template-fixed** — the finding traces to a template defect that has since been corrected. A pilot package that still surfaces it is a regression and blocks ship.
- **(b) standard-fixed** — the finding traces to a rule that is now ratified (in `references/`). A pilot package that still surfaces it is a regression and blocks ship.
- **(c) standard-still-open** — the finding maps to an unresolved item in [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md), or no ratified standard governs it yet. Pilots may surface these until Dan rules; they do not block ship on their own.

Findings are listed in the same order as the sweep's top-table. Finding text is copied verbatim from that table. Sweep counts are the sweep's; nothing has been recomputed. No standard's language is restated here — each row cites the file that owns the wording.

Where the current template file is cited, the path is `fixtures/mock-jobs-root/_SALES .TEMPLATE FOLDER (DO NOT OVERWRITE THIS)/Equip & Svc Schedule Template.xlsx` (added to the repo in commit `8edd136`, "Land Additional Docs delivery: template fixtures"). That file is the on-repo copy of the template the drafter uses.

---

## 1. Permit procurement clarification present — 22, WARN

**Category:** (b) standard-fixed.
**Evidence:** [`BASELINES.md`](BASELINES.md) "Universal Baselines / Clarifications" subsection, line 77 (permit clarification; revision note 2026-08-10 aligns to verified Commercial Security Master); [`clarifications.json`](clarifications.json) `permits` bullet (order 55); [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md) item 9 resolved 2026-08-19 (commit `7d14d31`, "Resolve BASELINES wording conflicts: permit pair kept").
**Rationale:** The check WARNs when the permit-procurement clarification is missing from the block; item 9's ratification kept the pair, so the clarification is now mandated and old packages that omit it will always show up.

## 2. SOW carries "at the site listed above" — 21, WARN

**Category:** (b) standard-fixed.
**Evidence:** [`SOW-BASELINES.md`](SOW-BASELINES.md) §7.1 canonical opener (fragment ratified 2026-08-10; "of this schedule" trailing dropped 2026-08-17 per Dan); verifier CANON aligned in commit `26d5e73` ("SOW coverage for all sold system types + §7.3 device-set conditioning").
**Rationale:** The canonical SOW opener is ratified in SOW-BASELINES. Packages drafted under earlier SOW conventions (address typed into the SOW, or no cross-reference to the Site box) do not carry the fragment.

## 3. SOW carries "as itemized in the Equipment and Labor" — 21, WARN

**Category:** (b) standard-fixed.
**Evidence:** [`SOW-BASELINES.md`](SOW-BASELINES.md) §7.1 canonical opener cross-reference (ratified 2026-08-10, refined 2026-08-17); verifier CANON aligned in commit `26d5e73`.
**Rationale:** Same as pattern 2. The canonical cross-reference replaces the former "consisting of:" opener with its bulleted device list; older packages using the old opener don't carry the fragment.

## 4. Validity bullet opens "Pricing is valid for 30 days" — 20, FAIL

**Category:** (a) template-fixed.
**Evidence:** [`Equip & Svc Schedule Template.xlsx`](../../../fixtures/mock-jobs-root/_SALES%20.TEMPLATE%20FOLDER%20(DO%20NOT%20OVERWRITE%20THIS)/Equip%20&%20Svc%20Schedule%20Template.xlsx) cell A56 opens with the ratified wording; [`clarifications.json`](clarifications.json) `validity` bullet (order 10) is the authoritative text; [`PORTFOLIO-SWEEP.md`](PORTFOLIO-SWEEP.md) header explicitly names this as fixed in the template on 2026-08-11.
**Rationale:** The template's validity bullet was changed from "Quotation is valid" to the current opener on sweep day; two 2026-08-11 packages already carrying the new wording (CPD_Douglass Park, Mark Eschel) are annotated by the verifier as `found "Quotation is valid"`, which is the check's leftover-text explainer, not a claim the new wording is wrong. The FAIL fires on the old text.

## 5. Clarification count within 12-16 — 19, WARN

**Category:** (b) standard-fixed.
**Evidence:** [`BASELINES.md`](BASELINES.md) §0 "Target length" (12-16 clarifications, 8-10 exclusions) added in the 2026-08-10 revision note "§0 added — length discipline"; range hardcoded in `skill/aac-contract-package/scripts/verify_package.py` `CLAR_RANGE` (line 27).
**Rationale:** The count range is ratified as the length-discipline standard. Packages predating §0 ran long or short and did not aim for the range.

## 6. Purchase Price is a SUM over the equipment rows — 16, WARN

**Category:** (a) template-fixed.
**Evidence:** [`Equip & Svc Schedule Template.xlsx`](../../../fixtures/mock-jobs-root/_SALES%20.TEMPLATE%20FOLDER%20(DO%20NOT%20OVERWRITE%20THIS)/Equip%20&%20Svc%20Schedule%20Template.xlsx) cell G35 = `=SUM(G21:G34)`; [`PORTFOLIO-SWEEP.md`](PORTFOLIO-SWEEP.md) header explicitly names the Purchase Price formula as fixed in the template on 2026-08-11.
**Rationale:** Old templates carried a literal value or a non-SUM formula in the Purchase Price cell; the fixed template now uses `=SUM(...)`. Old packages inherited the un-SUM cell.

## 7. Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES" — 12, FAIL

**Category:** (a) template-fixed.
**Evidence:** [`Equip & Svc Schedule Template.xlsx`](../../../fixtures/mock-jobs-root/_SALES%20.TEMPLATE%20FOLDER%20(DO%20NOT%20OVERWRITE%20THIS)/Equip%20&%20Svc%20Schedule%20Template.xlsx) cell A7 reads "SCHEDULE OF EQUIPMENT AND SERVICES" (verified `AND`, not `&`).
**Rationale:** All 12 failing packages carry the ampersand form ("SCHEDULE OF EQUIPMENT & SERVICES"); the current template is the AND form. This is a template-fix regression check.

## 8. Equipment heading reads "EQUIPMENT AND LABOR" — 12, WARN

**Category:** (a) template-fixed.
**Evidence:** [`Equip & Svc Schedule Template.xlsx`](../../../fixtures/mock-jobs-root/_SALES%20.TEMPLATE%20FOLDER%20(DO%20NOT%20OVERWRITE%20THIS)/Equip%20&%20Svc%20Schedule%20Template.xlsx) cell A19 reads "EQUIPMENT AND LABOR".
**Rationale:** The 12 WARN packages carry the shorter "EQUIPMENT" heading; the current template uses the AND-LABOR form. Regression check for the template.

## 9. SOW designation token present — 12, WARN

**Category:** (b) standard-fixed.
**Evidence:** [`SOW-BASELINES.md`](SOW-BASELINES.md) §2 designation vocabulary (new / replacement / takeover / addition) and the §7 opener's `[DESIGNATION]` placeholder; DESIGNATIONS list in `skill/aac-contract-package/scripts/verify_package.py` (line 35).
**Rationale:** The designation vocabulary is a ratified part of every SOW opener. Packages that predate §7.1's canonical opener commonly omitted it.

## 10. Exclusions section present — 12, WARN

**Category:** (b) standard-fixed.
**Evidence:** [`BASELINES.md`](BASELINES.md) §0 mandates an Exclusions section alongside Clarifications; universal exclusion set in [`clarifications.json`](clarifications.json) `exclusions.universal`.
**Rationale:** Ratified length-discipline standard names both a Clarifications and an Exclusions header. Packages with no "Exclusions" header in the block predate the standard.

## 11. Every equipment line carries a Qty — 11, FAIL

**Category:** (c) standard-still-open.
**Evidence:** No OPEN-DECISIONS entry, unresolved. The check is mechanical (`verify_package.py` lines 254-256); no ratified standard document states "every equipment line carries a Qty" in so many words.
**Rationale:** Drafter-discipline finding. The template provides a Qty column but nothing ratified yet compels every non-header line to be populated; a rule would sit alongside the equipment-block conventions in `SCHEDULE-GENERATION-PROCEDURE.md` §6 (still draft outside §1/§6/§11/§12).

## 12. System header present — 11, WARN

**Category:** (a) template-fixed.
**Evidence:** [`Equip & Svc Schedule Template.xlsx`](../../../fixtures/mock-jobs-root/_SALES%20.TEMPLATE%20FOLDER%20(DO%20NOT%20OVERWRITE%20THIS)/Equip%20&%20Svc%20Schedule%20Template.xlsx) cell B22 seeds `System: ` on a row inside the equipment block.
**Rationale:** The current template carries the `System:` row inside the equipment block; the 11 WARN packages have no `System:` line in that block. Regression check for the template's seeded rows.

## 13. Filename names every system sold — 9, WARN

**Category:** (c) standard-still-open.
**Evidence:** No OPEN-DECISIONS entry, unresolved. Filename convention is enforced by the check (`verify_package.py` lines 438-443) but not documented as a ratified standard in `references/`.
**Rationale:** Drafter-discipline finding on the schedule filename. A naming standard would fit alongside the schedule cell map / handoff email conventions in `SCHEDULE-GENERATION-PROCEDURE.md`, whose remaining sections are still draft.

## 14. Prospect # filled — 7, FAIL

**Category:** (a) template-fixed.
**Evidence:** [`Equip & Svc Schedule Template.xlsx`](../../../fixtures/mock-jobs-root/_SALES%20.TEMPLATE%20FOLDER%20(DO%20NOT%20OVERWRITE%20THIS)/Equip%20&%20Svc%20Schedule%20Template.xlsx) cell E11 carries the `Prospect #` label.
**Rationale:** All 7 failing packages report `(no label)` — the label is absent from the schedule entirely, i.e. they were drafted on a template variant that did not include the Prospect # field. The current template has the label, so the drafter now sees where to fill it.

## 15. Clarifications do not say "proposal" — 6, FAIL

**Category:** (b) standard-fixed.
**Evidence:** [`clarifications.json`](clarifications.json) — search of every `text` field under `clarifications` returns no `proposal` occurrence; [`BASELINES.md`](BASELINES.md) §1 lists the ratified clarification set.
**Rationale:** The ratified clarification bullets do not use the word "proposal". Packages carrying the word came from bespoke text predating the ratified library; regression check for the standard clarification set.

## 16. Exclusion count within 8-10 — 6, WARN

**Category:** (b) standard-fixed.
**Evidence:** [`BASELINES.md`](BASELINES.md) §0 "Target length" (8-10 exclusions), added 2026-08-10; range hardcoded in `verify_package.py` `EXCL_RANGE` (line 28).
**Rationale:** Length-discipline standard. Same ratification path as pattern 5; packages predating §0 do not aim for the range.

## 17. Purchase Price equals the proposal total — 4, FAIL

**Category:** (b) standard-fixed.
**Evidence:** [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md) line 67 — proposal governs schedule, discrepancy escalates to rep (not silently reconciled).
**Rationale:** The proposal-governs rule is settled. A schedule that carries a Purchase Price different from the proposal total is a rule violation, not a rounding call; pilots that surface it are regressions.

## 18. No exclusion excludes permit procurement — 3, FAIL

**Category:** (b) standard-fixed.
**Evidence:** [`BASELINES.md`](BASELINES.md) "Universal Baselines / Exclusions" subsection, line 93 (permit-fee exclusion and its bracket note on the permit-fee/procurement boundary); [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md) item 9 resolved 2026-08-19 (commit `7d14d31`); the check's narrow-fee heuristic (`verify_package.py` lines 330-333) enforces "fees excluded, procurement not excluded."
**Rationale:** Item 9's ratification kept the pair and named exclusions that overreach into procurement as violations. Packages that excluded permit procurement are regressions.

## 19. Purchase Price non-zero — 3, FAIL

**Category:** (c) standard-still-open.
**Evidence:** No OPEN-DECISIONS entry, unresolved. Mechanical check (`verify_package.py` lines 272-273); no ratified standard document states "Purchase Price must be non-zero" in so many words.
**Rationale:** Drafter-discipline / mechanical hygiene finding. Same shape as pattern 11 — a rule would fit in `SCHEDULE-GENERATION-PROCEDURE.md`'s pricing-block section (still draft).

## 20. Deposit bullet present (price over $5,000) — 3, FAIL

**Category:** (b) standard-fixed.
**Evidence:** [`BASELINES.md`](BASELINES.md) 2026-08-10 revision note "$5,000 deposit threshold named"; [`clarifications.json`](clarifications.json) conditional `deposit` bullet (order 15, threshold codified in the `when` field); threshold hardcoded in `verify_package.py` `DEPOSIT_THRESHOLD` (line 29).
**Rationale:** The $5,000 threshold is a named standard. Failing packages over the threshold that omit the deposit bullet are regressions.

## 21. System headers use approved names — 2, FAIL

**Category:** (b) standard-fixed.
**Evidence:** [`SOW-BASELINES.md`](SOW-BASELINES.md) §3 approved-names table, extended in commit `26d5e73` ("SOW coverage for all sold system types") to include the six missing names; SYSTEMS list in `verify_package.py` (lines 36-39).
**Rationale:** The approved-names table is a ratified standard, extended 2026-08-19 for the six missing types (Nurse Call, Area of Refuge, Network, Standalone Intercom, Visitor Management, Standalone Environmental Monitoring). Packages using unapproved names ("System: Network Cabling", "System: Access Control" without matching the approved form) are regressions.

## 22. Deposit amount is 50% of Purchase Price — 2, WARN

**Category:** (b) standard-fixed.
**Evidence:** [`BASELINES.md`](BASELINES.md) 2026-08-10 revision note "$5,000 deposit threshold named"; [`clarifications.json`](clarifications.json) conditional `deposit` bullet names the 50% rate; rate hardcoded in `verify_package.py` `DEPOSIT_RATE` (line 30).
**Rationale:** The 50% rate is part of the ratified deposit bullet. Packages carrying a mismatched deposit amount over the threshold are regressions against the settled rule.

---

## Summary

| Category | Count | Patterns |
|---|---|---|
| (a) template-fixed | 6 | 4, 6, 7, 8, 12, 14 |
| (b) standard-fixed | 13 | 1, 2, 3, 5, 9, 10, 15, 16, 17, 18, 20, 21, 22 |
| (c) standard-still-open | 3 | 11, 13, 19 |
| **Total** | **22** | |

Pilot packages surfacing (a) or (b) findings are regressions and block ship. (c) findings — the three mechanical drafter-discipline items with no ratified rule text yet — are expected until the drafting-side sections of `SCHEDULE-GENERATION-PROCEDURE.md` outside §1/§6/§11/§12 are ratified.
