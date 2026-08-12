# Where these eight skill directories came from

Copied 2026-08-11 out of **session-scoped** installs, which is why `find ~/.claude -name SKILL.md`
used to miss them. They were callable but not durable: the source paths are keyed by session id and
disappear when the session's plugin cache is cleared.

## Sources

Seven from the Anthropic **`design`** plugin v1.2.0 (namespaced `design:<name>` when invoked from the
plugin, plain `<name>` from here):

    AppData/Roaming/Claude/local-agent-mode-sessions/<host-session>/<session>/rpm/
      plugin_01XXJmxLXPEhPMmnxmrgntNw/skills/

- `accessibility-review`
- `design-critique`
- `design-handoff`
- `design-system`
- `research-synthesis`
- `user-research`
- `ux-copy`

One from the **`anthropic-skills`** bundle (83 files, 5.5 MB — most of it `canvas-fonts/*.ttf`):

    AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/<session>/<host-session>/skills/

- `canvas-design`

## Not copyable

`artifact-design`, `artifact-diagramming`, `artifact-capabilities`, `dataviz`, `update-config` and the
other unprefixed skills are compiled into `claude.exe` — no directory exists for them on disk. A
`find` for those names returns nothing, and that is not evidence they are unavailable.

## What they are, for the AAC board question

All seven `design` skills are Markdown **report templates** — headings and tables to fill in. No code,
no linter, no exit code. `/design-system audit` prints a table with a column for "instances of
hardcoded hex"; a human or model still has to count them. Compare `_adherence.oxlintrc.json` in the
"AAC Sales Reporting" design system (`fb594320-be4c-40f6-bf77-416e5ecea664`), which declares the same
constraints as oxlint selectors a machine can fail a build on. The skills describe adherence; that
file enforces it.

`canvas-design` outputs `.png` / `.pdf` static art. It is not a board authoring surface.

## Rollback

    rm -rf ~/.claude/skills/{accessibility-review,design-critique,design-handoff,design-system,research-synthesis,user-research,ux-copy,canvas-design}
    rm ~/.claude/skills/PROVENANCE-design-skills.md
