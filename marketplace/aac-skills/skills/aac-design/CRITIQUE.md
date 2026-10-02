# Design critique protocol

Adapted for paper forms from pbakaus/impeccable (`reference/critique.md`, `reference/audit.md`, Apache 2.0) and the Anthropic design plugin's `design-critique`. The scoring rules are strict: `scripts/score.py` rejects a critique that breaks them.

## Invariants

- Two assessments, always. **A** is the design review. **B** is the detector (`designlint.py`) plus the renders (`render.py`).
- A and B run as two isolated sub-agents whenever the Agent tool exists. A must finish before B's output enters your context, because detector output anchors judgment.
- Running both in one context is allowed only when no sub-agent tool exists. The report's first line then reads `⚠️ DEGRADED: single-context (<reason>)`, and the release gate fails until a dual run passes.
- A reviews the **rendered PNGs**, never the XML or the spec alone. A form is judged by what prints.
- A skipped detector is a failed critique unless `designlint.py` crashed after a real attempt.
- Bounded passes: critique once, fix everything in one batch, confirm with at most one more critique, stop.

## Assessment A: design review

Give the sub-agent only these: the PNG paths (both stand-ins), the spec JSON, the purpose of the form, who fills it in, and this file. It returns, in this order:

1. **Specificity verdict.** Does the form read as authored for this AAC process, or could any company use it unchanged? Check it against `TELLS.md`.
2. **Heuristic scores**, ten of them, each 0–4 or `n/a: <reason>`, using the tables below.
3. **Audit scores**, five dimensions, each 0–4.
4. **Cognitive load:** the checklist items it fails.
5. **Personas:** 2–3 personas from the table, each walked through the fill-in path with named red flags.
6. **2–3 strengths, 3–5 priority issues** (P0–P3, each with *what*, *why it matters*, *fix*), and minor observations.

## Assessment B: detector and renders

```bash
python3 scripts/render.py form.docx --max-pages N --out render/
python3 scripts/designlint.py form.docx --json
node <aac-house-writing-standard>/scripts/wr001-lint.js <plain-text export> --formal
```

B returns page counts under both stand-ins, every detector finding, and which findings are false positives with a reason. Rule 95 table-title warnings on form layout grids are expected false positives, because they apply to data tables.

## Heuristic scoring (Nielsen's ten, for paper)

A 4 means genuinely excellent. Most real forms land at 20–32 of 40. Heuristic 7 may be `n/a` on a single-use form that nobody fills in more than once a year; say why in the cell.

### 1. Visibility of status
*Can each person tell where the form is in its process, and whose move it is?* Check: numbered steps on the signature cards, completed signatures visible, an office-use section that shows processing.

| 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| No sense of order or ownership | Order implied only by position | Order stated once, not tied to the fields | Order stated and mirrored in the signature cards | Every step, owner and hand-off is visible at a glance |

### 2. Match to the real world
*Does it use the reader's words and the order they do the task in?* Check: plain labels, AAC terms from the source documents, fields in fill-in order.

| 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Legal or system jargon throughout | Mostly insider terms | Mixed | Plain, one term needs context | Reads the way the people filling it in talk |

### 3. User control and freedom
*Can a signer decline, return or correct?* Check: an approve-or-return choice, a way to correct an entry, no step that forces a signature to proceed.

| 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Signing is the only path | Returning is possible but unmarked | One exit, others missing | Approve or return exists, correction is implied | Every signer can approve, return or correct, and the form says how |

### 4. Consistency and standards
*Same thing, same name, same look, everywhere.* Check: one term per role, identical field styling, the AAC template and tokens, house-standard conventions.

| 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Stitched together | Many inconsistencies | Main areas match, details drift | One minor deviation | Fully consistent with DESIGN-SYSTEM.md and AAC-WR-001 |

### 5. Error prevention
*Does the layout stop wrong entries before they happen?* Check: units stated, choices instead of free text where values are known, constant values prefilled, enough space for the longest real answer.

| 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Blank lines, no guidance | Few constraints | Common errors blocked, edge cases open | Most error paths closed | Wrong entries are hard to make |

### 6. Recognition rather than recall
*Can someone fill it in without another document open?* Check: every field labeled, the instructions next to the field they govern, no need to look up a code or section.

| 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Needs outside knowledge everywhere | Mostly needs lookups | Main fields clear, some lookups | One lookup at most | Everything needed is on the page |

### 7. Flexibility and efficiency
*Does it serve the frequent filler as well as the first-timer?* Check: typing or ticking in Word works as well as printing, prefilled constants, a logical tab order for electronic fill.

| 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| One rigid way | Print only, nothing prefilled | Some prefill | Prints and fills electronically | Fast for the repeat user, clear for the first-timer |

### 8. Aesthetic and minimalist design
*Does every element earn its place?* Check: no duplicate fields, no decoration, clear hierarchy, whitespace that groups rather than pads.

| 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Everything competes | Cluttered | Main content clear, edges noisy | Clean, minor noise | Every element earns its space |

### 9. Error recovery
*When someone gets it wrong, what happens?* Check: a Returned path with where it goes back to, correction instructions, no dead end.

| 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| A mistake means starting over, unexplained | Recovery exists only by asking | Recovery implied | Recovery path named | Recovery is obvious and keeps completed work |

