# AAC design system

Approved by Dan Gatsakos on 2026-09-30, line by line. The tokens apply to every AAC deliverable. The components are the form branch, which `scripts/build_form.py` implements; its `T`, `S` and constant block is the executable copy of the tables below, so change a token in both places or neither.

## Tokens

### Color

| Token | Value | Use | Contrast (`designlint.py --contrast`) | Source |
|---|---|---|---|---|
| `accent` | #1161A0 | Section headings, step numbers, bullets, the title bar | 6.48:1 on white, 5.63:1 on tint | AAC brand blue, TPS title bar |
| `tint` | #E8F0F8 | Fill for signer cards and the HR card; nothing else | Black on tint 18.25:1 | Approved 2026-09-30 |
| `caption` | #595959 | Field labels and signer statements only | 7.00:1 on white, 6.09:1 on tint | Approved 2026-09-30 |
| `border` | #7F7F7F, 0.5 pt | Every cell border | 4.00:1 on white (non-text minimum 3:1) | Approved 2026-09-30 |
| `text` | black | Everything else, including the intro (Rule 78) | n/a | AAC-WR-001 Rule 78 |

One accent hue per deliverable. No color carries meaning alone.

### Type

Aptos, named on every run and in the document defaults (never through the theme alone; designlint D18). Checkboxes are FORMCHECKBOX fields.

| Token | Size | Weight and color | Use |
|---|---|---|---|
| `heading` | 11 pt | bold, accent | Section heading (Rule 77, third level) |
| `role` | 10 pt | bold, black; step number in accent | Signer and HR card heading |
| `value` | 10.5 pt | regular, black | Prefilled values, choice text |
| `body` | 10 pt | regular, black | Intro, terms |
| `caption` | 9 pt | regular, caption gray | Field labels, signer statements |

Floor: 9 pt on paper, 12 pt on slides (designlint D07).

### Spacing scale (points)

| Step | pt | Used for |
|---|---|---|
| `hair` | 1 | Space around a written value |
| `tight` | 2 | Gap between a card heading and its statement or choices |
| `snug` | 3 | Heading after (Rule 82), term item after, cell top padding |
| `base` | 4 | Card top padding, gap after an acknowledgment line |
| `loose` | 6 | Cell and card side padding; spacer before the HR row |
| `open` | 8 | Card bottom padding, space before the intro |
| `heading_before` | 9 | Space above a section heading (Rule 82) |
| `value_row` | 27 | Minimum height of a field row (0.375 in) |
| `hr_row` | 28 | Minimum height of the HR row |
| `signature_row` | 34 | Minimum height of a signature row (0.47 in) |
| `indent` | 18 | Bullet hanging indent |

Other constants: terms line spacing 1.05; two em spaces between checkbox options; an en space between a step number and its role.

### Page and grid

U.S. Letter, 0.5 in margins (TPS template), 10,800 twips usable, a 12-column grid of 900 twips. The HR card takes 4 of the 12 columns.

## Components (form branch)

| Component | Spec block | Rules |
|---|---|---|
| Letterhead and title bar | from `assets/aac-letterhead.docx` | The title bar is bound to the document Title property; `title` sets both. Its capitals are the one caps exception. |
| Intro | `{"type":"intro","text":...}` | Black body text, one to three sentences: ink, dates, corrections, N/A, signing order, the legal timing rule. No step list. |
| Section | `{"type":"section","heading":...,"rows":[[field,...],...]}` | One joined grid per section; every cell fully bordered (Rule 98). Row spans sum to 12. Four fields or fewer per section. |
| Field | `{"label":...,"prefill":...,"span":n,"height":twips,"format":"date"\|"money"}` | Label inside the cell, top left, caption style (9 pt, Rule 77); write space below. State the unit in the label. `format` appends the entry format (below; Rule 43). Rules 77, 98. |
| Choice field | `{"label":...,"choices":[...],"other":true,"write":true}` | Drawn checkboxes, one fixed gap, no underline. Four options or fewer plus Other. `write` adds a write line for "describe" answers. Rules 77, 98. |
| Bullets | `{"type":"bullets","heading":...,"items":[...]}` | Terms and conditions. Bullets, never numbers; the signing steps own numbering. |
| Signatures | `{"type":"signatures","heading":...,"columns":[{"step","role","statement"\|"choices","prefill","labels"}],"rows":[...],"full_rows":[...]}` | One tinted card per signer in step order, then Signature (prefilled "X"), Printed name and Date rows. An approver gets Approved / Returned. `labels` renames a row for one column; `full_rows` adds full-width rows (return reason, late notice). The whole block is kept on one page (Rule 85). Rules 85, 99. |
| HR use | `{"type":"hr_use","step":n,"label":...,"statement":...,"fields":[label or {"label","span","format"}]}` | A tinted card plus one row of fields, the last step. `statement` says where the form goes. (`"office"` is accepted as an alias.) |
| Page break | `{"type":"page_break"}` | Starts the next block on a new page; use only when a section must begin a page. |
| Continuation header | `"continuation": {"identify": [labels], "label": optional}` | Pages 2 and on carry "<Form name>, continued" and a bordered row of the identity fields (employee, account), so a separated page can be matched to its first page (Rule 85). Page 1 keeps the letterhead. |
| Footer | `"footer": "Active Alarm Company, Inc. \| <Form name> \| Rev. YYYY-MM-DD"` | Page X of Y comes from the template. Bump the revision on every content change. |

