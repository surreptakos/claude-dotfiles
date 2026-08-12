---
name: verify-deploy-via-exec-fetch
description: How to verify a deployed client-side dashboard change against prod without the login flow
metadata: 
  node_type: memory
  type: reference
  originSessionId: aace68c9-dd82-4ff5-aa31-91e31b078393
---

`doGet(?v=2)` ships the FULL `Dashboard_v2.html` client (all render functions) to any anonymous GET — the session/rep gate is client-side, applied only after `verifyLoginCode`. So a purely presentational client change can be verified against the REAL deployed artifact by fetching the `/exec?v=2` URL and grepping the returned HTML for added/removed function names — no magic-link auth needed.

Stable deploy (CI redeploys in place on push to main): `AKfycby3cuGIPE7dcBYfhiDYDQzfW0XLl4X9Bk4_wCDH3scKFkImf2fDAAveO-EzDWIcU7E`. URL: `https://script.google.com/macros/s/<that>/exec?v=2`. Get deploy IDs with `clasp deployments`.

Local pre-deploy visual check: `node tests/visual/build-harness.js` then serve `tests/visual/serve.js` (port 5178) and query rendered `#root` (use `.textContent`, not `innerText` — CSS `text-transform:uppercase` corrupts case matches; and `body.innerHTML` includes the inlined `<script>` source, so scope checks to `#root`). Data correctness still needs the real signed-in app; layout/removal does not.
