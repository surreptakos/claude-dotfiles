---
name: install-mirror-prs-to-live-before-sync-push
description: "After merging a PR that edited agents/skills, claude/ or codex/ from a cloud branch, copy those files into ~/.claude or ~/.codex before the next sync push, or the push silently reverts the PR"
metadata: 
  node_type: memory
  type: project
  originSessionId: c3de08e3-8567-4e36-b44c-2596424dcea0
  modified: 2026-09-16T00:22:18.967Z
---

A cloud branch may edit the generated mirrors (`agents/skills/**`, `claude/settings.json`) because
it has no live tree (repo CLAUDE.md allows it with a stamp + rebuild). Once merged, the desktop's
live tree is BEHIND master for those files, and `sync.ps1 -Mode push` copies live over the mirror:
the PR's change vanishes from the repo with no conflict and no warning. Seen 2026-09-15 after
fleet PRs #288, #289 and #296 landed while the desktop had uncommitted live edits of its own.

**Why:** push is live → mirror, one direction, whole tree. `sync.ps1 -Mode pull` would install
master into live but also overwrites any live edit not yet pushed, so neither direction alone is
safe when both sides moved.

**How to apply:** before a push, `git diff --name-only <last-sync-commit> origin/master -- agents/skills claude/ codex/ memory/`
lists what master changed in the mirrors; copy each of those files from the checkout into its live
twin (merge by hand only where live also changed), then push and confirm `git diff` shows only
your intended edits. `sync.ps1 -Mode push` refuses a worktree; `-FromWorktree` is fine when the
branch is rebased on `origin/master`. Fleet workers cannot do any of this (no live tree), so a
`ready-for-local-agent` ticket that needs a live edit is the desktop session's own work after the
fleet, not a fleet ticket — run `6aa9c553` failed 4 of 4 such tickets and the session landed them
directly. See [[fleet-implementers-edit-the-live-tree]] and [[concurrent-sessions-share-one-sync-push]].
