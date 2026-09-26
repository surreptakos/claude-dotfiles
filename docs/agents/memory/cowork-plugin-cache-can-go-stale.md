---
name: cowork-plugin-cache-can-go-stale
description: "claude.ai's own Cowork plugin cache (rpm/plugin_<id>/, listed as aac-skills@synced) can go stale and miss files its own hooks.json calls, blocking every tool call; the packager already ships hooks/scripts/ atomically, so this is an account-side cache bug, not a publish-path gap"
metadata:
  node_type: memory
  type: project
  originSessionId: cc0e168f-6fa4-5a8f-94fa-83a8165b98a6
  modified: 2026-09-25T23:11:48.000Z
---

Observed 2026-09-24 on AAC-AI (issue 829): every tool call failed at PreToolUse with
`can't open file '...\rpm\plugin_01GBedA5A59asvhKehjXd3sm\hooks\scripts\ask_matt_gate.py': No such
file or directory`, while the marketplace install (`2026.9.241649`) had the script. `claude plugin
list` named the broken one `"aac-skills@synced" from claude.ai`, matching the **Account Plugins**
channel ([[three-skill-channels]]) — claude.ai's own sync of the marketplace plugin into
`%APPDATA%\Claude\local-agent-mode-sessions\<org>\<account>\rpm\plugin_<id>\` for Cowork, proved
running hooks correctly nine days earlier at `2026.9.182049` ([[cowork-runs-plugin-hooks]]). The
owner had not uploaded a plugin manually; the old `dan-skills`/`aac-skills` manual-upload flow was
retired 2026-08-31 (commit `7662d5b`). Deleting the local `rpm` folder cleared this machine only —
the account still re-serves the stale copy.

**Why it is not a packager bug:** `tools/build-cloud-plugin.py`'s `gov_sources_present` gate copies
every governance script into `hooks/scripts/` and writes the `hooks.json` entries that call them
atomically, in the same build — there is no code path that emits a `hooks.json` referencing
`ask_matt_gate.py` without the file. Both publish paths (the marketplace payload and the zip
fallback) already ship the full payload. The break is a stale/incomplete client-side cache on the
claude.ai account side, outside this repo's control.

**How to apply:** if a session reports every tool call failing at PreToolUse with a missing
`hooks/scripts/*.py` path under `rpm\plugin_<id>\`, don't go looking for a packager gap — check the
`gov_sources_present` invariant holds (it does, as of issue 829) and treat it as this account-cache
bug instead. The fix is account-side (claude.ai UI, ready-for-human territory — issue 857), not a
rebuild. `docs/agents/memory/MEMORY.md` and this note's own file are the source; there is no
`~/.claude` mirror to keep in step, per issue 210.
