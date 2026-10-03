---
name: session-check
description: The session-gate engine (check.js). Run it by hand only to debug the engine; /session-start and /session-end read its report.
metadata:
  disable-model-invocation: 'true'
  modified: '2026-10-03T20:18:46Z'
  previous-modified: '2026-10-02T20:04:56Z'
  revision: '53'
  content-sha: cff1db92538a
---

# Session check (engine)

> **Packaged copy.** A cloud session runs none of this machine's hooks, so the commands below
> call the plugin's own bundled scripts. Nothing is cached and `--refresh` does not apply:
> every run is fresh.

`check.js` is the one engine the session-gate hook runs, for any repo. To read its findings, use
`/session-start` or `/session-end`. Run it by hand when the engine itself is what you are debugging:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js          # start-of-session checks
node ${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js --end    # adds release gates
```

Exit 1 reports STOP-level findings from a run that completed. The header comment of `check.js` is
the reference for every detection, every optional `.claude/session.json` key, and when `--end`
skips the test command. This `SKILL.md` exists because the plugin packager
(`tools/build-cloud-plugin.py`) ships only a directory that carries one, and the plugin is how
`check.js` reaches every session.

## Rulings the engine encodes

- **Hung release gate** (issue 818). Each `releaseGates` command runs under `gateTimeoutMs`
  (default 300000 ms); a timeout is a STOP naming it. A gate that printed a `PASS` verdict line
  before hanging (a gas-run-driven gate that never returns) is a `!!` quoting that line instead:
  the gate already passed the work.
- **End gate** (issue 622). At `--end`, three checks nothing can talk past, each skipped where the
  file it reads is absent: `tools/skill-stamps.py check aac-skills` (a skill edited without a
  re-stamp is a STOP); the files this branch touched against the credential patterns parsed out of
  `lib/manifest.ps1` (read, never restated, so it is the list `Assert-NoSecrets` uses); and every
  hook script `profile/claude/settings.json` names that this repo carries (`~/.claude/hooks/…` →
  `profile/claude/hooks/…`), which must exist and, for Python, import cleanly. A command naming
  anything else is reported unchecked, never passed. `SESSION_END_GATE_ROOT` repoints the third
  check at a fixture tree, for tests and demonstrations only.
- **Host-only checks.** A `checks` entry with `"host": "desktop"` (or `"cloud"`) reports
  `skipped (<host>-only)` on the other host and does not run: a check that can only exit 2 there
  is noise, and noise gets the whole report skimmed past.
- **Account** (`identity.js`; owner ruling 2026-09-25, issue 714). Either of the owner's accounts
  in `~/.claude/accounts.json` may work any repo, so the only finding is a session under an
  unregistered account, and it is a warning by ruling.
- **Pull nudge** (`pull-nudge.js`, issue 735). Desktop, claude-dotfiles checkout only: one line
  naming the pull command, printed only when a merge since the last `sync.ps1 -Mode pull` touched
  a path `Get-DotfileItems` in `lib/manifest.ps1` whitelists. A merge that moved only
  plugin-carried content stays silent.

## Tests

`node --test *.test.js` from this directory. Each test locates its fixtures relative to itself and
assumes nothing about where this copy is installed (issue 300: two located "this repo" by counting
three directories up, which is the home directory in an installed copy, and they were red).
`.github/workflows/skill-tests.yml` runs them a second time from a copy outside any checkout,
which is the run that catches that.

## Related

- The plugin's `hooks/scripts/session-gate.js` (source: claude-dotfiles
  `profile/claude/hooks/session-gate.js`) runs this on SessionStart, SessionEnd and
  UserPromptSubmit.
