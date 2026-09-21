---
name: gate-declare-bare-command
description: The ask-matt PreToolUse gate accepts the declare-claude command only as the exact bare string; chaining anything onto it blocks every tool
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a7a166dd-0cbf-43ad-b53f-e797c0dd93a7
  modified: 2026-09-03T22:33:28.635Z
---

Run the gate declaration exactly as the prompt hook prints it, as its own Bash call, nothing appended:

```
python "__USERHOME__\.codex\hooks\ask_matt_gate.py" declare-claude "<session>" "<nonce>" <flow>
```

**Why:** The PreToolUse hook whitelists the declaration by exact command match. On 2026-09-03 five attempts with `; echo "exit=$?"`, a trailing pipe, or an extra quoted argument were all rejected with `Ask Matt, Yes, and caveman ultra missing. Run exact declaration from prompt gate.` and every other tool (Read, Grep, PowerShell, Agent) stayed blocked until the bare form ran. Writing the three names in reply text does nothing; the hook reads the command, not the transcript.

Since 2026-09-21 (issue 608) a trailing `; echo "exit=$?"` or `2>&1; echo 'EXIT=$?'` is tolerated; anything else appended is still a rejection.

**How to apply:** First tool call of every turn is the bare declaration. Put the real work in the next call. Same rule for the pre-send lint: separate call, output read from the result, no chaining needed but harmless there. Related: [[workflow-runtime-quirks]].
