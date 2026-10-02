---
name: aac-contract-package
description: Create, review or audit an Active Alarm Company (AAC) customer contract package (Schedule of Equipment and Services, master agreement, Rider for Additional Locations). Use when a rep or Sales Admin asks for a contract, schedule or paperwork for a named job, customer or job folder (including a forwarded "please create contract"); when a package needs rebuilding after a fact changes (price, purchase vs. financed, designation, scope); when a package needs reviewing, or the jobs drive sweeping for defects; or for questions on AAC clarifications, exclusions, RMR names and prices, SOW wording, the $5,000 deposit rule, permit responsibility or the Schedule-to-Master mapping. Prefer it over generic document generation or contract review for anything touching an AAC package.
metadata:
  modified: "2026-10-02T15:37:28Z"
  previous-modified: "2026-09-26T03:38:45Z"
  revision: "2"
  content-sha: "f60911bfac4e"
---

# AAC Contract Package

Everything needed to create and review AAC contract packages travels in this skill: the governing standards in `references/`, the tools in `scripts/`. Customer data stays on the jobs drive and is never moved.

## The rule that shapes this skill

**`references/` is the only copy of every standard. Read the file every time rather than working from memory, and keep restatements out of this file, job folders and scripts.** A 2026-08-11 sweep found 91 copies of one baselines document on the jobs drive in three divergent versions, two of them telling reps for months that permit procurement was optional, against the verified master agreement (`00-INDEX.md` has the full account).

If a summary anywhere disagrees with the file it cites, the file wins. Say so rather than picking.

## What is in `references/`

Read `00-INDEX.md` first; it lists every document with its status. Then read only what the task needs.

| File | Read it when |
|---|---|
| `ACCOUNT-RULES.md` | **Always, first.** Standing per-customer exceptions override everything else |
| `SCHEDULE-GENERATION-PROCEDURE.md` | Creating a package. Source precedence, package composition, cell map, work-up translation, verification, handoff |
| `PROMPT.md` | Reviewing a package someone else drafted. Run order, what you fix vs. ask, the Output Contract |
| `LIVING-STANDARD.md` | The full reviewer standard behind PROMPT.md |
| `BASELINES.md` | The rules for clarifications and exclusions and the §0 length discipline; the bullet text is in `clarifications.json` |
| `SOW-BASELINES.md` | Writing the scope of work. Templates, approved system names, designation tokens |
| `MAPPING-APPENDIX.md` | RMR names, price tiers, master agreement mapping, §3a pricing formulas |
| `DRAFTER-PRESEND-CHECKLIST.md` | Before anything goes out |
| `SCHEDULE-EDIT-PROCEDURE.md` | Touching a workbook by any route other than the scripts |
| `clarifications.json` | The bullet wording itself. `build_package.py` reads it; wording edits go here, never in Python |
| `SOP-LEAF-Financed-Installations.docx` | The deal is financed through a lender |
| `CONTEXT.md` | Who people are, prior decisions, failure modes already corrected |
| `OPEN-DECISIONS.md` | Something seems unsettled: it probably is, and is probably listed |
| `PORTFOLIO-SWEEP.md` | Known defects across existing packages as of 2026-08-11 |

## Creating a package

The procedure is `references/SCHEDULE-GENERATION-PROCEDURE.md`; § numbers below are its sections. The shape:

1. **`ACCOUNT-RULES.md` first.** Where an exception covers an item for this customer, it wins and you never raise it.
2. **Inventory the job folder.** List the whole tree once, noting what is missing as well as present. Then run `python scripts/extract_package.py "<job folder>"` and read from `_extract/`: the digest lists hidden tabs, hashes, and anything that would not open.
3. **Read the package end to end**: work-up (visible tabs), issued proposal, supplier and sub quotes, sales checklist, FSI worksheet, drawings. Take scope from the documents' contents, never from a filename, title or RE: line. If a file will not open, stop and say which one.
4. **Apply source precedence** (§1). The issued proposal outranks the work-up and the FSI on anything the customer was quoted. Newest work-up wins. A prevailing wage checkbox is not evidence; the labor rate is.
5. **Write `_facts.json`** in the job folder: `python scripts/build_package.py "<job folder>" --facts`.
6. **Build**, which also verifies: `python scripts/build_package.py "<job folder>"`.
7. **Fix every FAIL, judge every WARN.** Change a fact in `_facts.json` and rebuild; the three documents are only ever written by the builder.
8. **Run the export pass** (§11a), every step in order, ending with every interim file deleted. The deliverable is the PDF: cell checks cannot stand in for a render.
9. **Hand off** per §12, showing the stop-slop score.

