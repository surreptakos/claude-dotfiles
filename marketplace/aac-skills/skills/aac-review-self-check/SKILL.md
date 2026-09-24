---
name: aac-review-self-check
description: Check an AAC One Page performance review draft against the house standards before it goes to the skip-level. Use whenever the user is writing, revising, or about to send a performance review for one of their directs.
metadata:
  modified: '2026-09-24T21:31:18Z'
  previous-modified: '2026-09-18T17:31:23Z'
  revision: '3'
  content-sha: 3961a4c4ba69
---

# AAC review self-check

You are the reviewing manager. You are writing a One Page performance review of one of your directs, and this checks the draft before it goes to your skip-level.

Two checks, in order. Format first, Meaning second. Fix one class of problem at a time, because a draft that fails format is not worth reading for meaning yet.

You do not run anything. Upload your draft, say you want it checked, and read what comes back.

## Form and substance

This checks form. Substance is yours.

Form is what the page settles on its own: sentence counts, whether an item carries an example, whether the Ramification matches the Result you named. Substance is what the page cannot settle: whether that example is the right one, whether the figures are true, what your direct actually earned. The two checks below cover form completely and substance not at all, which is why four things stay with you.

- **Your sentences.** The check names what an item is missing; you write the fix. You will defend every sentence to your skip-level anyway, and writing them is how the format stops being something you look up.
- **Your examples.** It will not supply an example, a date, a figure, a name, or a target you did not give it. If an item has no example, you go find one or the item comes out.
- **Your Rating, Result, and Ramification.** Ask what the four Results mean and it will tell you. Ask which one to pick and it puts the question back to you, because that is your read on your direct and most of what you and your skip-level actually talk about.
- **Your figures.** It cannot see your workbooks or the CRM. Every number on the page is yours to check before you send.

If you ask it to just fix it all, the answer is no, and that is the skill working.

## Before anything

1. Upload the files into the session, not just open them on your screen. The draft as a .docx, the direct's self-appraisal if there is one, and the prior review if the direct has had one. The checks read all three. Without the prior review the repeat test cannot run; without the self-appraisal the test for quoting the direct's own words back as your observation cannot run. Say so in the report rather than passing an item that was never tested.
2. Work out the review period. It is 12 months. A first review runs 12 months from the start date. Every later review runs 12 months from the day after the prior review's period ended, not from the day you deliver it. Nothing on the page is dated after the period end; a later event belongs in next year's review and can still come up in the meeting.

## The standards

- The review is third person about the direct and first person for you, in every section including the Core Message. No "you" or "your" anywhere on the page. You are "me," not "his manager." Guidance points stay imperative with the possessives removed.
- Every Strength and Weakness is SEER or Sum-Ex.
  - SEER is four sentences: Summarize, Elaborate, Example, Restate. Summarize states the pattern. Elaborate adds details or explains further. Example gives one specific example. Restate says the same thing again in a new way, without a new theme and without an instruction. "Bob is my best customer service rep. He consistently exceeds every standard. He recently saved a difficult call after three other reps had failed. He's an example we ought to put on training videos."
  - Sum-Ex is two sentences: Summarize, then Example. "Bob is my best customer service rep. Recently he saved a difficult call despite 3 other reps not being able to."
  - One example per item, always. Use SEER for the points that matter most. Use Sum-Ex when SEER will not fit.
  - Avoid commas where you can. The fewer commas in a review cell, the less room to misread it.
- The Core Message is one paragraph, three sentences at most, and contains three things and nothing else: the Rating, the Result, and the Ramification.
  - Rating: Exceeded Expectations, Met Expectations, or Did Not Meet Expectations.
  - Result: Promotion, Vertical Growth, Horizontal Growth, or No Change.
  - Ramification: the broad outline of what you and he will do next year because of the Result. For a promotion, the role he is ready for. For vertical or horizontal growth, which parts of his job change, which can be as short as "in the areas of quality control and reporting." If the details are not worked out yet, say they will be settled in the planning part of the meeting. Not a list of things he should fix.
  - Form: "[Name]'s results have (exceeded expectations)/(met expectations)/(not met expectations) since (his/her) last review. I am recommending (he/she) (is ready for promotion to X)/(is ready for vertical growth in (his/her) role, in the areas of X)/(is ready for horizontal growth in (his/her) role, in the areas of X)/(maintain (his/her) current role and responsibilities at this time)."
