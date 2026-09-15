---
name: session-check
description: Engine behind the session gate — check.js runs the git/clasp/test/ticket checks for any repo. Invoked automatically by hooks/session-gate.js; /session-start and /session-end re-print its report. Not a flow skill; do not invoke it to answer a user request.
disable-model-invocation: true
metadata:
  modified: "2026-09-15T22:35:31Z"
  previous-modified: "2026-09-15T18:30:29Z"
  revision: "8"
  content-sha: "ff13b17ffe64"
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

Regression tests live next to it: `node --test check.test.js identity.test.js` from this directory.

## Related

- `~/.claude/hooks/session-gate.js` — runs this on SessionStart / SessionEnd / UserPromptSubmit
- `/session-start`, `/session-end` — re-print the cached report
