---
name: read-the-connector-not-the-local-copy
description: The on-disk design reference goes stale the moment Design pushes; read the board through the DesignSync connector before claiming a hook or field is missing.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a6ed8c90-20ee-4d6f-8130-e73aba68b846
  modified: 2026-07-31T15:50:14.139Z
---

`design/weekly-sales-review/reference/*.dc.html` is a **snapshot of the last pull**, not the board.
Design edits the Claude Design project directly, so the local file is stale as soon as they push. Read the
live one with `DesignSync get_file` on project `497dceb2-621c-4fdd-a09a-3dee7c5a27d8`, path
`AAC Weekly Sales Review.dc.html`, before asserting anything about what the board does or does not carry.

**Why:** on 2026-07-31 I audited the on-disk copy, told Dan the obstacle card was missing four hooks and the
masthead had none, and drafted a Design ask around it — while all of it had already landed. Dan caught it
("I thought 84 was done? Did you check the design connector's latest file?"). The false report cost a
round trip and would have sent Design work they had already done. Same failure family as
[[verify-before-filing-cite-the-check]]: a stale artifact read like a fact.

**How to apply:** before filing a ticket, writing a Design ask, or reporting a board gap, pull the file
through the connector and diff it against `design/.../reference/`. If it differs, pull it in, re-run
`node tools/build-ds-view.js`, run the suite, and audit the fresh copy. State which one you read.
See [[design-work-goes-to-claude-design]] for who owns the change once the gap is real.

**2026-08-12 amendment:** "the connector" is now two connectors that disagree, and one of them was stale. See [[design-projects-on-the-work-account]] — the live board project moved to the work account, and reading a token list off the older of two design systems produced 143 false violations. Check WHICH project answered before trusting the answer.
