# AAC-STD-001 - Rules 171-185. Performance review material: the review page, audit and coaching email mechanics, review file names, templates and the gate script

# Part XXVI - Performance review material

## 171. Scope of this part

This part applies only to the material Rule 2 names: performance review documents, the audits of them, and the format, meaning, and coaching emails a skip-level sends about them. It does not extend to any other AAC document.

The AAC performance review standards (standards.md in the aac-review-self-check skill) govern what a review says: SEER, Sum-Ex, the Core Message form, third person, one example per item, the review period, and the meaning checks. This part governs the layout and mechanics of review material. Where the two conflict, the review standards control. Where this part conflicts with another rule of this standard, this part controls for review material, and every other rule continues to apply.

## 172. Templates and tools

Clone every generated review-material Word document from one of the two canonical templates in the aac-performance-review-audit skill: "DIRECT NAME - Annual Performance Review - YEAR (template, 2026-09-23).docx" for the review and "Format Rejection Template.docx" for an audit email sent as a document. Do not build one from a blank document.

The template sets type, spacing, and margins. Rules 77 and 80 and Appendix E apply only where it is silent. The review page is Aptos 10 pt, as the approved review template carries it. Every other piece of review material, including the audit emails and the rejection document, is Aptos 11 pt under Rule 77. Text is black, with no colored headings, shading, or decorative rules, whatever Rule 78 permits elsewhere.

Run the mechanical format gate with **review_gate_tools.py check** and use its fix lines verbatim. Build an audit email document with **review_gate_tools.py build**, which applies the list treatment in Rule 180. When the builder lacks a treatment, extend the builder rather than hand-editing spacing in its output. Before release, render every generated document to PDF, inspect pages 1 and 2, and run the docx skill's validator.

## 173. The review page

The review is one page, and the template fixes its layout. Managers do not change it. When a draft runs long, trim in this order: a duplicate Strength, the lowest-value Weakness, the lowest-value Guidance point, then SEER to Sum-Ex on the weakest item. Signature lines stay as templated.

## 174. Dates in review material

Use numeric dates throughout the review document, in one form (7/24/25), including the header dates and the examples inside review cells. This overrides Rule 43 for review material. The Dates covered field runs the 12 months the review standards set, and the Date field is the delivery date. Audit emails may use the same numeric form. Write a range with **through** in prose: 7/24/25 through 7/23/26.

## 175. Review cells

A Strength or Weakness cell holds plain paragraphs. Do not put bullets, bold, or headings inside a cell, and never bold a number. Each cell carries one SEER or Sum-Ex with one example.

Inside a cell, drop the serial comma unless the sentence cannot be read without it. This overrides Rule 16 for review cells only. Audit and coaching emails may keep it. **Should** inside a Strength or Weakness cell is a prescription and fails the behavior-only test, whatever Rule 3 allows elsewhere. The instruction belongs in Guidance.

The Summarize and Restate sentences usually take the present tense (he closes large multi-site projects) and the Example the past (on 2/4/26 he closed). A repeat flag such as "which was also noted in his last review" is nonrestrictive and keeps its comma.

## 176. Guidance points

Guidance points are the template's plain bullets under "Guidance for the next year." Each opens with an action verb and runs one to three sentences. An older draft that labels each point "Guidance Point N:" is accepted.

## 177. Review vocabulary

Capitalize Rating, Result, Ramification, Strength, Weakness, Guidance, and Core Message when they name a section or element of the review. Lowercase them as ordinary words: a weakness in the process. Write the Rating and Result terms exactly as the review standards list them.

Capitalize a job title used as the formal designation in a review, such as Account Executive (Mid-Level). Spell out SEER and Sum-Ex once per document. Refer to a numbered element as Guidance Point 2 and to a revision as Rev 2, never Rev II.

## 178. Numbers and word treatment in review material

Use the % sign with no space in review material, one form per document. The figures come from workbooks that use it, so this overrides the spelled-out **percent** of Rule 47. A large amount may be written $1.44M in an audit email or a table. Write a part of a whole as **17 of 79**, not 17/79, in prose.

Do not use e.g. or i.e. in documents to managers. Write **for example** or recast. This overrides Rule 66 for review material. Do not use semicolons in documents to managers. Split the sentence instead.

Keep **multi-site** hyphenated, as AAC's existing reviews and the compensation plan write it.

## 179. Audit email opening and closing

Open with **Hey [First name],** on its own line. The first paragraph says what the message is about and what is good before what is wrong. Keep one topic per message. A second topic gets its own email and subject so it can be found later.

Close with **Thanks,** on its own line and type nothing after it. Outlook adds the signature block.

A coaching email runs about 55 words per Strength, Weakness, and Guidance point. A format or meaning rejection is the fix list plus the standards it cites, and nothing more.

## 180. Numbered fix lists

Number every list in a format or meaning rejection, because the manager replies by item number. Each list restarts at 1 (Rule 91). Introduce a list with a complete sentence ending in a colon: "There are five fixes needed before I review the content:" Write every item as a full sentence ending with a period.

Bold the lead phrase of a top-level item only when sub-items sit under it. Nothing else in a list is bold. Set a quoted rewrite in quotation marks, not italics.

In a generated document, a top-level item that opens a new group takes 12 pt before and 0 pt after, with contextual spacing turned off on those items only, so the group reads as a block. This overrides the item spacing in Rule 93.

## 181. Audit email subject line and thread

The subject states the topic and the ask and is never blank. A new thread's subject is "[Direct] Annual Review - [Year]" with the direct's name and the review year filled in. A reply keeps the original subject so the thread stays whole. The mail client adds RE:, so do not type it. Reply in the thread unless the topic has changed, and quote only what you answer.

## 182. Audit email body

Do not put tables, all capitals, colored text, backgrounds, emoji, or signature images in the body of an audit or coaching email. A table belongs in the audit file's notes, a workbook, or a longer document. A heading in one of these emails is the section word alone, in sentence case: Core message, Strengths.

## 183. Review file names and attachments

Name a review file **[Direct] [Year] - [Document] Rev [N]**. An audit is **[Direct] [Year] - Audit of Rev [N].md**, and its email document is **[Direct] [Year] - Audit of Rev [N] (paste into Outlook).docx**. The Rev number, not a date, is the sequence key, so this pattern replaces Rule 145 for review material.

Say in the email body what is attached and why (Rule 106). Do not send a draft with tracked changes showing unless the tracked changes are the point.

## 184. Figures in the audit notes

Every set of figures in the audit file's notes carries the date it was pulled and the system it came from: "Zoho CRM, pulled 9/9/26" or "2026 sales workbook, through 7/23/26." A figure without a pull date cannot be reconciled against the manager's.

## 185. Proofreading review material

Read review material in the two passes of Rule 148. The first pass checks each figure against the source in hand, each date against the review period, each name against its spelling in the CRM, and each quoted passage word for word. A figure the manager states is taken as stated unless a source contradicts it. Do not ask the manager to verify it again. The second pass adds the review's own mechanics: sentence counts per cell, items per list, numbering restarts, spacing, headings, and page count.
