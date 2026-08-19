---
name: headless-claude-cli-auth-dead
description: "headless `claude -p` auth broken 2026-08-19 (empty credentials file, no CLAUDE_CODE_OAUTH_TOKEN); opus47 registered agent type is the working Opus 4.7 pin"
metadata: 
  node_type: memory
  type: project
  originSessionId: df9de2e4-1ad1-460e-933e-45310a15d441
  modified: 2026-08-19T01:38:14.252Z
---

Measured 2026-08-19: `claude -p --model claude-opus-4-7 …` returns `is_error: true`, `Failed to
authenticate: OAuth session expired and could not be refreshed`. `CLAUDE_CODE_OAUTH_TOKEN` unset in
process/User/Machine scopes; `~/.claude/.credentials.json` holds empty `accessToken`/`refreshToken`
with `expiresAt: 0`. So the global CLAUDE.md "headless CLI run with the full model ID" recipe for
pinning a subagent model is dead until Dan mints a token (`claude setup-token`) or re-logs the CLI.

**Why:** the interactive session authenticates through a different store; headless runs have nothing
to refresh from.

**How to apply:** for "spin up an Opus 4.7 agent on this ticket", use the registered `opus47` agent
type via the Agent tool first — it runs under the live session's auth and worked for issue 136
(PR #141). Test the CLI before trusting it again; a later `claude setup-token` fixes it. Logged in
[[nightly-orchestrator-live]] territory: FOLLOW-UPS.md 2026-08-19 entry tells Dan.
