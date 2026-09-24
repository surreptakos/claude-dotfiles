# Open Decisions — 2026-08-11

The ruling ledger, opened 2026-08-11 and carried forward since. An item is open when it carries no **Resolved** or **Executed** line; the ledger below is history and is never rewritten (Dan's rule 2026-08-25: do not restate item counts elsewhere — read this file).

## Still open (2026-09-24)

- **12** — Tom's five answers (CUSTOMER-14 only; live-deal work, not roadmap).
- **13** — Fire Alarm System to Code checkbox and plans-filed-by field (CUSTOMER-14 only).
- **16** — Whether anything still in flight from the portfolio sweep gets corrected.
- **17** — Deleting the two duplicate document sets (Claude project knowledge; Documents folder) — off-repo.
- **22** — The crew-day floor remainder of the subcontractor markup ruling.

Everything else below is resolved, and where execution was pending it is recorded on the item. Each line names who owns it and what changes once it is settled.

---

## Ratifications (Dan)

**1. Generation procedure §1, source precedence.** ~~Ratify as written or amend.~~ **Resolved 2026-08-19** (wayfinder ticket #4): ratified with amendments — precedence is domain-scoped with a hard stop on proposal-versus-master conflict; prevailing wage judged from the labor cost column against the approved labor costs; the two work-up rules merged with explicit reconciliation precedence. Wording is in §1.

**2. Generation procedure §6, the work-up to Equipment-and-Labor translation.** ~~Confirm that is deliberate rather than one person's habit.~~ **Resolved 2026-08-19** (wayfinder ticket #4): deliberate, ratified with amendments — description resolution order (work-up Description field first, then `PART-TRANSLATIONS.md`), largest unit price first in the line-item variant, kit sentence removed, deviation approval recorded in the handoff email.

**3. Generation procedure §11, verification discipline.** ~~New.~~ **Resolved 2026-08-19** (wayfinder ticket #4): ratified, §11a included, plus one line in the handoff email for each dismissed WARN.

**4. Generation procedure §12, the handoff email.** ~~New.~~ **Resolved 2026-08-19** (wayfinder ticket #4): ratified as written; the stop-slop scoring rubric is vendored at `skill/stop-slop/` so the 42/60 threshold cites an in-repo file.

**5. The LEAF SOP.** ~~Issue as v1.0 or hold.~~ **Resolved 2026-08-20** (wayfinder ticket #9): **issued v1.0.** Lender facts rest on LEAF's own lease form and quoting tool; the nine process steps carry no live precedent yet, and the first real financed deal amends the SOP by PR. Status flipped in `00-INDEX.md`; the builder's financed-deal shape (full price in the pricing block, deposit $0.00, LEAF payable clarification, no deposit clarification) now cites an issued SOP.

---

## Standards conflicts (Dan, with Mark where noted)

**6. Mapping Appendix §3a, the CUSTOMER-14 worked example.** ~~It does not reproduce from the FSI worksheet on file, and both are cited as authority.~~ **Resolved 2026-08-19** (wayfinder ticket #7): §3a rewritten validation-only; the worked example moved to `ESTIMATING-APPENDIX.md` §5 with the $46 relabeled as the combined program (Repair Service alone $21) and the $40-versus-$25 divergence recorded. Mark's 2026-08-03 ruling stands: the customer keeps the quoted $25; the quoted price governs, which is package law already.

**7. The 1% Repair Service basis.** ~~§3a leaves it open.~~ **Resolved 2026-08-19** (wayfinder ticket #7): estimating-owned, out of contract-package scope. The drafter never derives a Repair Service price, so no basis ruling is needed for package work. The open basis question (equipment cost versus full WU cost) is flagged in `ESTIMATING-APPENDIX.md` §2 for the estimating build.

**8. Repair Service start date.** ~~Cutover or month 13, after the one-year parts-and-labor warranty.~~ **Resolved 2026-08-19** (wayfinder ticket #7): **cutover.** Dan ratified Mark's CUSTOMER-14 position as the written rule — the customer pays through year one and is covered for calls the warranty does not reach. Rule recorded in MAPPING-APPENDIX §3a. **Reversed 2026-09-22, item 24.**

**9. The permit fee overlap in BASELINES.** ~~Keep both or drop the exclusion.~~ **Resolved 2026-08-19** (wayfinder ticket #8): **keep both.** Dan ruled the permit-fee restatement deliberate; the exclusion's bracket note now records the ratification so §0 Rule 1 sweeps stop flagging the pair.

**10. The Rider bullet in BASELINES.** ~~Move it to the reviewer notes.~~ **Resolved 2026-08-19** (wayfinder ticket #8): **bullet deleted entirely.** The whole bullet was reviewer instruction, never customer-facing text — the Contract Package Rules already name the rider as a standard package component, and pre-send item 14 keeps the reviewer-facing do-not-question copy.

**11. Contract Package Rules versus Mapping Appendix on IN LIEU OF.** ~~These reconcile and neither document says so.~~ **Resolved 2026-08-19** (wayfinder ticket #8): consolidated, one full rule. MAPPING-APPENDIX §1 rule 6 now owns the complete IN LIEU OF rule (Other / See Schedule route only; combine all RMR pricing there without fragmenting the master wording; fallback when boxes cannot be identified); old rule 8 folded into it. Pre-send item 11 and the PROMPT.md email-instruction rule stay as point-of-use checks citing rule 6. Contract Package Rules moved into `references/CONTRACT-PACKAGE-RULES.md` on 2026-08-21 (issue #43); §2.6 there is the same point-of-use note, transcribed verbatim from the source tab.

---

## Blocking CUSTOMER-14

**12. Tom's five answers.** In the handoff email: the $5,158 versus $5,134 price, whether the customer knows a 50% deposit applies, the blank Fire tab of the sales checklist including who filed the plans with the AHJ, the legal entity and any assumed name, and confirming she understands detector cleaning is not included.

**13. Fire Alarm System to Code.** The checkbox and its plans-filed-by field are left blank on the master and move together. Our permit clarification says we file and procure; the agreement's own NOTICE says that unless the box is selected, applying for permits is *not* our responsibility. So the box almost certainly needs checking, and it cannot be until Tom answers item 12.

---

## Live defect (Dan)

**18. Lease Guide wrong-payment risk.** Split from item 14 by Dan's ruling (2026-08-21, tracker issue #36): the Lease Guide and Calculator document AAC-as-lessor structures with our own rate factors, and the Guide will produce a wrong payment on the next financed deal. This item carries defect priority, separate from the housekeeping question of how the retired lessor forms are marked. ~~Needs Dan's ruling on the fix (correct the Guide, retire it, or replace it).~~ **Resolved 2026-08-21** (Dan, in-session ruling): **replace with a LEAF pointer.** The Lease Guide and Calculator are marked superseded and stay retrievable — existing artifacts may reference the "Lease Calculator" by name, so nothing is deleted or renamed away from findability. A one-page pointer document states that financed deals quote payments through LEAF's own lease form and quoting tool, citing the issued LEAF SOP v1.0; no in-house payment math survives as authority. ~~The interim guard (drafters do not quote financed-deal payments from the Lease Guide) stays in force until the pointer document and superseded markings land.~~ **Executed 2026-08-24** (issue #100): pointer landed at `LEASE-PAYMENTS-POINTER.md`; the Lease calculator row in `SCHEDULE-GENERATION-PROCEDURE.md` §3 and the Equipment Lease row in `MAPPING-APPENDIX.md` §3 both carry the superseded marking and route payment questions to `SOP-LEAF-Financed-Installations.docx`; `00-INDEX.md` lists the pointer and notes the jobs-drive lease calculator as superseded. **The interim guard is lifted.**

## Housekeeping (Dan)

**20. Live-Drive coordination of the Contract Package Rules migration.** Opened and **resolved 2026-08-21** (issue #43). Dan ruled in chat: **stamp the title** — the live first tab of the RMR Items sheet is renamed to `MIRROR OF REPO — DO NOT EDIT (PRs only)`, keeping the content visible to Sales Admin during the bridge period. The rename was applied the same day via the Sheets API and read-back verified; `docs/DRIVE-COORDINATION-LOG.md` carries the dated entry. The rule text is repo-authoritative in `references/CONTRACT-PACKAGE-RULES.md` (§5 records the coordination model); the target-state fixture `fixtures/google-drive/RMR-Items-post-retirement-target.xlsx` carries the stamped form, pinned by `tests/test_drive_retirement_target.py`. `py -3 scripts/apply_drive_mirror_stamp.py --check-live` re-proves live state at any time; `--revert` restores the pre-migration name if ever needed. (Item numbered 20 because PR #83 assigns 19 to registry entity-name verification.)

**14. Retiring Active Alarm as lessor.** Three LEASE packages sit in the agreements folder and the Lease Guide and Calculator documents three AAC-as-lessor structures with our own rate factors. Nothing has been moved or deleted, because St. Sophia, Wentworth Volo and Cleaver Brooks are live AAC-as-lessor leases and the forms must stay retrievable. ~~Say how you want them marked superseded: a `_RETIRED` prefix on the folders, a note inside each, or a line at the top of the Lease Guide.~~ **Resolved 2026-08-21** (Dan, in-session ruling): **`_RETIRED` prefix on the folders.** Visible at a glance, no file content touched, forms stay retrievable for the three live leases. The jobs drive is not mounted on the dev machine; the rename executes the next time it is reachable. **Executed** — Dan confirmed the `_RETIRED` rename done, 2026-09-18 (in session, recorded on issue 273). The Lease Guide wrong-payment risk was split out to item 18 (Dan's ruling, 2026-08-21).

**15. Pre-ticked checkboxes on the other masters.** The Commercial Security master ships with six boxes ticked and the Residential with seven. On the Fire master, two pre-ticked boxes turned out to be correct defaults (Quarter Annually billing, and 2(a) service per call). I did not touch the other two forms because their field semantics are unmapped and a default cannot be told from a leftover without reading the clauses. ~~Worth a look before the next security or residential job.~~ **Resolved 2026-09-24** (Dan, in-session ruling, recorded on issue 334): **answered by issue 40.** The builder sets every mapped box from deal facts and never consults template state (issue 40 ruling 1); every pre-tick was removed from the four blank forms under issue 42 (ruling 2); the box mapping is the RMR Items "Standard RMR" tab (ruling 4). Nothing remains open on the two forms; their field maps are issues 336 and 337.

**16. The portfolio sweep.** 25 drafted packages carry findings, listed per job in `references/PORTFOLIO-SWEEP.md`. Signed and exported packages are history; the value is in the recurring patterns, and the top two trace to template defects fixed today. Decide whether anything still in flight gets corrected.

**17. Delete the duplicate copies.** Closed on 2026-08-11: every governing document now ships in the skill's `references/` folder, which is the only authoritative copy. Two duplicate sets must be removed so they cannot drift:

- **Claude project knowledge** still holds the eight review-side documents. Delete them; upload one pointer file saying the standards live in the `aac-contract-package` skill and nothing in project knowledge is authoritative.
- **Documents folder** holds the copies moved off the P: drive. Delete once the skill is installed and verified.

## Rulings added later

**19. Registry verification of legal entity names (ROADMAP step 1, "OpenCorporates permissibility").** **Resolved 2026-08-21** (Dan, in-session ruling): **permitted, verify and flag.** The drafter may check a customer's legal entity name and assumed names against a public company registry (OpenCorporates or the state Secretary of State) during package build. A mismatch becomes a WARN item routed to the rep; it is never silently corrected — the rep-confirmed name governs what prints.


**21. BASELINES compression — tags, merges, and the small-job target.** Opened and **resolved 2026-08-26** (Dan, in-session ruling, from the Clearbrook Commons-Krause compression review): all eleven proposed items ratified. Applicability tags on four universal exclusions; Access Control additional-power-supplies bullet deleted; deposit and credit-card fee merged; cabling-pathways assumption folded into the site-conditions bullet; access bullet’s consequence clause bracketed behind Commercial ¶13 with a no-master append rule; software-licensing bullet compressed; IT/network bullet tagged for cloud architectures; §0 gains a small-retrofit target of 10–12 clarifications and 5–6 exclusions. Wording is in BASELINES.md under the 2026-08-26 revision note. The ratified proposal document is on the jobs drive: `BASELINES Revision Proposal 2026-08-26.md`.


**22. Subcontractor pass-through markup tiers.** Opened and **resolved 2026-08-27** (Dan, in-session ruling, Clearbrook Commons-Krause lockwork review): sub furnish-and-install scope is priced by placement — 20–25% inside base sections, 10–15% when broken out as a separable or optional section. The 64% standard stays on self-performed scope; blended markup is not the health metric on mixed jobs. Rule recorded in ESTIMATING-APPENDIX.md §6, which is live policy despite the appendix's parked status. **Open remainder:** the gross-profit-per-crew-day floor awaits P&L review; until it is computed, 64% on self-performed scope is the working standard.

**24. Repair Service start date, reversed.** Opened and **resolved 2026-09-22** (Dan, in-session ruling, Premier Eye Care Z-4260 services-only review): **month 13.** Reading Commercial Security ¶7 against ¶12, the warranty already covers parts and labor on defects for a year and both paragraphs exclude the same damage classes, so year-one Repair Service adds only no-defect labor calls. Item 8 is reversed; MAPPING-APPENDIX §3a rewritten with the schedule and master presentation (full price with "(begins month 13)", SOW states both monthly amounts).

---

## Settled on 2026-08-11, recorded so they are not reopened

- CUSTOMER-14 is an outright purchase, not a lease.
- CUSTOMER-14 takes one agreement; the burglar side of the combination panel is not in use at all.
- Active Alarm as lessor is retired on new deals. Existing AAC-as-lessor leases stay in force under their own paper.
- The proposal price governs the schedule. The discrepancy goes to the rep rather than being reconciled silently.
- Where multiple work-ups exist, the newest by modified date wins.
- A prevailing wage flag is judged against the labor rate, not taken at face value.
- The 90 stale baselines copies in job folders stay as they are. Only the template folder copy was corrected.
- The schedule shape on a financed deal: list the equipment, carry the full purchase price, deposit $0.00, and add the clarification naming the lender.

**23. Validity bullet's Repair Service sentence — universal; cybersecurity exclusion retired.** Opened and **resolved 2026-09-18** (Dan, in-session ruling during the clarifications.json resync, issue 274): the Repair Service sentence prints on every agreement because Repair Service is either contracted or T&M on nearly every account; no-master accounts still omit it (ACCOUNT-RULES.md). The cybersecurity exclusion, which existed only in the builder's library with no BASELINES source, is retired. In the same ruling the library gained the bullets BASELINES carried that it had lacked (Fire Alarm exclusions; Access Control IDF conduit and software-licensing clarifications; video retention; reused-equipment T&M exclusion) and the universal AHJ-fees bullet matches BASELINES with the fire-specific fees under Fire Alarm. Wording in BASELINES.md under the 2026-09-18 revision note and in `clarifications.json` v1.3.