Spec top level: `title`, `footer`, `max_pages` (the budget `render.py` enforces under both stand-in fonts), optional `continuation`, `blocks`. References: `examples/employee-raise-form.json` (one page) and `examples/multi-page-sample.json` (two pages, continuation header).

## Patterns

- **Labels inside boxes need the box.** A field label sits inside a fully bordered cell; without all four borders the label floats. Underscore lines and open fields are not used.
- **Dates are MM/DD/YYYY.** State it once in the intro when a form has three or more date fields; otherwise give the one date field `"format": "date"`.
- **Money states its unit in the label** ("$ per hour or per year"); cents are optional. `"format": "money"` adds "($)" when the label has no unit.
- **N/A is written and initialed.** The intro tells the filler to write N/A in a field that does not apply (Rule 99 defines N/A). A field is never left blank to mean "not applicable."
- **Step order lives on the signature cards.** The intro states the rule that matters; the cards carry the numbers.
- **Prefill every constant:** the authorized signer's printed name, a fixed title, the company name.
- **The signature block never strands** (Rule 85). It moves to the next page as a unit with its acknowledgment line.
- **Cut before you squeeze.** Duplicate and defensive content goes before a type size or row height shrinks, and nothing goes below the 9 pt floor.

## Document parts (document branch)

Documents are built with the `docx` skill on the AAC template, using the tokens above and AAC-WR-001 Appendix B and E. Nothing below is new; it maps the standard onto the tokens.

| Part | Treatment |
|---|---|
| Letter | Letterhead template, Aptos 11 pt body in `text`, full block, 1 in margins (Appendix B); signature block kept together (Rule 85). |
| Memo | DATE / TO / FROM / SUBJECT block, Aptos 11 pt, headings in `accent` at Rule 77 sizes; page numbers after page 1. |
| Report | Title 20 pt, Heading 1 14 pt, Heading 2 12 pt, Heading 3 11 pt, headings in `accent`; Page X of Y; data date on tables (Rule 124). |
| Data table | Title above in sentence case (Rule 95), header row in `tint` with bold `text`, 10 pt, rules between rows in `border`, **no full grid** (Rule 98), numbers right-aligned (Rule 97), source note 9 pt. A full grid is for fill-in cells only. |
| SOP | The `aac-sop` skill owns it; tokens apply. |

## Web tokens (web branch)

`assets/aac-tokens.css` carries the same tokens as CSS custom properties for HTML artifacts and pages: the colors, the type scale in rem, and the spacing scale. Pages import or inline it and build only from those variables. The Vercel web interface guidelines, fetched each run, govern interaction.

## Relation to AAC-WR-001

The house writing standard governs every word and the release; this file governs layout. AAC-WR-001 v0.11 adopted the amendment in `assets/AAC-WR-001-amendment-forms.md` (issue 1090), so the form system has no exceptions left:

| Standard | How the system meets it |
|---|---|
| Rules 1–74 | Every label, statement and term; Assessment B runs `wr001-lint.js` |
| Rule 37 | Headings, labels and the continuation title in sentence case |
| Rule 43 | Dates on forms are MM/DD/YYYY, format stated once in the intro or the field label |
| Rule 77 | Body 10 pt in tables; 9 pt labels and statements under the fill-in form clause; font named on runs and defaults |
| Rule 78 | Body text black; gray only for captions |
| Rules 79–82, 86 | designlint D01, D02, D10, D11; Page X of Y |
| Rule 85 | Keep-together signatures; continuation header repeating the form name and identity fields |
| Rule 98 | Full grid only on fill-in cells, under the fill-in form clause |
| Rule 99 | Blank write cells on an uncompleted form; N/A written and initialed on a completed one |
| Rules 145–147, 166 | Step 7 of the skill |

Still open, and not this system's to fix: the TPS letterhead writes the phone number "(847) 438-2600"; Rule 53 says 847-438-2600. That belongs to the template owner.

Expected linter false positives: Rules 95 and 124 fire on form layout grids because they govern data tables.

## Do and don't

| Do | Don't |
|---|---|
| "1 Manager" as the card heading | A "STEP 1" eyebrow above "Manager" |
| One brand blue | A second accent, or a stripe of it under a heading |
| Label inside a fully bordered cell | A label over an underscore line, or a box missing a side |
| Drawn checkboxes | The ☐ character |
| Bullets for terms | A second numbered list |
| Black body text, gray captions | Gray paragraphs |
| Cut a field to fit | Shrink text below 9 pt to fit |
