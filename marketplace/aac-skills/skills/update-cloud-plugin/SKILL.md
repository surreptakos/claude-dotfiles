---
name: update-cloud-plugin
description: Rebuild and republish the aac-skills plugin. Use when the session-end cloud-plugin sweep reports drift or no recorded upload, when cloud or Cowork sessions are missing a skill, after editing a skill that must reach claude.ai/code, or to upload a skill zip to a claude.ai Skills page.
metadata:
  modified: '2026-09-25T23:18:11Z'
  previous-modified: '2026-09-24T05:28:01Z'
  revision: '9'
  content-sha: 2c6f93038916
---

# Update the cloud plugin

> **Packaged copy.** A cloud session runs none of this machine's hooks, so the commands below
> call the plugin's own bundled scripts. Nothing is cached and `--refresh` does not apply:
> every run is fresh.

**One plugin.** `aac-skills` — every skill in the repo's hand-edited `aac-skills/` tree, packaged
by `tools/build-cloud-plugin.py` and served from the private marketplace at
`surreptakos/claude-dotfiles`. (`dan-skills` is retired: no account or zip carries that name.)

## Three skill channels, and the surface each serves

1. **Local** — `~/.claude/skills`. Retired for the aac skills (issue 734): pull no longer writes
   it, so the desktop session takes them from the plugin as `aac-skills:<name>`, installed at user
   scope (channel 2). The sweep still fingerprints whatever tree an older pull left there.
2. **Project-settings marketplace install** — each repo's `.claude/settings.json` declares
   `extraKnownMarketplaces` + `enabledPlugins`, so a cloud claude.ai/code session clones the
   marketplace after git credentials are wired and loads every packaged skill plus the plugin's
   SessionStart hook. Serves **cloud claude.ai/code sessions**, and any machine that runs
   `claude plugin install aac-skills@claude-dotfiles`. Installed per repo by `project-harness`
   **step 16** (`node ${CLAUDE_PLUGIN_ROOT}/skills/project-harness/templates/add-cloud-plugin.js <repo-root>`).
3. **Account Skills pages** — individual skills uploaded at `claude.ai/settings/customize` > Skills
   or admin-settings > Skills. Serves **Cowork and other claude.ai chat surfaces**, and is
   invisible to everything in this repo — check it before concluding a skill is missing from the
   packager. Its cache, upload steps and the two other plugins uploaded there are in
   [skills-page-upload.md](skills-page-upload.md).

**Cloud claude.ai/code sessions read channel 2 only** — the repo's `.claude/settings.json`. They
load no account-enabled plugins (the account-level sync returns zero,
`plugins_sync_no_changes count:0` in the session diag log), and the environment setup script runs
before git credentials exist, so `claude plugin marketplace add` fails there on a private clone.
Uploading a plugin to an account reaches none of them.

A local machine refreshes with:

```bash
claude plugin marketplace update claude-dotfiles && claude plugin update aac-skills
```

## 1. See what drifted

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/session-check/cloud-plugin-sweep.js"
```

Exit 0 in sync, 1 drift or never uploaded, 2 could not check — **2 is never a pass**. In sync
means there is nothing to do; say so and stop.

## 2. Rebuild the plugin

From a claude-dotfiles checkout — `aac-skills/` there is the only skill source, on the desktop and
in a container alike:

```bash
python3 tools/build-cloud-plugin.py
```

`--home` names the home every skill body is spelled against and is folded out of each content
hash. It defaults to the owner's, which is what CI checks with; pass it only when the owner's home
has moved (claude-dotfiles `CLAUDE.md` spells the flag next to CI's). CI (`skill-stamps.yml`)
checks that a rebuild from `aac-skills/` reproduces the committed payload.

Done when it exits 0. Non-zero means at least one skill could not be packaged; it prints which and
why — fix that first, because a partial plugin silently drops skills from every surface it
reaches. Note the version it prints (a UTC-monotonic date, e.g. `2026.9.112109`) to check against
the surface later.

## 3. Publish through the marketplace (primary channel)

Commit the rebuild on a branch and merge it to `master`. The packager has already refreshed
`marketplace/aac-skills/` and `.claude-plugin/marketplace.json` and rotated the four skill stamps
(`modified`, `previous-modified`, `revision`, `content-sha`) on any skill whose content hash moved,
so the branch carries the whole publish. **The merge is the release** — every machine with the
plugin installed and every cloud session with the repo declared picks it up on the next
`claude plugin marketplace update claude-dotfiles`.

## 4. Verify

The merge is the upload for every skill the plugin serves, so there is no claude.ai step. Record
the publish for this machine, then confirm:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/session-check/cloud-plugin-sweep.js" --stamp
node "${CLAUDE_PLUGIN_ROOT}/skills/session-check/cloud-plugin-sweep.js"
```

Done when it prints `cloud plugin is current`. A later edit moves the fingerprint and the sweep
reports drift, naming the skill — that is the loop closing, not a bug.

## Skills-page fallback (channel 3)

When a skill must reach Cowork or another claude.ai chat surface, or the owner asks for a zip, the
marketplace cannot help: follow [skills-page-upload.md](skills-page-upload.md). It needs no sweep
stamp — the sweep does not track that channel.
