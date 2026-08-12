---
name: a-board-pull-is-three-files
description: pulling the board means AAC Weekly Sales Review.dc.html AND Matrix.dc.html AND support.js — taking one is not taking the board
metadata: 
  node_type: memory
  type: feedback
  originSessionId: dc30d7b1-b64a-4292-890a-d056919d16ae
  modified: 2026-08-02T06:56:11.410Z
---

A Claude Design board pull is **three files**, not one: `AAC Weekly Sales Review.dc.html`, `Matrix.dc.html`
and `support.js`. Fetch all three, run `node tools/design-sync.js` on each, then `node tools/build-ds-view.js`.

**Why:** on 2026-08-02 I pulled the board file, recorded the hover chip as shipped, and left `Matrix.dc.html`
a version behind — so the coverage bars kept the `title=` tooltip that #99 exists to remove, while the
open-mix bars in the other file got the chip. Dan noticed before I did. Nothing looked broken and no test
failed: the payload keys the chip binds were already there, the markup was just old.

**How to apply:** after any pull, grep the generated output for the mechanism you expected (`grep hovr
DsBoard.html`, and decode the inlined asset out of `DsAssets.html` for the Matrix — it is a data: URL, so
plain grep will not find it). "The sync record says it shipped" is not the same as "the repo has it."

Related: [[read-the-connector-not-the-local-copy]], [[design-work-goes-to-claude-design]],
[[one-owner-per-file]].