## Reviewing a package

Follow `references/PROMPT.md`: read the standards, read the package, fix what a governing source answers, ask the rep only what only the rep knows, edit the schedule surgically, send one short email.

Extract first, then let the machines do the mechanical half before you read anything:

```
python scripts/extract_package.py "<job folder>"
python scripts/verify_package.py "<job folder>"
python scripts/verify_workup.py "<job folder>"
python scripts/verify_package.py --sweep "<jobs root>"
```

Then read from `_extract/`, not from the binaries. What a cheap subagent may read for you and what you must read yourself is in PROMPT.md, File Reading Rules.

## Scripts

Each script's header carries its usage and exit codes. Which to reach for:

| Script | When |
|---|---|
| `extract_package.py` | Before reading anything in a job folder |
| `verify_workup.py` | Before reading a single work-up cell |
| `build_package.py` | Writing `_facts.json` (`--facts`), then building and verifying the package. It also lands a second pristine template copy in `_to_delete\` |
| `prebuild_gate.py` | Run by the builder first; alone, to test a `_facts.json` record |
| `verify_package.py` | The machine-checkable half of DRAFTER-PRESEND; calls `zoho_crosscheck.py` (advisory, SKIP without Zoho credentials) |
| `aac_paths.py` | To see which template, jobs root and backup folder resolved for a job folder |
| `xlsx_surgical.py` | Every write to a schedule workbook |

**Write a schedule workbook only through `xlsx_surgical.py`; read it with openpyxl freely.** openpyxl, pandas and every other spreadsheet library rebuild the file from their own object model on save, silently destroying printer settings, rich text, embedded images and the calc chain while every cell still reads back correct.

Needs `openpyxl`, `pypdf`, `python-docx`, and poppler for `pdftotext`.

## Verifier discipline

**When a finding looks surprising, check it against the source document before reporting it.** A tool bug reads exactly like a package defect (SCHEDULE-GENERATION-PROCEDURE §11 has the full discipline). Three false-positive classes were found and fixed this way on the verifier's first day: proposals carrying more than one "Total Investment" line, the Commercial Fire field map applied to a residential master, and "TBD" flagged in the two date fields where item 8 permits it.

A clean run means nothing mechanically checkable is wrong, not that the package is right.

## What stays human

Designation choices, SOW coverage sentence phrasing, which conditional clarifications the job earns, job-specific clarifications, BASELINES §0 merges, and the print layout: none reduce to a rule. The builder fills fields; what the system protects and which boundaries the job needs stay the drafter's call. The §11a visual pass covers what a render can show; the final print check in Excel is still the drafter’s.

The line-by-line coverage of the mechanical layer lives in `docs/verifier-coverage.md`, and anything ticketed for automation in the GitHub tracker; point there rather than restating the coverage split (Dan's rule 2026-08-25).

**No placeholder edits.** A line whose answer is pending waits unwritten and goes in `held`. No write-then-strike, and TBD only in the two date fields the master permits.

## Hard stops

Stop and escalate rather than guessing when the customer or site does not match across documents, pricing conflicts and the proposal does not settle it, scope does not match the equipment, reused equipment is unaddressed, responsibility boundaries conflict, a device in scope has no equipment line, placeholder or bracket text sits in a customer-facing document, or a file will not open.

## Known limits

The builder refuses out-of-scope work rather than silently truncating. Which agreement types are field-mapped, the current row caps, and which multi-site/multi-system shapes are handled live in `docs/GAP-REPORT.md` and the open tickets in the GitHub tracker; read them there rather than restating caps or the mapped list here (Dan's rule 2026-08-25).
