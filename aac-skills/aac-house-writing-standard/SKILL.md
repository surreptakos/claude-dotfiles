---
name: aac-house-writing-standard
description: "AAC house writing standard, AAC-STD-001 (formerly AAC-WR-001). Load before drafting, formatting or reviewing any AAC deliverable: email, Teams message, memo, letter, report, SOP, proposal, scope, Word document or table; also a performance review or its audit."
metadata:
  standard-version: '0.16'
  modified: "2026-10-02T23:09:18Z"
  previous-modified: "2026-10-02T18:10:11Z"
  revision: "24"
  content-sha: "cf86ef3de2ac"
---

# AAC house writing standard

`references/` holds the controlled copy of AAC-STD-001; `scripts/` holds its
mechanical check.

## The rule that shapes this skill

**Read each rule in `references/` and cite it by number. Restate no rule, not
in this file, not in a job folder, not from memory:** a condensation of v0.2
with no rule numbers rode here while the standard moved to v0.4, and nothing it
claimed could be checked.

When any summary disagrees with the controlled copy, the controlled copy wins;
name the disagreement.

## How it works

1. Read `references/00-INDEX.md`. It routes the deliverable to the files it
   needs, routes work that belongs to another controlled document, and
   describes the mechanical check.
2. Read `references/CORE.md`, then the files the index names.
3. Run the mechanical check on anything already written, as the index describes.
4. When the deliverable answers someone, list every question they asked before
   drafting. Each one gets an answer at the depth they asked: asked how a number
   was reached, show the arithmetic with its inputs labeled. A request to shorten
   cuts framing and repetition and keeps every answer. A fact you inferred, such
   as why a record changed, is written as inference, with who can confirm it
   (Rule 8). Write the deliverable in full house prose, whatever the terse style
   of your own session replies.
5. Draft or review against the rules you read, citing each by number: "Rule 23
   prohibits em dashes in company writing."
6. Confirm the result against Rule 166, item by item. Done when every condition
   it names and every question listed in step 4 is answered.

## What stays human

Whether a clarification belongs in a scope, which exclusions a job earns, what
the customer was actually quoted, and who verified an installed sequence. The
controlled copy governs how those are written, not what they say. Where a fact
about AAC is not in the source you were given, leave `[CONFIRM]` and say what
would settle it.

## Regenerating after a revision of the standard

The master is `docs/standards/AAC-STD-001.md` at the repo root. Edit the
master, never `references/`, then regenerate from this directory:

```
python3 scripts/build_references.py ../../docs/standards/AAC-STD-001.md references/
```

The script exits non-zero if any section of the source lands in no file, so a
new Part cannot go missing. It also writes `references/00-INDEX.md`: its prose is
edited in the script's `INDEX` template, its counts come from
`scripts/wr001-coverage.md`, so update the coverage table first, then build.

When a revision adds or changes a rule, the same PR adds its check to
`scripts/wr001-lint.js` or its row to `scripts/wr001-coverage.md` saying why no
pattern can decide it; `tools/wr001-lint-coverage.test.js` fails when the two
disagree (Dan, September 29, 2026, after Rule 37 sat as an owner ruling for six
days with no check). Then set `standard-version` in this file's `metadata` and
`STANDARD_VERSION` in `scripts/wr001-lint.js` to the new version. The other four
metadata keys belong to `tools/skill-stamps.py`.
