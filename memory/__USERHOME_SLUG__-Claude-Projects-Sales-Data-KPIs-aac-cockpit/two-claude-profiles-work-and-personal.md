---
name: two-claude-profiles-work-and-personal
description: Work and personal Claude Code accounts live in separate config dirs on this machine; CLAUDE_CONFIG_DIR is asymmetric and pointing it at ~/.claude breaks the work profile.
metadata: 
  node_type: memory
  type: project
  originSessionId: 653c3728-2f67-4694-b71d-84577a47fbf6
  modified: 2026-08-02T19:51:41.306Z
---

Two side-by-side Claude Code profiles were set up 2026-08-02: work (`dgatsakos@activealarm.com`,
Active Alarm Team seat, the default profile) and personal (`~/.claude-personal`). Tooling lives at
`__USERHOME__\Claude\Projects\Meta\claude-account-handoff\` (`claude-handoff.js` + README with the
full evidence log); shims `claude-work`, `claude-personal`, `claude-handoff` are installed in
`~/.local/bin`.

**The trap, measured on claude 2.1.219:** the two layouts are not symmetric.
`CLAUDE_CONFIG_DIR` unset puts the account state at `~/.claude.json`, a *sibling* of `~/.claude`.
Setting it to `X` puts it at `X/.claude.json`, *inside* the dir. So `CLAUDE_CONFIG_DIR=~/.claude`
yields a half profile: token found, `email: null`, no project history, plus a stub
`~/.claude/.claude.json` written as a side effect. Reach the work profile by REMOVING the variable.

**Why a handoff works at all:** transcripts carry no account identity (no `userID`, `accountUuid` or
`organizationUuid` in `projects/<slug>/<id>.jsonl`), and the session lookup runs before the auth
check, so a real id under a signed-out profile says "Not logged in" while a fake id says "No
conversation found". Copy the `.jsonl`, sign in, `--resume`.

**Do not** copy `.credentials.json` between profiles: it carries live tokens plus ~30 work connector
grants. `C:\Program Files\ClaudeCode\managed-settings.json` is machine-level, so the governance rules
apply to both profiles regardless of account. Resuming a work transcript under the personal account
does move AAC content to a consumer subscription; that is Dan's call as `primary_owner`, not an
accident to drift into. Related: [[nothing-lives-only-in-chat]].
