---
name: concurrent-sessions-share-one-sync-push
description: "Any session's sync.ps1 push sweeps every live ~/.claude edit into its own commit, including another session's in-flight work"
metadata: 
  node_type: memory
  type: project
  originSessionId: 422b7e48-b3a2-49db-ba3f-ef7dfd40388a
  modified: 2026-09-02T00:33:03.694Z
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

**Second observation, 2026-09-01 — the push is not always a person's.** The freshness hook's
state2 auto-resolver runs `sync.ps1 -Mode push -Commit "chore: session-start capture"` on prompt
submit, seconds after a `git pull` lands. Merging fleet PR #49 changed `lib/manifest.ps1` to read
the global `CLAUDE.md` from `~/.claude-personal` when that directory exists; the hook then captured
the stale personal copy into `claude/CLAUDE.md` (commit `19f43b8`) before anyone had looked at the
merged manifest, regressing two same-day live edits. Caught only because a `git status` mid-push
showed 133 staged deletions (the clear-then-copy phase). Reverted in `4d85555`, recaptured in
`3fb70d7`. So: a merged PR that touches `lib/manifest.ps1` or `sync.ps1` is applied to the mirror
by the hook on the very next prompt — after merging one, compare `claude/CLAUDE.md` (tokenized) to
the live file before the hook's commit is pushed, and never merge a manifest change whose PR was
verified only against a fake home with a single profile.

Related: [[powershell-7-is-the-tool-engine]], [[verify-before-filing-a-sweep-ticket]]
