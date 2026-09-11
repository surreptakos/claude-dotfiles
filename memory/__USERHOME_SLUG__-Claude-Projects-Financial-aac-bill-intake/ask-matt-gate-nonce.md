---
name: ask-matt-gate-nonce
description: "The ask-matt gate nonce is per-prompt and the declare must be the turn's first tool call — a stale nonce blocks every tool"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3fba5f80-137f-4816-826f-f4db0d32829e
  modified: 2026-09-10T23:21:39.277Z
---

`python "__USERHOME__\.codex\hooks\ask_matt_gate.py" declare-claude "<session>" "<nonce>" <flow>`

The nonce in the UserPromptSubmit gate text **rotates on every prompt**. Use the one from the current
turn's gate block, and make the declare the first tool call of that turn. Both conditions are real:
a nonce carried over from an earlier turn fails.

Until the declare succeeds, a PreToolUse hook blocks **every** tool — Bash, Read, Glob, PowerShell —
all with the same message:

```
Ask Matt, Yes, and caveman ultra missing. Run exact declaration from prompt gate.
```

That message names three things and says "missing", which reads like a prose-declaration problem. It
is not. Declaring the route, YES and caveman ultra in the reply text does nothing, and no
capitalization of those tokens helps. The gate blocks reading its own source, so the contract cannot
be discovered from inside a blocked session — that misled a full wrap-up on 2026-08-06 into
seven failed attempts and a wrong "the hook blocks its own declare command, needs an exemption"
conclusion. It does not need one.

Success looks like: `Governance recorded: direct-answer; yes; caveman-ultra`, exit 0.

**Run the command exactly as printed, nothing appended.** On 2026-09-10 a declare with
`; echo "exit=$?"` tacked on (and a PowerShell `py -3` variant) was blocked with the same "missing"
message; the bare command, via Bash, succeeded first try. The hook matches the command text itself.

Flows: `implement`, `diagnosing-bugs`, `triage`, `wayfinder`, `code-review`, `research`,
`direct-answer` (no engineering flow).
