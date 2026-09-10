---
name: counterparty-redline
description: "Turn a counterparty's contract plus our positions into minimal strike/insert redlines, tiered by a walk-away test, with a one-page countersign addendum. Use when replying to vendor pushback on redlines or fixing the final conditions before signature."
---

# Counterparty redline

Produces the smallest set of exact edits that gets a contract signed, and the paper the other side signs. Findings and clause language are the deliverable. The cover email is the user's unless they ask.

## Inputs

- The counterparty's current document (PDF or .docx). Extract text with `pdftotext -layout` or `pandoc -t plain`.
- The prior version, if one exists.
- Our prior asks and their replies, if any.
- Who signs for us, and their title as it appears on the agreement.

## Step 0: diff, never trust "change has been made"

If a prior version exists, `wdiff -3` the two extracted texts. Report every textual change. A reply that says a change was made is a claim, not a fact, until the diff shows it.

## Step 1: tier every open item

Three buckets, default to fewer:

- **Condition of signature.** Passes the ownership test: "If they walk over this, I can tell the owner it was completely unacceptable." Write that one-line explanation for each. If the line sounds weak, the item is not a condition.
- **Correction.** A defect in an edit they already made (misplaced sentence, typo, ambiguous modifier). Not a condition; they already agreed to the substance.
- **Drop.** Everything else. Name what is being dropped so the user can count concessions.

Tell the user plainly which conditions they would really walk over and which they would not. Never let the email say "condition" for something the user would sign without.

## Step 2: write each kept item as a minimal redline

For every condition and correction:

- Quote the **exact current sentence**, verbatim from the extracted text, with page or section cite. Re-grep to confirm before quoting.
- Write the edit as a **strike/insert on that sentence**. Never a replacement paragraph. If moving a sentence fixes it, move it; do not reword.
- One **why**, one to two sentences, direct. Prefer pointing at the counterparty's own document ("page 11 already excuses you when the error is ours") over outside authority.
- **No facts about the user's business the user has not stated in this session.** Use `[CONFIRM: ...]` and say so. This includes lenders, sureties, bonding, insurance, customers, revenue.
- **No statute or standards citations unless verified this session.** If cited from memory, label "cited from memory, counsel to confirm" or leave it out.
- **No claims about the counterparty's other documents** (their insurance, their statements, their office location) that are not in the text in hand. Cite their contract language instead.

Identical structure for every item: heading with clause and page, Current, Edit, Why.

## Step 3: build the addendum

One page, .docx via docx-js (see the docx skill):

- Title, party line, preamble. Defined terms sit immediately after what they define: `the X Agreement (the "Agreement") between A ("A") and B ("B")`.
- Numbered items mirroring the email exactly: same order, same wording, same edits. If the email says "move," the addendum says "move," not "reword."
- No explanatory or affirmative sentences beyond the edits themselves. A deletion is a deletion.
- "Where this Addendum conflicts with the Agreement, this Addendum controls. All other terms remain unchanged."
- Dual signature block with the signer's name and title as they appear on the agreement.
- Convert to PDF, confirm one page, run `validate.py`.

## Step 4: deliver findings, not the email

Hand the user: the tiered list with ownership one-liners, the redlines, the addendum. Stop. Do not draft the cover email unless asked. If asked, run `aac-skills:writing`, then check the email against the addendum for any mismatch in wording or numbering.

## Step 5: reread before delivery

One pass, every time, on the exact files going out:

- Every quoted sentence matches the extracted text character for character.
- Email and addendum say the same thing in the same order.
- Nothing asserted without a page cite, a `[CONFIRM]`, or an "unverified" label.
- Defined terms adjacent to what they define.
- Numbering correct after any item removal.
- No em dashes.

An edited draft is an unchecked draft. Re-run this after any change, however small.