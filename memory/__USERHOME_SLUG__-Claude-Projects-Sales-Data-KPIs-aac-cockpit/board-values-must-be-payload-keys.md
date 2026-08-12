---
name: board-values-must-be-payload-keys
description: "A getter on the board's logic class renders as nothing; only keys returned by renderVals() reach a binding, and the failure is silent."
metadata: 
  node_type: memory
  type: project
  originSessionId: 3ef79b06-15a0-4db5-a082-fb32e5b11563
  modified: 2026-08-02T04:40:07.375Z
---

The DC runtime resolves `{{ name }}` and `sc-if value="{{ name }}"` against the object `renderVals()`
returns — not against the `Component` instance. So `get unchangedRows()` exists, reads fine from inside the
class, and renders an empty string on the page. No error, no exception, nothing in the console.

Bit three times in the 2026-08-02 Design pull: `hasQuota`, `unchangedRows`, and `createdNA` — the last had
already been broken for weeks, printing nothing where the server's `UNAVAILABLE.CREATED` reason belonged.

**How to apply:** when Design binds a new name, add it to the returned object, not just as a getter. After any
pull, run `node tests/run-all.js` before believing the page works — `tests/ds_board_render.js` is the only
thing that catches this, and it throws `Board markup reads missing logic value "<name>"`, one key at a time.

Now also written in `GOTCHAS.md`. Related: [[one-owner-per-file]], [[served-board-executed-by-nothing]].
