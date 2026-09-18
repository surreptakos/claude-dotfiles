# Contract Package Rules

## Document control

- **Document type:** Governing standard. Names the documents that must be built for each package situation, plus the standing rules that apply to every package.
- **Audience:** Drafters, reviewers, Sales Admin, GPT-assisted drafters and reviewers.
- **Source of record:** the Contract Package Rules tab (first tab) of the RMR Items Google Sheet, snapshot `fixtures/google-drive/RMR-Items-2026-08-19.xlsx`. See §3 below for the exact source cells.
- **Provenance discipline:** §2 reproduces the tab's cell values byte-for-byte, only as needed to render the same rows as Markdown (Situation column headers become sub-headings; Contract Package column becomes a bulleted list under each; the four bottom notes appear on their own without added wording). Cell strings are not paraphrased, not reworded, not re-punctuated. No editorial insertion or cross-reference has been added inside §2 — every cross-reference lives in §4 (Editor's notes), outside the transcription. §3 gives the source-to-render mapping for audit.
- **Repo-authoritative — 2026-08-21 (issue #43, follows ruling on issue #15).** This file is now the authoritative copy of Contract Package Rules; the Drive-side tab is a stamped read-only mirror (see §5). Language authority sits with Dan; changes ratify via PR against `aac-contract-builder`, same governance as every other `references/*` file.

## How to use this document

Use with `SCHEDULE-GENERATION-PROCEDURE.md` §2 (Package composition), which cites this file. Build every document on the applicable Situation row; nothing on a row is optional. The three Situation rows are mutually exclusive — pick one, then build every listed item in its Contract Package column. The four bottom notes (§2.5–§2.8) apply across every situation as written.

## 2. Contract Package Rules — verbatim from source

### 2.1 CONTRACT PACKAGE RULES

Below are the tab's own rows, rendered as Markdown. Cell strings are exact; the table shape is the two columns (Situation / Contract Package) followed by four free-form rows.

### 2.2 Situation: Commercial: initial job with customer or the first job with customer since we've started using the master agreements \*\*\*

Contract Package:

- Schedule of Equipment & Services (include new job equip & services alongside all existing services)
- Master Agreement (5 year default term, must include all existing RMR)
- Electronic Communication Disclosure
- Disclaimer Notice
- Rider for Additional Locations
- Credit application (if LEASING)
- Drawing/Plan showing device locations (customer must initial)
- Onboarding forms (ECL, IT forms, Billing Form)

### 2.3 Situation: Commercial: any job after getting the Master Agreement and Rider for Additional Locations signed

Contract Package:

- Schedule of Equipment & Services
- Emergency Contact List (if monitored)
- Electronic Communication Disclosure
- Disclaimer Notice
- Drawing/Plan showing device locations (customer must initial)
- Onboarding forms (ECL, IT forms, Billing Form)

### 2.4 Situation: Residential: Every time

Contract Package:

- Master Agreement (5 year default term, must include all existing RMR)
- Schedule of Equipment & Services (include new job equip & services alongside all existing services)
- Rider for Additional Locations
- Cancellation Notice (MUST GIVE THREE COPIES!!) -- see Cancellation Notice Instructions
- Electronic Communication Disclosure
- Disclaimer Notice
- Drawing/Plan showing device locations (customer must initial)
- Onboarding forms (ECL, IT forms, Billing Form)
- Note: No CCTV Network Form Needed for Residential

### 2.5 Bottom note (Situation column, row 30)

\*\*\* if sending an existing commercial customer a master agreement for the first time, you must include all existing RMR on the initial schedule & master agreement. \*\*\*

### 2.6 Bottom note (Situation column, row 32)

Note that you must combine all RMR item pricing on the "IN LIEU OF" line if you use Other on the Master Agreement

### 2.7 Bottom note (Situation column, row 34)

Service is always checked on all agreements.

### 2.8 Bottom note (Situation column, row 36)

When a customer has a combo fire/burg panel, you must have them sign both fire and security agreements.

Use the Security All in One for the intrusion alarm equipment & services and the Fire All in One for the fire alarm equipment & services.

Since the two systems share a single control panel, you need to indicate in the security contract that the intrusion alarm system shares a panel with the fire alarm system. The monitoring charge should appear in the fire alarm contract and schedule. You should indicate on both the fire contract and the security contract that the monitoring charge in the fire alarm contract includes the monitoring for the intrusion alarm system.

## 3. Source-to-render mapping (audit)

Snapshot: `fixtures/google-drive/RMR-Items-2026-08-19.xlsx`, tab `Contract Package Rules`.

| Source cell | Rendered as |
|---|---|
| A1 | §2.1 heading |
| A2 / B2 | Column labels (Situation / Contract Package) named in §2.1 preamble |
| A3 + B3–B10 | §2.2 |
| A12 + B12–B17 | §2.3 |
| A19 + B19–B27 | §2.4 (B27 is the "No CCTV Network Form Needed" note, kept in place as the tab has it — last bullet of the residential list) |
| A30 | §2.5 |
| A32 | §2.6 |
| A34 | §2.7 |
| A36 (multi-line string; the tab uses `\n\n` between paragraphs) | §2.8, three paragraphs |

The tab has no other populated cells (max row 36, max column 2). Rows 11, 18, 28, 29, 31, 33, 35 are visual spacers in the source and are dropped from the render.

Rendering choices (not wording changes): the em-dash separator in "Cancellation Notice ... -- see Cancellation Notice Instructions" keeps the source's literal `--`; leading `***` markers keep the source's literal asterisks (backslash-escaped in Markdown so they render as asterisks rather than emphasis); the multi-paragraph combo-panel note keeps the source's paragraph breaks. No text is added, removed, or reworded.

## 4. Editor's notes (not part of the standard)

These notes are for reviewers of this document; they are not part of the migrated rule text and do not change what §2 says.

- **IN LIEU OF (relates to §2.6).** `MAPPING-APPENDIX.md` §1 rule 6 already owns the complete IN LIEU OF rule; ratified 2026-08-19 (wayfinder ticket #8) and recorded in `OPEN-DECISIONS.md` item 11. §2.6 remains the tab's point-of-use note as it appears in the source. This cross-reference is editorial — no such cross-reference exists in the source tab.
- **Combo fire/burg (relates to §2.8).** The paragraph carries the operating rule; downstream implementation details (which contract carries the monitoring charge, which contract states the shared-panel language) match §2.8 as written.

## 5. Drive-side coordination

Per the issue #15 ruling and Dan's 2026-08-21 stamp ruling (issue #43), the Drive-side tab is a stamped read-only mirror: renamed to **`MIRROR OF REPO — DO NOT EDIT (PRs only)`** so anyone opening the sheet sees the notice on the tab itself, while the content stays visible to Sales Admin during the bridge period.

**The stamp is executed in the repo.** The repo carries a target-state fixture at `fixtures/google-drive/RMR-Items-post-retirement-target.xlsx` whose first tab is already `MIRROR OF REPO — DO NOT EDIT (PRs only)`. The rename was produced surgically (only `xl/workbook.xml` differs from the pre-migration evidence snapshot; every other zip member is byte-for-byte identical). `tests/test_drive_retirement_target.py` pins the executed state; a regression that re-introduces `Contract Package Rules` as the first tab of the target fixture fails the test suite before it can ship.

**Pre-migration evidence** stays at `fixtures/google-drive/RMR-Items-2026-08-19.xlsx`, unchanged from the original 2026-08-19 export. Nothing edits it after this migration lands. It is the source `--revert` uses to recover the pre-migration name if the stamp ever needs to be undone.

**Live-Drive projection.** `scripts/apply_drive_mirror_stamp.py` projects the target-state fixture onto the live Google Sheet — a mechanical, idempotent one-command action. The applier reads the first-tab title from the target fixture rather than a hard-coded string, so the repo declaration IS the source of truth for what "applied" means:

```
py -3 scripts/apply_drive_mirror_stamp.py                 # dry-run
py -3 scripts/apply_drive_mirror_stamp.py --check-live    # verify live matches target
py -3 scripts/apply_drive_mirror_stamp.py --apply         # project target onto live Drive
py -3 scripts/apply_drive_mirror_stamp.py --revert        # rename back to the pre-migration name
```

Fleet subagents cannot run the applier — the fleet task rules forbid touching production paths, and a live Google Sheet is a production path. The stamp was applied to live Drive on 2026-08-21 by the main session under Dan's ruling; `docs/DRIVE-COORDINATION-LOG.md` records the event, and `--check-live` re-proves live state at any time.
