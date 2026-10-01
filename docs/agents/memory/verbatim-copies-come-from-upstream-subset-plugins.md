---
name: verbatim-copies-come-from-upstream-subset-plugins
description: "A skill that is a verbatim copy of another repo's never ships in aac-skills (Dan, 2026-10-01): it is a git-subdir entry of this marketplace listing the upstream directories to load, and the cloud hook replays the same entry"
metadata:
  node_type: memory
  type: feedback
  modified: 2026-10-01T18:30:00Z
---

Dan, 2026-10-01, after a provenance audit of the payload (every file hashed against every commit
of six upstream repos): "drop everything that is a verbatim copy for its upstream payload. kill
writing-guidelines". Twenty directories left `aac-skills/`: twelve mattpocock/skills
copies, five vercel-labs/agent-skills copies, agent-browser, find-skills, and writing-guidelines
(killed, no replacement).

**The mechanism.** `UPSTREAM_PLUGINS` in `tools/build-cloud-plugin.py` emits one plugin entry per
upstream into `.claude-plugin/marketplace.json`: `source` is `git-subdir` at the upstream repo's
`skills` path on `main`, `strict: false`, and `skills` lists only the directories to load
(`./engineering/tdd`, `./productivity/grill-me`, ...). A desktop installs
`<name>@claude-dotfiles` like any plugin; the plugin version is the upstream commit SHA, so the
marketplace's `autoUpdate` follows the branch head. A container clones no marketplace
(`SKIP_PLUGIN_MARKETPLACE=true`), so `.claude/hooks/upstream-skills.sh` reads the same entries
and copies only the listed directories into `~/.claude/skills/`.

**Measured 2026-10-01** in an isolated `CLAUDE_CONFIG_DIR`: `claude plugin install` of such an
entry loads exactly the listed skills (`claude plugin details` showed `grill-me, tdd` for a
two-item list), nested paths included, and the skill's name is the SKILL.md frontmatter `name`
(`vercel-composition-patterns` from the directory `composition-patterns`). The cache holds the
whole subdir; only the listed directories load.

**Why the subset matters.** The locally edited copies (ask-matt, code-review, triage, to-tickets,
to-spec, implement, grill-with-docs, handoff, research, wayfinder, diagnosing-bugs,
setup-matt-pocock-skills) stay in `aac-skills/`; listing their upstream directory too would put
two skills of one name in a session.

**A one-line frontmatter flip is a local edit, not a verbatim copy.** The first cut of PR 1217
dropped to-spec because its only local line was `disable-model-invocation: false`; Dan reverted
it the same day ("revert /to-spec") and asked for the same flag on to-tickets, which already had
it. The ask-matt flows call both, and upstream's `true` would stop the model from loading them.
The stand-in was the similarity ratio: a near-total match read as "verbatim" where the diff
itself said what the line did. Read the local-only lines, never the score; the hook test now asserts
both flags. The same guard keeps writing-guidelines out. Two copies
stay vendored because upstream retired them: resolving-merge-conflicts (deleted in
mattpocock/skills daa01d8) and writing-great-skills (renamed to writing-for-agents in 1fc6573).
`tests/bootstrap-assert.py` fails the payload if any dropped name comes back;
`tools/upstream-skills-hook.test.js` pins the hook's subset copy and the marketplace entries.

**How to apply:** to add an upstream skill, add its directory to the right `UPSTREAM_PLUGINS`
entry and rebuild; never copy it into `aac-skills/`. To take a local edit on one, move it the
other way: vendor it (full-history diff first, see
[[vendored-copy-provenance-needs-upstream-history]]) and remove it from the entry in the same
commit.

Source: https://github.com/surreptakos/claude-dotfiles/pull/1217, tools/build-cloud-plugin.py, .claude/hooks/upstream-skills.sh, tools/upstream-skills-hook.test.js, tests/bootstrap-assert.py, https://github.com/surreptakos/claude-dotfiles/issues/928
