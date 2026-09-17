---
name: update-cloud-plugin
description: Rebuild and republish the aac-skills plugin (the single package built from ~/.claude/skills plus the repo aac-skills/ tree) when the session-end sweep reports drift. Marketplace push is the primary channel; zip upload is the fallback for claude.ai Skills pages. Use when the session-end cloud-skills sweep reports drift or no recorded upload, when the user says the cloud sessions are missing a skill, or after adding or editing a skill that should reach claude.ai/code and Cowork.
metadata:
  modified: '2026-09-14T20:25:02Z'
  previous-modified: '2026-09-11T22:43:49Z'
  revision: '4'
  content-sha: 424cc9429dd7
---

# Update the cloud plugin

> **Packaged copy.** A cloud session runs none of this machine's hooks, so the commands below
> call the plugin's own bundled scripts. Nothing is cached and `--refresh` does not apply:
> every run is fresh.

**One plugin.** `aac-skills` — Dan's personal set from `~/.claude/skills` merged with the AAC team
skills from the repo's hand-edited `aac-skills/` tree by `tools/build-cloud-plugin.py`. Served from
the private marketplace at `surreptakos/claude-dotfiles`. `dan-skills` is retired — the plugin name
does not exist on any account or in any zip.

## Three skill channels, and the surface each serves

1. **Local** — `~/.claude/skills` plus `~/.agents/skills` junctions. What `sync.ps1` mirrors into
   claude-dotfiles, what the sweep fingerprints, what a fresh machine restores. Serves the desktop
   Claude Code session on this machine.
