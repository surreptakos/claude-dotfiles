# Schedule Edit Procedure — SCHEDULE-EDIT-PROCEDURE.md

## Document control
- **Document type:** Mechanical procedure for editing a Schedule of Equipment and Services workbook
- **Audience:** Contract reviewers, GPT-assisted reviewers
- **Purpose:** Apply review changes to the live schedule without damaging the file.
- **Created:** 2026-08-10
- **Revision note — 2026-08-18 (per Dan, from the CPD Marquette/McKinley CO1 reviews):** Two additions. (1) Sizing wrapped text blocks — an edit that grows the text in a wrapped or merged cell is not done until the rows are resized to render the whole block. (2) Change-order paperwork placement — the CO workbook and its PDF live in the job folder's `Source Docs` subfolder once the PDF is made.
- **Revision note — 2026-09-23 (issue 304):** Sizing wrapped text blocks now covers the shrink case: an edit that removes text from a wrapped or merged block gives back the surplus rows in the same session. `delete_rows` added to the editor API, and the verification gate lists the members a shrink changes.

## The rule
The reviewer edits the schedule. Do not hand back a list of changes for someone else to retype, and do not attach a second copy of the workbook to the review email or to chat. One file exists, it lives in the job folder, and the reviewer edits it in place.

## Reaching the job folder
The jobs root is a mapped network drive on the user's machine.

**Running on the user's computer — the normal case.** The drive is directly available. Use ordinary file and shell tools against it: list the folder, read the package, run the edit script, save in place. Nothing special applies.

