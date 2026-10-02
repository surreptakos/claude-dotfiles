#!/usr/bin/env python3
"""Partition AAC-STD-001 into references/.

    python3 scripts/build_references.py <AAC-STD-001.md> references/

Prints the content-sha. Exits non-zero if any section of the source lands in no
file. Writes 00-INDEX.md too: the rule range, each file's rule span, and the
linter's pattern and Jev counts, read from scripts/wr001-coverage.md, so no count
there is ever edited by hand (issue 1164).
"""
import hashlib
import pathlib
import re
import sys

COVERAGE = pathlib.Path(__file__).resolve().parent / "wr001-coverage.md"
RULE_HEAD = re.compile(r"^## (\d+)\. ", re.M)
COVERAGE_ROW = re.compile(
    r"^\| \d+ \| .+? \| (Pattern and Jev|Pattern|Jev|Reader|Layout) \| ", re.M)

PARTS = [
    ("CORE.md",
     "Governing rules, house style, punctuation, capitalization, "
     "numbers, abbreviations, spelling, grammar",
     ["How to use", "Part I ", "Part II ", "Part III ", "Part IV ", "Part V ",
      "Part VI ", "Part VII ", "Part VIII "]),
    ("LAYOUT.md",
     "Page layout, lists, tables, Word styles",
     ["Part IX ", "Part X ", "Part XI ", "Appendix E"]),
    ("DELIVERABLES.md",
     "Email, Teams, letters, memos, reports, proposals and "
     "scopes, SOPs, contract and legal, technical",
     ["Part XII ", "Part XIII ", "Part XIV ", "Part XV ", "Part XVI ",
      "Part XVII ", "Part XVIII ", "Part XIX ", "Part XX "]),
    ("CONTROL.md",
     "File names, document review, format matrix, editorial "
     "decision rule, release checklists",
     ["Part XXI ", "Part XXII ", "Part XXIII ", "Part XXIV ", "Appendix A",
      "Appendix B"]),
    ("DRAFT-QUALITY.md",
     "AI tells, machine vocabulary, reader need, phrase register, "
     "structure register",
     ["Part XXV ", "Appendix G", "Appendix H"]),
    ("REVIEW.md",
     "Performance review material: the review page, audit and coaching "
     "email mechanics, review file names, templates and the gate script",
     ["Part XXVI "]),
    ("TERMINOLOGY.md",
     "Terminology list, quick reference, style governance and decision register",
     ["Appendix C", "Appendix D", "Appendix F", "References"]),
]


# 00-INDEX.md, filled in by write_index(). Its prose is edited here; the numbers
# in braces come from the master and the coverage table.
INDEX = """# AAC-STD-001 index

The controlled copy of AAC's house writing and document standard, partitioned
for reading. Rules are numbered 1 through {total} and each number lives in exactly
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
| `CORE.md` | **Always, first.** Order of authority, house style, punctuation, capitalization, numbers, abbreviations, spelling, grammar | {span[CORE.md]} |
| `DELIVERABLES.md` | The deliverable is an email, Teams message, letter, memo, report, proposal, scope of work, SOP, contract or legal text, or technical writing | {span[DELIVERABLES.md]} |
| `LAYOUT.md` | Producing a Word document, a table, or any list; setting margins, fonts, headings or styles | {span[LAYOUT.md]} |
| `DRAFT-QUALITY.md` | Any original prose. AI tells, machine vocabulary, plus the release check that closes the work | {span[DRAFT-QUALITY.md]} |
| `REVIEW.md` | A performance review, its audit, or a format, meaning or coaching email about one. Rule 2 scopes it to that material | {span[REVIEW.md]} |
| `CONTROL.md` | Naming a file, running the pre-send review, or choosing the format for a document type | {span[CONTROL.md]} |
| `TERMINOLOGY.md` | An AAC term, acronym or product name is in question, or you need the decision register | {span[TERMINOLOGY.md]} |
| `FRONT-MATTER.md` | Reporting which version governs | {span[FRONT-MATTER.md]} |

## Common loads

| Deliverable | Files |
|---|---|
| Email or Teams message | `CORE.md`, `DELIVERABLES.md`, `DRAFT-QUALITY.md` |
| Proposal, scope of work, report | `CORE.md`, `DELIVERABLES.md`, `LAYOUT.md`, `DRAFT-QUALITY.md`, `CONTROL.md` |
| SOP or work instruction | `CORE.md`, `DELIVERABLES.md`, `LAYOUT.md`, `CONTROL.md` |
| Reviewing someone else's draft | `CORE.md`, `DRAFT-QUALITY.md`, `CONTROL.md` |
| Contract or legal text | `CORE.md`, `DELIVERABLES.md`. Rule 2 governs what AAC may restyle |
| Performance review, its audit, or a coaching email | `CORE.md`, `DELIVERABLES.md`, `DRAFT-QUALITY.md`, `REVIEW.md`, and the review standards Rule 2 names |

Rule 2 names controlled documents that outrank AAC-STD-001 within their scope,
including the AAC performance review standards. When a deliverable falls under
one of them, name that document and hand the work to it. Review material also
takes `REVIEW.md`, the layout and mechanics Rule 2 scopes to it.

## Mechanical check

`scripts/wr001-lint.js` decides {pattern} of the {total} rules by pattern and {jev} by Jev
(judgment, warning only); `scripts/wr001-coverage.md` says how every rule is
checked, or why a reader decides it. Run the linter before reading, and read
for the rest.

```
node scripts/wr001-lint.js <file> [--formal|--prose]
```

Exit 0 clean, 1 findings at error severity. Formality is detected from the
filename and opening lines; `--formal` forces it, which makes Rule 23 and Rule
28 hard failures. The linter reports findings; it never decides that a draft is
finished. Rule 166 does that.
"""


