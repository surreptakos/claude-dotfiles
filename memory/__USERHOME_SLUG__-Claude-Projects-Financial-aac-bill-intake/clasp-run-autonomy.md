---
name: clasp-run-autonomy
description: "How Claude executes the GAS pipeline headlessly (clasp run) — setup, scopes, and the run functions"
metadata: 
  node_type: memory
  type: project
  originSessionId: 775b530f-7299-4b6d-b767-b407e67616c7
---

`clasp run` works for the `gas/` project, so Claude can execute functions headlessly (no editor).
Setup that made it work (done 2026-07-06):
- Apps Script project joined to GCP project **gpt-sheets-access-475817** (594980791877) in the editor.
- `.clasp.json` has `"projectId": "gpt-sheets-access-475817"`; `appsscript.json` has
  `"executionApi": {"access":"MYSELF"}` + an `oauthScopes` list (mail.google.com, spreadsheets,
  drive, script.external_request, script.scriptapp, userinfo.email).
- Logged in with the project's desktop OAuth client (interactive browser consent as
  djgatsakos@gmail.com — the script owner). Today's re-auth method: `node tools/clasp-auth.js`
  and paste the command it prints — never hand-write a `clasp login` line (see
  [[clasp-login-scope-trap]]).
- An API-executable deployment must exist (`clasp create-deployment`).

Run from the `gas/` dir (the Bash cwd resets between calls — always `cd` first):
`clasp run ping` (env/creds check), `clasp run seedGl`, `clasp run processInbox` (returns a
JSON summary {counts, rows, ...} — I added that return for headless inspection),
`clasp run reprocessReview`, `clasp run runIntake --params '["<gmail query>", <max>]'` (targeted),
`clasp run diagAttachment --params '["<query>"]'`.

Gmail connector (MCP) is also authorized (read threads/labels) but CANNOT fetch attachment
bytes — so the pipeline must run in GAS. Still on SANDBOX (`BILL_BASE_URL` stage). See
[[gas-testing-architecture]]. Prod cutover still needs prod Script Properties set in the editor.
