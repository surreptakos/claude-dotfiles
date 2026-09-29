---
name: plugin-auto-updates-never-tell-dan
description: "The desktop aac-skills plugin updates itself: profile settings register the claude-dotfiles marketplace with autoUpdate true, so a merged payload reaches the PC after the next session start; never tell Dan to run claude plugin update (Dan, 2026-09-29). Check the registration, not a doc line, before relaying an install step"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 42142cbe-dafa-5bf0-83a2-8a2fe0b40517
  modified: 2026-09-29T22:50:00.000Z
---

Dan, 2026-09-29, after the third "run `claude plugin update` on the PC" in one evening: "why do
you keep telling me to do claude plugin update on my pc if it updates automatically".

**The fact.** `profile/claude/settings.json` registers the `claude-dotfiles` marketplace under
`extraKnownMarketplaces` with `autoUpdate: true`. Claude Code docs (host-marketplace, "Keep users
up to date"): with auto-update on, the background refresh after a session starts installs a plugin
whose computed version changed, using the machine's stored git credentials. The payload's
`plugin.json` version moves on every `tools/build-cloud-plugin.py` run, so every merge to master
is a version change the PC picks up on its own.

**The stand-in that caused it.** `CLAUDE.md` said "a desktop takes the skills and rules with
`claude plugin update`", and the update-cloud-plugin and ticket-fleet skills repeated the command
as the refresh step. An agent relayed the doc line instead of reading the registration. PR 1044
corrected all three.

**How to apply.** After a payload merge, the PC needs nothing; say so or say nothing. The manual
command is for an agent inside a running desktop session that cannot wait for the next start,
never an instruction to Dan. Before relaying any install or refresh step to him, open the
registration or settings that govern it; a sentence in a doc is a stand-in. The same reflex
applies to "owner" steps: a desktop session with `gh` and a logged-in browser does most of them
(to-tickets skill, "Human-only halves").

Source: PR 1044; https://code.claude.com/docs/en/plugins/host-marketplace (Keep users up to date).
