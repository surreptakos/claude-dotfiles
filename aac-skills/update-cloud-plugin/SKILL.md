---
name: update-cloud-plugin
description: Republish the aac-skills plugin, or upload a skill zip to a claude.ai Skills page. Use when the cloud-plugin sweep reports drift, a cloud or Cowork session is missing a skill, or an edited skill must reach claude.ai/code.
metadata:
  modified: "2026-10-02T15:37:15Z"
  previous-modified: "2026-09-29T22:36:17Z"
  revision: "12"
  content-sha: "870adaeb1775"
---

# Update the cloud plugin

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
node "$HOME/.claude/skills/session-check/cloud-plugin-sweep.js"
```

Exit 0 in sync, 1 drift or never uploaded, 2 could not check — **2 is never a pass**. In sync
means there is nothing to do; say so and stop.

## 2. Rebuild the plugin

From a claude-dotfiles checkout — its `aac-skills/` is the only skill source, on the desktop and in
a container alike:

```bash
python3 tools/build-cloud-plugin.py
```

`--home` defaults to the owner's home, the one CI checks against; pass it only when that home has
moved. CI (`skill-stamps.yml`) checks that a rebuild from `aac-skills/` reproduces the committed
payload.

Done when it exits 0. Non-zero names each skill that could not be packaged and why; fix those first,
because a partial plugin silently drops skills from every surface it reaches. Note the version it
prints (e.g. `2026.9.112109`) to match against the surface later.

## 3. Publish through the marketplace

Commit the rebuild on a branch and merge it to `master`. The packager has already refreshed
`marketplace/aac-skills/` and `.claude-plugin/marketplace.json` and rotated the skill stamps on any
skill whose content hash moved, so the branch carries the whole publish. **The merge is the
release**: every machine with the plugin installed and every cloud session with the repo declared
picks it up on its next marketplace refresh.

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
node "$HOME/.claude/skills/session-check/cloud-plugin-sweep.js" --stamp
node "$HOME/.claude/skills/session-check/cloud-plugin-sweep.js"
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
