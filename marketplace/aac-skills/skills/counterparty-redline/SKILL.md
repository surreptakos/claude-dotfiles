---
name: counterparty-redline
description: Minimal strike/insert redlines on a counterparty's contract, tiered by a walk-away test, with a one-page countersign addendum. Use when replying to vendor pushback on redlines or fixing the final conditions before signature.
---

# Counterparty redline

Produces the smallest set of exact edits that gets a contract signed, and the paper the other side signs. Findings and clause language are the deliverable. The cover email is the user's unless they ask.

## Inputs

- The counterparty's current document (PDF or .docx). Extract text with `pdftotext -layout` or `pandoc -t plain`.
- The prior version, if one exists.
- Our prior asks and their replies, if any.
- Who signs for us, and their title as it appears on the agreement.

## Step 0: diff

A reply that says a change was made is a claim; the diff is the fact. If a prior version exists, `wdiff -3` the two extracted texts and report every textual change. Done when every change in the diff is listed, or no prior version exists.

## Step 1: tier every open item

Three buckets, default to fewer:

- **Condition of signature.** Passes the walk-away test: "If they walk over this, I can tell the owner it was completely unacceptable." Write that one-line explanation for each. A weak line means the item is a correction or a drop.
- **Correction.** A defect in an edit they already made (misplaced sentence, typo, ambiguous modifier). They already agreed to the substance.
- **Drop.** Everything else. Name what is being dropped so the user can count concessions.

Tell the user plainly which conditions they would really walk over and which they would not. "Condition" appears in the email only on items the user would walk over. Done when every open item sits in exactly one bucket and every condition carries its walk-away line.

## Step 2: write each kept item as a minimal redline

For every condition and correction, one block with the identical structure: heading with clause and page, Current, Edit, Why.

- **Current:** the exact sentence, verbatim from the extracted text, with page or section cite. Re-grep to confirm before quoting.
- **Edit:** a strike/insert on that sentence. If moving the sentence fixes it, move it; otherwise change the fewest words that fix it. A replacement paragraph is a new negotiation, so it is off the table.
- **Why:** one to two sentences, direct. Point at the counterparty's own document ("page 11 already excuses you when the error is ours") before any outside authority.

Sources of fact, in this order and nothing beyond them:

- The user's business (lenders, sureties, bonding, insurance, customers, revenue): only what the user stated in this session. Anything else is written as `[CONFIRM: ...]` and flagged to the user.
- Statutes and standards: only citations verified this session. A citation from memory carries the label "cited from memory, counsel to confirm" or stays out.
- The counterparty: only the text in hand. Their contract language is the evidence; their insurance, statements, and office location are out of reach.

Done when every condition and correction has its block and every Current line has been re-grepped.

## Step 3: build the addendum

One page, .docx via docx-js (see the docx skill):

- Title, party line, preamble. Defined terms sit immediately after what they define: `the X Agreement (the "Agreement") between A ("A") and B ("B")`.
- Numbered items mirroring the email exactly: same order, same wording, same edits. If the email says "move," the addendum says "move."
- The edits are the only sentences. A deletion is a deletion, with nothing explanatory or affirmative around it.
- "Where this Addendum conflicts with the Agreement, this Addendum controls. All other terms remain unchanged."
- Dual signature block with the signer's name and title as they appear on the agreement.

Convert to PDF and run `validate.py`. Done when the PDF is one page and validation passes.

## Step 4: deliver findings

Hand the user: the tiered list with walk-away lines, the redlines, the addendum. Stop there. The cover email is drafted only on request; when asked, run `aac-skills:writing`, then check the email against the addendum for any mismatch in wording or numbering.

## Step 5: reread before delivery

One pass, every time, on the exact files going out. An edited draft is an unchecked draft, so this step re-runs after any change, however small. Done when every line holds:

- Every quoted sentence matches the extracted text character for character.
- Email and addendum say the same thing in the same order.
- Every assertion carries a page cite, a `[CONFIRM]`, or an "unverified" label.
- Defined terms adjacent to what they define.
- Numbering correct after any item removal.
- Punctuation without em dashes.