**Running in the cloud.** The folder reaches the session through a device bridge, and the file-transfer tools on that bridge do not work against this mount: `device_stage_files` returns "Could not stat" and `device_commit_files` returns "fetch or write failed" for every path under it, including paths with no unusual characters. Do not spend time diagnosing it. Use `device_bash` for everything instead — listing, reading, and writing. Python 3 with `openpyxl` and `pdftotext` are both available there. Run edit scripts against the real file rather than transferring it. `device_bash` cannot delete; to remove a file, move it into `_to_delete\` under the jobs root and tell the user.

Either way the destination is the same: the schedule in the job folder, edited in place.

The surgical editor ships at `scripts/xlsx_surgical.py` inside the skill. Import it rather than rewriting it.

## Never use a spreadsheet library to save the workbook
`openpyxl`, `pandas`, and every other read-write spreadsheet library rebuild the file from their own object model on save. Anything the library does not model is gone.

Measured on a real AAC schedule, a single `openpyxl` load-and-save silently destroyed:

| Lost | Consequence |
|---|---|
| `xl/printerSettings/*.bin` (all five) | Paper size, margins, scaling, print quality reset |
| `xl/sharedStrings.xml` | Rich text flattened — bold **Clarifications** and **Exclusions** headers became plain |
| `xl/calcChain.xml` | Recalculation order rebuilt from scratch |
| `xl/metadata.xml`, `xl/richData/*` | Rich-value metadata dropped |
| — | Three embedded images silently duplicated |

Every cell value read back correct. The document was still damaged. No cell-value check catches this.

`openpyxl` is fine for **reading** — the WU, the sales checklist, inspecting a schedule. It is never used to save one.

## Use the surgical editor
`xlsx_surgical.py` edits the XML parts inside the .xlsx zip and copies every other member byte-for-byte. On the same file it changes 4 of 43 members and leaves the other 39 bit-identical.

### API
```python
import sys; sys.path.insert(0, r'<skill>\scripts')
import xlsx_surgical as X

w = X.Workbook(source_path)
w.set_text(sheet, cell, new_text)          # plain shared string
w.runs(sheet, cell)                         # inspect rich-text runs
w.set_runs(sheet, cell, {1: t1, 3: t3})     # replace run bodies, keep run formatting
w.set_number(sheet, cell, value)            # static value, drops any formula
w.delete_rows(sheet, first_row, count)      # remove empty rows; everything below moves up
w.save(destination_path)
```

`set_text` and `set_runs` refuse when the shared string is referenced by more than one cell, so a shared label can never be changed in one place and corrupted in another.

`set_number` removes the cell's formula, strips its `calcChain` entry, and sets `fullCalcOnLoad="1"` so Excel recalculates dependents on open. Use it for the pricing block: a formula pointing at an empty cell is the most common defect on these schedules.

`delete_rows` removes empty rows and moves everything below them up, as Excel's Delete Row does: the rows and cells, merge ranges (a merge containing the deleted rows shrinks), formulas on every sheet that point at the moved rows, the print area and other defined names, `calcChain` entries, and drawing anchors such as the signature lines. It refuses rather than guessing when a deleted row holds a value or formula, when the deleted rows include the top row of a merge that continues below them, or when a reference would be left pointing at a deleted row.

### Rich text
The Clarifications and Exclusions block is one cell containing four runs: bold header, body, bold header, body. Inspect with `runs()` first, then update only the body runs. Never replace the whole cell — that is what flattens the headers.

Line breaks inside these cells are `\r\n`, not `\n`. Bullets are `• `.

Run 1 (the Clarifications body) ends with an empty line, `\r\n\r\n`, so one blank line separates the last clarification from the bold Exclusions header (SCHEDULE-GENERATION-PROCEDURE §11a). A replacement body run keeps it. The builder writes it; a hand edit is where it gets lost (Z-4260, 2026-09-22).

## Procedure
1. **Back up.** Copy the schedule to `_to_delete\<job> BACKUP pre-edit.xlsx` before touching it. If an edit goes wrong, rebuild from the backup rather than editing an already-edited file.
2. **Read the target cells** and confirm each is what you think it is. `set_text` on a rich-text cell raises rather than flattening it; let it.
3. **Change only the cells that must change.** If a clarification is correct, leave the bytes alone. The diff is the review, nothing more.
4. **Resize any wrapped block the edit grew or shrank.** See “Sizing wrapped text blocks” below. Text that fits the cell is part of the edit, not part of the export QA.
5. **Save over the job folder copy.** Same filename, same folder. For a change order, the copy lives in `Source Docs` — see “Change-order paperwork placement.”
6. **Verify before reporting.** The gate below is not optional.

## Sizing wrapped text blocks
Excel does not autofit merged cells. When an edit adds text to a wrapped or merged cell — the Clarifications and Exclusions block especially — the row heights stay where the old text left them and the new text clips silently in the render. The verifier reads cell values, so no value check catches it.

The reverse holds when an edit removes text: the merged block keeps its old rows and prints a tall empty gap under the shortened text. Resizing covers both directions and is the reviewer's job, done in the same edit session:

1. Find the merge range for the cell (e.g., `A59:G64`) and the widths of the columns it spans. The widths sum to an approximate characters-per-line figure — on the CO rider template, columns A through G total about 118 characters at Calibri 11.
2. Count wrapped lines: for each logical line in the cell, `ceil(length / chars-per-line)`.
3. Budget about 15 points per line at Calibri 11, add roughly 5% margin, and distribute the total evenly across the merged rows by setting each row's `ht` attribute in the worksheet XML. Copy every other zip member byte-for-byte and run the verification gate; only the worksheet XML should change.
4. **Shrink.** When the recomputed line count needs fewer points than the merged rows now give, remove the surplus merged rows with `delete_rows`, taking them from the bottom of the block so its top cell (which holds the text) stays put, and leave the remaining rows at a height that still renders the whole block. Where a block has no rows to spare, reduce the row heights instead. Do this in the same session as the text edit, not later in Excel.

Worked example (CPD Marquette CO1, 2026-08-18): ten logical lines wrapped to ~19 rendered lines, needing ~285 points against the 111 the old text used; rows 59–64 were set to 48.5 each for 291 total.

The drafter's final print check in Excel still stands — the arithmetic above is an estimate, and a line that clips at true rendering means the rows need a nudge.

## Change-order paperwork placement
The change-order workbook and its exported PDF live in the job folder's `Source Docs` subfolder once the PDF is made — not in `Subcontractor & Supplier Docs` and not in the folder root. Save CO edits over the `Source Docs` copy. On a job that predates the convention, create `Source Docs` and move both files rather than leaving them where they were found.

## Verification gate
```python
a = zipfile.ZipFile(backup); b = zipfile.ZipFile(edited)
assert a.namelist() == b.namelist()                      # no part added or dropped
changed = [n for n in a.namelist() if a.read(n) != b.read(n)]
```

`changed` should contain only the parts your edits touch — typically `sharedStrings.xml`, the one `worksheets/sheetN.xml`, and, when a formula was replaced, `calcChain.xml` and `workbook.xml`. Anything else means stop and rebuild from the backup.

A shrink with `delete_rows` changes, in addition to the edited text's `sharedStrings.xml`:

| Member | Changes when |
|---|---|
| `worksheets/sheetN.xml` (the edited sheet) | Always: rows, merge ranges and the dimension move up |
| `workbook.xml` | A print area or other defined name reaches below the removed rows |
| `drawings/drawingN.xml` (the edited sheet's drawing) | A drawing, such as a signature line, is anchored below the removed rows |
| `calcChain.xml` | A formula cell sits below the removed rows |
| another `worksheets/sheetN.xml` | A formula on that sheet points at a row below the removed rows |

On the schedule template, shrinking the Clarifications and Exclusions block changes `sharedStrings.xml`, the schedule's sheet XML, `workbook.xml` (print area) and its drawing (signature lines). Every other member stays bit-identical.

Then confirm content: rich-text runs still alternate bold and plain as before, the pricing cell holds a number rather than a formula, and the strings you set read back correctly.

## Re-running after an edit
If the schedule has already been saved by a library that damages it, do not repair the damaged file. Rebuild from the pristine backup and apply the full edit set again. Damage is not reversible by further editing.

## Delivery
The edited schedule in the job folder is the deliverable. Tell the user the backup exists and to open the file and check the print layout before it goes out.
