---
name: session-check
description: Engine behind the session gate — check.js runs the git/clasp/test/ticket checks for any repo. The hooks call it; /session-start and /session-end re-print its report.
metadata:
  disable-model-invocation: 'true'
  modified: '2026-09-16T04:36:53Z'
  previous-modified: '2026-09-15T23:58:01Z'
  revision: '10'
  content-sha: cb9ee093b483
---

# Session check (engine)

> **Packaged copy.** A cloud session runs none of this machine's hooks, so the commands below
> call the plugin's own bundled scripts. Nothing is cached and `--refresh` does not apply:
> every run is fresh.

`check.js` is the single global engine the session hooks run — one copy, shared by every repo.
This `SKILL.md` exists so the folder is a well-formed skill for tooling that expects one (the
dotfiles restore test asserts every junctioned skill carries a `SKILL.md`). To read its findings,
use `/session-start` or `/session-end`; run the engine by hand when the engine itself is what you
are debugging:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js          # start-of-session checks
node ${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js --end    # adds release gates
```

Everything is universal (git), auto-detected, or read from an optional `.claude/session.json`
(`test`, `testTimeoutMs`, `ticketLabel`, `releaseGates`, `checks`, `note`). Exit 1 reports
STOP-level findings from a run that completed.

The **Account** section (`identity.js`) reads `~/.claude/accounts.json` — which Claude account
owns which repo and desktop routine — and compares it with the account the session runs under
(desktop: the host-session file's path; CLI: `oauthAccount` in the profile's `.claude.json`;
cloud: unknown, so unchecked). Findings there carry warning severity by ruling.

Regression tests live next to it: `node --test check.test.js identity.test.js` from this directory.

## Related

- `~/.claude/hooks/session-gate.js` — runs this on SessionStart / SessionEnd / UserPromptSubmit
- `/session-start`, `/session-end` — re-print the cached report
