# Tells: defaults that make a deliverable look assembled, not designed

Sources: anthropics/skills `frontend-design`, pbakaus/impeccable `craft-floor.md`, leonxlnx/taste-skill `redesign-skill`, and the AAC Employee Raise Form critique (v4 to v6, 2026-09-30). The detector rule appears in brackets where `designlint.py` catches it; the rest are Assessment A's job.

A pattern here is a default, not a ban, unless marked **ban**. The brief can earn a default back. Reaching for one when nothing asked for it means no decision was made; rewrite the element.

## Structure

- **Instructions before fields.** A block of steps above the form pushes the fields a third of the way down and repeats what the signature block says. Put the order on the signature cards and keep one intro sentence.
- **Numbering collision.** "1." meaning three different things on one page (steps, terms, signers) [D09]. Number only the one real sequence; bullets elsewhere.
- **Numbering that is not a sequence.** Numbered markers belong only to a real order, like the signing steps.
- **Floating labels.** A label inside a cell with any border missing, or fields as separate lines instead of one joined, fully bordered grid per section [D16].
- **Checkboxes on writing lines.** A choice field drawn with an underline invites writing where there is nothing to write.
- **Duplicate fields.** Increase amount and percent next to both rates; "rate unit" next to "pay basis." One source per fact.
- **Defensive fields.** Fields for a failure nobody has had (a second verification of an entry that is already checked). Park them.

## Type

- **Eyebrow above a heading (ban).** A small tracked-caps label ("STEP 1") over a heading ("Manager") [D03]. Make the heading carry the step: "1 Manager."
- **All caps for labels** anywhere except the template's title bar [D03].
- **Justified text** with rivers of space [D01].
- **Alignment by spaces** [D02] and **underscore fill lines** [D13].
- **Bold everywhere.** When every label is bold, nothing leads. Labels are small and gray; headings carry the weight.
- **Text below 9 pt** to force a fit [D07]. Cut content instead.
- **More than one font family** [D12].

## Color and surface

- **More than one accent** [D05]. AAC forms use brand blue #1161A0 only.
- **Colored side stripe on a card** wider than 1 pt [D08].
- **Decorative accent stripes:** a colored top border on a card, or an accent rule under a heading that sits on top of the box below it [D17]. The heading's color and spacing carry the section; the gray box carries the edge.
- **Palette drift:** text in any color other than black, caption gray or the accent [D15].
- **Gray paragraphs.** Gray is for field captions; body text is black (Rule 78) [D19].
- **Color as the only signal.** Every step, state and section also has a word.
- **Glyphs as controls** [D04]. The ☐ character is a font-dependent glyph; use a drawn FORMCHECKBOX field.
- **Light gray text on tint** below 4.5:1 [D06]. `designlint.py --contrast FG BG` answers it.

## Copy

- **"Please" and filler** in instructions (AAC-WR-001 Rule 10).
- **Two names for one role** ("Head of Human Resources" in the intro, "HR" on the card). Pick one per form, or use the glossary pair consistently.
- **Labels that name the system, not the task** ("Rate unit") where the reader's words exist ("$ per hour or per year").
- **A signature with no date** [D14], or a date with no statement of what signing means.
- **A font left to the theme** [D18]. Word resolves it; many previews do not and fall back to Times New Roman. Name the font (`designlint.py --fix-fonts`).

## Documents and decks

- **Justified body text** [D01] and **text below 12 pt on a slide** [D07].
- **A heading for every paragraph**, or bold sprinkled through sentences (AAC-WR-001 Rule 165).
- **Identical cards or boxes for unequal content.** Boxes are for things the reader fills in or compares; prose stays prose (Rule 94).
- **A slide per bullet**, or a title slide carrying a subtitle that repeats the title.
- **Chart color as the only label.** Every series is named in text.

## Web pages and HTML artifacts

From anthropics `frontend-design`, impeccable's craft floor and the Vercel web interface guidelines, which the Web branch fetches fresh each run.

- **Template chrome:** a tracked caps eyebrow above every heading [D03]; meta strings joined with middle dots; an arrow appended to every link; a monospace face for small labels.
- **Default kits:** cream background with a serif display and a terracotta accent; near-black with one acid accent; identical rounded cards with the same soft shadow; the hero-metric block (big number, small label, gradient accent).
- **Gradient text** [H06], **glassmorphism as decoration**, and **zero-offset colored halos** as depth.
- **Scattered entrance animations** on every section; `transition: all` [H01].
- **Removed focus rings** [H02], **disabled zoom** [H03], **images without alt** [H04], **div buttons** [H05], **inputs without labels** [H09].
- **Emoji or glyphs as icons** [H08]; three periods for an ellipsis [H07].

## Process tells

- **Judging by page count.** "It fits on one page" is not "it reads well." The critique runs on the rendered PNG.
- **Mechanical checks standing in for design review.** Schema validation, the writing linter and the page count all passing is the floor, not the verdict.
- **Polishing past two passes.** Fix everything the critique found in one batch, confirm once, stop.
