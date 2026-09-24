---
name: aac-contract-package
description: Create, review, or audit an Active Alarm Company (AAC) customer contract package — the Schedule of Equipment and Services, the master agreement, and the Rider for Additional Locations. Use whenever a rep or Sales Admin asks to create, draft, build, or "put together" a contract, schedule, or paperwork for a named job or customer; when a "please create contract" request is forwarded; when a job folder path is given and the ask is paperwork; when a package needs rebuilding after a fact changes (price, purchase vs. financed, designation, scope); or when an existing package needs reviewing, verifying, or sweeping for defects across the jobs drive. Also use for questions about AAC clarifications, exclusions, RMR names and prices, SOW wording, the $5,000 deposit rule, permit responsibility, or the Schedule-to-Master mapping. Prefer this over generic document generation or contract review for anything touching an AAC package, even if the words "schedule" or "package" are not used.
metadata:
  modified: "2026-09-24T16:40:55Z"
  previous-modified: "2026-09-24T14:21:24Z"
  revision: "1"
  content-sha: "171b76726bb0"
---

# AAC Contract Package

Everything needed to create and review AAC contract packages travels in this skill: the governing standards in `references/`, the tools in `scripts/`. Customer data stays on the jobs drive and is never moved.

## The rule that shapes this skill

**`references/` is the only copy of every standard. Never restate one — in this file, in a job folder, in a script, or from memory. Read the file.**

A sweep on 2026-08-11 found 91 copies of one baselines document across the jobs drive in three divergent versions. Two told reps that permit procurement was optional, contradicting the verified master agreement, and had done so for months. Same day, a second copy of the reviewer standard turned out to be two revisions behind.

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
| `clarifications.json` | The bullet wording itself. `build_package.py` reads this; edits go here, never in Python |
| `SOP-LEAF-Financed-Installations.docx` | The deal is financed through a lender |
| `CONTEXT.md` | Who people are, prior decisions, failure modes already corrected |
| `OPEN-DECISIONS.md` | Something seems unsettled — it probably is, and is probably listed |
| `PORTFOLIO-SWEEP.md` | Known defects across existing packages as of 2026-08-11 |

## Creating a package

Full procedure in `references/SCHEDULE-GENERATION-PROCEDURE.md`. The shape:

1. **`ACCOUNT-RULES.md` first.** Where an exception covers an item for this customer, it wins and you never raise it.
2. **Inventory the job folder.** List the whole tree once. Note what is missing as well as present. Then run `python scripts/extract_package.py "<job folder>"` and read from `_extract/` — the digest lists hidden tabs, hashes, and anything that would not open.
3. **Read the package end to end** — work-up (visible tabs), issued proposal, supplier and sub quotes, sales checklist, FSI worksheet, drawings. Never infer scope from a filename, title, or RE: line. If a file will not open, stop and say which one.
4. **Apply source precedence** (§1). The issued proposal outranks the work-up and the FSI on anything the customer was quoted. Newest work-up wins. A prevailing wage checkbox is not evidence; the labor rate is.
5. **Write `_facts.json`** in the job folder:
   ```
   python scripts/build_package.py "<job folder>" --facts
   ```
6. **Build**, which also verifies:
   ```
   python scripts/build_package.py "<job folder>"
   ```
7. **Fix every FAIL, judge every WARN.** Rebuild after any fact change; never hand-edit one of the three documents.
8. **Run the export pass** per §11a: stop-slop the schedule text, hide unused rows, size the clarifications cell, PDF, test the render totals, visual pass, fix the footer page count, trim hidden-tab pages, then delete every interim file the pass created. The deliverable is the PDF; §11a explains why cell checks cannot stand in for a render.
9. **Hand off** per §12 — questions for the rep, then what is still the drafter's, then conditionals with both branches. Run `write-like-dan`, then `stop-slop`, then cut. Show the stop-slop score.

## Reviewing a package

Follow `references/PROMPT.md`. It governs a package someone else drafted: read the standards, read the package, fix what a governing source answers, ask the rep only what only the rep knows, edit the schedule surgically, send one short email.

Extract first, then let the machines do the mechanical half before you read anything:

