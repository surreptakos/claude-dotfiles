# Slop — nine core rules + ten AI-generated tells

Pass 1 of the revise workflow. Also the base pass in `--audit` mode.

## Core Rules

1. **Cut filler phrases.** Remove throat-clearing openers, emphasis crutches, and all adverbs. See [phrases.md](phrases.md).

2. **Break formulaic structures.** Avoid binary contrasts, negative listings, dramatic fragmentation, rhetorical setups, false agency. See [structures.md](structures.md).

3. **Use active voice.** Every sentence needs a human subject doing something. No passive constructions. No inanimate objects performing human actions ("the complaint becomes a fix").

4. **Be specific.** No vague declaratives ("The reasons are structural"). Name the specific thing. No lazy extremes ("every," "always," "never") doing vague work.

5. **Put the reader in the room.** No narrator-from-a-distance voice. "You" beats "People." Specifics beat abstractions.

6. **Vary rhythm.** Mix sentence lengths. Two items beat three. End paragraphs differently. No em dashes.

7. **Trust readers.** State facts directly. Skip softening, justification, hand-holding.

8. **Cut quotables.** If it sounds like a pull-quote, rewrite it.

9. **Write for the reader's vocabulary.** Use the words the audience already uses and explain in plain language. Cut jargon, statistics-speak (`percentile`, `dwell time`, `standard deviation`), and internal system terms (`payload`, `the store`, `cache`) from anything a user reads. Keep a domain term only when the audience genuinely uses it; say everything else the plain way. No coined metaphors the reader has to decode ("synthesize, don't staple").

## Ten AI-Generated Tells

Flag and rewrite these whether or not the piece is in `--docs` mode. These come from Vercel's public writing guidelines and match the tells that show up in every Claude-drafted paragraph.

1. **Summary-style transitions.** Never open a paragraph by recapping the last one (`With this setup complete…`, `Now that we've explored…`). Pivot straight to the next point (`In practice…`, `The catch is…`).
2. **Stop-start fragments.** Don't split one dependent idea into choppy sentences (`Previously this was manual. Now it's automatic. This saves time.` → one sentence). Short sentences for emphasis are fine.
3. **Spec-sheet voice.** Rewrite sentences that read like a datasheet (`provides`, `is configurable`, `is explicitly labeled`).
4. **Cold-open paragraphs.** A body paragraph whose first sentence works as a standalone heading has no antecedent. Carry the prior subject forward (`Because…`, `Once…`).
5. **Personified artifacts.** Machines don't perform human-physical actions (`hand the browser a URL` → `the browser fetches the URL`; `the token holds…` → `the token is stored…`).
6. **Reused/template framing.** The angle must come from this page, not a template (`The question most teams face is whether…`).
7. **Weasel words.** Replace vague qualifiers (`significantly`, `many`, `often`, `typically`, `generally`) with a specific number or claim.
8. **Vague quantifiers.** No `near-zero`, `sub-second`, `most requests`. Give the figure and cite it (`99.37% of requests see zero cold starts`).
9. **Filler / metaphor verbs.** Name the action instead of reaching for cadence (`moves through`, `lands`, `carries`, `hits` → the literal step).
10. **Second-read test.** Each sentence must parse on one read at speech pace. If a reader has to re-read, name the subject, the action, and the consequence. Kill metaphor verbs and pronouns reaching back several sentences.

## Quick Checks

Before delivering prose:

- Any adverbs? Kill them.
- Any passive voice? Find the actor, make them the subject.
- Inanimate thing doing a human verb ("the decision emerges")? Name the person.
- Sentence starts with a Wh- word? Restructure it.
- Any "here's what/this/that" throat-clearing? Cut to the point.
- Any "not X, it's Y" contrasts? State Y directly.
- Three consecutive sentences match length? Break one.
- Paragraph ends with punchy one-liner? Vary it.
- Em-dash anywhere? Remove it.
- Jargon or a coined metaphor the reader must decode? Say it plainly.
- Statistics-speak in user-facing copy ("75th percentile," "dwell time")? Translate.
- Internal system term leaking to a user ("payload," "the store," "cache")? Use the reader's word.
- A term of art the audience doesn't share? Replace it.
- Vague declarative ("The implications are significant")? Name the specific implication.
- Narrator-from-a-distance ("Nobody designed this")? Put the reader in the scene.
- Meta-joiners ("The rest of this essay...")? Delete. Let the essay move.
- Complexity announced without demonstrated? Remove the announcement or show the complexity.
- Empathy statement before content earns it? Delete.
- Discovery narration ("As I researched this...")? Cut the journey. Lead with the finding.
- Hedged urgency ("This may be one of the most...")? State the claim directly or cut it.
- Paragraph opens or closes with a freestanding aphorism? Check whether it's earned or decorating.
- Transition phrase opening a paragraph? Remove and check if the paragraphs actually connect. If not, rewrite the logic.
- Closing paragraph opens with "Ultimately," "In the end," or "Taken together"? Read against the opening. If it restates, replace with something the body earned.
- Numbered or bulleted list where the items connect causally? Rewrite as continuous argument.
- Weak verb plus abstract noun ("work to ensure," "seek to address," "take steps to")? Collapse to the real verb.
- Email or letter opener that delays the point ("I hope this finds you well")? Cut it.
- Summary-style transition ("With this setup complete…")? Pivot to the next point.
- Cold-open paragraph opener with no antecedent? Carry the prior subject forward.
- Personified artifact ("hand the browser a URL")? Name the literal step.
- Reused/template framing not specific to this piece? Rewrite from the specific.

## Scoring

Rate 1–10 on each dimension. Below 42/60, revise and re-score before Pass 2:

| Dimension | Question |
|-----------|----------|
| Directness | Statements or announcements? |
| Rhythm | Varied or metronomic? |
| Trust | Respects reader intelligence? |
| Authenticity | Sounds human? |
| Density | Anything cuttable? |
| Structure | Prose moves as argument, not as list of announcements? |

## Technical Mode

For API docs, specs, PRDs, ADRs, and code comments, some flagged patterns are correct and expected. Before editing technical prose, read [technical.md](technical.md), which lists the false positives and what stays slop even in technical writing.

Two adjustments for technical work:

- **Detect-only.** Flag issues without rewriting, so a human keeps final say on spec-critical wording. `--audit` mode does this automatically.
- **Keep override.** Add `[keep]` on any line to exempt it from rewriting.
