# Harness version

    harness-version: 23

Installed/upgraded: 2026-09-16 by the `project-harness` skill (v23: no test-suite spawn inherits `NODE_TEST_CONTEXT`, issue 395; v22 narrowed two tracker-audit advisories for meta-tickets, issue 374; v21 added `deleted-subject?`, issue 361; v20 made the harness `tracker-audit.js` a generated copy of this repo's own, issue 336).

This file exists so "which generation of the harness does this repo have?" is a question you can
answer by reading, instead of by remembering. Before this marker, a new harness capability only
reached the repos someone happened to re-harness.

Do not hand-edit the number. It is bumped by the skill when it installs or upgrades. The list of what
each version comprises lives in the skill's `SKILL.md` ("Upgrading an existing install") — one copy,
so it cannot disagree with itself across repos.
