---
status: accepted
amends: 0002-jev-picks-the-route.md (its engineering-only scope, for skills only)
---

# Jev picks a skill beside the route, from every installed plugin

On 2026-10-02 the session's skill listing gave a description to only the first ~45 of ~270
installed skills. code-review, grill-with-docs, to-tickets and gas-deploy appeared as bare names,
although their SKILL.md files carry descriptions, so the model could not see that they fit a
message. Issue 1302 (parent 1296) makes the prompt hook name the skill instead.

The decision:

- **The skill pick is separate from the route.** On every prompt the `claude-prompt` hook names at
  most one installed skill: its qualified name, its description, and the instruction to open it
  with the Skill tool before acting. The route tree, the route gate and appeals are unchanged, and
  the skill pick never changes the route.
- **Every installed plugin's skills are candidates**, read from disk rather than from the session's
  listing: the user plugin registry's active install paths (one version per plugin, so old versions
  and trash under the plugin cache are never read), the Desktop org plugin folders beside the
  running plugin (`rpm/plugin_<id>/`), and the user skills folder. A skill marked
  `disable-model-invocation: true` is left out.
- **A local word-overlap score shortlists at most eight; Jev chooses one or `none`** as a Choice
  question in the request the prompt hook already makes. Nothing shortlisted means no question
  and no pick. Jev unavailable means no pick: the skill pick fails open and never blocks a turn.
- **The budget rises** (Dan, 2026-10-02): Jev's limit on that request goes from 3 to 10 seconds,
  and the prompt hook's own timeout from 5 to 15 seconds, in the plugin build and the Codex hooks
  file.
- **Each prompt's pick is logged** (`skill-pick.log` beside the gate's other logs): the pick, the
  shortlist and Jev's confidence, so a wrong pick can be audited.

## Considered options

- **A route per work skill.** Rejected again, as in ADR 0002: ask-matt is an engineering map, and
  each new leaf is one more place to mis-route. The skill pick names a skill without adding a leaf.
- **Keep the skill pick inside ADR 0002's engineering-only scope.** Rejected: the skills the
  listing hid include contract packages, review audits and Todoist triage, which are not
  engineering work. ADR 0002's scope still holds for routes; for skills it is widened to every
  installed plugin.
- **Send every skill to Jev.** Rejected: ~270 options in one Choice would outgrow the request's
  budget. The local shortlist keeps the question to at most nine options.
- **Read the session's skill listing.** Rejected: the listing is what dropped the descriptions.

## Consequences

The prompt hook reads the head of every installed SKILL.md on each prompt (a few hundred
milliseconds on the owner's desktop). A pick the model should not follow costs one Skill call. The
Codex `prompt` handler gets the 15-second timeout but no skill pick, since Codex has no Skill tool.
