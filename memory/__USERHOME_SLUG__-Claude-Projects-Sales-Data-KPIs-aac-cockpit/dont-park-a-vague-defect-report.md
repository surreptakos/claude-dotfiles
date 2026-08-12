---
name: dont-park-a-vague-defect-report
description: "Dan saying \"the report doesn't look right\" is a signal to go render the page, not a request for a screenshot."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1993242d-e5cc-400d-a76f-faaee726f218
  modified: 2026-08-01T20:59:16.959Z
---

On 2026-07-31 Dan reported "sales report doesn't look right". It was filed as #97 and parked `needs-info` pending a screenshot, on the reasoning that the board ships verbatim from Claude Design and guessing risked "fixing" something Design chose deliberately.

On 2026-08-01 he came back with sixteen specific defects. A ~130-line script that loads the board's logic class and prints its rendered strings found all of them in seconds — and four more nobody had reported.

**Why:** the reasoning for parking it was sound in general and wrong here. There WAS a way to look at the page without asking him: instantiate the board and read its output. Asking the owner to describe his own screen, when the screen is reachable from a script, is deflection wearing the costume of rigour.

**How to apply:** when he reports a vague visual or content problem, run `node tools/render-board.js` FIRST and bring findings to the conversation. Ask for a screenshot only for things a script genuinely cannot see — layout, spacing, colour, hover positioning. "It might be a deliberate Design choice" justifies not *changing* something; it never justifies not *looking*.

Related: [[served-board-executed-by-nothing]], [[verify-before-filing-cite-the-check]], [[design-work-goes-to-claude-design]].
