---
name: aac-performance-review-audit
description: Audit an AAC One Page performance review draft from a reviewing manager and produce the skip-level's email back. Use whenever Dan uploads or points at a performance review draft, revision, or self-appraisal, asks to "audit," "check," or "gate" a review, or asks for the rejection or coaching email for one.
metadata:
  modified: '2026-09-24T21:31:18Z'
  previous-modified: '2026-09-11T22:12:08Z'
  revision: '2'
  content-sha: f5bfd6fde92a
---

# AAC performance review audit

Dan Gatsakos (skip-level) receives a review draft from a reviewing manager (Mark Kurland, Nick Remblake, others) about a direct. The audit produces the email Dan sends back. Three gates, in order. Stop at the first gate that fails and produce only that gate's email. One class of problem per round; every fix line names the item (S3, W4, Core Message, Guidance Point 2) and the check it failed. Never mix gates. Never preview the next gate.

This file holds the standards, Gate 1, and the style rules. Five files sit beside it: `wr001-lint.js` (the pinned WR-001 linter for the release gate), `review_gate_tools.py` (the Gate 1 check and the docx builder), `Format Rejection Template.docx` (Dan's canonical formatting, md5-checked when the builder reads it), `gate2.md`, and `gate3.md`. Read a gate file when you reach that gate, not before. The "Performance Review Audits" project folder, when mounted, holds prior reviews, self-appraisals, workbooks, comp plans, earlier audits, and loose copies of the same files; use it for evidence, not for procedure. If the folder's copy of the script carries a check this one does not, the folder copy is newer: use it, and bring this one up to match.

## Before anything

1. Identify by exact filename: target review, self-appraisal, prior review, supporting documentation. Ask for the prior review if the direct has one and it is missing; the repeat check in Gate 2 cannot run without it.
2. Review period: 12 months. First review runs from the start date. Every later review runs from the day after the prior review's period ended (not its delivery date). Compute start and end before running anything.
3. One output file: "[Direct] [Year] - Audit of Rev [N].md". Email on top. Below a line reading "Notes for Dan (delete before sending)": file identification, period, gate reached and result, the script output, anything parked for a later gate, and the reason behind every "please confirm." Gate 1 and Gate 2 emails also go out as "[Direct] [Year] - Audit of Rev [N] (paste into Outlook).docx", built by the script.
4. `pip install python-docx --break-system-packages` if the script cannot import it. Page count needs LibreOffice (`soffice`) and `pdfinfo`; if absent pass `--no-render` and count pages another way (say so).
5. If the manager's draft arrives with its own unanswered "open items" or notes from a drafting tool, those are the manager's to answer. The Gate 1 opener may say so in one sentence, because they are his own document, not a preview of a later gate.

## The standards (controlling)

- Review is third person about the direct, first person for the manager, in every section including the Core Message. No "you" or "your" on the page, and no "his manager" for the reviewer. Guidance stays imperative with possessives removed.
- SEER = Summarize, Elaborate ("Add details or explain further"), Example, Restate. Exactly four sentences. Sum-Ex = Summarize, Example. Exactly two. One example per item, ever. Example of SEER: "Bob is my best customer service rep. He consistently exceeds every standard. He recently saved a difficult call after three other reps had failed. He's an example we ought to put on training videos." Example of Sum-Ex: "Bob is my best customer service rep. Recently he saved a difficult call despite 3 other reps not being able to." Avoid commas in review cells where possible.
- Core Message: three sentences at most; Rating (Exceeded Expectations, Met Expectations, Did Not Meet Expectations); Result (Promotion, Vertical Growth, Horizontal Growth, No Change); Ramification (the broad outline of what manager and direct will do next year because of the Result: the target role for a promotion, the parts of the job that change for growth; it can be short, and details may be left to the planning part of the meeting). Form: "[Name]'s results have (exceeded expectations)/(met expectations)/(not met expectations) since (his/her) last review. I am recommending (he/she) (is ready for promotion to X)/(is ready for vertical growth in (his/her) role, in the areas of X)/(is ready for horizontal growth in (his/her) role, in the areas of X)/(maintain (his/her) current role and responsibilities at this time)."
- Result definitions: Promotion, ready now or during the year. Vertical Growth, more responsibility in areas the direct already works in: the manager delegating his own work down (leadership tasks, meetings, administration, reporting, developing other reps). Horizontal Growth, tasks in areas the direct is not in today. No Change, current role held. A Ramification listing the direct's current accounts is No Change. A Ramification listing the Weaknesses is not a Ramification.
- Guidance: each point a bullet that opens with an action verb (an older "Guidance Point N:" label is accepted) and names a behavior or work the manager wants next year. No details or measure required yet (Manager Tools, OnePage section 7). One to three sentences. Every Weakness has a Guidance point. Guidance may also carry new work or development no Weakness asked for.
- Repeat Weaknesses say so in the body: "which was also noted in his last review."
- One page. Nothing dated after the period end. "Opportunities" means Weaknesses.

## Gate 1: Format (mechanical)

```
python3 review_gate_tools.py check REVIEW.docx --end 7/23/2026 --start 7/24/2025 --direct Erich
```

Use its fix lines verbatim (merge two lines for one item into one line). Add nothing it did not flag. Known limits: an event with no date on the page cannot be caught as late (park it for Gate 3); "rather than" and "instead of" are not flagged (they are usually descriptive contrasts; Gate 2 reads each one for smuggled prescription); the Date field placeholder is a note, not a fix. The first-person check flags "his manager" and the like, and can misfire on a direct who manages people and legitimately reports to someone else.

Gate 1 email:

> Hey [Name],
>
> [One sentence on what passed, from the script's Passed line in plain words.] However, there are [N] format fixes needed before I review the content:
>
> 1. [Item: fact; rule.] ...
>
> See the standards below:
>
> 1. Strengths and Weaknesses. Each is two sentences (Sum-Ex) or four sentences (SEER). None contains "should," "must," "needs to," "would benefit from," "ought to," or "is expected to." Write the behavior; an instruction belongs in Guidance.
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

Reviewing managers run `aac-review-self-check` themselves. When it passes both its checks it writes a line into the docx and gives the manager a code. Before Gate 2, run:

```
python3 review_format_check.py verify REVIEW.docx --end END --start START --direct FIRSTNAME
```

That script ships with the self-check skill; the project folder has a copy. Three outcomes:

- **VALID.** The manager ran the checks on the version he sent. **Gate 2 is closed.** Do not send him a Gate 2 email, and do not send a fix list for anything Gate 2 would have caught. Carry every remaining finding into Gate 3 and raise it there, in Gate 3's voice, as part of one conversation. Dan's rule, 9/23/26: a manager who ran the check does not get sent back around the same loop.
- **STALE.** He edited the page after stamping. Say so and ask him to rerun the self-check on the version he wants reviewed. That is not a Gate 2 email; it is one line.
- **NO STAMP.** He did not run it, or his copy predates stamping. Ask for the code. If he says he ran it and has no code, take him at his word, treat it as VALID, and tell Dan the stamp was claimed rather than verified.

When a Gate 2 finding rolls into Gate 3, it also goes to the notes as a gap in the self-check: name the item, the check it failed, and whether the self-check states that check. If it does not, the rule is missing from the self-check and belongs there.

## Gate 2: Meaning

Only when the stamp is absent or the manager did not run the self-check. **Read `gate2.md` in this skill directory before writing anything.** It holds every check and the email body.

## Gate 3: Consistency

Only after Gates 1 and 2 pass. **Read `gate3.md` in this skill directory before writing anything.** It holds the figure-verification procedure, the Rating checks, and the coaching email's voice and shape.

## Release gate: house writing standard (mandatory, every output)

Nothing leaves this skill until it passes this gate: every gate email, the coaching email, and any review text the audit writes or rewrites (a model item, a full rewrite, or a rebuilt review docx). A draft that has not passed it is not finished, whatever the three gates said. Dan made this mandatory on 9/24/26 after an email went out for review having been only spot-checked.

1. Invoke `aac-house-writing-standard`. Read `references/00-INDEX.md`, then `CORE.md`, `DELIVERABLES.md` and `DRAFT-QUALITY.md`. Rule 2 hands performance reviews, their audits and coaching emails to the AAC review standards and the House Layout Standard where they conflict with WR-001 (serial comma, headings, "should," e.g./i.e., the % sign and numeric dates in review material). Every other WR-001 rule applies.
2. Run the linter on each text. Use the house skill's `scripts/wr001-lint.js` when its folder is readable; otherwise the pinned copy beside this file (`wr001-lint.js`, WR-001 v0.6). For a docx, extract the paragraphs and table cells to a .md file first. Email: `node wr001-lint.js EMAIL.md`. Review: `node wr001-lint.js REVIEW.md --prose`. Exit 0 is required. Fix every error and every warning that is not a Rule 2 exception.
3. Read for the rules the linter cannot see, and confirm Rule 166 item by item: voice preserved, filler and empty adverbs cut, no manufactured insight, every attributed claim sourced, one name per actor, no kicker, no recap. Also Rule 106 (the attachment is named) and Rule 107 (an email that asks for action ends with how Dan learns it is done).
4. Record the result under the Notes line: linter exit code and counts for each text, the Rule 166 items confirmed, and each fix made. "Linted" with no exit code does not pass.

If the house skill's version is newer than the pinned copy, use the house skill's and say so in the Notes.

## Building the Outlook docx

Gate 1 and Gate 2 emails go out as a docx cloned from Dan's canonical template. **Read `building-the-docx.md` when you are ready to build one.**

## Style

No em dashes. Curly quotes in deliverables. Banned words: land/landed/landing, cycle (say review period or year), incident (say example), anchor as a noun, my call, the real story. No consultant phrases, no balanced antithesis, no significance closers. Short sentences. Full prose in every deliverable regardless of any compression mode in the chat.

## Ask before deviating

If the review or the request does not fit this procedure, ask Dan rather than improvising. Filling a gap is fine; overriding a rule is not. When something was wrong, lead with what was wrong and what caused it.

## The script

`review_gate_tools.py` and `Format Rejection Template.docx` sit next to this file. Run the script from the skill directory so it finds the template:

```
python3 review_gate_tools.py check REVIEW.docx --end 7/23/2026 --start 7/24/2025 --direct FIRSTNAME
python3 review_gate_tools.py build BODY.py OUT.docx
python3 review_gate_tools.py template [OUT.docx]
```

Needs python-docx. The page count needs LibreOffice and pdfinfo; otherwise pass `--no-render`.
