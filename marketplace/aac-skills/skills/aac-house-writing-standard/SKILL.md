---
name: aac-house-writing-standard
description: 'AAC-WR-001, the controlled copy of AAC''s house writing and document standard. Load before drafting, formatting or reviewing any AAC deliverable: email, Teams message, memo, letter, report, SOP, proposal, scope, Word document, or table. Also load for a performance review or its audit.'
metadata:
  standard-version: '0.10'
  modified: '2026-09-26T01:37:12Z'
  previous-modified: '2026-09-26T00:06:54Z'
  revision: '11'
  content-sha: 09cbbfb11622
---

# AAC house writing standard

AAC-WR-001 travels in this skill. The controlled copy is in `references/`; the
mechanical check is in `scripts/`.

## The rule that shapes this skill

**`references/` holds the controlled copy. Never restate a rule — not in this
file, not in a job folder, not from memory. Read the file and cite the rule by
number.**

A condensation of v0.2 rode in this skill for months while the standard moved to
v0.4. It carried no rule numbers, so nothing it claimed could be checked against
the text it came from.

If a summary anywhere disagrees with the controlled copy, the controlled copy
wins. Say so rather than picking.

## How it works

1. Read `references/00-INDEX.md`. It routes the deliverable to the files it
   needs, routes work that belongs to another controlled document, and
   describes the mechanical check.
2. Read `references/CORE.md`, then the files the index names.
3. Run the mechanical check on anything already written, as the index describes.
4. When the deliverable answers someone, list every question they asked before
   drafting. Each one gets an answer at the depth they asked: asked how a number
   was reached, show the arithmetic with its inputs labeled. A request to shorten
   cuts framing and repetition, never an answer. A fact you inferred, such as why
   a record changed, is written as inference, with who can confirm it (Rule 8).
   The terse style of your own session replies never carries into the deliverable.
5. Draft or review against the rules you read, citing each by number: "Rule 23
   prohibits em dashes in company writing."
6. Confirm the result against Rule 166, item by item. Every condition it names
   is answered before release, and so is every question listed in step 4.

## What stays human

Whether a clarification belongs in a scope, which exclusions a job earns, what
the customer was actually quoted, and who verified an installed sequence. The
controlled copy governs how those are written, not what they say. Where a fact
about AAC is not in the source you were given, leave `[CONFIRM]` and say what
would settle it.

## Regenerating after a revision of the standard

The master is `docs/standards/AAC-WR-001.md` at the repo root. Edit it, never
the files under `references/`, then from this directory:

```
python3 scripts/build_references.py ../../docs/standards/AAC-WR-001.md references/
```

The script exits non-zero if any section of the source lands in no file, so a
new Part cannot go missing. Then set `standard-version` in this file's
`metadata` and `STANDARD_VERSION` in `scripts/wr001-lint.js` to the new
version. The other four metadata keys belong to `tools/skill-stamps.py`; the
repo's stamp-and-build commands rotate them.
