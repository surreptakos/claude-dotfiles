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
Its `manifest.json` marks each skill `creatorType: anthropic` (the stock set) or `user` (Dan's own
upload) — read that before calling anything a vendor's. Measured 2026-08-31: work org 33 skills of
which only 12 were his, personal org 27 of which 7 were his.

Nine of his work-org skills have no copy under `~/.claude/skills`: `aac-contract-package`,
`aac-sop`, `audit-code-changes`, `email-review`, `o3-prep`, `review-contract`, `software-decision`,
`todo`, `writing`. A restored machine does not get them. Two more — `caveman`, `find-skills` — exist in both channels and drift unwatched. `writing-dan`
did too until 2026-08-31, when Dan retired it (deleted locally; account copies pending his
deletion): it had already drifted, byte-equal local-vs-personal-org but different in the work org. The two orgs also disagree: `aac-contract-package`, `email-review`, `o3-prep`,
`review-contract` and `todo` exist only in the work org.

The manifest does NOT distinguish org-scoped from personal — every uploaded skill is
`creatorType: user`, and the org-vs-personal scope is a claude.ai concept only. Confirmed
2026-08-31: the work-org Skills UI shows `aac-contract-package`, `writing`, `aac-sop`,
`software-decision` as Organization skills (visible to every Active Alarm member), yet
`manifest.json` marks them the same as personal `writing-dan`. Do not infer scope from disk.

**How to apply:** never conclude a skill is missing, or that a `plugin:name` skill is a vendor's,
from `~/.claude/skills` alone — list channel 3 for both orgs first. The org UUIDs come from each
profile's `.claude.json` (`oauthAccount.organizationUuid`).

