---
name: three-skill-channels
description: "Skills reach a session by three routes; only one is in claude-dotfiles, and the account Skills cache is invisible to every tool here"
metadata: 
  node_type: memory
  type: project
  originSessionId: 422b7e48-b3a2-49db-ba3f-ef7dfd40388a
  modified: 2026-08-31T18:32:48.406Z
---

A skill offered in a session came from one of three places, and they are not interchangeable:

1. **Local** — `~/.claude/skills` plus `~/.agents/skills` junctions. Mirrored by `sync.ps1`,
   fingerprinted by `cloud-plugin-sweep.js`, restored on a fresh machine.
2. **Account Plugins** — the `dan-skills` zip. Namespaced `dan-skills:`. Not under
   `~/.claude/plugins`; `installed_plugins.json` never lists it.
3. **Account Skills** — skills uploaded individually at claude.ai, cached at
   `%APPDATA%\Claude\local-agent-mode-sessions\skills-plugin\<orgUuid>\<accountUuid>\skills\`
   next to a `manifest.json`. The namespace is the **org's display name**, which is why
   `anthropic-skills:` fronts skills Dan wrote himself.

**Why it matters:** channel 3 is invisible to the repo, the mirror, the packager and the sweep.
Measured 2026-08-31 — work org 33 skills, personal org 27, and 28 of the work org's had no
counterpart in `~/.claude/skills`: `writing`, `aac-sop`, `aac-contract-package`, `o3-prep`, `todo`,
`email-review`, `review-contract`, `software-decision`, `audit-code-changes` among them. A restored
machine does not get them; they arrive only by signing back into the account.

Names that appear in more than one channel drift with nothing watching: `writing-dan` was
byte-equal between local and the personal org and different in the work org, and each org's
`writing` differed from the other's.

**How to apply:** never conclude a skill is missing, or that a `plugin:name` skill is a vendor's,
from `~/.claude/skills` alone — list channel 3 for both orgs first. The org UUIDs come from each
profile's `.claude.json` (`oauthAccount.organizationUuid`).

Related: [[concurrent-sessions-share-one-sync-push]]
