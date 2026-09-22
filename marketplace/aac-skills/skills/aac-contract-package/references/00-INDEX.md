# references — the authoritative standards

Every governing document for AAC contract packages. **This folder is the only copy.** It travels inside the skill, so the standards cannot drift from the version of the code that reads them.

## Why one copy

A sweep on 2026-08-11 found **91 copies** of one baselines document across the jobs drive, in three divergent versions. Two of them told reps that permit procurement was optional, contradicting the verified master agreement, and had done so for months. The same day, a second copy of the reviewer standard turned out to be two revisions behind.

**Never restate a standard** — not in the skill's `SKILL.md`, not in a script, not in a job folder, not from memory. Read the file. If a summary anywhere disagrees with the file it cites, the file wins.

## Reviewer side

| File | Governs | Status |
|---|---|---|
| `PROMPT.md` | The reviewer standard: run order, what you fix versus what you ask, recurring defect checks, the Output Contract for the review email | Active, rev. 6 (2026-09-22: review email in Dan's Z-4260 shape) |
| `LIVING-STANDARD.md` | The full reviewer standard behind PROMPT.md | Active |
| `DRAFTER-PRESEND-CHECKLIST.md` | Completion and export QA | Active |

## Create side

| File | Governs | Status |
|---|---|---|
| `SCHEDULE-GENERATION-PROCEDURE.md` | Source precedence, package composition, template paths, the schedule cell map, work-up to Equipment-and-Labor translation, services layout, pricing block, conditional clarifications, verification, the handoff email | §1, §6, §11, §11a and §12 **ratified by Dan 2026-08-19** (wayfinder ticket #4); §4 multi-Site multi-System layout amendment **awaiting Dan's signature (2026-09-10, spec 215 stream B, ADR-0001, issue 218)**; remaining sections draft |
| `PART-TRANSLATIONS.md` | Part number to customer-facing schedule description; §6 resolution order step 2 | Active, seeded 2026-08-19 |
| `SCHEDULE-EDIT-PROCEDURE.md` | Workbook editing mechanics, and why a spreadsheet library must never save a schedule | Active |
| `clarifications.json` | Every clarification and exclusion, the SOW templates, and the print order. The only place this wording exists. `build_package.py` reads it | Active, v1.5 (2026-09-18: designation renders as a phrase, "an addition to the existing" per SOW-BASELINES §2; v1.3 2026-09-18: resynced to the 2026-08-26 BASELINES revision, OPEN-DECISIONS item 21) |

## Pilot

| File | Governs | Status |
|---|---|---|
| `EXTRACTION-PROMPT.md` | The prompt the pilot fact extractor (`pilot/extract/fact_extractor.py`, repo root) hands to headless Claude: output contract for `_facts.json`, the cross-artifact validation statuses (`validated` / `single-source` / `conflict`), and the re-read-on-anomaly discipline (hard rule 6 applied inside extraction). Cited by the extractor by path; never restated in code | Active (correction rounds ratified 2026-08-21, issue 71; whole file ratified by Dan 2026-09-18, in session; delivered under issue #53) |
| `FACTS-SCHEMA.md` + `facts.schema.json` | The `_facts.json` deal record: the tree shape (Customer / Sites / Systems), field types, required/conditional/optional membership, and the resolved open-question ledger. `facts.schema.json` is the machine-checkable JSON Schema; the Markdown file is the human-readable companion. Read by the extractor, the builder and the pre-build gate | **Active, v1.0**, ratified by Dan 2026-09-10 (issue #215 stream A) |

## Content standards

| File | Governs | Status |
|---|---|---|
| `ACCOUNT-RULES.md` | Standing per-customer exceptions. **Read before judging anything** | Active |
| `BASELINES.md` | The §0 length discipline, the master-agreement relationship, site constraints and reviewer rules; each section points at its bullets in `clarifications.json` by id | Active (bullet lists moved to `clarifications.json` 2026-09-18, issue 274) |
| `SOW-BASELINES.md` | SOW templates for all sold system types (§7.1–§7.13 + fallback rule), approved system names, designation tokens | Active. §7.13 services-only template **ratified by Dan 2026-09-22** (Z-4260). §1 per-System labelled paragraph form and §3 Contract family column **awaiting Dan's signature (2026-09-10, spec 215 stream B, ADR-0001, issue 218)** |
| `MAPPING-APPENDIX.md` | RMR names, price tiers, master agreement mapping, §3a price validation, Repair Service start date | Active. §3a rewritten validation-only, **ratified by Dan 2026-08-19** (wayfinder ticket #7); Repair Service start date **ruled month 13 by Dan 2026-09-22** (OPEN-DECISIONS item 24) |
| `CONTRACT-PACKAGE-RULES.md` | Which documents make up each package situation (commercial initial, commercial subsequent, residential) plus the standing rules (IN LIEU OF combine note, service always checked, combo fire/burg both agreements). Verbatim transcription of the Contract Package Rules tab from the RMR Items Google Sheet; repo-authoritative per the issue #15 ruling | Active, migrated 2026-08-21 (issue #43) |
| `ESTIMATING-APPENDIX.md` | Parked estimating policy: approved labor costs, Repair Service and Inspection derivation, software-passthrough markup, known divergences. Seed document for the estimating build; not consulted during drafting or review except the labor costs table | Active, created 2026-08-19 (wayfinder ticket #7) |
| `SOP-LEAF-Financed-Installations.docx` | Third-party financed deals. Retires Active Alarm as lessor on new work | **Active, issued v1.0 by Dan 2026-08-20** (wayfinder ticket #9). Lender facts from LEAF's own lease form and quoting tool; the nine process steps have not yet run against a live financed deal — the first real deal amends by PR |
| `LEASE-PAYMENTS-POINTER.md` | Where a drafter looking for lease-payment guidance lands. Cites the LEAF SOP; marks the jobs-drive Lease Guide and Lease Calculator superseded for financed-deal payments without renaming or moving them | Active pointer, issued 2026-08-24 (executes OPEN-DECISIONS item 18) |

## Context and open work

| File | Holds |
|---|---|
| `CONTEXT.md` | AAC, the people, prior architectural decisions, failure modes already corrected. Snapshot as of 2026-08-11; keeping it current is a deliberate act |
| `OPEN-DECISIONS.md` | Governing rulings and their status. Open items are those without a Resolved or Executed line in the file itself; historical ledger stays inside. Do not restate item counts anywhere else — read the file (Dan's rule 2026-08-25) |
| `PORTFOLIO-SWEEP.md` | Drafted packages carrying findings and recurring patterns, snapshot 2026-08-11 |
| `PORTFOLIO-SWEEP-TRIAGE.md` | Classifies each `PORTFOLIO-SWEEP.md` recurring pattern as (a) template-fixed, (b) standard-fixed, or (c) `OPEN-DECISIONS.md`-open; input to the pilot's three-metric scorecard (issue #41 ruling 7) | Active, 2026-08-20 |

## What is not here, and why

**Fillable templates and forms** stay on the jobs drive: the schedule template in `_SALES .TEMPLATE FOLDER (DO NOT OVERWRITE THIS)`, the FSI worksheet, the lease calculator (**superseded 2026-08-24** for financed-deal payments — see `LEASE-PAYMENTS-POINTER.md`; the file stays retrievable under its original name), and the agreement forms under `New Agreements 8-22-19`. They are artifacts the business edits, not text this skill governs.

**Job folders** stay on the jobs drive. They hold customer data.

**RMR Items sheet** (Standard RMR tab and other pricing tabs) lives in Google Drive, owned by Sales Admin; the repo carries a dated snapshot under `fixtures/google-drive/` and is not authoritative for those tabs. **Contract Package Rules** moved out of that split on 2026-08-21 — it now lives in this folder as `CONTRACT-PACKAGE-RULES.md` and the Drive-side tab is **stamped** `MIRROR OF REPO — DO NOT EDIT (PRs only)` per Dan's 2026-08-21 ruling (content stays visible to Sales Admin during the bridge period). The stamp is executed in the repo — `fixtures/google-drive/RMR-Items-post-retirement-target.xlsx` carries the stamped form, pinned by `tests/test_drive_retirement_target.py` — and applied to live Drive 2026-08-21, logged in `docs/DRIVE-COORDINATION-LOG.md`. (Issue #43, following the ruling on issue #15.)

## Editing

Bullet wording changes go in `clarifications.json`, never in a script. Dan holds language authority. Print order is the `order` field: lower prints first, gaps left for insertion.

Changing a standard means updating this folder and re-saving the skill. That is deliberate friction — it means a wording change is a versioned event rather than someone quietly editing a file on a shared drive.
