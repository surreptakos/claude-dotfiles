---
name: clasp-login-scope-trap
description: "clasp run-function needs the PROJECT OAuth client + restricted scopes; plain clasp login breaks it with \"This app is blocked\""
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5b67bf36-f517-4beb-8b8b-906a9e45a4c0
  modified: 2026-07-23T22:29:52.109Z
---

`clasp run-function` requires a token that (a) uses the PROJECT's own OAuth client, not clasp's default bundled client, and (b) carries ALL scopes the script declares — including the restricted `mail.google.com` / full `drive`.

**Why:** plain `clasp login` authenticates with clasp's bundled client (`1072944905499-…`). Google will NOT let that public client grant restricted scopes to arbitrary users → a hard **"This app is blocked. This app tried to access sensitive info"** (not the soft "unverified — proceed" warning). Editing the project's own OAuth consent screen (publish/testing, adding test users) has zero effect, because that flow is governed by clasp's client, not the project's. Separately, `scripts.run` checks the UNION of the script's declared scopes, so even a property-only function (e.g. `ping`) fails if the token lacks Gmail/Sheets/external_request.

**How to apply:** re-auth from the `gas/` dir with `clasp login --creds <gpt-sheets-access-475817 OAuth client json> --use-project-scopes --include-clasp-scopes` (Desktop-type client). When run-function is scope-blocked, the universal fallback is the `doPost` `/exec` web app: it runs as the OWNER with the full bound grant, invoked via PowerShell `Invoke-RestMethod` — and `clasp push`/`deploy`/`logs` still work meanwhile because they only need the non-restricted `script.projects`/`script.deployments`/`cloud-platform`/`logging.read` scopes. Verify token scopes with tokeninfo, don't assume. See [[clasp-run-autonomy]] [[gas-verification-loop]].
