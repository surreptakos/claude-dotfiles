# Docs — Vercel structural conventions

Activated by `--docs`. Layer on top of slop + voice for API docs, PRDs, ADRs, README, runbooks, marketing landing pages.

Derived from Vercel's public writing guidelines: [vercel-cache/command.md](vercel-cache/command.md) and [vercel-cache/AGENTS.md](vercel-cache/AGENTS.md). Cache is authoritative — refresh with `node scripts/refresh_vercel.js`.

## Planning

- Every page has a plan referenced or linked (overview, goal, audience, content plan, open questions).
- Content type declared in `meta.contentType`: `Tutorial`, `How-to`, `Reference`, `Conceptual`, `Troubleshooting`, `Landing`.
- Title is user-shaped (the user's question), not feature-shaped (the engineer's name).
- Page does one job: tutorial OR how-to OR reference, not three at once.
- Goal is verb-driven (Bloom's taxonomy): `configure`, `explain`, `debug` (testable).
- Multi-audience pages: short shared opener, then technical subsections.

## Voice adjustments for docs

Voice from `voice.md` still applies. Docs mode adds:

- Active voice with the "by monkeys" test: append `by monkeys` to the sentence; if it parses, rewrite.
- Direct address: `you`, never `the user` or `one can`.
- Imperative for steps: `Click **Add Project**`, not `You will need to click **Add Project**`.
- Sentences under 20 words target.
- Contractions encouraged (`you'll`, `it's`) for warmth.
- Present tense unless describing future behavior.
- Limit `we`: only for deliberate Vercel actions (`we recommend`, `we deprecated`), never as a stand-in for `you`.
- No rhetorical questions (sounds like marketing).

## Banned words (docs mode only)

- `easy`, `simple`, `quick` — reads as marketing pressure. Replace with a concrete description (`one command`, `default settings`, `most projects don't need this`).
- `very`, `just`, `really` — filler. Cut or rewrite.

These add to voice.md's `flag`, `flagged`, `defect`, `degraded`, `reconcile`, `churn`, `earned` bans. Full annotated list: [banned-words.md](banned-words.md).

## Concision

- Earn every detail: cut a number, name, or implementation detail if a more general phrasing wouldn't change the reader's understanding or action.
- Weasel words: replace vague qualifiers (`significantly`, `many`, `often`, `typically`, `generally`) with a specific number or claim.
- Vague quantifiers: no `near-zero`, `sub-second`, `most requests`. Give the figure and cite it.
- Filler/metaphor verbs: name the action instead of reaching for cadence (`moves through`, `lands`, `carries`, `hits` → the literal step).

## Tone, by content type

- **Tutorial** — warm, encouraging, predictable structure, no traps.
- **How-to** — terse, direct (reader is mid-task).
- **Reference** — neutral, exhaustive, quotable.
- **Conceptual** — explain like the reader will teach it back; examples and analogies welcome.
- **Troubleshooting** — empathetic but not apologetic; acknowledge then fix.

## Headings

- Sentence case for page headings (`H1`–`H6`): `Configure environment variables`, not `Configure Environment Variables`.
- Title case for nav labels: `Configuring Environment Variables`.
- `meta.title` becomes the `H1`; `meta.navLabel` becomes the sidebar entry.
- Subheadings descriptive, not cute: `Caveats when self-hosting on Cloudflare`, not `Caveats`.
- Reader should be able to guess section content from the heading alone.

## Structure

- Every page opens with a one-paragraph TL;DR of what the page covers.
- Every major section opens with a summary sentence.
- Acronyms spelled out on first use: `Content Security Policy (CSP) blocks inline scripts`.
- Define every term the first time you use it (link to its conceptual page).
- Reference docs organized by surface; education docs organized by reader task.
- Keep paragraphs to 2–4 sentences; split anything longer or covering two ideas.

## Lists

- Three or more list-shaped items in a paragraph: convert to a list.
- Bulleted for unordered; numbered for ordered (lifecycles, sequential steps).
- Always introduce a list with a colon.
- No periods on list items unless they are full sentences.
- Bold/description format: `- **Term**: description here` (colon after bold term).

## Code

- Code blocks need a language tag for syntax highlighting.
- TypeScript is the default for new code unless the surface is genuinely language-agnostic.
- Multi-step flows wrapped in `<Steps/>` so structure is visible.
- Highlight load-bearing lines: ` ```typescript {8-12,23-37} `.
- ≤80 columns per line in snippets.
- ≤25 lines per snippet; split longer blocks with prose.
- Omit defaults; don't repeat variable definitions, use a shared var.
- Minimal comments in code blocks; prefer prose explanation.
- Explain what every code block does in prose (don't drop and run).
- Don't reference full example files at the end of guides (`See train.py`); the guide is the deliverable.

## Placeholders

- Text placeholders: `snake_case`, descriptive: `your_access_token_here` (reader can double-click to select before pasting).
- Number placeholders: count up `1234567890123` (recognizable as fake, predictable).
- Never `<TOKEN>`, `xxx`, `your-token`, or generic `ALL_CAPS`.

## Data sizes & units

- Space + uppercase unit: `64 KB`, `5 KB`, `200 ms`.
- Exception: seconds is bare: `30s`.
- Consistent across the corpus so readers can develop scanning habits.

## Money & pricing pages

- Uncompromising detail: err on `too much`.
- Use tables for pricing.
- Never assume reader knows the pricing model or whether their workload counts as one invocation or several.
- Clarity and transparency above all else.

## Emphasis

- **Bold** means UI element or critical fact, never emphasis-for-emphasis-sake.
- Reaching for bold for tone means the sentence is weak; rewrite it.
- `Inline code` for paths, file extensions, identifiers, short snippets: `/api`, `.tsx`, `body`, `query`, `req`.
- Rule: if it would look weird without a monospace font, monospace it.

## Punctuation & typography

- Never em dashes (`—`) or dashes (`-`) as punctuation; use colons, commas, periods, or rephrase.
- Curly quotes `"` `"` and `'` `'`, not straight `"` or `'`.
- Ellipsis `…`, not three dots `...`.
- Loading states end with `…`: `Loading…`, `Saving…`.
- Non-breaking spaces in `10&nbsp;MB`, `⌘&nbsp;K`, brand names.
- `&` over `and` only where space-constrained (nav labels, buttons).

## Source formatting

- Don't hard-wrap paragraphs: each paragraph is one line in source, let the editor wrap.
- One blank line before headings; one blank line before and after code blocks.
- No `---` horizontal rules between sections.
- No extra blank lines between elements that aren't paragraph breaks.

## Links

- Define every term the first time it appears, link to its conceptual page.
- Anchor text names the destination; never bare URLs or `here`/`link`.

## Anti-patterns (audit flags these)

- Em dashes (`—`) or dashes (`-`) used as punctuation.
- `easy`, `simple`, `quick` describing reader actions.
- Passive voice (apply "by monkeys" test).
- Title Case in page headings (only sentence case in `H1` through `H6`).
- Generic placeholders: `<TOKEN>`, `xxx`, `your-token`, `ABC123`.
- Code blocks without a language tag.
- JS examples where TypeScript is the convention.
- Code blocks over 25 lines without prose between.
- Hard-wrapped prose paragraphs (multiple lines for one paragraph in source).
- `---` horizontal rules between sections.
- Subheadings that are single generic words: `Overview`, `Caveats`, `Notes`.
- Bold used for emphasis instead of UI element or critical fact.
- Page or section without an opening summary.
- Straight quotes (`"`, `'`) instead of curly.
- Three dots (`...`) instead of ellipsis (`…`).
- Acronyms used before being spelled out.
- Bare unit numbers (`64KB`, `5kb`, `200MS`) instead of `64 KB`, `5 KB`, `200 ms`.
- `We` standing in for `you`.
- Rhetorical questions.
- Filler words: `very`, `just`, `really`, `simply`.
- References to "the full example file at the end of the guide" rather than inlining the code.
- Outdated model strings in examples.
- Hardcoded date/number formats instead of `Intl.DateTimeFormat` / `Intl.NumberFormat` in code samples.
- `Loading...` instead of `Loading…`.
- Summary-style transitions recapping the previous paragraph (`With this setup complete…`).
- Stop-start fragments splitting one dependent idea into choppy sentences.
- Spec-sheet voice reading like a datasheet (`provides`, `is configurable`, `is explicitly labeled`).
- Cold-open body paragraphs whose first sentence has no antecedent.
- Personified artifacts performing human-physical actions (`hand the browser a URL`).
- Reused/template framing not specific to the page.
- Weasel words instead of a specific claim.
- Vague quantifiers without a cited figure.
- Filler/metaphor verbs instead of the literal step.
- Sentences that need a second read to parse.
- Paragraphs over 4 sentences or covering two ideas.
- Bare URLs or `here`/`link` as anchor text.
