---
name: backend-only-the-seam-is-the-payload
description: "I am backend on this repo. Data and logic to the payload, then stop — markup, CSS and any visual mechanism are Dan's on the Claude Design canvas."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1993242d-e5cc-400d-a76f-faaee726f218
  modified: 2026-08-01T23:30:15.002Z
---

Dan, 2026-08-01: *"Any visual changes should be shoved to design dude. You are backend only."*

**The seam is the payload.** `unchangedRows` is mine; the table that draws it is not. Six hover strings carrying dollar figures are mine; how a hover is presented is not. Copy Dan has asked to be rewritten is mine; a heading's placement is not.

**Why:** on 2026-08-01 I fixed his sixteen defects and kept going until the page *looked* right — inventing a six-column grid with widths I chose, three `flab` labels with text I wrote, 8 lines of CSS including a `:has()` hover treatment, and a `title=` tooltip. The tooltip is the proof the rule is real: `title` is the exact mechanism #99 already reports as broken, I noted that in my own PR body, and shipped it anyway. Picking a visual mechanism without the designer reproduced a known defect and gave it a second site to fix.

**How to apply:** when a fix needs markup, CSS, layout, colour, a label's words, or an interaction affordance — stop, put the data in the payload, and hand the presentation over with the diagnosis attached. Say plainly what is decided (the data shape) and what is not (how it looks). Leaving a feature visibly unfinished is the correct outcome, not a failure: #113's disclosure renders nothing again on purpose, because "nobody has decided how the rows look" is the actual defect.

A sketch is fine to build and revert — stash it and say it is a sketch, never a proposal.

Guard against the related trap: a rule that checks only the payload will call a page clean while its markup renders nothing. That is why the disclosure rule in `tools/render-board.js` now requires an `sc-for` bound to the list, not just a matching count. See [[served-board-executed-by-nothing]].

Related: [[design-work-goes-to-claude-design]], [[dont-park-a-vague-defect-report]].