2. **Project-settings marketplace install** — each repo's `.claude/settings.json` declares
   `extraKnownMarketplaces` + `enabledPlugins`, so a cloud claude.ai/code session clones the
   marketplace itself after git credentials are wired and loads every packaged skill plus the
   plugin's SessionStart hook. Serves **cloud claude.ai/code sessions**, and any local machine that
   runs `claude plugin install aac-skills@claude-dotfiles`. Installed per repo by `project-harness`
   **step 16** (`node ${CLAUDE_PLUGIN_ROOT}/skills/project-harness/templates/add-cloud-plugin.js <repo-root>`);
   verified in a cloud container (claude-dotfiles#100, 2026-09-09) loading all packaged skills from
   a fresh startup.
3. **Account Skills pages** — individual skills uploaded at `claude.ai/settings/customize` > Skills
   or admin-settings > Skills, cached on disk at
   `%APPDATA%\Claude\local-agent-mode-sessions\skills-plugin\<orgUuid>\<accountUuid>\skills\`
   beside a `manifest.json`. Namespaced by the org's display name; `creatorType` is `anthropic` for
   the stock set and `user` for an upload. Serves **Cowork and other claude.ai chat surfaces**.
   Invisible to everything in this repo — check it before concluding a skill is missing from the
   packager. The manifest does NOT distinguish org-scoped from personal; every uploaded skill is
   `creatorType: user`, and the org-vs-personal scope lives only in claude.ai.

**Cloud claude.ai/code containers do NOT load account-enabled plugins.** The claude.ai account-level
plugin sync returns zero plugins for the account (`plugins_sync_no_changes count:0` in the session
diag log), and the cloud environment setup script runs before the session's git credentials exist,
so `claude plugin marketplace add` fails there on a private clone. Cloud sessions read channel 2
only — the repo's `.claude/settings.json`. Uploading a plugin to an account does nothing for them.

A local machine refreshes with:

```bash
claude plugin marketplace update claude-dotfiles && claude plugin update aac-skills
```

Installed at user scope 2026-08-31 for both profiles.

## 1. See what drifted

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/session-check/cloud-plugin-sweep.js"
```

Exit 0 in sync, 1 drift or never uploaded, 2 could not check — **2 is never a pass**. In sync means
there is nothing to do; say so and stop.

## 2. Rebuild the plugin

Two packager routes, same output, different source of truth:

- **Local rebuild** (this machine's live tree is the truth — the usual case):

  ```bash
  py -3 "$HOME/Claude/Projects/Meta/claude-dotfiles/tools/build-cloud-plugin.py"
  ```

- **From-mirror rebuild** (rebuild from the repo mirror instead of `~/.claude/skills`; used when no
  live tree exists — a cloud session working on a branch, or CI verifying a rebuild is
  reproducible):

  ```bash
  py -3 tools/build-cloud-plugin.py --from-mirror --home '__USERHOME__'
  ```

  `--home` substitutes the owner's path back where the mirror holds home-path tokens (see
  `sync.ps1` `ConvertTo-Tokens`), so the payload matches one built on that machine. CI
  (`skill-stamps.yml`) checks exactly this: a rebuild from the mirror must reproduce the committed
  payload.

Exit non-zero means at least one skill could not be packaged; it prints which and why. Fix that
before publishing — a partial plugin silently drops skills from every surface it reaches. Note the
version it prints (a UTC-monotonic date, e.g. `2026.9.112109`); it gets checked against the surface
later.

## 3. Publish through the marketplace (primary channel)

```powershell
cd "$HOME\Claude\Projects\Meta\claude-dotfiles"; .\sync.ps1 -Mode push -Commit "chore: rebuild aac-skills plugin"; git push
```

`sync.ps1 -Mode push` refreshes `marketplace/aac-skills/` and `.claude-plugin/marketplace.json` from
the live tree on every push and rotates the four skill stamps (`modified`, `previous-modified`,
`revision`, `content-sha`) on any skill whose content hash moved. Every machine and every cloud
session with the repo declared (channels 1 and 2) picks it up on the next
`claude plugin marketplace update claude-dotfiles`. Session-end hooks already run the push
automatically on the main checkout; run this by hand when a session is on a branch or in a
worktree, where the auto-push refuses.

## 4. Zip fallback for claude.ai Skills pages

The Skills pages (channel 3 above) are the only surface that has no marketplace path — a plugin
install cannot reach them. Upload the individual skill's zip to
`claude.ai/settings/customize` > Skills (per-user) or admin-settings > Skills (org-wide). One skill
per upload; that surface has no bulk import.

**The account matters more than the upload.** Dan runs on two accounts —
`djgatsakos@gmail.com` (personal, the cloud claude.ai/code account) and
`dgatsakos@activealarm.com` (Active Alarm team + a personal org). Which login the browser holds
decides where the upload lands. Read the signed-in email out of the profile menu before believing
an upload will reach anywhere useful.

Default path: `SendUserFile` the built zip and let the owner upload it. One drag, no account
switching, no credentials, works regardless of which login the browser holds.

Only upload yourself when the browser is signed into the right account **and** the owner said yes
in chat — it replaces a skill on their account, which is an account settings change. Show the drift
summary and the skill count so the answer is informed. No standing approval carries over.

Browser mechanics when a self-upload is unavoidable:

1. Open `https://claude.ai/settings/customize`, Skills section.
2. If replacing, open the existing row and delete it. Same-name uploads OVERWRITE for plugins, but
   individual Skills-page skills upsert; deleting first is only needed to change the name.
3. Add → Upload skill.
4. Attach the zip by finding the `input[type=file]` element and setting the file on it directly.
   **Never click the file-picker button** — it opens an OS dialog the browser tools cannot drive,
   and the tab is then stuck.
5. Submit.

Validator rejections, all seen in practice:

- `SKILL.md description cannot contain XML tags` — a description holds something like
  `<ViewTransition>`. The packager strips these; if one survives, its regex missed a form.
- frontmatter key rejected — only `name`, `description`, `allowed-tools`, `license`, `metadata`,
  `compatibility` are allowed. The packager moves the rest under `metadata:`.
- `Plugin contains a top-level bin/ directory` — repacked marketplace plugins only; `aac-skills`
  ships no `bin/`.

A rejection means the package is wrong, not the upload. Fix the packager, rebuild, upload again.

## 5. Verify — no manual stamp step

`sync.ps1 -Mode push` stamps the cloud-plugin sweep as a side effect of packaging (right after it
rebuilds `marketplace/aac-skills/`). The marketplace push IS the upload for every skill the plugin
serves, so nothing to run by hand here. After `git push`, confirm:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/session-check/cloud-plugin-sweep.js"
```

Must print `cloud plugin is current`. A later live edit will move the fingerprint and the sweep
will report drift, naming the skill — that is the loop closing, not a bug.

The zip fallback (step 4) is separate: it reaches only the claude.ai Skills pages (channel 3), not
the plugin, so it needs no stamp update either — the sweep does not track that channel.

## The other two plugins

`caveman` and `i-have-adhd` were uploaded from `~/.claude/plugins/cache/<name>/...`, repacked
without their top-level `bin/`. The sweep does not track them — it watches `~/.claude/skills`.
After `claude plugin update`, repack and re-upload those by hand if the cloud copy should match.
