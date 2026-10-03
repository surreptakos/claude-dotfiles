---
name: aac-performance-review-audit
description: Audit a reviewing manager's AAC One Page performance review draft and write the skip-level's email back. Use when Dan shares a review draft, revision or self-appraisal, asks to audit or gate a review, or asks for its rejection or coaching email.
metadata:
  modified: '2026-10-02T23:07:47Z'
  previous-modified: '2026-10-02T21:14:40Z'
  revision: '17'
  content-sha: 6eff7c2add29
---

# AAC performance review audit

Dan Gatsakos (skip-level) receives a review draft from a reviewing manager (Mark Kurland, Nick Remblake, others) about a direct. The audit produces the email Dan sends back. Three gates, in order. Stop at the first gate that fails and produce only that gate's email: one class of problem per round, and nothing from a later gate. Every fix line names the item (S3, W4, Core Message, Guidance Point 2) and the check it failed.

**The standard is `standards.md` in the self-check skill: [`../aac-review-self-check/standards.md`](../aac-review-self-check/standards.md). Read it in full before Gate 1.** It is the controlling copy of the rules, format tests, meaning checks and substance list, and the manager's self-check reads the same file.

`review_gate_tools.py` beside this file runs the checks and builds the email docx (its header lists the commands). Run every command in this skill from this directory: the `../` paths resolve from here. `review_meaning.py` and `jev.py` are the same copies the self-check carries. Read `gate2.md`, `gate3.md` and `building-the-docx.md` when you reach that step, not before.

The "Performance Review Audits" project folder, when mounted, holds prior reviews, self-appraisals, workbooks, comp plans and earlier audits: use it for evidence, not procedure. If the folder's copy of a script carries a check this one lacks, the folder copy is newer: use it, and bring this one up to match.

## Before anything

0. When the "Performance Review Audits" project folder is mounted, read its reference files in full before the first audit of a session: "AAC Common Failure Modes.md", "AAC_Audit_Standards_Reference.md", "Gate Email Templates.md", both Dan anchor files, and the Manager Tools PDFs (OnePage, Preparing, Delivering, No Surprises, Shot Across The Bow, Aggregated Behaviors). The House Layout Standard is now WR-001 Part XXVI, read through `aac-house-writing-standard`, so the project's layout file is no longer on this list. standards.md wins where they differ, but they carry rulings it does not: Failure Mode 19 (never re-verify a figure the manager states) was on file when an audit asked a manager to confirm one (Dan, October 1, 2026). Name in the Notes any of them you did not read.
1. Identify by exact filename: target review, self-appraisal, prior review, supporting documentation. Ask for the prior review if the direct has one and it is missing; the Gate 2 repeat check cannot run without it.
2. Compute the period start and end by the review-period rule in `standards.md`.
3. Run both checks on the draft, whatever gate it stops at:
   ```
   python3 review_gate_tools.py check REVIEW.docx --end 7/23/2026 --start 7/24/2025 --direct FIRSTNAME
   python3 review_gate_tools.py meaning REVIEW.docx --direct FIRSTNAME
   ```
   Each writes `REVIEW.docx.gate.json`, and `build` refuses a Gate 1 or Gate 2 email without both runs on the file as it stands. `meaning` exit 2 means Jev could not answer (no key, 401, 402, timeout): it counts as not run, so stop and fix the access. If python-docx will not import, `pip install python-docx --break-system-packages`. Without LibreOffice (`soffice`) and `pdfinfo`, pass `--no-render`, count pages another way, and say so.
4. Write one output file, "[Direct] [Year] - Audit of Rev [N].md": the email on top; below a line reading "Notes for Dan (delete before sending)", the file identification, period, gate reached and result, the script output with the `check` and `meaning` exit codes, anything parked for a later gate, and the source behind every figure checked. Gate 1 and Gate 2 emails also go out as "[Direct] [Year] - Audit of Rev [N] (paste into Outlook).docx", built by the script.
5. Unanswered "open items" or drafting-tool notes in the manager's draft are his to answer. The Gate 1 opener may say so in one sentence, because they are his own document, not a preview of a later gate.

