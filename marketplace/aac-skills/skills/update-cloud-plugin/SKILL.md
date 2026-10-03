---
name: update-cloud-plugin
description: Republish the aac-skills plugin, or upload a skill zip to a claude.ai Skills page. Use when the cloud-plugin sweep reports drift, a cloud or Cowork session is missing a skill, or an edited skill must reach claude.ai/code.
metadata:
  modified: '2026-10-03T20:19:08Z'
  previous-modified: '2026-10-02T15:37:15Z'
  revision: '13'
  content-sha: 091b44417a1c
---

# Update the cloud plugin

> **Packaged copy.** A cloud session runs none of this machine's hooks, so the commands below
> call the plugin's own bundled scripts. Nothing is cached and `--refresh` does not apply:
> every run is fresh.

**One plugin.** `aac-skills` — every skill in claude-dotfiles' hand-edited `aac-skills/` tree,
packaged by `tools/build-cloud-plugin.py` and served from the marketplace at
`surreptakos/claude-dotfiles` (a public repo since 2026-09-21). `dan-skills` is retired: no account
or zip carries that name.

The surface that lacks the skill picks the path. claude.ai/code sessions and every machine with the
plugin: steps 1–4. Cowork or another claude.ai chat surface, or a zip the owner asked for: the
marketplace cannot reach it, so follow [skills-page-upload.md](skills-page-upload.md) instead (no
sweep stamp; the sweep does not track that channel). The three channels at the end say which
surface reads what.

## 1. See what drifted

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/session-check/cloud-plugin-sweep.js"
```

Exit 0 in sync, 1 drift or never uploaded, 2 could not check — **2 is never a pass**. In sync
means there is nothing to do; say so and stop.

## 2. Stamp, and check it packages

From a claude-dotfiles checkout, on a branch — its `aac-skills/` is the only skill source, on the
desktop and in a container alike:

```bash
python3 tools/skill-stamps.py stamp aac-skills --home 'C:\Users\Dan'
python3 tools/build-cloud-plugin.py --home 'C:\Users\Dan' --no-marketplace --no-stamp-write
```

The second line builds into the gitignored `dist/` only. A branch never writes or commits
`marketplace/` or `.claude-plugin/marketplace.json` (issue 1308): master builds those.

Done when both exit 0. A non-zero build names each skill that could not be packaged and why; fix
those first, because a partial plugin silently drops skills from every surface it reaches.

## 3. Publish through the marketplace

Commit the sources on the branch and merge it to `master`. `plugin-payload.yml` then rebuilds
`marketplace/aac-skills/` and `.claude-plugin/marketplace.json` on master and commits them; done
when its run on the merge is green, and note the version that commit carries (e.g.
`2026.9.112109`) to match against the surface later. **The merge is the release**: every machine
with the plugin installed and every cloud session with the repo declared picks it up on its next
marketplace refresh.

A desktop refreshes itself: the profile's `settings.json` registers the marketplace with
`autoUpdate: true`, so the background refresh after the next session start installs the new
version. Tell the owner it arrives on its own; never tell him to run `claude plugin update` (Dan,
2026-09-29). Only a session that cannot wait for the next start runs the manual form itself:

```bash
claude plugin marketplace update claude-dotfiles && claude plugin update aac-skills
```

## 4. Verify

The merge is the upload for every skill the plugin serves, so there is no claude.ai step. Record
the publish for this machine, then confirm:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/session-check/cloud-plugin-sweep.js" --stamp
node "${CLAUDE_PLUGIN_ROOT}/skills/session-check/cloud-plugin-sweep.js"
```

Done when it prints `cloud plugin is current`. A later edit moves the fingerprint and the sweep
reports drift naming the skill: that is the loop closing, not a bug.

## The three skill channels

1. **Local** — `~/.claude/skills`. Retired for the aac skills (issue 734): pull no longer writes
   it, so a desktop session takes them from the plugin as `aac-skills:<name>`, installed at user
   scope (channel 2). The sweep still fingerprints whatever tree an older pull left there.
2. **Project-settings marketplace install** — each repo's `.claude/settings.json` declares
   `extraKnownMarketplaces` + `enabledPlugins`, so a cloud claude.ai/code session clones the
   marketplace after git credentials are wired and loads every packaged skill plus the plugin's
   SessionStart hook. Serves **cloud claude.ai/code sessions** and any machine that runs
   `claude plugin install aac-skills@claude-dotfiles`. Installed per repo by `project-harness`
   **step 16** (`templates/add-cloud-plugin.js`).
3. **Account Skills pages** — individual skills uploaded at `claude.ai/settings/customize` > Skills
   or admin-settings > Skills. Serves **Cowork and other claude.ai chat surfaces**, and is
   invisible to everything in this repo: check it before concluding a skill is missing from the
   packager. Its cache, upload steps and the two other plugins uploaded there are in
   [skills-page-upload.md](skills-page-upload.md).

**Cloud claude.ai/code sessions read channel 2 only.** They load no account-enabled plugins (the
account-level sync returns zero, `plugins_sync_no_changes count:0` in the session diag log), and the
environment setup script runs before git credentials exist, so `claude plugin marketplace add`
fails there on a private clone. Uploading a plugin to an account reaches none of them.
