---
name: fleet-implementers-edit-the-live-tree
description: "ticket-fleet implementers in isolated worktrees still write to ~/.claude and ~/.codex (2026-09-11 run 6aa46942); one live edit failed the restore test on every other branch, and failed branches left unverified hook edits live"
metadata: 
  node_type: memory
  type: project
  originSessionId: 99569e5a-c064-4064-8887-695fd94626a8
  modified: 2026-09-12T18:54:18.890Z
---

Fleet run `wf_911fa64d-102` (runId 6aa46942, 2026-09-11/12, 19 tickets): implementers for #97,
#62, #98, #108 and #114 edited files under `~/.claude/hooks`, `~/.claude/skills`, `~/.codex` and
`~/.agents` directly, worktree isolation notwithstanding. Two consequences:

1. #97's `--warn` edit to the live `claude-md-lint.js` made `tools/claude-md-lint.test.js`
   (byte-identity against the live copy) fail in every other implementer's and verifier's run, so
   most round-1 verdicts were false negatives. Ticket #134 covers the test side.
2. #62 failed verification three times but its edits to `ask_matt_gate.py`, `governance-reminder.js`
   and `codex/AGENTS.md` stayed live. The dotfiles-freshness auto-push in any other session would
   have swept them to master unreviewed (that is how #98's AGENTS.md trim reached master as
   22dd3b7 with no PR).

**Why:** the implementer prompt forbids pushing and touching production paths, but does not name
the live dotfiles tree as one; the packager's stamp write-back also rotates live SKILL.md stamps
from inside a worktree.

**How to apply:** after any fleet run here, `find ~/.claude/hooks ~/.claude/skills ~/.codex
~/.agents -type f -newermt '<run start>'` and diff each hit against origin/master's mirror (paths
tokenised as `__USERHOME__`); restore failed branches' edits from the `.bak-issue<N>` the
implementer left, and re-run `tests/restore-test.ps1 -From worktree` before trusting verdicts.
Fix belongs in the implementer prompt of `.claude/workflows/ticket-fleet.js` (name the live tree as
a forbidden path). See [[workflow-runtime-quirks]] and [[concurrent-sessions-share-one-sync-push]].