### 10. Help and documentation
*Does the reader know who to ask and where the form goes?* Check: a return-to line, the governing document named where terms apply, the right amount of instruction.

| 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| No help or destination | Destination unclear | Destination only | Destination and governing terms | Right help at the right field, nothing extra |

**Total** is the sum of scored heuristics out of 4 × (the number scored). Bands by percentage: 90%+ Excellent, 70%+ Good, 50%+ Acceptable, 30%+ Poor, below that Critical. Never print /40 over a partial set.

## Audit dimensions (0–4 each, /20)

| Dimension | Checks | 0 | 2 | 4 |
|---|---|---|---|---|
| **legibility** | Contrast (designlint D06), 9 pt floor on captions, 10 pt body, readable at arm's length | Fails contrast or size | Passes, some strain | Comfortable for a low-vision reader |
| **print** | Fits the page budget under both stand-ins, survives grayscale, fax and photocopy, no meaning carried by color alone | Breaks across pages or loses meaning in grayscale | Fits, some color-only cues | Prints, copies and faxes with nothing lost |
| **fillability** | Write space fits real handwriting (value rows ≥ 0.37 in, signature rows ≥ 0.47 in), drawn checkboxes, room after "Other" | Cramped or unfillable | Fillable, tight in places | Fits the longest real answer in a normal hand |
| **system** | Tokens from DESIGN-SYSTEM.md, one accent hue, one font family, AAC template | Ad hoc | Mostly tokens | Pure system |
| **integrity** | Detector clean, no TELLS.md patterns, content matches the source documents | Systemic drift | Several verified issues | Coherent and intentional |

Bands: 18–20 Excellent, 14–17 Good, 10–13 Acceptable, 6–9 Poor, 0–5 Critical.

## Cognitive load checklist

Count the failures: 0–1 low, 2–3 moderate, 4+ high (critical). Use these exact item names in `critique.json`.

- `single_focus`: each section serves one task.
- `chunking`: no group has more than four fields.
- `grouping`: related fields share a section box; unrelated ones do not.
- `visual_hierarchy`: in a squint test the title, then the sections, then the signatures read in order.
- `one_thing_at_a_time`: each signer sees their own block and does not need to read the others' first.
- `minimal_choices`: no choice field offers more than four options, not counting "Other."
- `working_memory`: nothing has to be carried from one part of the form to another.
- `progressive_disclosure`: conditional material (sales-plan terms, HR use) is visually secondary.

## Severity

| P | Name | Meaning | Action |
|---|---|---|---|
| P0 | Blocking | The form cannot be completed or would be legally wrong | Fix now |
| P1 | Major | Real confusion, a wrong entry is likely, or WCAG AA fails | Fix before release |
| P2 | Minor | Annoyance with a workaround | Fix in this pass if cheap |
| P3 | Polish | No user impact | Fix if time permits |

Test for P1: would someone call HR about it?

## Personas for paper forms

Pick 2–3 that match the form. Walk each one through filling it in and name exactly what fails for them.

| Persona | Profile | Red flags |
|---|---|---|
| **Jordan, first-time employee** | Has never seen the form, reads every word, takes labels literally | Undefined terms, unclear whose field is whose, no destination |
| **Pat, approver in a hurry** | Signs dozens of forms, reads only their own block | Their decision hidden in prose, no approve or return choice, prefill missing |
| **Sam, low vision or faxed copy** | Reads a grayscale photocopy at 200% | Light gray text, color-only meaning, hairline boxes that vanish on copy |
| **Riley, stress tester** | Long names, two-line reasons, pen mistakes | Cells too short, no room after "Other," no way to correct |
| **Chris, HR processor** | Keys the form into the HR database and payroll | Fields out of system order, ambiguous values (hourly or annual), missing date |

## Branch adaptations

The heuristics, audit dimensions and personas are written for paper forms. For the other branches, read each check through the branch's task:

| Branch | Read "fill in" as | Page budget and render | Personas to prefer |
|---|---|---|---|
| Document | read, act on, sign | pages set by the plan; both stand-in fonts | Jordan, Pat, Sam |
| Deck | follow while someone presents | slide count; nothing below 12 pt | Pat, Sam, Riley |
| Web page | find, act, navigate | desktop and phone-width screenshots; keyboard path | Jordan, Sam, Riley |

For the web branch, the fillability audit dimension becomes **interaction** (labels, focus, targets at least 44 px, keyboard path), and print fidelity becomes **responsive fidelity** (no horizontal scroll at 375 px, readable at 200% zoom).

## Report

Write the report in chat first. Persistence and scoring bookkeeping come after.

1. The first line is the method: `Method: dual-agent (A: <id> · B: <id>)` or the degraded banner.
2. The `score.py --markdown` tables: heuristics, audit, cognitive load, gate.
3. Specificity verdict, then detector summary (counts, false positives, what the detector caught that A missed).
4. Strengths (2–3), priority issues (3–5, P-tagged, each with *what*, *why*, *fix*), persona red flags, minor observations.
5. The close: when there are **three or more** priority issues, ask 2–3 targeted questions tied to the findings, each with 2–3 concrete options, **last** in the message. With fewer than three, write `Questions skipped: <n> priority issues`. A report with neither is incomplete.
