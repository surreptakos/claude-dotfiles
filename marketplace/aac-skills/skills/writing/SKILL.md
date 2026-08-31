---
name: writing
description: 'Revise prose with AI writing tells stripped, or audit prose against the same rules without editing. Use whenever the user asks to "fix", "clean up", "rewrite", "edit", "revise", "polish", "tighten", or "audit" writing — email, memo, doc, PRD, ADR, README, runbook, release note, feedback, policy — or hands over text that reads as AI-generated (hedged, metronomic, padded). Add --docs to layer Vercel''s structural conventions (sentence-case headings, Steps components, curly quotes, unit spacing, no em-dashes) on top for API docs, PRDs, ADRs, READMEs, runbooks, marketing pages. Add --audit to return file:line findings without touching the text — use for specs, contracts, or quoted wording where a human keeps final say. Trigger even when the user does not name the skill — "make this better", "does this sound AI", "slop check" all apply. Voice-neutral: strips AI tells, does not impose a house voice. Ends with a required six-dimension scoring gate (42/60) before any text is returned.'
---

# Writing

## Modes

- **revise** (default) — rewrite the text with AI tells stripped. Preserve the writer's own voice, tone, and phrasing. Return only the final text unless the user asks for analysis or intermediate drafts.
- **audit** (`--audit`) — read the text and return `file:line` findings without editing. Use when the human wants final say on wording (specs, contracts, quoted language, spec-critical technical prose).

## Flag

- **`--docs`** — layer Vercel's structural conventions on top of the mode above: sentence-case H1–H6, TL;DR opener, `- **Term**: description` bullet format, Steps components for multi-step flows, `64 KB` / `200 ms` / bare `30s` units, curly quotes, `…` ellipsis, snake_case placeholders, no em-dashes, no `---` rules, code language tags. Use for API docs, PRDs, ADRs, READMEs, runbooks, marketing landing pages. See [references/docs.md](references/docs.md).

Modes and flag compose: `--audit --docs` audits against slop + docs; `--docs` alone rewrites with them applied.

## Skip

Code, code comments, structured data, transcripts where voice is preserved verbatim, direct quotes. For spec-critical technical wording, prefer `--audit` so a human keeps final say.

## Revise Workflow (two passes + a required scoring gate)

Run both passes in order, then the Final Scoring Gate. Keep intermediate drafts internal. Return only the final text, and only after it passes the gate.

### Pass 1 — Strip AI tells (slop)

Apply the nine core slop rules and the ten AI-generated tells to every paragraph. See [references/slop.md](references/slop.md), [references/phrases.md](references/phrases.md), [references/structures.md](references/structures.md).

Score the result on the six dimensions in slop.md (1–10 each). Below 42/60, revise and re-score before moving on.

Preserve the writer's own voice. Do not substitute a house style or rewrite phrasing that is idiomatic but not AI-generated.

### Pass 2 — Recipient test (cut)

Read the Pass 1 draft one more time. For every sentence and bullet, ask: does the recipient need this to act? Cut anything that only:

- explains why the writer wrote it, apologizes for length, or restates what was said,
- reassures the writer instead of instructing the recipient (defensive scope reminders, "the constraint here is…" openers that repeat what the ask below already carries),
- asks the recipient to confirm what the delivery already proves (send X + separately confirm X was sent),
- repeats a category label already carried by its header (`Type: shared mailbox` under a "Shared mailbox" heading),
- was copied verbatim from a source ticket, spec, or prior draft without checking against actual use. When names, scope, or delegates come from a written source, verify against real use before drafting; ask when unsure.

Delete on sight. Do not rephrase. Full patterns and examples: [references/audience.md](references/audience.md).

If `--docs` is set, also normalize the Pass 2 draft against [references/docs.md](references/docs.md) before the gate.

**Foreign text.** The two-pass sequence is designed for English prose. Text in another language: recast to English first as a separate call, then run the passes. Do not run the passes on non-English source.

## Final Scoring Gate (required)

Score the exact text you are about to return — after every pass, edit, and normalization — on the six dimensions, 1–10 each:

