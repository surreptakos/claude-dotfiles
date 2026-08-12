---
name: git-bash-tmp-invisible-to-windows-python
description: "Writing to /tmp from the Bash tool then reading it with Windows python silently fails, and a chained `gh issue edit --body-file` then rewrites the body unchanged."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83ee3ddd-d4d3-450c-bc41-19092153e8f4
  modified: 2026-08-01T20:59:32.047Z
---

On this machine, never stage a file in `/tmp` from the Bash tool and then read it with `python`. Git Bash resolves `/tmp` to its own mount; Windows `python` resolves it to `C:\tmp`, which does not exist. Use the session scratchpad directory (a real Windows path) for anything that crosses between the two.

**Why:** It has bitten **three times**, every time while editing GitHub issue bodies. `gh issue view N --json body -q .body > /tmp/bN.md` succeeds, `python` then raises `FileNotFoundError`, and — the dangerous part — the chained `gh issue edit N --body-file /tmp/bN.md` still runs against the *stale* file and rewrites the body unchanged. Nothing errors loudly and no data is lost, so it reads as a no-op edit rather than a broken pipeline. The second occurrence (2026-07-29, clearing tracker-audit advisories on #30/#31) happened despite knowing about the first. The third (2026-08-01, removing a commit hash from #121's acceptance criteria) happened despite this very memory being in context — reading the note is not the same as applying it, because the `> /tmp/x.md` reflex fires while writing the command, before the note is consulted.

**The catch that works:** the `assert` in the Python fired (`FileNotFoundError` before it, in fact), the chained `gh issue edit` still ran and reported success, and only an explicit `grep -c` on the re-fetched body proved the edit was a no-op. **Always verify the body changed by re-reading it from the API** — the exit code of `gh issue edit` is not evidence.

**How to apply:** Put intermediates in the scratchpad path from the system prompt, or do the whole transform in one interpreter. Prefer `sed -i` when the edit is a simple substitution — one tool, one filesystem. When patching text fetched from an API, `assert` the anchor string is present before writing, so a missing anchor fails loudly instead of silently shipping the original. Related: [[verify-before-filing-cite-the-check]].
