---
name: clasp-login-never-hand-write
description: "Never type a `clasp login` command by hand — run `npm run auth` in message-board and paste what it prints; a bare login silently produces a wrong credential."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f12735f2-8212-44f0-8ad6-673821edae36
  modified: 2026-08-01T20:20:58.353Z
---

Run `npm run auth` (repo `Meta/message-board`, or `node tools/clasp-auth.js` from anywhere) and paste
the command it prints. Never compose a `clasp login` line yourself, and never shorten the one it
gives you. Verified 2026-08-01 against installed clasp 3.3.0 source.

**Why:** a bare `clasp login` appears to succeed while producing a wrong credential, two independent
ways, and the failure hides because `clasp push` keeps working.

1. *Wrong OAuth client.* clasp ships its own public client `1072944905499-…`
   (`@google/clasp/build/src/auth/oauth_client.js`). Every AAC token belongs to the private client
   `594980791877-1r31l7idb4nc5js9ag2d28s5eni5joj5` in GCP project `gpt-sheets-access-475817`, so
   `--creds` is mandatory. The secret JSON is at `~/Downloads/client_secret_594980791877-….json`.
2. *Scopes silently dropped.* clasp's `DEFAULT_SCOPES` (`build/src/commands/login.js`) omit
   `spreadsheets`, full `drive`, `mail.google.com` and `script.processes`, and `authorize()` never
   sends `include_granted_scopes` (`build/src/auth/auth_code_flow.js`) — so any scope not requested
   is removed from the new grant. `~/.clasprc.json` is machine-wide, so this breaks Gmail and Drive
   work in *other* AAC repos while this one still pushes fine.

**How to apply:** `tools/clasp-auth.js` generates the command from a `REQUIRED_SCOPES` list, locates
the creds file by matching `client_id` rather than filename, refreshes the token to prove the grant
is live server-side, and checks the result against `tokeninfo` instead of trusting `expiry_date`.
`npm run push` / `npm run pull` gate on it via npm's `prepush`/`prepull` hooks. Need a new scope? Add
one line to `REQUIRED_SCOPES` — the command rebuilds itself. Exit codes match the repo's other
audits: 0 clean, 1 broken (prints the fix), 2 could-not-check.

One gotcha inside that tool: on Node 24 / Windows, `process.exit()` with open fetch sockets trips a
libuv assertion and reports **127** instead of the real code, which would make the gate block every
push. It sets `process.exitCode` and drains instead.

Related: [[message-board-google-access]]
