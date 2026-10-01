---
name: vendored-copy-provenance-needs-upstream-history
description: "A vendored skill is judged against every upstream revision, never a grep or the upstream head alone; a verbatim copy never lives in aac-skills, it is a git-subdir marketplace entry listing the upstream dirs, and the cloud hook replays the entry (PR 928, PR 1217)"
metadata:
  node_type: memory
  type: feedback
  modified: 2026-10-01T19:30:00Z
---

## Telling a local edit from an upstream copy

To decide whether a copied skill (the matt-pocock set, anything under `aac-skills/` that came from
another repo) carries local edits, compare it with **the upstream repo's full history**: unshallow
the clone, and for each file find the upstream revision it is closest to; the lines left over are
the local edits. A match against some past revision means "old upstream copy", safe to resync.

Two stand-ins that gave the wrong answer on PR 928:
- a grep for local vocabulary (`claude-dotfiles`, `issue N`, `Dan`, `gh api`) classed 13 skills as
  wording-only; three of them (grill-with-docs, handoff, to-spec) carried real local rules with none
  of those words;
- a diff against the current upstream head alone mixes upstream drift with local edits and cannot
  tell them apart.

Also normalise before comparing: this repo stores the copies CRLF, and em-dash vs. other
punctuation churn upstream makes whole files look rewritten when the words are unchanged.

**A one-line frontmatter flip is a local edit, not a verbatim copy.** The first cut of PR 1217
dropped to-spec because its only local line was `disable-model-invocation: false`; Dan reverted
it the same day ("revert /to-spec") and asked for the same flag on to-tickets, which already had
it. The ask-matt flows call both, and upstream's `true` would stop the model from loading them.
The stand-in was the similarity ratio: a near-total match read as "verbatim" where the diff
itself said what the line did. Read the local-only lines, never the score; the hook test now
asserts both flags.

## Where a verbatim copy lives: an upstream-subset marketplace entry

Dan, 2026-10-01, after a provenance audit of the payload (every file hashed against every commit
of six upstream repos): "drop everything that is a verbatim copy for its upstream payload. kill
writing-guidelines". Twenty directories left `aac-skills/`: twelve mattpocock/skills
copies (eleven current ones plus writing-great-skills, the old name of writing-for-agents), five
vercel-labs/agent-skills copies, agent-browser, find-skills, and writing-guidelines (killed, no
replacement). grilling was on the list until master took a local edit on it the same day
(AskUserQuestion rounds, PR 1211): a copy that gains a local edit moves back to vendored and
out of the entry, which is what the merge did.

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
to-spec, implement, grill-with-docs, grilling, handoff, research, wayfinder, diagnosing-bugs,
setup-matt-pocock-skills) stay in `aac-skills/`; listing their upstream directory too would put
two skills of one name in a session. The same guard keeps writing-guidelines out. One copy
stays vendored because upstream deleted it with no successor: resolving-merge-conflicts
(mattpocock/skills daa01d8). A renamed upstream skill is not that case: writing-great-skills was
the old name of writing-for-agents (renamed in 1fc6573), so the old copy went and the ask-matt
gate's route became writing-for-agents (Dan, 2026-10-01: "yes, writing-great-skills gets
dropped"). `tests/bootstrap-assert.py` fails the payload if any dropped name comes back;
`tools/upstream-skills-hook.test.js` pins the hook's subset copy and the marketplace entries.

**How to apply:** to add an upstream skill, add its directory to the right `UPSTREAM_PLUGINS`
entry and rebuild; never copy it into `aac-skills/`. To take a local edit on one, move it the
other way: vendor it (full-history diff first, above) and remove it from the entry in the same
commit.

Source: https://github.com/surreptakos/claude-dotfiles/issues/928, https://github.com/surreptakos/claude-dotfiles/pull/1217, tools/build-cloud-plugin.py, .claude/hooks/upstream-skills.sh, tools/upstream-skills-hook.test.js, tests/bootstrap-assert.py

Unsourced facts, ticket: https://github.com/surreptakos/claude-dotfiles/issues/988