| Dimension | Question |
|-----------|----------|
| Directness | Statements or announcements? |
| Rhythm | Varied or metronomic? |
| Trust | Respects reader intelligence? |
| Authenticity | Sounds human? |
| Density | Anything cuttable? |
| Structure | Prose moves as argument, not as list of announcements? |

- Below 42/60 total: revise and re-score. Never deliver a draft below 42/60.
- Any single dimension at 5 or below: fix that dimension even if the total passes.
- Re-run the gate after any later edit to the same text, however small. An edited draft is an unscored draft.
- Keep the numbers internal unless the user asks for them.
- Stop once the gate passes and the draft reads like a person wrote it. Editing past that point risks over-polishing.

## Audit Workflow (`--audit`)

Do not edit. Read the file(s), check against slop + (if `--docs`) docs conventions, return one line per finding.

```text
## <filename>

<filename>:12 - throat-clearing opener ("Here's the thing")
<filename>:24 - passive voice ("the decision was reached")
<filename>:47 - banned word "easy" (docs mode)
<filename>:58 - em dash in prose (docs mode)
<filename>:71 - vague quantifier "significantly" (docs mode)
```

State issue + location. Skip explanation unless the fix is non-obvious. No preamble.

Group by file. Terse. Sacrifice grammar for brevity. Use `file:line` (VS Code clickable) format. A clean file gets `✓ pass`.

End every audit report with the source text's six-dimension score from the Final Scoring Gate table, e.g. `Score: 38/60 — fails gate (threshold 42)`.

**Recipient-test heuristic.** For each bullet or sentence, flag if any is true: restates the header label immediately above it; asks the recipient to confirm something the same message already delivers; opens with reasoning the body's structure already conveys; names people, scope, or numbers traceable to a ticket or spec without a note that real use was checked. Full patterns: [references/audience.md](references/audience.md).

## Banned Words

Union list, source-annotated: [references/banned-words.md](references/banned-words.md). Slop rules always in force. Docs bans (`easy`, `simple`, `quick`, `very`, `just`, `really`) enforced only with `--docs`.

## Vercel Cache

The docs-mode rules mirror Vercel's public writing guidelines (`vercel-labs/writing-guidelines`). Cached locally in [references/vercel-cache/](references/vercel-cache/): `command.md` and `AGENTS.md`, plus the SHA manifest.

Refresh the cache on demand:

```bash
node scripts/refresh_vercel.js
```

The script polls `GET repos/vercel-labs/writing-guidelines/commits?path=<file>&per_page=1`, compares the returned SHA to the manifest, downloads only when the SHA has moved, and prints a diff summary. Offline (no network, `gh` not available, rate-limited): the script exits 0 without touching cache, and the skill continues to use the last known good copy. Never fail-close on refresh — the cache is the source of truth for the skill.

If Vercel's canonical rules and this skill's derived files diverge after a refresh, the cache is authoritative. Update `references/docs.md` and `references/banned-words.md` to match, then re-run the skill.

## Deliver

- Run the Final Scoring Gate on the exact text being returned. Never deliver an unscored draft.
- Return only the final text unless the user asks for analysis, intermediate drafts, the score, or the audit report.
- Preserve a supplied subject line and signature unless the task calls for changing them.
- Do not mention the passes, dependency check, scores, mode, flag, or skill name in the final text.
- Do not add facts, commitments, or certainty that were not present in the source.
- Preserve exact figures, conditions, names, quoted language, and legal wording.

## Edge Cases

- **Direct quotes.** Leave them alone.
- **Technical prose where precision beats rhythm.** API reference sentences can be metronomic; don't force variation that loses accuracy. See [references/technical.md](references/technical.md). Score the gate's Rhythm dimension against that standard, not against essay prose.
- **Lists and tables.** Structural repetition is the point; don't "vary rhythm" inside a parameter list.
- **First-person personal voice.** `you` and `I` are fine; don't strip writer presence in the name of directness.
- **Foreign language source.** Recast to English first, then run the passes.

## License

See `LICENSE` (MIT; attribution to stop-slop, writing-fix, writing-guidelines upstreams).
