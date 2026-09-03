---
name: environment-verification-log
description: "Dated evidence behind the global CLAUDE.md environment-claim rules (model pinning, headless CLI auth, pre-send lint mechanics) — moved out of the rulebook in the 2026-09-03 concision trim"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 256462ea-6b07-41a1-8f84-5bd1a21d6d26
  modified: 2026-09-03T22:48:08.126Z
---

Evidence trail for rules that stay in `~/.claude/CLAUDE.md` under "Environment claims" and the
pre-send lint bullet. The rules stay there; the proof lives here. A later failed run supersedes any
line below.

- **Model pinning via Workflow** (2026-08-19, run `wf_ebb5f702-08c`): `agent()` with
  `{model: 'claude-opus-4-7'}` produced `"model":"claude-opus-4-7"` in the agent's transcript
  metadata; an `opus`-alias control in the same run served `claude-opus-5`. The Agent tool rejects
  full IDs with `expected one of ...`; mid-session agent registration fails with
  `Agent type '...' not found` (registry loads at session start).
- **Headless CLI pin** (2026-08-17): `claude -p --model claude-opus-4-7 ... --output-format json`
  ran in production. **Auth outage** 2026-08-19: empty credentials, headless runs failed.
  **Restored** 2026-09-01: Dan ran `claude auth login` (claude.ai, Active Alarm team org); probe
  exited 0 with `is_error: false`, `subtype: "success"`; access token auto-refreshes from
  `refreshToken`. Probe under an AAC project cwd inherited governance hooks: 40 turns, ~$0.42 on a
  trivial prompt.
- **Pre-send lint is a step, not a hook** (2026-08-12, measured three times): `MessageDisplay` is
  read-only per the docs; a `Stop` block appended a second reply and every flagged message still
  reached the user. Audit trail: clean run stamps `lint_clean_nonce`; a miss is logged to
  `~/.codex/hook-state/ask-matt/caveman-lint.log` and injected into the next turn. Every turn mints a
  new nonce, so a stale stamp cannot pass later.
- **Caveman flag ownership** (Dan, 2026-09-03): before the fix the ask-matt gate re-armed ultra every
  turn, so `/caveman lite` lasted one prompt. Now only the plugin tracker writes
  `~/.claude/.caveman-active`; gate, reminder hook and lint read it.
- **Standards no-counts ruling** (Dan, 2026-08-26): during a `/maintain-repo` sweep of
  aac-contract-builder, stripped "22 patterns", "~20 of 35 checklist items" and a Status column from
  four surfaces in one commit. See [[state-a-standing-rule-once]].
