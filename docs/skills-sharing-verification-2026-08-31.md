# Claude skills sharing verification

Verified 2026-08-31 against the supplied Claude Desktop session export, Claude Code 2.1.251 on this machine, the local Claude state, and current Anthropic documentation.

## Bottom line

Claude's final architectural direction was sound: a Git-backed plugin marketplace is the best common distribution source for reusable skills. Its surface model was not. Claude Code CLI, Code Desktop, Code on the web, Cowork, Chat, account Skills, and the API do not collapse into only “filesystem” and “account” surfaces.

The proposal is also not implemented yet. `surreptakos/claude-dotfiles` is private and currently has no `.claude-plugin/marketplace.json` or plugin payload. The proposed marketplace commands therefore cannot install `dan-skills@claude-dotfiles` today.

`claude plugin validate C:/Users/Dan/Claude/Projects/Meta/claude-dotfiles` confirms this with: `No manifest found in directory. Expected .claude-plugin/marketplace.json or .claude-plugin/plugin.json`.

## Claim check

| Claude claim | Verdict | Evidence |
|---|---|---|
| Claude Code CLI and local Code Desktop share plugin state | Confirmed on this Windows profile | Claude Code 2.1.251 lists `dan-skills@local-desktop-app-uploads`, installed at the exact time the Desktop upload wrote `~/.claude/plugins/installed_plugins.json` and `known_marketplaces.json`. Anthropic's [Code Desktop guide](https://code.claude.com/docs/en/desktop) describes the same installed marketplaces and plugin scopes as the CLI. |
| Web, Cowork, and cloud Claude Code are one account-level surface with no filesystem | False | Anthropic says custom plugins added in Desktop/Cowork are saved locally; Cowork installs Git marketplaces and checks their updates. Claude Code web uses fresh VMs and repo configuration. See [Use plugins in Claude](https://support.claude.com/en/articles/13837440-use-plugins-in-claude), [Install plugins in Cowork](https://claude.com/docs/cowork/guide/plugins), and [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web). |
| A Git marketplace plus plugin install is the right Code distribution mechanism | Correct direction | Anthropic recommends plugins for reusable, versioned, team-shared skills and supports Git marketplaces, private repositories, scopes, and updates. See [Create plugins](https://code.claude.com/docs/en/plugins) and [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces). |
| Committing `extraKnownMarketplaces` and `enabledPlugins` silently installs for every local session | False locally | Local users are prompted after trusting the folder and may skip installation. See [Claude Code settings](https://code.claude.com/docs/en/configuration) and [Discover plugins](https://code.claude.com/docs/en/discover-plugins). |
| The same committed keys install the plugin in Claude Code web | Confirmed, with access qualification | Code web documentation says repo-declared plugins install at session start if the marketplace source is network-accessible. User-scoped local plugins do not carry over. Private-source credentials still must exist in the cloud environment. See [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web). |
| The same committed keys cover Cowork when it opens a repo | Unsupported | Anthropic documents Cowork plugin installation through Customize, file upload, a Git marketplace URL, or organization provisioning. It does not document Cowork consuming a repo's Claude Code `.claude/settings.json`. See [Install plugins in Cowork](https://claude.com/docs/cowork/guide/plugins). |
| Repo-less cloud requires permanent per-account ZIP uploads | False/outdated | Cowork accepts a Git repository as a marketplace. Team/Enterprise owners can sync a private GitHub marketplace and distribute it to Chat and Cowork. ZIP upload remains a one-off/manual option. See [Manage organization plugins](https://support.claude.com/en/articles/13837433-manage-plugins-for-your-organization). |
| A same-name plugin must be deleted before re-upload | False for organization marketplaces | Current admin documentation says a same-name upload overwrites the previous version automatically. See [Manage organization plugins](https://support.claude.com/en/articles/13837433-manage-plugins-for-your-organization). |
| No CLI or API exists for skill upload | Too broad | Claude Code's plugin CLI has no command to upload a plugin to a claude.ai account. Anthropic Platform does have a Skills API and `ant skills create`, but that manages Platform workspace skills, not personal claude.ai Customize state. See [Managed Agents skills](https://platform.claude.com/docs/en/managed-agents/skills). |
| Private marketplace support was unknown | Mostly resolved | Claude Code explicitly supports private repositories through git credentials and provider tokens. Organization marketplaces support private/internal GitHub repositories through the Claude GitHub App. A second private marketplace used by Code web still needs cloud-accessible credentials; it is not guaranteed merely because the task repo cloned successfully. See [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) and [Manage organization plugins](https://support.claude.com/en/articles/13837433-manage-plugins-for-your-organization). |
| Account Skills are a distinct channel and can drift from filesystem/plugin skills | Confirmed | Anthropic documents uploaded custom skills as private to an individual account unless shared/provisioned. This machine has three account/org cache trees with 21, 33, and 27 skills, separate from `~/.claude/skills` and `~/.claude/plugins`. See [Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude). |

## Best sharing design

1. Make one plugin directory in one private Git marketplace repository the canonical source. Generate ZIPs or local mirrors from it; never edit those generated copies.
2. Local Claude Code CLI and Code Desktop: add the marketplace once at user scope, install the fully qualified plugin ID, and enable/update it there.
3. Claude Code web: declare the marketplace and plugin at project scope. For guaranteed private operation, give the cloud environment explicit read credentials or vendor project-required skills into that repo's `.claude/skills`.
4. Cowork and Chat on a Team/Enterprise work account: use an organization marketplace synced to the private GitHub repository. This provides versioned updates and centralized distribution without repeated ZIP uploads.
5. Personal Cowork/Chat: add the same Git marketplace through Customize. Use ZIP upload only when Git marketplace access is unavailable.
6. Standalone account Skills: reserve for Chat/Cowork-only workflows or individually shared skills. Do not maintain a second editable copy of a skill already shipped in the plugin.
7. API/Managed Agents: treat as a separate deployment target. Upload through the Skills API or mount a repository whose root contains `.claude/skills`.

## Documentation conflict

Anthropic's current pages disagree about Chat: the newer Help Center article says plugin skills work in web Chat, Desktop Chat, and Cowork, while the Cowork guide says plugins are not used in Chat. This is a current documentation inconsistency, not evidence for Claude's two-surface model. Validate Chat behavior in the live account before deleting account Skills used there.

## Local facts checked

- Claude Code: `2.1.251`.
- `claude plugin list --json` shows five installed plugins, including `dan-skills@local-desktop-app-uploads` version `2026.08.31`.
- `claude plugin marketplace list --json` shows the Desktop-created `local-desktop-app-uploads` marketplace in `~/.claude/plugins/marketplaces`.
- `surreptakos/claude-dotfiles` is private.
- Its current `master` tree has no marketplace manifest or distributable plugin directory.
- Claude Code's validator rejects that tree because no marketplace or plugin manifest exists.
- Its generated settings enable the local Desktop-upload copy, not `dan-skills@claude-dotfiles`.
