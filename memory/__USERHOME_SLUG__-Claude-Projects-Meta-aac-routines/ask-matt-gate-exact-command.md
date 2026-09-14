---
name: ask-matt-gate-exact-command
description: "The ask-matt gate's declare-claude command must be the whole Bash command, alone; and gh issue create needs a to-tickets/to-spec/triage declaration first"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a9fdffe7-0cef-49d6-943f-65a0ad4eb1fb
  modified: 2026-09-14T15:27:07.782Z
---

The PreToolUse gate blocks every tool until `python "__USERHOME__\.codex\hooks\ask_matt_gate.py" declare-claude <session> <nonce> <flow>` has run — and it matches the Bash command string exactly. Appending anything (`; echo "exit=$?"`, a second command, output redirection) makes it print `Ask Matt, Yes, and caveman ultra missing. Run exact declaration from prompt gate.` on every tool call, including Read/Grep. Cost five failed calls on 2026-09-11 before the bare command was tried.

Second rule, hit 2026-09-14: `gh issue create` under route `implement` is refused with `Publishing an issue under route implement. Declare one of: to-spec, to-tickets, triage.` Re-declare with the current nonce and the publishing route before creating issues, even inside `/session-end`.

**Why:** the gate is a string-matching hook, not a parser; the route it records also authorises what the session may publish.

**How to apply:** first tool call of every turn is the bare declare command, nothing else in the string; switch route to `to-tickets` before any issue create. See [[pre-send-lint-discipline]].
