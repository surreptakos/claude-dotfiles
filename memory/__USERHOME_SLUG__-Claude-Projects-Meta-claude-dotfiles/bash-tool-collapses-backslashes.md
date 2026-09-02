---
name: bash-tool-collapses-backslashes
description: "The Bash tool unescapes backslashes once before bash sees the command, even inside a quoted heredoc; write scripts with backslashes via the Write tool instead"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 71b30f27-7c0a-4ac0-86b0-e50d45a35100
  modified: 2026-09-02T21:27:36.265Z
---

The Bash tool collapses `\\` to `\` before the command reaches bash, and a quoted heredoc (`<<'EOF'`) does not protect it. A Python source passed that way with `\\b` arrives as `\b` (a backspace byte in a non-raw string), and `C:\\Users` arrives as `C:\Users` (a `\U` unicode-escape error). Seen 2026-09-02 while patching six `ticket-fleet.js` copies: the regex `\b...\b` landed as two 0x08 bytes in every file and had to be repaired byte by byte.

**Why:** the harness rewrites the command string once; there is no escaping level that survives it reliably.

**How to apply:** any script, patch or file content that contains a backslash goes through the Write tool to a scratchpad file, then Bash runs the file. Building the backslash in code (`chr(92)`, `bytes([92])`) also works. Verify with a byte-level check (`b'\x08' in data`) when the payload is a regex. Related: [[sed-strips-crlf-in-this-repo]].