Done when every file is named, the period is computed, and both exit codes are recorded under the Notes line.

## Gate 1: Format (mechanical)

Use the `check` fix lines verbatim (merge two lines for one item into one), and add only what it flagged. Known limits: an event with no date on the page cannot be caught as late (park it for Gate 3); "rather than" and "instead of" are not flagged (usually descriptive contrasts; Gate 2 reads each for smuggled prescription); the Date field placeholder is a note, not a fix; the "his manager" check can misfire on a direct who manages people (see the format tests in `standards.md`).

Gate 1 email:

> Hey [Name],
>
> [One sentence on what passed, from the script's Passed line in plain words.] However, there are [N] format fixes needed before I review the content:
>
> 1. [Item: fact; rule.] ...
>
> See the standards below:
>
> 1. Strengths and Weaknesses. Each is two sentences (Sum-Ex) or four sentences (SEER), and at least 30% (rounded down, never fewer than one) are SEER. None contains "should," "must," "needs to," "would benefit from," "ought to," or "is expected to." Write the behavior; an instruction belongs in Guidance.
> 2. Core Message. Three sentences or fewer. Exactly one Rating phrase and one Result phrase. Third person about the direct, first person for the reviewer.
> 3. Voice. No "you" or "your" anywhere on the page. The reviewer is "me," not "his manager."
> 4. Review period. Dates covered are 12 months. A first review runs from the start date; every later review runs from the day after the prior review's period ended. For this review: [start] through [end]. Nothing on the page is dated after [end], and a figure that runs from [start] runs to [end].
> 5. Guidance. Each point starts with an action verb, one to three sentences.
> 6. Length. One page.
>
> Please resubmit once the review meets the above.
>
> Thanks,

Drop any numbered standard whose check passed and renumber.

## The self-check stamp (check this before Gate 2)

Reviewing managers run `aac-review-self-check` themselves; when it passes both its checks it writes a line into the docx and gives the manager a code. Before Gate 2, run the verifier that ships with the self-check (the project folder has a copy):

```
python3 ../aac-review-self-check/review_format_check.py verify REVIEW.docx --end END --start START --direct FIRSTNAME
```

- **VALID.** He ran the checks on the version he sent. **Gate 2 is closed**: no Gate 2 email and no fix list for anything Gate 2 would have caught (Dan, 9/23/26: a manager who ran the check is not sent back around the same loop). The `meaning` run still counts, even when his stamp reads "meaning: Jev": its fix lines and read list carry into Gate 3, raised there in Gate 3's voice alongside every other finding. A stamp reading "meaning: read, not Jev" means his machine had no Jev, so this run is Jev's first look at the page.
- **STALE.** He edited the page after stamping. One line, not a Gate 2 email: ask him to rerun the self-check on the version he wants reviewed.
- **NO STAMP.** He did not run it, or his copy predates stamping. Ask for the code. If he says he ran it and has no code, take him at his word, treat it as VALID, and tell Dan the stamp was claimed rather than verified.

A Gate 2 finding that rolls into Gate 3 also goes under the Notes line as a gap in the self-check: the item, the check it failed, and whether `standards.md` states that check. If it does not, the rule is missing from the standard both skills read and belongs there.

## Gate 2: Meaning

Only on NO STAMP with no claimed run. **Read `gate2.md` before writing anything.** It holds the fix-line form, the reader's share of the run, and the email body.

## Gate 3: Consistency

Only after Gates 1 and 2 pass. **Read `gate3.md` before writing anything.** It holds the figure verification, the Rating checks, and the coaching email's voice and shape.

## Release gate: house writing standard (mandatory, every output)

Every gate email, the coaching email, and any review text the audit writes or rewrites (a model item, a full rewrite, a rebuilt review docx) passes this gate before it leaves; until then it is unfinished, whatever the three gates said. Dan made it mandatory on 9/24/26 after an email went out having been only spot-checked.

1. Review text the audit writes or rebuilds is held to the same runs as a manager's draft: put it in a review docx, run `check` and `meaning`, then `python3 review_gate_tools.py gate REVIEW.docx`, which exits 0 only when both exited 0 on that exact file.
2. Invoke `aac-house-writing-standard`. Read `references/00-INDEX.md`, then `CORE.md`, `DELIVERABLES.md`, `DRAFT-QUALITY.md` and `REVIEW.md`. Rule 2 hands performance reviews, their audits and coaching emails to the AAC review standards (`standards.md`) and to WR-001's own review part, Rules 171 to 185 in `REVIEW.md`, where they conflict with the rest of WR-001: the serial comma and "should" in review cells (Rule 175), numeric dates (Rule 174), e.g./i.e. and the % sign (Rule 178), email headings (Rule 182). The same part carries the review page, the audit email's salutation, numbered fix lists, subject line and attachments, and the templates and gate script. Every other WR-001 rule applies.
3. Lint each text with the house skill's own linter, `../aac-house-writing-standard/scripts/wr001-lint.js` (a pinned copy beside this file sat at WR-001 v0.6 while the standard reached v0.10, and was deleted 2026-09-29). For a docx, extract the paragraphs and table cells to a .md file first. Email: `node ../aac-house-writing-standard/scripts/wr001-lint.js EMAIL.md`. Review: `node ../aac-house-writing-standard/scripts/wr001-lint.js REVIEW.md --prose`. Exit 0 is required: fix every error and every warning that is not a Rule 2 exception.
4. Read for what the linter cannot see, and confirm Rule 166 item by item: voice preserved, filler and empty adverbs cut, no manufactured insight, every attributed claim sourced, one name per actor, no kicker, no recap. Also Rule 106 (the attachment is named) and Rule 107 (an email that asks for action ends with how Dan learns it is done).
5. Record under the Notes line: the `check`, `meaning` and `gate` exit codes for any review text, the linter exit code and counts for each text, the Rule 166 items confirmed, and each fix made. "Linted" with no exit code does not pass.

## Rebuilding the review itself

When Dan takes a draft the rest of the way himself, the rebuilt review goes on the approved template beside this file, "DIRECT NAME - Annual Performance Review - YEAR (template, 2026-09-23).docx": title, header fields, Core Message, one table row per Strength and Weakness pair (extra rows removed), Guidance as the template's plain bullets with any "Guidance Point N:" label dropped. Never edit the manager's own file and call it the next revision: his file can carry an old layout, and Dan reads that as not the review template (Dan, October 1, 2026). Leave the Date and Method of delivery placeholders for the manager. Before showing it, set it beside Dan's most recent rebuilt review in the project folder and match its depth and form: SEER where the manager's own material supports it, Guidance without added measures, a Ramification in the template's "in the areas of" form. The reasons behind that rebuild are in the Notes of its audit file in the project folder; the conversation itself ran on another PC and is not on this one. A rebuild that shipped first as six Sum-Ex items read as weak to Dan (October 1, 2026). Run Gate 1 on the result, count pages in Word or LibreOffice, and save it beside the manager's draft so Dan can attach it.

## Building the Outlook docx

Gate 1 and Gate 2 emails go out as a docx cloned from Dan's canonical template. **Read `building-the-docx.md` when you are ready to build one.**

## Style

Commas, colons or periods in place of em dashes. Curly quotes in deliverables. Say review period or year for cycle, and example for incident; land/landed/landing, anchor as a noun, "my call" and "the real story" stay out. No consultant phrases, no balanced antithesis, no significance closers. Short sentences. Full prose in every deliverable regardless of any compression mode in the chat.

## Ask before deviating

If the review or the request does not fit this procedure, ask Dan rather than improvising. Filling a gap is fine; overriding a rule is not. When something was wrong, lead with what was wrong and what caused it.
