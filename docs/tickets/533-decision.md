# Issue 533: full rules at SessionStart, a digest per prompt

**Status:** shipped. `hooks/scripts/global-rules.js` has two modes. `start <k>` is a `SessionStart`
hook carrying part *k* of `rules/global-rules.md`; `digest` is one `UserPromptSubmit` hook carrying
`rules/global-rules-digest.md`. Issue 209's chunking, cap and doubling guard are unchanged — what
moved is *when* the ~12 KB text rides.

## Why

Issue 209 put the whole `### Four standing disciplines` section on **every prompt**, because a
container has no `~/.claude/CLAUDE.md` to read it from. It worked, and it cost about 12 KB of input
per turn to re-send text the session already had in context from the turn before. A rulebook
belongs where context begins — and begins again, since compaction drops it. What a long turn needs
is the short reminder that the rules exist and what they say.

## Measured, this container, 2026-09-17

Both payload hook scripts run directly, their `additionalContext` bytes summed per event
(`governance-reminder.js` plus the rules entries):

| | bytes |
| --- | --- |
| per prompt, before (reminder + 2 rules parts) | 13,637 |
| per prompt, after (reminder + digest) | 2,539 |
| saved per prompt | 11,098 (81.4%) |
| once per SessionStart, after (2 parts) | 12,277 |

The digest itself is 1,187 bytes on disk and 1,280 emitted (the pointer token resolves to an
absolute path). The cap is 1,500 and the packager refuses to build over it.

## The headless probe, 2026-09-17

Two-prompt headless session, payload loaded with `--plugin-dir`, scratch `CLAUDE_CONFIG_DIR` with
no global `CLAUDE.md` (the `ask_matt_gate` `Stop`/`PreToolUse` entries removed from the probe copy
of `hooks.json` so `claude -p` terminates; the rules hooks and the reminder are untouched).
Transcript read back from `<config>/projects/*/*.jsonl`:

```
[SessionStart:startup] GLOBAL RULES (part 1 of 2 ...)   6,160 bytes injected
[SessionStart:startup] GLOBAL RULES (part 2 of 2 ...)   6,117 bytes injected
--- PROMPT 1: 'Reply with the single word ONE.'
  injected @prompt 1: GLOBAL RULES DIGEST | 1,225 bytes
  injected @prompt 1: GOVERNANCE          | 1,259 bytes   (header: "GOVERNANCE (always on):")
  assistant: 'ONE'
[SessionStart:resume]  GLOBAL RULES (part 1 of 2 ...)   (the -c continuation is a SessionStart)
--- PROMPT 2: 'Reply with the single word TWO.'
  injected @prompt 2: GLOBAL RULES DIGEST | 1,225 bytes
  injected @prompt 2: GOVERNANCE          | 1,259 bytes
  assistant: 'TWO'
```

No `GLOBAL RULES (part ...)` block at either prompt, and no `persisted-output` / `Output too
large` wrapper anywhere in the transcript — every part arrived whole.

## The digest is generated, never hand-kept

`claude/CLAUDE.md` is a **generated mirror** of the owner's live file: the one rule of this repo is
that it is never hand-edited. So the digest is derived from marks the rules prose *already*
carries — bold run-in labels (`- **Ultra:**`, `- **Never drop:**`), numbered rules
(`1. **Evidence over intuition.**`, `1. **Lead with the next action.**`), and the ask-matt
paragraph's opening line. Nothing was added to the source to make the extraction possible.

`DIGEST_SECTIONS` in `tools/build-cloud-plugin.py` names the marks; `build_rules_digest()` takes
the verbatim span each mark opens, unwrapped to one line, and fails the build when a mark is
missing or ambiguous — the same contract `RULES_HEADING` has. A rewording of the source therefore
breaks the branch loudly instead of quietly dropping a discipline from every prompt.

What the digest carries, per the ticket: the caveman level and the never-drop list; the yes trigger
sentence and the evidence rule with its banned hedges; the ask-matt gate sentence; the ADHD reply
shape (lead with the next action, end with one two-minute action, no preamble/recap/closer); and a
pointer saying the full text is *already in this context* and where the file is.

## One pointer per prompt

The packaged `governance-reminder.js` said twice (issue 495) where the full rules are. The digest
now opens with the same sentence, so the packager's retarget makes both of the reminder's pointers
conditional on the digest being present: with it, the header is `GOVERNANCE (always on):` and the
ASK-MATT line ends at `...before starting work.`; without it (an older payload) the issue 495 text
is unchanged. The digest's own pointer carries a `__RULES_FILE__` token that `global-rules.js`
resolves to the installed absolute path, so the one pointer a prompt carries names a file the model
can open.

## Every SessionStart source, compaction included

The manifest group for the `start` entries carries **no matcher**, so it fires on `startup`,
`resume`, `clear` and `compact`. The hook ignores its stdin for exactly this reason: a compacted
session is the case that most needs the rulebook back, and a matcher is the easiest way to lose it.
`tools/global-rules-hook.test.js` fails if a matcher appears.

## Checks

- `tools/global-rules-hook.test.js` — parts reassemble the file byte for byte, each under the
  10,000-byte cap, one `SessionStart` entry per part with no matcher, exactly one
  `UserPromptSubmit` entry and it is the digest, the digest under 1,500 bytes with the five things
  the ticket names, and nothing emitted in either mode where a global `CLAUDE.md` already carries
  the rules.
- `tests/build-cloud-plugin.test.py` — the shipped digest equals a rebuild from the shipped rules
  text (so it cannot be hand-kept), its content is verbatim from those rules, an over-cap digest
  and a reworded mark both raise, and the reminder dedupe is pinned in both directions.
- `tests/bootstrap-assert.py` — `REQUIRED_HOOKS` names the `SessionStart` full-text entry and the
  per-prompt `digest` entry, and the digest file is asserted present and under the cap.