```
python scripts/extract_package.py "<job folder>"
python scripts/verify_package.py "<job folder>"
python scripts/verify_workup.py "<job folder>"
python scripts/verify_package.py --sweep "<jobs root>"
```

Then read from `_extract/`, not from the binaries. The fan-out rules — what a cheap subagent may read for you and what you must read yourself — are in PROMPT.md, File Reading Rules.

## Scripts

| Script | Does |
|---|---|
| `aac_paths.py` | Resolves paths. Standards from `references/`; the jobs drive derived from the job folder you name, so nothing is hardcoded to a drive letter. Run it with a job folder to see what resolved |
| `build_package.py` | Copies the pristine template into the job folder (a second pristine copy lands in `_to_delete\`), builds schedule, master and rider from `_facts.json`, then verifies (`--no-verify` skips) |
| `prebuild_gate.py` | The pre-build gate over `_facts.json`: refuses a record the standards would reject, warns on missing provenance. `build_package.py` runs it first and stops on a refusal; run it alone with `"<job folder>"`. Read-only. Exit 0 no refusal, 1 refused, 2 bad input |
| `verify_package.py` | The machine-checkable half of DRAFTER-PRESEND. Read-only. Exit 0 clean, 1 failures, 2 bad input, 3 no drafted schedule |
| `extract_package.py` | One read-only pass over the job folder: plain-text extracts in `_extract/` plus `_digest.json` (hashes, hidden tabs, quick facts, unreadables). Run it before reading anything; read the extracts, not the binaries. Re-runs skip unchanged files. `--clean` removes the folder |
| `verify_workup.py` | The mechanical workup arithmetic: overwritten extension formulas, typed costs on blank quantities, costs outside a total's range, stranded lower-section costs. Read-only, tab/cell/amount findings. Run before reading a single workup cell |
| `zoho_crosscheck.py` | Called by `verify_package.py`: five advisory Zoho cross-checks (WARN or PASS, never FAIL; SKIP without `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` or network). Read-only; never writes a Zoho value anywhere |
| `xlsx_surgical.py` | The **only** sanctioned way to write a schedule workbook |

**Never save a schedule through openpyxl, pandas, or any spreadsheet library.** They rebuild the file from their own object model and silently destroy printer settings, rich text, embedded images and the calc chain, while every cell still reads back correct. Reading with openpyxl is fine.

Needs `openpyxl`, `pypdf`, `python-docx`, and poppler for `pdftotext`.

## Verifier discipline

**When a finding looks surprising, check it against the source document before reporting it.** A tool bug reads exactly like a package defect (SCHEDULE-GENERATION-PROCEDURE §11 has the full discipline). Three false-positive classes were found and fixed this way on the verifier's first day: proposals carrying more than one "Total Investment" line, the Commercial Fire field map applied to a residential master, and "TBD" flagged in the two date fields where item 8 permits it.

A clean run means nothing mechanically checkable is wrong, not that the package is right.

## What stays human

What does not reduce to a rule: designation choices, SOW coverage sentence phrasing, judgment on which conditional clarifications the job earns, job-specific clarifications, BASELINES §0 merges, and the print layout. The §11a visual pass covers what a render can show; the final print check in Excel is still the drafter’s. The builder fills fields; it does not decide what the system protects or which boundaries the job needs.

The line-by-line coverage of the mechanical layer lives in `docs/verifier-coverage.md`; anything currently un-automated but ticketed to automate lives in the GitHub tracker. Do not restate that coverage split here (Dan's rule 2026-08-25).

**No placeholder edits.** If an answer is pending, the line waits unwritten and goes in `held`. No write-then-strike, no TBD outside the two date fields the master permits.

## Hard stops

Stop and escalate rather than guessing when the customer or site does not match across documents, pricing conflicts and the proposal does not settle it, scope does not match the equipment, reused equipment is unaddressed, responsibility boundaries conflict, a device in scope has no equipment line, placeholder or bracket text sits in a customer-facing document, or a file will not open.

## Known limits

The builder refuses out-of-scope work rather than silently truncating. Which agreement types are field-mapped today, the current row caps, and which multi-site/multi-system shapes are handled are tracked in `docs/GAP-REPORT.md` and the open tickets in the GitHub tracker. Do not restate specific caps or the mapped/unmapped list here (Dan's rule 2026-08-25).
