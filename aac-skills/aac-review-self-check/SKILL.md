---
name: "aac-review-self-check"
description: "Self-check an AAC One Page performance review draft before it goes to the skip-level. Use when the user is writing, revising or about to send a performance review of one of their directs."
metadata:
  modified: "2026-09-25T23:17:31Z"
  previous-modified: "2026-09-24T21:31:18Z"
  revision: "4"
  content-sha: "26b824388fde"
---

# AAC review self-check

You are the reviewing manager. You are writing a One Page performance review of one of your directs, and this checks the draft before it goes to your skip-level. You upload the draft, ask for the check, and read what comes back; the checks run here.

**Read [`standards.md`](standards.md) in full before checking anything.** It holds the rules, the format tests, the meaning checks and the substance list, and it is the same file your skip-level's audit checks against.

## Form is checked; substance is yours

Form is what the page settles on its own: sentence counts, whether an item carries an example, whether the Ramification matches the Result you named. Substance is what the page cannot settle: whether that example is the right one, whether the figures are true, what your direct actually earned. The checks cover form completely and substance not at all, so four things stay with you:

- **Your sentences.** The check names what an item is missing; you write the fix. You will defend every sentence to your skip-level anyway, and writing them is how the format stops being something you look up.
- **Your examples.** Every example, date, figure, name and target on the page comes from you. An item with no example gets one from you, or comes out.
- **Your Rating, Result, and Ramification.** Asked what the four Results mean, the check defines them. Asked which one to pick, it puts the question back to you, because that is your read on your direct and most of what you and your skip-level actually talk about.
- **Your figures.** The check cannot see your workbooks or the CRM. Every number on the page is yours to verify before you send.

A request to "just fix it all" gets the findings, not a rewrite, and that is the skill working.

## 1. Gather the files and the period

Upload the files into the session, not just open them on your screen: the draft as a .docx, the direct's self-appraisal if there is one, and the prior review if the direct has had one. Without the prior review the repeat check cannot run; without the self-appraisal the check for his own words quoted back as your observation cannot run. The report names each check that could not run, so no item passes untested.

Work out the period start and end by the review-period rule in `standards.md`.

## 2. Format

`review_format_check.py` sits next to this file and runs every format test in one pass:

```
python3 review_format_check.py REVIEW.docx --end 7/23/2026 --start 7/24/2025 --direct FIRSTNAME
```

It needs python-docx, and the page count needs LibreOffice and pdfinfo; pass `--no-render` without them. When the script cannot run, read the .docx and apply the format tests in `standards.md` by hand, and carry on: the result is the same, and the manager installs nothing. The script is faster and does not miscount sentences; it is not the skill.

Done when the report reads PASS, or FAIL with each failing test named; says which route ran, the script or reading; and names every test that did not run, with the reason. A test that did not run is never reported PASS.

## 3. Meaning

Only after Format passes: fix one class of problem at a time, because a draft that fails format is not worth reading for meaning yet.

Run the item against the checks, not the checks against the item. Take one Strength or Weakness, answer every meaning check in `standards.md` for it in order, then move to the next item. Reading an item once and forming an impression skips the checks that impression did not raise; that is how a run with every rule in hand still ships a bad restate.

Each finding names the item and the check, and leaves the sentence to the manager: "S3: sentence 2 is a list of five accounts; it must be one event or figure."

Done when every Strength, every Weakness, the Core Message and every Guidance point is named in the report, as a pass or with its finding. Report PASS with every item accounted for, or a numbered list of findings plus the items that passed. A sweep that stops at the first few problems is not a sweep, and the items it skipped come back from your skip-level.

## 4. Stamp

Stamp only a draft where Format reads PASS, Meaning reads PASS with every item accounted for, and every check ran:

```
python3 review_format_check.py stamp REVIEW.docx --end END --start START --direct FIRSTNAME
```

It writes a line into the file and prints a code. Give the manager the code and tell him to put it in the email with the review. The code is computed from the text of the page, so it stops matching the moment the page changes. That is the point: it tells his skip-level that the checks ran, and that they ran on the version he actually sent. If the script cannot write to the file, say so and give the manager the code to send by hand.

## 5. Before you send

Both checks passing puts the draft in form; it is not finished, because form is all the checks can see. Settle every item in the substance list in `standards.md` yourself; your skip-level checks exactly these, so expect the questions.

Last, and it costs the most time when skipped: read the finished page yourself, start to finish, before you send it. A draft that a tool cleared is not a draft you have read.
