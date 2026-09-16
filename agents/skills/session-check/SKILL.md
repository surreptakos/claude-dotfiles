---
name: session-check
description: Engine behind the session gate — check.js runs the git/clasp/test/ticket checks for any repo. Invoked automatically by hooks/session-gate.js; /session-start and /session-end re-print its report. Not a flow skill; do not invoke it to answer a user request.
disable-model-invocation: true
metadata:
  modified: "2026-09-16T02:50:41Z"
  previous-modified: "2026-09-16T02:47:41Z"
  revision: "11"
  content-sha: "584a59ffce38"
---

# Session check (engine)

`check.js` is the single global engine the session hooks run. It is not installed per repo, and it
is not meant to be picked as a skill — this file exists so the folder is a well-formed skill for
tooling that expects a `SKILL.md` (the dotfiles restore test asserts every junctioned skill carries
one).

Run it directly only when debugging the engine itself:

```bash
node ~/.claude/skills/session-check/check.js          # start-of-session checks
node ~/.claude/skills/session-check/check.js --end    # adds release gates
```

Everything is universal (git), auto-detected, or read from an optional `.claude/session.json`
(`test`, `testTimeoutMs`, `ticketLabel`, `releaseGates`, `checks`, `note`). Exit 1 means STOP-level
findings, not a crash.

The **Account** section (`identity.js`) reads `~/.claude/accounts.json` — which Claude account
owns which repo and desktop routine — and compares it with the account the session runs under
(desktop: the host-session file's path; CLI: `oauthAccount` in the profile's `.claude.json`;
cloud: unknown, so unchecked). Findings there are warnings by ruling, never STOP.

Regression tests live next to it: `node --test *.test.js` from this directory — all six files, and
they assume nothing about where this copy is installed (issue 300: two of them located "this repo"
by counting three directories up, which is the home directory here, and they were red). CI runs
the same files twice, from the claude-dotfiles mirror and from a copy outside any checkout:
`.github/workflows/skill-tests.yml`, and the repo's own test command in `.claude/session.json`.

## Related

- `~/.claude/hooks/session-gate.js` — runs this on SessionStart / SessionEnd / UserPromptSubmit
- `/session-start`, `/session-end` — re-print the cached report
