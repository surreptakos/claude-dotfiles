---
name: served-board-executed-by-nothing
description: "The test gate points at the retired Dashboard_v2; the served board is unexecuted, which is how sixteen defects shipped green on 2026-08-01."
metadata: 
  node_type: memory
  type: project
  originSessionId: 1993242d-e5cc-400d-a76f-faaee726f218
  modified: 2026-08-01T20:59:06.442Z
---

The report that is actually served (`DsBoard.html`) was executed by no test until 2026-08-01. Verified then:

- `render_smoke_test` — the largest suite in the repo, 321 assertions — renders **`Dashboard_v2.html`**, the view ADR-0025 retired on 2026-07-31.
- Exactly one suite executes the served board's logic: `owed_one_ledger_test`, and only its owed-ledger preview.
- `ds_view_build_test` compares `DsBoard.html` to the design export **byte for byte**. It catches a hand-edit; it cannot catch wrong. A byte-perfect copy of a broken board passes.
- `deploy.yml` gates on that same suite and redeploys on every push to `main`. Twenty commits went out on 2026-07-31.

So a green build means nothing about the page a person opens. Sixteen defects reached production that way — `$2K` swallowing a $488 deal, a disclosure promising fourteen deals and rendering none, warnings naming deal numbers and never deal names.

**Use `tools/render-board.js`** before believing the board is fine. It stubs `DCLogic`, instantiates the board's logic class against its own fixture, and prints every rendered string plus four copy-rule violations. No browser. `--audit` for violations only; an optional path argument audits any other copy (`git show <sha>:DsBoard.html > /tmp/old.html`).

Being fixed by [[test-gate-tickets-120-121]]. Until #120 lands, that script is the only way to read the served board's output.

Related: [[design-work-goes-to-claude-design]], [[read-the-connector-not-the-local-copy]].
