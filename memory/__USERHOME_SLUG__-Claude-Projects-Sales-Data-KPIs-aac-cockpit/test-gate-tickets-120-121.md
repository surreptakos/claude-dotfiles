---
name: test-gate-tickets-120-121
description: "The agreed fix for the blind test gate — #120 makes the served board testable, #121 turns four copy rules into a hard gate, #59 absorbed the smoke-test cleanup."
metadata: 
  node_type: memory
  type: project
  originSessionId: 1993242d-e5cc-400d-a76f-faaee726f218
  modified: 2026-08-01T20:59:45.269Z
---

Agreed with Dan 2026-08-01 after sixteen defects shipped through a green build (see [[served-board-executed-by-nothing]]).

- **#120 — the served board renders under test.** No blockers, this is the frontier. Executes the board's logic class against its fixture; fails on a throw, on a section that renders empty when the fixture populates it, and on markup reading a value the logic no longer produces. Seed already committed: `tools/render-board.js`.
- **#121 — copy rules are enforced by the gate.** Blocked by #120 (native GitHub dependency edge). Four rules, **hard fail**, exemptions annotated in the test with a reason — Dan's explicit choice over report-only. No magnitude shorthand; no em dash in prose; no deal number without its deal name; a disclosure renders what it counts. Runs over the board's output **and** the server payload, because `k()` and `bdSignedK_` produced the same defect independently.
- **#59** absorbed the third ticket (separating `render_smoke_test`'s live coverage from its dead coverage) at Dan's direction, and is now blocked by #120.
- **#75** re-scoped from `needs-triage` to `ready-for-human`: it now covers only what genuinely needs a real DOM (layout, computed styles, hover positioning), since #120 needs no browser.

**Never pin an acceptance criterion to a commit hash.** #121 originally said "reverting `b397eab` makes this suite fail"; a squash merge or rebase would make that unverifiable. It now names the content instead. Same reason PR #122 asks for `--no-ff`.

Related: [[dont-park-a-vague-defect-report]].
