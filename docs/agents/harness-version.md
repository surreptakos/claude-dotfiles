# Harness version

    harness-version: 30

Installed/upgraded: 2026-09-19 by the `project-harness` skill (v30: the cloud bootstrap hook is wired as `bash "<path>"` and staged 100755 so a Windows commit cannot silence it, and the governance hooks it merges are seated for settings.json instead of carrying the `${CLAUDE_PLUGIN_ROOT}` Claude Code refuses there, issue 614; v29: the auto-mode rule covers
attended cloud sessions and names every classifier category seen since the 245 ruling, and
`add-cloud-plugin.js` reads that rule out of `templates/claude-settings.json` instead of repeating
it, issue 543; v28: the bootstrap hook writes a FAILED marker and a STOP line on a clone or payload failure, gh installs before the clone, issue 483; v27: step 16 delivers the cloud
bootstrap hook (`.claude/hooks/session-start.sh` + its `SessionStart` entry) and the auto-mode
posture to any repo, issue 218; v26: `templates/dashboard.yml`'s `issues.types` trimmed to `[opened, closed]` per the 2026-09-16 Actions-quota ruling, issue 453; v25: `tracker-audit.js`'s `## Blocked by` section ends at its claim, not at end-of-body, issue 364 — backfilled with the missing v23 row by issue 434; v24: the pre-commit gate unsets `GIT_PREFIX` alongside the rest of git’s hook environment, issue 406; v23: no test-suite spawn inherits `NODE_TEST_CONTEXT`, issue 395; v22 narrowed two tracker-audit advisories for meta-tickets, issue 374; v21 added `deleted-subject?`, issue 361; v20 made the harness `tracker-audit.js` a generated copy of this repo's own, issue 336).

This file exists so "which generation of the harness does this repo have?" is a question you can
answer by reading, instead of by remembering. Before this marker, a new harness capability only
reached the repos someone happened to re-harness.

Do not hand-edit the number. It is bumped by the skill when it installs or upgrades. The list of what
each version comprises lives in the skill's `SKILL.md` ("Upgrading an existing install") — one copy,
so it cannot disagree with itself across repos.
