# AAC-WR-001 index

The controlled copy of AAC's house writing and document standard, partitioned
for reading. Rules are numbered 1 through 166 and each number lives in exactly
one file.

Generated, never hand-edited. `SKILL.md` carries the regeneration procedure.

## Read order

`CORE.md` always. It carries the order of authority (Rule 2), the meaning of
must, should, may and do not (Rule 3), and every punctuation, capitalization,
number, abbreviation, spelling and grammar rule. Those reach every sentence of
every deliverable, so no task skips it.

Then read only what the deliverable needs.

| File | Read it when | Rules |
|---|---|---|
| `CORE.md` | **Always, first.** Order of authority, house style, punctuation, capitalization, numbers, abbreviations, spelling, grammar | 1-74 |
| `DELIVERABLES.md` | The deliverable is an email, Teams message, letter, memo, report, proposal, scope of work, SOP, contract or legal text, or technical writing | 103-144 |
| `LAYOUT.md` | Producing a Word document, a table, or any list; setting margins, fonts, headings or styles | 75-102 |
| `DRAFT-QUALITY.md` | Any original prose. AI tells, plus the release check that closes the work | 153-166 |
| `CONTROL.md` | Naming a file, running the pre-send review, or choosing the format for a document type | 145-152 |
| `TERMINOLOGY.md` | An AAC term, acronym or product name is in question, or you need the decision register | — |
| `FRONT-MATTER.md` | Reporting which version governs | — |

## Common loads

| Deliverable | Files |
|---|---|
| Email or Teams message | `CORE.md`, `DELIVERABLES.md`, `DRAFT-QUALITY.md` |
| Proposal, scope of work, report | `CORE.md`, `DELIVERABLES.md`, `LAYOUT.md`, `DRAFT-QUALITY.md`, `CONTROL.md` |
| SOP or work instruction | `CORE.md`, `DELIVERABLES.md`, `LAYOUT.md`, `CONTROL.md` |
| Reviewing someone else's draft | `CORE.md`, `DRAFT-QUALITY.md`, `CONTROL.md` |
| Contract or legal text | `CORE.md`, `DELIVERABLES.md`. Rule 2 governs what AAC may restyle |

Rule 2 names controlled documents that outrank AAC-WR-001 within their scope,
including the AAC performance review standards. When a deliverable falls under
one of them, name that document and hand the work to it.

## Mechanical check

`scripts/wr001-lint.js` decides 21 of the 166 rules by pattern: 15, 23, 25, 27,
28, 29, 42, 44, 45, 46, 47, 53, 56, 57, 61, 62, 64, 65, 66, 146, 165. Run it
before reading, and read for the rest.

```
node scripts/wr001-lint.js <file> [--formal|--prose]
```

Exit 0 clean, 1 findings at error severity. Formality is detected from the
filename and opening lines; `--formal` forces it, which makes Rule 23 and Rule
28 hard failures. The linter reports findings; it never decides that a draft is
finished. Rule 166 does that.
