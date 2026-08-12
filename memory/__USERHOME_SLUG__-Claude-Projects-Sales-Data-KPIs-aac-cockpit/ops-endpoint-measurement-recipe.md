---
name: ops-endpoint-measurement-recipe
description: "how to time the deployed report end to end — the ops secret's home, the POST-302 trap, and what each leg costs"
metadata: 
  node_type: memory
  type: reference
  originSessionId: dc30d7b1-b64a-4292-890a-d056919d16ae
  modified: 2026-08-02T06:37:58.773Z
---

Timing the deployed report needs three things, and two of them cost an hour to rediscover.

- **The shared secret lives in the workbook**, `Ops_Access!A:B`, key `doPostSecret`. Read it with the
  service account (see [[live-workbook-id-sa-readable]]); it is not in code or Script Properties, deliberately.
- **A POST to `/exec` 302s to a `script.googleusercontent.com` echo URL that must be followed with GET.**
  Re-POSTing to the redirect returns 405 and a "Page Not Found" HTML body that parses as nothing.
- `inspectBoardData` on the allowlist takes `(email, weekIso, targetRep)` — all read-only — so a prior week
  and a rep switch are both drivable from outside.
- `doGet?probe=1` returns the letter `x`: time it against the real page on the same deployment to separate
  platform cost from template evaluation.

**Measured 2026-08-02, after the #101/#102/#103 work:** `/exec` document 1.1–1.8 s (of which ~85 ms is the
template, the rest is the platform and is a floor); the data call 0.2–1.2 s warm; the bundle 6–57 ms warm and
1.2–2.4 s cold. A prior week with no stored payload blob costs 70–80 s (#131).

**The Browser pane cannot see inside the report.** Apps Script serves it in a cross-origin sandbox iframe, and
the pane records no console, no network and no DOM from within it. The page posts its own timeline out
(`window.__aacTiming`, also logged and postMessaged) for whoever has a real browser on it.
