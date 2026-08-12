---
name: one-owner-per-file
description: "Design and I may read each other's files but only one of us writes each; the split landed 2026-08-02 (ADR-0026) and the first pull after it needed no hand-merge."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a7005e98-50b8-4c73-b267-b206f1ab5632
  modified: 2026-08-02T04:40:26.459Z
---

Dan, 2026-08-01: *"it would be best to have you and design not touch the same files. You can see each others files, but each file is only owned by one of you."*

**Design writes:** `weekly-sales-review-rep.dc.html`, `Matrix.dc.html`, `support.js`, the print board, the bundles, the screenshots.
**I write:** `Code.js`, `Signals.html`, `DsApp.html`, `DsHost.html`, `tests/`, `tools/`, `docs/`.
**Generated, neither hand-edits:** `DsBoard.html`, `DsRuntime.html`, `DsAssets.html`.

**I also write `board-logic.js`** — the logic class and its fixture. **DONE, 2026-08-02** (#123, ADR-0026): the class moved out of Design's `.dc.html`, and `build-ds-view.js` composes Design's markup + Design's opening script tag + `board-logic.js` inlined as that tag's contents. The composed `DsBoard.html` came out byte-identical, so the move shipped no behaviour.

**Design's file still contains a logic block. It is their canvas preview fixture** — replaced at build time, never shipped, free to differ. Do not sync it back and do not read it as production logic.

**The first pull after the split (2026-08-02) needed no hand-merge at all** — Design's whole file was taken wholesale after `node tools/design-sync.js` exited 0. Still run that guard before merging: it now checks the markup half for rejected copy and the script tag for `data-props`, since the logic half is no longer taken from Design.

**The runtime forbids LINKING, not splitting.** It reads the logic as inline text (`js: scriptEl.textContent`, `support.js`) and never fetches a `src`, so a `.dc.html` referencing a separate logic file previews as nothing and errors with `must define class Component extends DCLogic`. I turned that into "the split costs Design their preview" — wrong, and Claude Design corrected it: `build-ds-view.js` already composes the served file, so it inlines `board-logic.js` as the script tag's contents at build time and the runtime never knows there were two files. Design previews off a fixture stub in their own copy, which never ships.

Two verified traps for that generator change: **preserve Design's opening `<script>` tag verbatim** — `data-props` is a 1,714-character attribute on it and a whole-tag replace drops every board prop — and **assert no literal `</script>`** in the logic, as line 27 already does for `support.js`.

**The lesson under it:** I twice drew a consequence from a correct mechanism finding without testing the consequence. Dan caught the first ("can't Design combine two files?"), Design caught the second. Verify the *conclusion*, not just the fact it rests on.

**Why it matters beyond tidiness:** co-ownership is what let Design's copy sit at `Pace calls for` while the repo's said `To be on track today`, with no test able to see it. One owner per file makes that state impossible rather than detectable.

Related: [[backend-only-the-seam-is-the-payload]], [[design-work-goes-to-claude-design]].
