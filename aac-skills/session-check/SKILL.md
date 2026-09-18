---
name: session-check
description: Engine behind the session gate — check.js runs the git/clasp/test/ticket checks for any repo. The hooks call it; /session-start and /session-end re-print its report.
disable-model-invocation: true
metadata:
  modified: "2026-09-18T17:39:10Z"
  previous-modified: "2026-09-18T15:52:50Z"
  revision: "22"
  content-sha: "fd3b4a93a3c9"
---

# Session check (engine)

`check.js` is the single global engine the session hooks run — one copy, shared by every repo.
This `SKILL.md` exists so the folder is a well-formed skill for tooling that expects one (the
dotfiles restore test asserts every junctioned skill carries a `SKILL.md`). To read its findings,
use `/session-start` or `/session-end`; run the engine by hand when the engine itself is what you
are debugging:

```bash
node ~/.claude/skills/session-check/check.js          # start-of-session checks
node ~/.claude/skills/session-check/check.js --end    # adds release gates
```

Everything is universal (git), auto-detected, or read from an optional `.claude/session.json`
(`test`, `testTimeoutMs`, `ticketLabel`, `releaseGates`, `checks`, `note`). Exit 1 reports
STOP-level findings from a run that completed.

At `--end` the test command is skipped on a committed, pushed head in a repo with
`.github/workflows`: pre-commit ran the suite on each commit and CI runs it on the pushed head,
so a third run learns nothing. A dirty tree, an unpushed commit, or no upstream still runs it.

A `checks` entry may carry `"host": "desktop"` (or `"cloud"`). A check whose host is not this one
is reported as `skipped (<host>-only)` and not run — a desktop-only sweep that can only exit 2 in a
container is noise, and noise is what gets the whole report skimmed past.

The **Account** section (`identity.js`) reads `~/.claude/accounts.json` — which Claude account
owns which repo and desktop routine — and compares it with the account the session runs under
(desktop: the host-session file's path; CLI: `oauthAccount` in the profile's `.claude.json`;
cloud: unknown, so unchecked). Findings there carry warning severity by ruling.

Regression tests live next to it: `node --test *.test.js` from this directory — all six files, and
they assume nothing about where this copy is installed (issue 300: two of them located "this repo"
by counting three directories up, which is the home directory here, and they were red). CI runs
the same files twice, from the claude-dotfiles mirror and from a copy outside any checkout:
`.github/workflows/skill-tests.yml`, and the repo's own test command in `.claude/session.json`.

## Related

- `~/.claude/hooks/session-gate.js` — runs this on SessionStart / SessionEnd / UserPromptSubmit
- `/session-start`, `/session-end` — re-print the cached report
