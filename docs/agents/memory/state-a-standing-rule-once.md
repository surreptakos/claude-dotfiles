---
name: state-a-standing-rule-once
description: "Owner wants a standing directive stated once in CLAUDE.md and nowhere else — no reinforcing copies in other sections, skills or hooks."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 062630b3-240b-4bb4-b035-cdfb34f164d2
  modified: 2026-08-13T16:38:08.084Z
---

When Dan asks for a standing directive in CLAUDE.md, put it in exactly one place and stop. On
2026-08-13 he asked for a response prefix "in all CLAUDE.md files, and nowhere else"; I added the
section plus two defensive bullets inside the caveman rules, and he cut them: "you shouldn't need to
mention it anywhere except one time in Claude.md."

**Why:** a second copy earns nothing and costs context every session. His prefix was also chosen to
be unmissable (`YOU MUST CONSTRUCT ADDITIONAL PYLONS` in a `diff` fence, red), so defending it
against being mistaken for a pleasantry was solving a problem he had already designed away.

**How to apply:** one statement, at the top of the global `~/.claude/CLAUDE.md`, then push the mirror.
Do not echo it into skills, hooks or per-project CLAUDE.md files — global memory loads in every
session of every project already, and it loads once per session rather than per turn, so one mention
is the whole cost. If drift feels likely, say so and let him decide rather than pre-installing a
guard. See [[verify-before-filing-a-sweep-ticket]].
