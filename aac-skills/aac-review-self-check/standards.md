# AAC One Page review standard

The one copy of the standard a One Page performance review is written to and checked against. `aac-review-self-check` (the reviewer checking his own draft) and `aac-performance-review-audit` (the skip-level auditing it) both read this file. "The reviewer" is the manager writing the review; "the direct" is the person reviewed.

## The rules

**Review period.** 12 months. A first review runs 12 months from the start date. Every later review runs 12 months from the day after the prior review's period ended, not from its delivery date. Nothing on the page is dated after the period end; a later event belongs in next year's review and can still come up in the meeting. A figure that runs from the period start runs to the period end. A status stated with its data-as-of date ("as of 6/30/26") labels when the data was pulled and passes.

**Voice.** Third person about the direct and first person for the reviewer, in every section including the Core Message. No "you" or "your" anywhere on the page. The reviewer is "me," not "his manager." Guidance points stay imperative with the possessives removed.

**Strengths and Weaknesses.** Every item is SEER or Sum-Ex.

- SEER is exactly four sentences: Summarize, Elaborate, Example, Restate. Summarize states the pattern. Elaborate adds details or explains further. Example gives one specific example. Restate says the same thing again in a new way, without a new theme and without an instruction. "Bob is my best customer service rep. He consistently exceeds every standard. He recently saved a difficult call after three other reps had failed. He's an example we ought to put on training videos."
- Sum-Ex is exactly two sentences: Summarize, then Example. "Bob is my best customer service rep. Recently he saved a difficult call despite 3 other reps not being able to."
- One example per item, always. SEER for the points that matter most; Sum-Ex when SEER will not fit.
- Keep commas in a review cell to a minimum: the fewer commas, the less room to misread it.
- A Weakness that also appeared in the prior review says so in the body: "which was also noted in his last review."
- "Opportunities for Improvement" means Weaknesses.

**Core Message.** One paragraph, three sentences at most, holding the Rating, the Result and the Ramification and nothing else.

- Rating: Exceeded Expectations, Met Expectations, or Did Not Meet Expectations.
- Result: Promotion, Vertical Growth, Horizontal Growth, or No Change.
- Ramification: the broad outline of what the reviewer and the direct will do next year because of the Result. For a promotion, the role he is ready for. For vertical or horizontal growth, which parts of his job change, which can be as short as "in the areas of quality control and reporting." Details not yet worked out are settled in the planning part of the meeting, and the Ramification says so. It is never a list of things he should fix.
- Form: "[Name]'s results have (exceeded expectations)/(met expectations)/(not met expectations) since (his/her) last review. I am recommending (he/she) (is ready for promotion to X)/(is ready for vertical growth in (his/her) role, in the areas of X)/(is ready for horizontal growth in (his/her) role, in the areas of X)/(maintain (his/her) current role and responsibilities at this time)."

**Result definitions.** Promotion: ready now or during the year. Vertical Growth: more responsibility in areas he already works in, which in practice means the reviewer's own work handed down, including leadership tasks such as meetings, administration, reporting, or developing other reps. Horizontal Growth: tasks in an area he is not in today. No Change: he holds his current role and responsibilities for the year. A Ramification that lists the accounts he already owns is No Change. A Ramification that lists his Weaknesses is not a Ramification at all.

**Guidance.** Every Guidance point is a bullet under "Guidance for the next year" that starts with an action verb and names a behavior or piece of work the reviewer wants to see next year. One to three sentences. It needs no details or measure yet (Manager Tools, OnePage section 7): "Successfully complete Project X" is enough when the two will settle what success means in the weeks after the review. Every Weakness has at least one Guidance point. Guidance can also carry new work and professional development that no Weakness asked for.

**Length.** One page.

**Temperature.** The page is written a little cooler than the meeting, in both directions (Dan, 9/23/26). Praise on the page is a notch below what is said in the meeting, and criticism a notch lighter; the facts, examples and Rating stay true either way. The Rating never softens: the raise follows it.

## Format tests

Mechanical: each is a yes or no on the text, with no judgment in it. `review_format_check.py` (self-check) and `review_gate_tools.py check` (audit Gate 1) run all of them; by hand, they read the same way.

1. Header: dates covered start and end on the period's start and end.
2. Nothing anywhere on the page is dated after the period end, and no figure that runs from the period start stops before the period end. "From 7/24/25 through 6/30/26" against a 7/23/26 header fails. "As of 6/30/26" on a status is a data date and passes.
3. Every Strength and Weakness is exactly two sentences or exactly four. Count them.
4. No Strength or Weakness contains "should," "must," "needs to," "would benefit from," "ought to," "is expected to," or "shall." The behavior goes in the item; an instruction belongs in Guidance.
5. Core Message is three sentences or fewer and names one Rating and one Result.
6. No "you" or "your" anywhere on the page, and no "his manager," "her manager," or "their manager" where the reviewer is meant.
7. Every Guidance point starts with an action verb and runs one to three sentences. The 9/23/26 template lists them as plain bullets; an older draft that labels each "Guidance Point N:" passes too, as long as a verb follows the label.
8. One page. The scripts need LibreOffice and pdfinfo for this one; without them, the page count is reported as not tested and checked in Word.

