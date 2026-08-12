---
name: the-served-page-runs-in-the-browser-pane
description: "tools/preview-served-page.js builds the whole served page as one file that runs in the Browser pane — no Apps Script, no sandbox, full runtime and React"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: dc30d7b1-b64a-4292-890a-d056919d16ae
  modified: 2026-08-02T07:58:53.462Z
---

The real page — DsRuntime, React, the board, the authoring layer — runs locally in the Browser pane. Build
it and open it:

```
node tools/preview-served-page.js tests/visual/harness.html
```

then navigate the pane to `file:///…/tests/visual/harness.html`. That path is already in `.gitignore` and
`tests/**` is in `.claspignore`, so it never commits and never deploys. **Write it inside the project** — a
file outside the project folder loads as a static `data:` snapshot with no scripts.

Verified 2026-08-02: `__dcBoot`, `__dcSetProps`, `__dcUpdate`, `__dcRootName`, `__aacAuthor` all live;
34 controls and 6 trash icons bound; `javascript_tool` reads and drives all of it.

**Why:** I told Dan three times that runtime behaviour "cannot be tested without a browser inside the Apps
Script sandbox" and used it to justify not fixing #136. Wrong, and it broke the standing rule about never
asserting an environment limit without attempting it. The sandbox iframe is only how Apps Script *serves*
the page; nothing in the runtime needs it. The tool that removes the excuse was already in `tools/`, with a
header comment saying exactly what it was for.

**How to apply:** before writing "I cannot verify this in the browser", build the harness. It answers render
questions, focus and scroll behaviour, whether the authoring layer bound anything, and the client half of
the load timing. What it cannot answer is anything about the real `/exec` — session, server timings, the
cross-origin frame — and that is a much smaller list than I had been claiming.

Related: [[dom-repro-via-jsdom-scratchpad]], [[served-board-executed-by-nothing]],
[[where-the-reports-time-goes]].
