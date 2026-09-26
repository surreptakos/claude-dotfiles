#!/usr/bin/env python3
"""Partition AAC-WR-001 into references/.

    python3 scripts/build_references.py <AAC-WR-001.md> references/

Prints the content-sha. Exits non-zero if any section of the source lands in no
file.
"""
import hashlib
import pathlib
import sys

PARTS = [
    ("CORE.md",
     "Rules 1-74. Governing rules, house style, punctuation, capitalization, "
     "numbers, abbreviations, spelling, grammar",
     ["How to use", "Part I ", "Part II ", "Part III ", "Part IV ", "Part V ",
      "Part VI ", "Part VII ", "Part VIII "]),
    ("LAYOUT.md",
     "Rules 75-102. Page layout, lists, tables, Word styles",
     ["Part IX ", "Part X ", "Part XI ", "Appendix E"]),
    ("DELIVERABLES.md",
     "Rules 103-144. Email, Teams, letters, memos, reports, proposals and "
     "scopes, SOPs, contract and legal, technical",
     ["Part XII ", "Part XIII ", "Part XIV ", "Part XV ", "Part XVI ",
      "Part XVII ", "Part XVIII ", "Part XIX ", "Part XX "]),
    ("CONTROL.md",
     "Rules 145-152. File names, document review, format matrix, editorial "
     "decision rule, release checklists",
     ["Part XXI ", "Part XXII ", "Part XXIII ", "Part XXIV ", "Appendix A",
      "Appendix B"]),
    ("DRAFT-QUALITY.md",
     "Rules 153-167. AI tells, machine vocabulary, phrase register, "
     "structure register",
     ["Part XXV ", "Appendix G", "Appendix H"]),
    ("TERMINOLOGY.md",
     "Terminology list, quick reference, style governance and decision register",
     ["Appendix C", "Appendix D", "Appendix F", "References"]),
]


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


def main(src, outdir):
    text = pathlib.Path(src).read_text(encoding="utf-8")
    blocks = split_blocks(text)
    front = text.split("\n# ")[0].strip()

    out = pathlib.Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    used, written = set(), []

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
        content = f"# AAC-WR-001 - {desc}\n\n" + "\n".join(body).strip() + "\n"
        (out / fname).write_text(content, encoding="utf-8")
        written.append((fname, len(content.split())))

    (out / "FRONT-MATTER.md").write_text(
        "# AAC-WR-001 - control block\n\n" + front + "\n", encoding="utf-8")

    orphans = [blocks[i][0] for i in range(len(blocks))
               if i not in used and blocks[i][0] not in DROP]
    if orphans:
        sys.exit(f"ERROR: source sections assigned to no file: {orphans}")

    sha = hashlib.sha256(text.encode()).hexdigest()[:12]
    print(f"content-sha: {sha}")
    for fname, words in written:
        print(f"  {fname:<20} {words:>6} words")
    return sha


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: build_references.py <AAC-WR-001.md> <references/>")
    main(sys.argv[1], sys.argv[2])
