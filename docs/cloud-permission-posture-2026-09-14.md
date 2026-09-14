# Cloud session permission posture — ruling (2026-09-14)

Recorded for issue 170.

## Ruling

Cloud sessions in this repo run under **Accept edits with a blanket allow list**, not
auto mode.

> Ruling (Dan, 2026-09-14, wayfinder grilling on #161): Accept edits plus a blanket
> allow list, no auto mode. "You literally cannot do bypass permissions in a cloud
> container. We do Accept Edits + whitelist everything." Applies to interactive cloud
> sessions and to Routine runs (the Routine sessions parked by the auto-mode classifier
> in #166 are the failure this removes).

Source: https://github.com/surreptakos/claude-dotfiles/issues/170#issuecomment
(Dan, 2026-09-14).

## Why not auto mode

Auto mode's exfiltration classifier treats `~/.claude/**` reads as data-exfiltration
attempts, which is the *content* of this repo. The #166 live probe (fresh containers
B and C, 2026-09-14) parked Routine sessions on:

- `cat ~/.claude/plugins/installed_plugins.json` — classified "Data Exfiltration".
- combined `cat`/`ls` over `~/.claude/hook-state` — classified "Exfil Scouting".
- `gh api .../issues/166/comments -F body=@file` — classified "External System Writes".
- a shell heredoc that wrote a draft containing MCP server UUIDs.

Auto mode also drops `Bash(*)` regardless of allow list, so no allow-list edit can
recover the classifier's decisions. Accept edits pre-approves edits, honours the allow
list, and skips the classifier entirely.

Auto-mode's `autoMode.allow` block reads only from `~/.claude/settings.json` or
server-managed settings, never project settings; cloud containers have no
`~/.claude/settings.json` at container start, so lever 2 was not the chosen path.

## What landed

`.claude/settings.json` on this branch:

- `permissions.defaultMode`: `"acceptEdits"`
- `permissions.allow`: `["Bash(*)", "WebFetch", "WebSearch", "mcp__github__*"]`

The narrower prior allow rules (`Bash(git push origin --delete:*)`, `Bash(gh:*)`) are
subsumed by `Bash(*)` and dropped.

## `; echo "[exit $?]"` suffix finding — accepted (nothing to change here)

The issue calls out an auto-mode footgun: an allow rule like `Bash(gh:*)` fails to
match a compound command `gh api ... ; echo "[exit $?]"` because the classifier
matches each subcommand independently.

Repo-wide check on this branch:

```
grep -rn 'echo.*exit' --include='*.js' --include='*.md' --include='*.sh' --include='*.ps1'
grep -rn '\[exit'      --include='*.js' --include='*.md' --include='*.sh' --include='*.ps1'
```

The `[exit N]` occurrences in `.claude/workflows/ticket-fleet.js` and
`orchestrator/ticket-fleet-cloud.js` are report-rendering instructions to the
`reporter` agent (how a completed step should look in the follow-ups markdown),
not shell suffixes appended to real commands. The `; echo "exit=$?"` occurrences in
`memory/` are prose descriptions in generated notes (`gate-declare-bare-command.md`,
`ask-matt-gate-*.md`, `verify-exit-codes-not-pipes.md`) — they document past
failures, they are not instructions to append the suffix.

No probe/fleet instruction file in this tree tells anyone to append the suffix.
Nothing to change; finding recorded as accepted.

## Verification

Two halves; the first is what an implementer lands here, the second is a
runtime observation the delivery stage runs.

**Static (this branch):**

- `.claude/settings.json` parses as JSON and carries the ruling shape.
- `node --test tests/docs-claims.test.js tools/*.test.js` passes (96 tests).
- `powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1` passes
  (67 checks).

**Runtime (delivery stage — after this branch is on the default branch and a fresh
cloud container starts a session under it):**

- Open the session's permissions status (`/permissions` or the auto-mode summary)
  and see `defaultMode: acceptEdits`, no auto-mode classifier armed.
- Run `gh api repos/surreptakos/claude-dotfiles/issues/170/comments -F body='probe'`
  or equivalent write. Session runs it without a Bash prompt (allow list matches
  `Bash(*)`).

The runtime half cannot be exercised from an isolated worktree that cannot push; a
cloud container that would load this config does not exist until the branch is on
`origin/master`. That is why the ticket's second acceptance line is left for the
delivery stage; the delivery agent captures the observation into the issue when it
merges the PR.
