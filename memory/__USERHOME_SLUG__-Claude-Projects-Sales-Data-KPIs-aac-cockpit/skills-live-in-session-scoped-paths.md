---
name: skills-live-in-session-scoped-paths
description: A skill missing from ~/.claude is not missing — plugin and bundled skills live in session-scoped paths or inside claude.exe.
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4d5f5f05-e328-4aa4-88a9-2f1f0153c66e
  modified: 2026-08-11T21:33:30.864Z
---

`find ~/.claude -name SKILL.md` does NOT list every callable skill. I used it to tell Dan the `/design:*`
skills were "not on disk" while he was calling them in the same session — wrong, and he had to correct me.

Three tiers, verified 2026-08-11:

- **Global, durable** — `~/.claude/skills/` (the Matt Pocock suite: `implement`, `ask-matt`, `prototype`).
- **Session-scoped plugins** — `AppData/Roaming/Claude/local-agent-mode-sessions/<host-session>/<session>/rpm/plugin_<id>/skills/`.
  Directory names are opaque ids; read `<plugin>/.claude-plugin/plugin.json` for the real name. The Anthropic
  `design` plugin v1.2.0 was `plugin_01XXJmxLXPEhPMmnxmrgntNw`. The `anthropic-skills` bundle sits in a sibling
  `skills-plugin/<session>/<host-session>/skills/`. These paths are keyed by session id and do not survive.
- **Compiled into `claude.exe`** — `artifact-design`, `artifact-diagramming`, `artifact-capabilities`, `dataviz`,
  `update-config`. No directory exists anywhere; a `find` for them returns nothing and that proves nothing.

To make a session-scoped skill durable, copy its directory into `~/.claude/skills/<name>/` — it registers
unprefixed on the next listing (confirmed: the eight copied that day became callable without `design:`).
Provenance and rollback for that copy: `~/.claude/skills/PROVENANCE-design-skills.md`.

**The lesson that generalises:** absence from one search path is not absence. See
[[verify-before-filing-cite-the-check]] — the same failure, aimed at my own environment instead of at the repo.