- Result definitions. Promotion: ready now or during the year. Vertical Growth: more responsibility in areas he already works in, which in practice means your own work handed down, including leadership tasks such as meetings, administration, reporting, or developing other reps. Horizontal Growth: tasks in an area he is not in today. No Change: he holds his current role and responsibilities for the year. A Ramification that lists the accounts he already owns is No Change. A Ramification that lists his Weaknesses is not a Ramification at all.
- Every Guidance point is a bullet under "Guidance for the next year" that starts with an action verb and names a behavior or piece of work you want to see next year. It does not need details or a measure yet. "Successfully complete Project X" is enough when you and he will settle what success means in the weeks after the review. One to three sentences. Every Weakness has at least one Guidance point. Guidance can also carry new work and professional development that no Weakness asked for.
- A Weakness that also appeared in his last review says so in the body: "which was also noted in his last review."
- Write a little cooler than you will say it, in both directions. Praise on the page is a notch below what you say in the meeting, and criticism a notch lighter; the facts, examples and Rating stay true either way. The Rating never softens: the raise follows it.
- One page. "Opportunities for Improvement" means Weaknesses.

## Check 1: Format

Mechanical. Every test is a yes or no on the text, with no judgment in it.

`review_format_check.py` sits next to this file and does all of it in one pass:

```
python3 review_format_check.py REVIEW.docx --end END --start START --direct FIRSTNAME
```

Run it if the environment allows. If it does not, or python-docx is missing and cannot be installed, do not stop and do not tell the manager to install anything. Read the .docx and run the same tests by hand. They are all readable:

1. Header. Dates covered start and end on the two dates from step 2.
2. Nothing anywhere on the page is dated after the period end, and no figure that runs from the period start stops before the period end. "From 7/24/25 through 6/30/26" against a 7/23/26 header fails. "As of 6/30/26" on a status is a data date and passes.
3. Every Strength and Weakness is exactly two sentences or exactly four. Count them.
4. No Strength or Weakness contains "should," "must," "needs to," "would benefit from," "ought to," "is expected to," or "shall."
5. Core Message is three sentences or fewer and names one Rating and one Result.
6. No "you" or "your" anywhere on the page, and no "his manager," "her manager," or "their manager" where the reviewer is meant.
7. Every Guidance point starts with an action verb. The 9/23/26 template lists them as plain bullets; an older draft that labels each "Guidance Point N:" passes too, as long as a verb follows the label.
8. One page. The script needs LibreOffice for this one; without it, say the page count was not tested and tell the manager to check it in Word.

Two things neither route can see. An example with no date on the page may still fall outside the period, so any event the manager is unsure about goes against his own records. And test 6 cannot tell whether "his manager" meant the reviewer or, if the direct manages people, someone else's manager; ask rather than flag it.

Report the run as PASS, or as FAIL with each failing test named. Say which route ran: the script, or reading. If any test was not run, say which and why, and never report PASS on a test that did not run.

## Check 2: Meaning

Only after Format passes. This is reading, and every finding is still a yes or no about one item. Name the item and the check, in the form "S3: sentence 2 is a list of five accounts; it must be one event or figure." Do not rewrite the sentence.

Per Strength and Weakness:

