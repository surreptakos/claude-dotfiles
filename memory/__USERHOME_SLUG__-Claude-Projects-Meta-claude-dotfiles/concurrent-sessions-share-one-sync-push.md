---
name: concurrent-sessions-share-one-sync-push
description: "Any session's sync.ps1 push sweeps every live ~/.claude edit into its own commit, including another session's in-flight work"
metadata: 
  node_type: memory
  type: project
  originSessionId: 422b7e48-b3a2-49db-ba3f-ef7dfd40388a
  modified: 2026-08-31T16:28:00.527Z
---

`sync.ps1 -Mode push` mirrors the whole whitelist, not the caller's changes. So a session in a
different repo that pushes dotfiles will pick up whatever else is sitting uncommitted in
`~/.claude` and commit it under its own message.

Observed 2026-08-31: a session working on `session-end/SKILL.md` committed `5c0e270`, and that
commit also carried this session's unrelated `settings.json` `env` addition and a `skill-links.json`
reformat it had nothing to do with. Nothing was lost, and the working tree simply went clean under
this session's feet mid-decision.

**Why:** the whitelist is deliberately whole-tree — that is what makes the mirror a faithful
restore source. The cost is that "my diff" is not a concept push understands.

**How to apply:** before asking the owner to choose between options on an uncommitted dotfiles
diff, re-check `git status` and `git log` — the choice may already have been made by another
session. Do not start editing shared tracker state (milestones, issue bodies) while another
session is known to be active in the same repo; say so and let the owner sequence it.

Related: [[powershell-7-is-the-tool-engine]], [[verify-before-filing-a-sweep-ticket]]