# The source table of contents is superseded by 00-INDEX.md. Dropping it is
# deliberate, not an oversight: two maps of the same content is duplication.
DROP = ["Contents"]


def split_blocks(text):
    blocks, cur, head = [], [], None
    for line in text.split("\n"):
        if line.startswith("# "):
            if head is not None:
                blocks.append((head, "\n".join(cur)))
            head, cur = line[2:].strip(), [line]
        elif head is not None:
            cur.append(line)
    if head is not None:
        blocks.append((head, "\n".join(cur)))
    return blocks


def coverage_counts():
    kinds = COVERAGE_ROW.findall(COVERAGE.read_text(encoding="utf-8"))
    both = kinds.count("Pattern and Jev")
    return kinds.count("Pattern") + both, kinds.count("Jev") + both


def write_index(out, spans, all_rules):
    total = len(all_rules)
    if sorted(all_rules) != list(range(1, total + 1)):
        sys.exit("ERROR: rule numbers are not 1 through N, each in one file")
    pattern, jev = coverage_counts()
    (out / "00-INDEX.md").write_text(
        INDEX.format(total=total, span=spans, pattern=pattern, jev=jev),
        encoding="utf-8", newline="\n")


def main(src, outdir):
    text = pathlib.Path(src).read_text(encoding="utf-8")
    blocks = split_blocks(text)
    front = text.split("\n# ")[0].strip()

    out = pathlib.Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    used, written, spans, all_rules = set(), [], {"FRONT-MATTER.md": "—"}, []

    for fname, desc, prefixes in PARTS:
        body = []
        for i, (head, block) in enumerate(blocks):
            if i in used:
                continue
            # Prefixes keep their trailing space on purpose: without it,
            # "Part I " would prefix-match "Part IX".
            if any(head.startswith(p) for p in prefixes):
                body.append(block)
                used.add(i)
        if not body:
            sys.exit(f"ERROR: no source sections matched {fname}")
        rules = sorted(int(n) for n in RULE_HEAD.findall("\n".join(body)))
        spans[fname] = f"{rules[0]}-{rules[-1]}" if rules else "—"
        all_rules += rules
        if rules:
            desc = f"Rules {spans[fname]}. {desc}"
        content = f"# AAC-STD-001 - {desc}\n\n" + "\n".join(body).strip() + "\n"
        # newline="\n": on Windows the default turns every line into CRLF and
        # the committed LF copies show as rewritten end to end.
        (out / fname).write_text(content, encoding="utf-8", newline="\n")
        written.append((fname, len(content.split())))

    (out / "FRONT-MATTER.md").write_text(
        "# AAC-STD-001 - control block\n\n" + front + "\n", encoding="utf-8",
        newline="\n")

    orphans = [blocks[i][0] for i in range(len(blocks))
               if i not in used and blocks[i][0] not in DROP]
    if orphans:
        sys.exit(f"ERROR: source sections assigned to no file: {orphans}")

    write_index(out, spans, all_rules)

    sha = hashlib.sha256(text.encode()).hexdigest()[:12]
    print(f"content-sha: {sha}")
    for fname, words in written:
        print(f"  {fname:<20} {words:>6} words")
    return sha


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: build_references.py <AAC-STD-001.md> <references/>")
    main(sys.argv[1], sys.argv[2])
