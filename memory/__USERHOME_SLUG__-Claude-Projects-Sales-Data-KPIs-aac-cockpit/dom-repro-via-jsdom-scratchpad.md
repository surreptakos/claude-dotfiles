---
name: dom-repro-via-jsdom-scratchpad
description: "How to build a real-DOM repro for Dashboard_v2 client bugs — jsdom in the scratchpad, not the Browser pane."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 45b44532-f886-46f4-a64b-e46d770a753d
  modified: 2026-07-28T00:21:35.226Z
---

To reproduce a **DOM-level** front-end bug in this app (focus loss, caret jumps, re-render clobbering), drive the real client script under **jsdom installed into the scratchpad** (`npm install --no-save jsdom`), loaded via the repo's own `tests/load-client.js` so the script under test is byte-for-byte what `doGet` ships.

Two gotchas that cost real time:
- **jsdom must be created with `runScripts: 'dangerously'`.** With `'outside-only'` (what `render_smoke_test.js`-style fixtures effectively assume) **inline `on*` attributes never execute** — and this app wires every save through inline `onblur=`/`onchange=`/`oninput=` attributes, so the bug silently fails to reproduce and the loop reads green.
- **The Browser pane DOES reach localhost — corrected 2026-07-27.** `preview_start` with `{url: "http://localhost:5178/harness.html?..."}` loads and runs the visual harness with full JS, and `javascript_tool` then queries the live DOM. (`preview_start` with `{name}` fails if a stray `node` already holds the port; pass the URL instead. A `file://` path still renders a static no-JS snapshot.) The real limit is different: while the pane is **not displayed**, the page does not composite, so `screenshot` times out and every `getBoundingClientRect()`/`innerWidth` reads 0 — no pixel-layout checks. Structure is fully observable, so use it for node identity, spine/wrapper survival across re-renders, computed presence of controls, and console errors; use jsdom for focus/caret.

**Why:** the repo's existing headless fixtures stub the DOM (`fakeEl()`), which is fine for "does it render" but cannot observe focus, caret, or node identity — exactly what a cursor-jump bug is about.

**How to apply:** copy the pattern in the diagnosis harnesses (`loopA_cursor_jump.js` / `loopA_matrix.js`): real jsdom + `vm.runInContext(clientScript, dom.getInternalVMContext())` + a `google.script.run` stub whose success handler fires on a `setTimeout` so server latency is modelled. Assert on `document.activeElement`, `doc.contains(node)`, and `selectionStart`.

Related: [[verify-deploy-via-exec-fetch]]
