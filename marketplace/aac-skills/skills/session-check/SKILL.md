---
name: session-check
description: Engine behind the session gate — check.js runs the git/clasp/test/ticket checks for any repo. The hooks call it; /session-start and /session-end re-print its report.
metadata:
  disable-model-invocation: 'true'
  modified: '2026-09-26T05:16:12Z'
  previous-modified: '2026-09-26T01:49:13Z'
  revision: '41'
  content-sha: 31c86ced949f
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
(`test`, `testTimeoutMs`, `ticketLabel`, `releaseGates`, `gateTimeoutMs`, `checks`, `note`). Exit 1
reports STOP-level findings from a run that completed.

At `--end` the test command is skipped on a committed, pushed head in a repo with
`.github/workflows`: pre-commit ran the suite on each commit and CI runs it on the pushed head,
so a third run learns nothing. A dirty tree, an unpushed commit, or no upstream still runs it — and
so does a head whose pre-commit gate was never in force: `core.hooksPath` not pointing at the repo's
`.githooks`, or a cloud container with no `aac-bootstrap` marker, where the gate is inert and the
suite's dependencies are not installed.

At `--end` each `releaseGates` command runs under a `gateTimeoutMs` timeout (default 300000 ms,
issue 818): a gate that never exits is a STOP naming the timeout, unless it had already printed a
`PASS` verdict line before hanging — a gas-run-driven gate that prints its verdict and then never
returns — in which case it is a `!!` warning naming the timeout and quoting the PASS line, not a
STOP on work the gate already passed.

At `--end` an **End gate** section runs three checks nothing can talk past (issue 622), each
skipped where the file it reads is absent, so only a repo carrying them pays for them:
`tools/skill-stamps.py check aac-skills` (a skill edited without a re-stamp is a STOP);
the files this branch touched against the credential patterns parsed out of `lib/manifest.ps1`
— the same list `Assert-NoSecrets` uses, read rather than restated; and every hook script
`profile/claude/settings.json` names that this repo carries (`~/.claude/hooks/…` →
`profile/claude/hooks/…`), which must exist and, for a Python one, import cleanly. A command
naming anything else is counted and said to be unchecked, never passed. `SESSION_END_GATE_ROOT`
repoints the third check at a fixture tree — tests and demonstrations only.

A `checks` entry may carry `"host": "desktop"` (or `"cloud"`). A check whose host is not this one
is reported as `skipped (<host>-only)` and not run — a desktop-only sweep that can only exit 2 in a
container is noise, and noise is what gets the whole report skimmed past.

The **Account** section (`identity.js`) reads `~/.claude/accounts.json` — which Claude account
owns which repo and desktop routine — and compares it with the account the session runs under
(desktop: the host-session file's path; CLI: `oauthAccount` in the profile's `.claude.json`;
cloud: unknown, so unchecked). Findings there carry warning severity by ruling.

In a claude-dotfiles checkout, on a desktop, a silent **pull nudge** (`pull-nudge.js`, issue 735)
compares `sync.ps1 -Mode pull`'s last recorded commit against the default branch, restricted to the
whitelist `lib/manifest.ps1`'s `Get-DotfileItems` names, and prints one line naming the pull command
only when a merge since then touched a whitelisted path — quiet on a merge that only moved
plugin-carried content, and quiet in every other repo.

Regression tests live next to it: `node --test *.test.js` from this directory — all eight files, and
they assume nothing about where this copy is installed (issue 300: two of them located "this repo"
by counting three directories up, which is the home directory here, and they were red). CI runs
the same files twice, from the claude-dotfiles mirror and from a copy outside any checkout:
`.github/workflows/skill-tests.yml`, and the repo's own test command in `.claude/session.json`.

## Related

- `~/.claude/hooks/session-gate.js` — runs this on SessionStart / SessionEnd / UserPromptSubmit
- `/session-start`, `/session-end` — re-print the cached report
