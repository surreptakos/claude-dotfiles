# AAC-STD-001 amendment: fill-in forms

Adopted in v0.11, when the standard was numbered AAC-WR-001, its former number.

For the controlled revision process. Apply to the master `docs/standards/AAC-STD-001.md`, then regenerate the skill references with `scripts/build_references.py`, as `aac-house-writing-standard/SKILL.md` describes. Each change adds text to an existing rule; no rule is renumbered.

Owner and approver: Dan Gatsakos, General Manager. Proposed 2026-09-30.

## Rule 43. Numeric dates (append)

> On a form that a person fills in by hand, write dates as MM/DD/YYYY. State the format once in the form's instructions, or in the field label when the form has one date field.

## Rule 77. Default font (append)

> On a fill-in form, field labels and statements printed inside a write cell are 9 pt, the source-note size. Written values, instructions and terms are at least 10 pt. Name the font on the text and in the document defaults; a font left only to the document theme falls back to Times New Roman in previews that do not read themes.

## Rule 98. Table formatting (append)

> Fill-in forms are the exception to limited borders. When a label sits inside the cell it names, the cell carries all four borders, and neighboring cells share them in one joined grid per section. A label without its box floats and reads as stray text. Do not use a typed line of _ characters or open space as write space. Data tables keep the limited-border treatment above.

## Rule 99. Empty and zero values (append)

> On a form, a person marks a field that does not apply by writing N/A and initialing it. A blank field on a completed form means the entry is missing, not that it does not apply.

## Rule 85. Page breaks (append)

> A form longer than one page repeats its name and its identity fields (such as the employee or account) at the top of every continuation page, and keeps each signature block together with the statement it signs.

## Appendix F. Decision register (add a row)

| Decision | Rule | Date | Approver | Reason |
|---|---|---|---|---|
| Fill-in forms: full cell borders with labels inside, 9 pt labels, MM/DD/YYYY dates, N/A initialed, continuation headers | 43, 77, 85, 98, 99 | 2026-09-30 | Dan Gatsakos | A label inside a cell floats without all four borders; forms need a consistent, fillable treatment the table rules did not give. Implemented by the `aac-design` skill (DESIGN-SYSTEM.md). |