Two things neither the scripts nor a reading can see. An example with no date on the page may still fall outside the period; any event in doubt goes against the reviewer's own records. And test 6 cannot tell whether "his manager" meant the reviewer or, when the direct manages people, someone else's manager; ask rather than flag it.

## Meaning checks

Reading, and still a yes or no about one item. Run them after the format tests pass.

Per Strength and Weakness, in this order:

1. **Sentence roles match.** In SEER, sentence 1 is the pattern, sentence 2 adds detail, sentence 3 is one specific event or figure, and sentence 4 restates sentence 1 rather than adding a new theme or an instruction. In Sum-Ex, sentence 1 is the pattern and sentence 2 is the example. The example is one specific thing that happened, not a generic descriptor such as "stepped in." A date, figure or name helps and is not required: Manager Tools' own "He recently saved a difficult call after three other reps had failed" passes.
2. **Behavior, not inference.** Sentence 1 names something the direct does that the reviewer can see or hear: what he says, how he says it, his expressions or body language, or his work product (quality, quantity, accuracy, timeliness, documents, relationships). A trait, motive, attitude, intent, idea or circumstance fails. "He is not committed to the team" is an inference; "he missed three of the last five team meetings" is behavior. "He owns a complex account book" is a circumstance: what does he do with it? An attitude or trait word may stand in sentence 1 only when the item's other sentences give the behavior it is read from: "shows good judgment" followed by what he did passes, and "lacks decisiveness" followed by "the clearest documented case" fails (Manager Tools, Aggregated Behaviors Are Performance; Shot Across The Bow Review).
3. **Pattern, not one-off.** Sentence 1 says what he does repeatedly or how he performs over the period, even though only one example follows. "He closed the largest deal of the year" is a one-off. "He closes large multi-site projects" is a pattern, and the largest deal is the example under it.
4. **One example.** One event: not two dated events in one sentence, not a list of accounts or functions, not his own self-appraisal quoted back as though the reviewer had observed it.
5. **The example demonstrates the pattern.** The example is an instance of what sentence 1 names, not of something next to it. "He completed several certifications" followed by an example of him using a tool well is two different strengths in one item. When they do not match, the finding says which one the item is about.
6. **Observation only.** Every sentence in the item describes; instructions go to Guidance and notes to self come off the page. "Set a target with him" is Guidance. "These are self-identified patterns rather than a single dated example" is a note to self. A "rather than" or "instead of" clause is an instruction only when its second half names what he should have done ("rather than by surfacing the concern through her manager"); a contrast in observed behavior ("rather than letting them sit") is fine.
7. **Repeat flagged** (Weaknesses only). If the theme was in the prior review, the body says so.

Core Message: the Ramification fits the Result chosen, by the Result definitions.

Guidance: every Weakness has a point. A point that names new work or development with no Weakness behind it is fine, and no point needs a measure yet.

## Substance

What no format or meaning check can settle. The reviewer settles each of these before sending; the skip-level checks each of them.

- **Figures.** Every figure on the page matches the workbook or system it came from, computed to the period end in the header.
- **Rating.** It matches what the direct actually did, with the case against it named. For sales roles the evidence is the signed comp plan: its quotas, the New Logo and Self-Sourced definitions, and the mix gates.
- **Result and Ramification.** Consistent with the Rating and with each other, and the Ramification genuinely hands the direct something.
- **Preponderance.** Most of the page supports the Core Message; not every item has to.
- **No surprises.** Every Weakness is something the direct has already heard from the reviewer this year, in a One on One or at the time (Manager Tools, No Surprises In Reviews). A repeat from the prior review passes. A Weakness he has not heard comes off the page, may be raised out loud in the meeting, and does not weigh on the Rating.
- **Discipline.** Any behavior that could lead to discipline if it does not improve is on the page as a Weakness, with a Guidance point covering it (Manager Tools, OnePage section 7). A behavior the direct has never been told about follows no surprises and stays off the page.
- **Prior review.** Its repeats are flagged, and its Guidance is carried forward or closed.
- **Self-appraisal.** Every item the direct raised is in the review or was consciously left out.
- **Said out loud.** The page holds nothing the reviewer would not say out loud in the meeting.
