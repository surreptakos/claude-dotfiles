---
name: "aac-review-self-check"
description: "Self-check an AAC One Page performance review draft before it goes to the skip-level. Use when the user is writing, revising or about to send a performance review of one of their directs."
metadata:
  modified: "2026-10-02T16:27:48Z"
  previous-modified: "2026-10-02T15:36:04Z"
  revision: "10"
  content-sha: "9f75a05e161b"
---

# AAC review self-check

The user is a reviewing manager writing a One Page performance review of one of his directs. This checks the draft before it goes to his skip-level: he uploads it, the checks run here, and he reads what comes back.

**Read [`standards.md`](standards.md) in full before checking anything.** It holds the rules, format tests, meaning checks and substance list, and the skip-level's audit checks against the same file.

## Form is checked; substance is yours

Form is what the page settles on its own: sentence counts, whether an item carries an example, whether the Ramification matches the Result you named. Substance is what the page cannot settle: whether that example is the right one, whether the figures are true, what your direct actually earned. The checks cover form completely and substance not at all, so four things stay with you:

- **Your sentences.** The check names what an item is missing; you write the fix. You will defend every sentence to your skip-level anyway, and writing them is how the format stops being something you look up.
- **Your examples.** Every example, date, figure, name and target on the page comes from you. An item with no example gets one from you, or comes out.
- **Your Rating, Result, and Ramification.** Asked what the four Results mean, the check defines them. Asked which one to pick, it puts the question back to you, because that is your read on your direct and most of what you and your skip-level actually talk about.
- **Your figures.** The check cannot see your workbooks or the CRM. Every number on the page is yours to verify before you send.

A request to "just fix it all" gets the findings, not a rewrite, and that is the skill working.

## 1. Gather the files and the period

Upload the files into the session, not just open them on your screen: the draft as a .docx, the direct's self-appraisal if there is one, and the prior review if the direct has had one. Without the prior review the repeat check cannot run; without the self-appraisal the check for his own words quoted back as your observation cannot run. The report names each check that could not run, so no item passes untested.

Work out the period start and end by the review-period rule in `standards.md`. Done when the draft is in the session, each missing file is named with the check it disables, and the period is computed.

## 2. Format

`review_format_check.py` sits next to this file and runs every format test in one pass:

```
python3 review_format_check.py REVIEW.docx --end 7/23/2026 --start 7/24/2025 --direct FIRSTNAME
```

The page count needs LibreOffice and pdfinfo; pass `--no-render` without them. When the script cannot run at all, read the .docx, apply the format tests in `standards.md` by hand, and carry on: the result is the same, and the manager installs nothing. The script is faster and does not miscount sentences; it is not the skill.

Done when the report reads PASS, or FAIL with each failing test named; says which route ran, the script or reading; and names every test that did not run, with the reason. A test that did not run is never reported PASS.

## 3. Meaning

Only after Format passes: one class of problem at a time, because a draft that fails format is not worth reading for meaning yet.

`review_meaning.py` runs the meaning checks it can decide, the rules in code and the judgments through TypeSafe Jev. The audit runs the same module, so you see the same verdict your skip-level will:

```
python3 review_format_check.py meaning REVIEW.docx --direct FIRSTNAME
```

- **Exit 0 or 1.** Its fix lines are findings, verbatim; a line tagged "(Jev)" is Jev's judgment, the rest are rules. Read every item on its Read list and settle it by the meaning checks in `standards.md`. Then read every item for the checks it names as reader checks (a repeat from the prior review, framing past the record), which no code can see. The comma counts are a note: take commas out where the sentence still reads.
- **Exit 2.** Jev could not answer (no TypeSafe key on this machine, an auth or billing error, a timeout). That is not a pass: read every meaning check yourself, as below. The stamp then says the meaning checks were read, not run by Jev, and your skip-level's audit reruns them.

Jev receives the review text: it goes to api.typesafe.ai. Any new judgment added to the module starts from the `typesafe:typesafe-ai` skill.

Reading by hand, run the item against the checks: take one Strength or Weakness, answer every meaning check in `standards.md` for it in order, then move to the next item. An impression formed from one read skips the checks it did not raise; that is how a run with every rule in hand still ships a bad restate.

Each finding names the item and the check, and leaves the sentence to the manager: "S3: sentence 2 is a list of five accounts; it must be one event or figure."

Done when every Strength, every Weakness, the Core Message and every Guidance point is named in the report, as a pass or with its finding. Report PASS with every item accounted for, or a numbered list of findings plus the items that passed. A sweep that stops at the first few problems is not a sweep, and the items it skipped come back from your skip-level.

## 4. Stamp

Stamp only a draft where Format reads PASS, Meaning reads PASS with every item accounted for, and every check ran. Each format and meaning run writes `REVIEW.docx.gate.json` beside the draft, and the stamp reads it: it refuses (exit 2, "NOT STAMPED") unless this exact file has a format run at exit 0 and a meaning run with no fix lines. Edit the page and both runs go again.

```
python3 review_format_check.py stamp REVIEW.docx --end END --start START --direct FIRSTNAME
```

It writes a line into the file and prints a code. The line ends "meaning: Jev" when the meaning run exited 0, or "meaning: read, not Jev" when it exited 2 and you read the checks instead, so the audit knows what to rerun. Give the manager the code and tell him to put it in the email with the review. The code is computed from the page text, so it tells his skip-level the checks ran on the version he actually sent, and stops matching the moment the page changes. If the script cannot write to the file, say so and give the manager the code to send by hand.

Done when the stamp is written (or refused, with the reason) and the manager has the code.

## 5. Before you send

Both checks passing puts the draft in form; it is not finished, because form is all the checks can see. Settle every item in the substance list in `standards.md` yourself; your skip-level checks exactly these, so expect the questions.

Last, and it costs the most time when skipped: read the finished page yourself, start to finish, before you send it. A draft that a tool cleared is not a draft you have read.
