# UserPromptSubmit hook ordering — what the docs say (2026-09-03)

Question: can two `UserPromptSubmit` hooks (the caveman plugin's mode tracker and the ask-matt
gate) be made to run in a deterministic order, so a `/caveman lite` typed this turn is seen by the
gate this turn rather than next?

Sources: https://code.claude.com/docs/en/hooks-guide.md and the hooks reference, read 2026-09-03
by a claude-code-guide agent with verbatim quotes.

## Findings

1. **Hooks on one event run in parallel.** "When multiple hooks match the same event, every hook's
   command runs to completion before Claude Code merges the results. One hook returning `deny`
   doesn't stop sibling hooks from executing." (hooks-guide, "Combine results from multiple hooks")
   and, of the worked example, "both hooks execute in parallel".
2. **No ordering field exists.** The documented keys on a hook entry are `type`, `command`, `args`,
   `async`, `asyncRewake`, `shell`, `url`, `headers`, `allowedEnvVars`, `server`, `tool`, `input`,
   `prompt`, `model`, `if`, `timeout`, `statusMessage`, `once` (skill frontmatter only) and the
   wrapper-level `matcher`. Nothing named order, priority or sequence.
3. **Settings scopes merge, order unspecified.** "Hook entries merge across settings levels rather
   than replacing each other: user, project, and local settings add their own hooks without
   removing managed ones." A duplicate handler across settings files "runs once"; "A plugin's or
   skill's copy of the same handler stays separate." Nothing on which runs first.
4. **additionalContext from several hooks is concatenated**; the docs state the merge for
   PreToolUse ("Text from `additionalContext` is kept from every hook and passed to Claude
   together") and are silent on the order for UserPromptSubmit.
5. **Docs offer no ordering recipe.** The only related guidance is a warning: "Don't rely on one
   hook's `deny` to suppress side effects in another hook."

## Consequence

Ordering between a plugin hook and a user hook cannot be configured. The one-turn lag on
`/caveman <level>` (gate reads the flag before the tracker writes it) is inherent to running them
as two hooks.

## Ways to get determinism anyway

- **Have the gate read the prompt too.** The gate already receives the prompt text. Parsing the
  same `/caveman <level>`, `/caveman:caveman <level>`, `stop caveman` and `normal mode` forms the
  tracker recognises, and using that result for the current turn (falling back to the flag),
  removes the lag for the explicit commands. Natural-language triggers ("be terse") still lag one
  turn. About fifteen lines in the gate; the tracker stays the flag's only writer.
- **Run the tracker from inside the gate's own hook command**, sequentially, before the gate
  logic. Deterministic, but the plugin's own copy still runs in parallel (harmless: same value,
  atomic write) and the script path lives under a plugin cache hash that changes on every plugin
  update.
- **Single combined hook** (fork the tracker into `~/.claude/hooks`, disable the plugin's hook).
  Not possible without forking the plugin: plugin hooks cannot be switched off individually.

Recommended: the first. Smallest change, no dependence on plugin internals or cache paths.
