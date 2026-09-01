# Banned words — annotated union

Source-annotated so a reader can see which rule bans each word and in which mode.

Legend: `slop` (always in force), `docs` (only with `--docs`).

## Filler / adverbs / hedges

| Word | Bans | Replace with |
|------|------|--------------|
| `really` | slop, docs | cut or rewrite |
| `very` | docs | cut or rewrite |
| `just` | docs | cut or rewrite |
| `simply` | slop, docs | cut or downplay less |
| `actually` | slop | cut, unless correcting a previous statement in a technical context (see [technical.md](technical.md)) |
| `literally` | slop | cut |
| `genuinely` | slop | cut |
| `honestly` | slop | cut |
| `deeply` | slop | cut |
| `truly` | slop | cut |
| `fundamentally` | slop | cut |
| `inherently` | slop | cut |
| `inevitably` | slop | cut |
| `interestingly` | slop | cut |
| `importantly` | slop | cut |
| `crucially` | slop | cut |

## Marketing pressure

| Word | Bans | Replace with |
|------|------|--------------|
| `easy` | docs | concrete description (`one command`, `default settings`) |
| `simple` | docs | concrete description |
| `quick` | docs | concrete description |

## Weasel / vague quantifiers (docs enforce, slop flags)

| Word | Bans | Replace with |
|------|------|--------------|
| `significantly` | slop, docs | a specific number |
| `many` | slop, docs | a specific count |
| `often` | slop, docs | a frequency |
| `typically` | slop, docs | conditions where it holds |
| `generally` | slop, docs | conditions where it holds |
| `near-zero` | docs | the figure |
| `sub-second` | docs | the figure |
| `most requests` | docs | the percentage |

## Filler/metaphor verbs (slop, always flag)

Name the literal action instead.

| Verb | Replace with |
|------|--------------|
| `moves through` | the literal step (`the request reaches`, `the queue advances`) |
| `lands` | the literal outcome (`arrives`, `is applied`) |
| `carries` | the literal content (`contains`, `holds`, `is set to`) |
| `hits` | the literal contact (`reaches`, `is called against`) |
| `emerges` | name the actor |
| `becomes` | name the actor and the change |

## Business jargon (slop)

Full table in [phrases.md](phrases.md#business-jargon). Highlights:

`navigate`, `unpack`, `lean into`, `landscape`, `game-changer`, `double down`, `deep dive`, `take a step back`, `moving forward`, `circle back`, `on the same page`.

## Lazy extremes (slop, always flag)

`every`, `always`, `never`, `everyone`, `everybody`, `nobody` — false authority. Use specifics.

## Rhetorical / meta

`Look,` (opener), `So` (paragraph opener), `Hint:`, `Plot twist:`, `Spoiler:`, `Let me be clear`, `Full stop.`, `Period.`, `Let that sink in.`, `Make no mistake`. See [phrases.md](phrases.md) for the full list.
