---
name: cloud-skips-third-party-marketplaces
description: "A claude.ai/code container sets SKIP_PLUGIN_MARKETPLACE=true: enabledPlugins in .claude/settings.json fetched only claude-plugins-official; third-party marketplaces never clone (2026-09-28, PR 928 follow-up)"
metadata:
  node_type: memory
  type: feedback
  modified: 2026-09-28T01:10:00Z
---

Declaring a third-party plugin in `.claude/settings.json` (`extraKnownMarketplaces` +
`enabledPlugins`) does not install it in a cloud container. Observed 2026-09-28 in a session that
started with caveman, i-have-adhd, typesafe, pyright-lsp and typescript-lsp declared:
`SKIP_PLUGIN_MARKETPLACE=true` in the environment, `known_marketplaces.json` held only
claude-plugins-official, the plugin cache held only pyright-lsp and typescript-lsp, and
`installed_plugins.json` stayed `{}`. The claude-dotfiles marketplace itself is skipped the same
way, which is why `session-start.sh` copies the payload by hand.

So a third-party plugin reaches a container only through a SessionStart hook that clones its repo
and copies `skills/<name>/` into `~/.claude/skills/`: `caveman-bootstrap.sh` for caveman,
`upstream-skills.sh` for i-have-adhd and typesafe. Keep the settings declaration anyway: it is what
a desktop installs from.

Source: .claude/settings.json, profile/claude/plugins/known_marketplaces.json, profile/claude/plugins/installed_plugins.json, .claude/hooks/caveman-bootstrap.sh, .claude/hooks/upstream-skills.sh, https://github.com/surreptakos/claude-dotfiles/issues/928