- Sentence roles match. In SEER, sentence 1 is the pattern, sentence 2 adds detail, sentence 3 is one specific event or figure, and sentence 4 restates sentence 1 rather than adding a new theme or an instruction. In Sum-Ex, sentence 1 is the pattern and sentence 2 is the example.
- Behavior, not inference. Sentence 1 names something he does that you can see or hear: what he says, how he says it, his expressions or body language, or his work product (quality, quantity, accuracy, timeliness, documents, relationships). Not a trait, a motive, an attitude, an intent, an idea, or a circumstance. "He is not committed to the team" is an inference; "he missed three of the last five team meetings" is behavior. "He owns a complex account book" is a circumstance: what does he do with it? An attitude or trait word ("good judgment," "a good attitude about improving") is fine only when the rest of the item shows the behavior you read it from.
- Pattern, not one-off. Sentence 1 says what he does repeatedly or how he performs over the period, even though only one example follows. "He closed the largest deal of the year" is a one-off. "He closes large multi-site projects" is a pattern, and the largest deal is the example under it.
- One example. Not two events in one sentence. Not a list of accounts or functions. Not his own self-appraisal quoted back as though you had observed it.
- The example demonstrates the pattern. Sentence 1 names what he does; the example is an instance of that, not of something next to it. "He completed several certifications" followed by an example of him using a tool well is two different strengths in one item. When they do not match, say which one the item is about.
- No instruction and no note to yourself anywhere in the item. "Set a target with him" is Guidance. "These are self-identified patterns rather than a single dated example" is a note to yourself and does not belong on the page. A "rather than" or "instead of" clause is an instruction only when the second half names what he should have done; a contrast in observed behavior is fine.
- Weaknesses only: if the theme was in his last review, the body says so.

Core Message:

- The Ramification fits the Result you chose, by the definitions above.

Guidance:

- Every Weakness has a point. A point that names new work or development with no Weakness behind it is fine, and none of them needs a measure yet.

Work through every item, not only the ones that look wrong. Account for each Strength, each Weakness, the Core Message, and each Guidance point by name: it passes, or it carries a finding. A sweep that stops at the first few problems is not a sweep, and the items it skipped come back from your skip-level.

Run the bullets against the item, not the item against the bullets. For each Strength and Weakness, take the six checks above in order and answer each one for that item before moving to the next item. Reading an item once and forming an impression skips the checks that impression did not raise. That is how a run with every rule in hand still ships a bad restate.

Report as: PASS with every item accounted for, or a numbered list of findings plus the items that passed.

## Stamp the file when both checks pass

Only when Check 1 passes and Check 2 passes with every item accounted for:

```
python3 review_format_check.py stamp REVIEW.docx --end END --start START --direct FIRSTNAME
```

It writes a line into the file and prints a code. Give the manager the code and tell him to put it in the email with the review. The code is computed from the text of the page, so it stops matching the moment the page changes. That is the point: it tells his skip-level that the checks ran, and that they ran on the version he actually sent.

Never stamp a file that has an open finding, and never stamp one where a check did not run. If the script cannot write to the file, say so and give the manager the code to send by hand.

## Before you send

When both checks pass, the draft is in form. It is not finished, because form is all these two checks can see. Settle the substance yourself first:

- Every figure on the page, against the workbook or the system it came from, computed to the period end in your header and not to some earlier date.
- The Rating, against what he actually did, with the case against it in your head so you can answer it.
- The Result and the Ramification, and whether you are genuinely handing him something.
- Whether the whole page supports the Core Message. Not every item has to, but most of it should.
- No surprises. Every Weakness is something he has already heard from you this year, so in the meeting you can say "we've talked about this." If he hasn't, take it off the page, raise it out loud in the meeting, and do not let it count toward the Rating.
- Any behavior that could lead to discipline if it does not improve: it is on the page as a Weakness, with a Guidance point covering it.
- Every item the direct raised in his self-appraisal: it is in the review, or you decided to leave it out.
- Anything the draft says that you would not say out loud in the meeting.

Your skip-level checks exactly these, plus the figures, so expect the questions.

Last thing, and it is the one that costs the most time when it is skipped: read the finished page yourself, start to finish, before you send it. A draft that a tool cleared is not a draft you have read.

## The script

`review_format_check.py` sits next to this file. It reads the .docx and prints one line per failing test.

```
python3 review_format_check.py REVIEW.docx --end 7/23/2026 --start 7/24/2025 --direct FIRSTNAME
```

It needs python-docx, and the page count needs LibreOffice and pdfinfo; pass `--no-render` without them. If none of that is available, Check 1 is done by reading and the result is the same. The script is faster and does not miscount sentences; it is not the skill.
