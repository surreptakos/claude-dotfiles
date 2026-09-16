# Issue 209: global rules text delivered per prompt from the plugin payload — measurement + route

**Status:** direct injection, chunked. The packager copies the
`### Four standing disciplines` section of the owner's global `CLAUDE.md` into the payload at
`rules/global-rules.md` and wires one `UserPromptSubmit` entry per part of it
(`hooks/scripts/global-rules.js`). The pointer fallback the ticket allowed for is **not** used:
the cap is per hook output, so N parts under it deliver the file in full on every prompt.

## The measurement

Cloud container, 2026-09-16, Claude Code binary at `/opt/claude-code/bin/claude`. Headless
`claude -p` runs with a probe `UserPromptSubmit` hook in a scratch `CLAUDE_CONFIG_DIR`, emitting an
exact number of bytes of numbered filler as `additionalContext`; each run's transcript was read
back from `<config>/projects/*/*.jsonl`.

| `additionalContext` bytes | what reached the model |
| --- | --- |
| 2,000 | whole |
| 2,100 | whole |
| 8,000 | whole |
| 10,000 | whole |
| 10,240 | persisted, 2KB preview |
| 12,000 | persisted, 2KB preview |
| 16,000 | persisted, 2KB preview |
| 24,019 | persisted, 2KB preview |

The wrapper on an over-cap run, verbatim from the transcript:

```
UserPromptSubmit hook additional context: <persisted-output>
Output too large (23.5KB). Full output saved to: .../tool-results/hook-88bbdf6e-...-1-additionalContext.txt

Preview (first 2KB):
UPS-CAP-PROB
```

Same shape probe #175 quoted for `SessionStart` (15.1KB → 2KB preview), so the 2KB preview is the
host's persist behaviour, not a `SessionStart`-only cap.

**The cap is per hook output, not per prompt.** Two hook entries emitting 8,000 bytes each in the
same `UserPromptSubmit` group both arrived whole — 16,000 bytes of injected context in one prompt:

```
      2 UPS-PART1-END
      2 UPS-PART1-START
      2 UPS-PART2-END
      2 UPS-PART2-START
```

(each marker counted twice because the transcript records the turn twice).

## The route

The rules section is ~12 KB — over the ~10 KB per-output cap, under it once split. So:

- `tools/build-cloud-plugin.py` extracts the section from the global `CLAUDE.md` (live
  `~/.claude/CLAUDE.md` next to `--source` on a PC build; the `claude/CLAUDE.md` mirror,
  de-tokenized with `--home`, on a `--from-mirror` build) and writes it to
  `rules/global-rules.md`. One source, no hand duplicate; a build whose source lost the heading
  fails loudly.
- It splits the text by greedy line packing at 6,000 bytes and wires that many
  `UserPromptSubmit` entries, each `node global-rules.js <k>`. Today: 3 parts, 6,170 / 6,122 / 343
  bytes of `additionalContext` including each part's header.
- `global-rules.js` re-derives the same split and emits part *k*. `PART_BYTES` there and
  `RULES_PART_BYTES` in the packager are the two halves of that contract;
  `tools/global-rules-hook.test.js` fails if the parts stop reassembling the file, if a part
  crosses 10,000 bytes, or if the manifest stops wiring one entry per part.

The bootstrap-writes-a-CLAUDE.md-and-the-hook-points-at-it fallback stays unbuilt: it costs a file
the packager cannot own, and chunked injection already satisfies the criterion (full text, every
prompt, no file read).

## Criterion 3 — quoted on prompt 1 and prompt 2, no file read

Headless two-prompt session with the payload loaded (`--plugin-dir marketplace/aac-skills`), a
scratch `CLAUDE_CONFIG_DIR` with **no** global `CLAUDE.md`, and `Read`/`Bash`/`Grep`/`Glob`/
`Edit`/`Write`/`WebFetch`/`Task` denied in that config, so nothing could be read from disk.

Prompt 1 — asked for the sentence under the CAVEMAN ULTRA heading:

```
"Terse smart-caveman. All technical substance stays; only fluff dies."  This appeared in part 1 of 3.
```

Prompt 2 (`claude -p -c`, same session) — asked for the last sentence of part 3:

```
"See [[reporting-style-plain-english]]."  Part 3 of 3.
```

Transcript scan of the turn after prompt 2: `parts injected after prompt 2: ['1/3', '2/3', '3/3']`,
`tool calls after prompt 2: []`, no `persisted-output` around any part.

## Criterion 4 — a local session shows no doubled rules text

`global-rules.js` carries its own doubling guard rather than `_plugin_hook_guard.js`: nothing in
user settings dispatches it (there is no live-tree copy to dedup against), so the question is
whether the session **already has the text**. Where `<CLAUDE_CONFIG_DIR|~/.claude>/CLAUDE.md`
contains the rules file's first line — every PC session — the hook writes nothing and exits 0.
Pinned by the last test in `tools/global-rules-hook.test.js` and demonstrated in a session whose
config dir carried the owner's `CLAUDE.md` as global memory, with the payload loaded. Asked how
many copies of the CAVEMAN ULTRA sentence were in its context:

```
1

It appears once in `.../local-sim/cfg/CLAUDE.md` under the "#### 1. CAVEMAN ULTRA — output style, every response" section.
```

That session's transcript carries no `GLOBAL RULES (part ...)` block at all — the hook stayed
silent, which is the guard working.
