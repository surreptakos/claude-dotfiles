---
name: cloud-skips-third-party-marketplaces
description: "A claude.ai/code container sets SKIP_PLUGIN_MARKETPLACE=true: enabledPlugins in .claude/settings.json fetched only claude-plugins-official; third-party marketplaces never clone (2026-09-28, PR 928 follow-up)"
metadata:
  node_type: memory
  type: feedback
  modified: 2026-09-29T12:05:00Z
---

Declaring a third-party plugin in `.claude/settings.json` (`extraKnownMarketplaces` +
`enabledPlugins`) does not install it in a cloud container. Observed 2026-09-28 in a session that
started with caveman, i-have-adhd, typesafe, pyright-lsp and typescript-lsp declared:
`SKIP_PLUGIN_MARKETPLACE=true` in the environment, `known_marketplaces.json` held only
claude-plugins-official, the plugin cache held only pyright-lsp and typescript-lsp, and
`installed_plugins.json` stayed `{}`. The claude-dotfiles marketplace itself is skipped the same
way, which is why `session-start.sh` copies the payload by hand.

So a third-party plugin reaches a container only through a SessionStart hook that clones its repo
and copies what a plugin install would have registered: `caveman-bootstrap.sh` for caveman,
`upstream-skills.sh` for i-have-adhd, typesafe and, since 2026-09-29, travel-hacker
(borski/travel-hacking-toolkit). Keep the settings declaration anyway: it is what a desktop
installs from.

**What the hook copies (2026-09-29).** `skills/<name>/` with a `SKILL.md` to `~/.claude/skills/`,
a copy under `plugins/*/skills/<name>/` winning over the root one (the toolkit keeps its 8 scripted
skills there; its root `skills/` tree is SKILL.md only), `agents/*.md` to `~/.claude/agents/`, and
the servers of a root `.mcp.json` merged into `mcpServers` of `~/.claude.json` without touching a
server already there. Pinned by `tools/upstream-skills-hook.test.js` against a file:// fixture.

**Keys stay out of the repo.** The toolkit reads its API keys from the session environment
(`SEATS_AERO_API_KEY`, `DUFFEL_API_KEY_LIVE`, `IGNAV_API_KEY`, `AWARDWALLET_API_KEY`,
`AWARDWALLET_USER_ID`; more in its README). On Dan-Inspiron15 they are Windows user environment
variables, so every local session in either profile sees them; a container sees only what the
claude.ai environment variables carry, the same channel as the Zoho trio in
[[session-env-carries-zoho-and-gas-tokens]]. The five free MCP servers need no key.

Source: .claude/settings.json, profile/claude/plugins/known_marketplaces.json, profile/claude/plugins/installed_plugins.json, .claude/hooks/caveman-bootstrap.sh, .claude/hooks/upstream-skills.sh, tools/upstream-skills-hook.test.js, https://github.com/surreptakos/claude-dotfiles/issues/928
