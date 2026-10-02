---
name: aac-google-access
description: AAC Google stack access (GCP project, service account, clasp token, Apps Script projects). Load before AAC Sheets, Drive, Gmail or Apps Script work, when a Google call fails on auth or scope, when clasp needs re-authenticating, and before claiming you lack Google access.
metadata:
  modified: "2026-10-02T18:54:20Z"
  previous-modified: "2026-10-01T23:37:11Z"
  revision: "68"
  content-sha: "81dd5a092818"
---

# AAC Google Cloud & Apps Script access

The access is on disk. Pick the transport by surface (*From a cloud container* below), and
verify a grant with `tokeninfo` before relying on any list here.

## Identities

- **One shared GCP project** for all AAC Apps Script projects: ID `gpt-sheets-access-475817`,
  number `594980791877`. It owns the clasp OAuth client (`594980791877-…`) AND the service
  account. Put `"projectId": "gpt-sheets-access-475817"` in each repo's `.clasp.json` so
  `clasp logs` works.
- **Service account (god-tier, no expiry):**
  `gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com`, key at
  `~/.config/gpt-sheets-access-475817-853f8648243b.json`. Use from Python
  (`from google.oauth2 import service_account` → `AuthorizedSession`) for direct Sheets/Drive
  REST: it bypasses the gen-AI-ineligible flag and never expires. **That signing path is the PC
  and Team transports only**; a cloud container has no key on disk (see *From a cloud
  container*). **Share the target workbook Editor with the SA email** to grant it access. The SA
  **cannot** run Apps Script functions (`scripts.run` → 404; `executionApi.access: MYSELF`).
- **clasp token** (`~/.clasprc.json`, user `djgatsakos@gmail.com`): refresh at
  `oauth2.googleapis.com/token`. Verified by tokeninfo **2026-07-31**, the grant is:
  `mail.google.com` (full Gmail, read AND send), **full `/auth/drive`** plus `drive.file` and
  `drive.metadata.readonly`, `spreadsheets`, `cloud-platform`, `service.management`,
  `logging.read`, `script.*` (projects/deployments/scriptapp/external_request/container.ui/
  webapp.deploy), `userinfo.email`, `userinfo.profile`, `openid`. An earlier note here claimed
  `drive.file` only, which would have ruled out a working transport: verify with tokeninfo,
  including against this list. The token now serves only Sheets/Drive REST and Gmail from a
  machine that has it; never re-mint it for a deploy, and never tell the owner a deploy
  needs it.
- **Auth model:** bound Apps Script runs as the **user** (djgatsakos@gmail.com), never a service
  account. So "no permission to call DriveApp.X / Required: /auth/drive" from a bound script means
  the stored grant is behind the project's pinned `oauthScopes`, not a token problem: re-authorize
  once (interactive). Publishing the OAuth consent screen out of Testing is the only thing that
  stops the 7-day token expiry.

## Apps Script projects and scopes

- **Canonical AAC scope block** (superset of every AAC data/ops project's declared scopes; pin it
  verbatim as each `appsscript.json`'s `oauthScopes` and authorize once, to stop scope-drift
  breakage): `spreadsheets`, `drive`, `mail.google.com`, `script.external_request`,
  `script.scriptapp`, `script.container.ui`, `userinfo.email`. Scope enforcement is
  **lazy/per-call**: a declared scope the code never calls is inert (no trigger breakage); the
  grant only needs to catch up when code invokes that scope (or at the next interactive auth).
- **AAC ops projects (repo ↔ online name ↔ scriptId), all bound to `projectId
  gpt-sheets-access-475817`:** `Sales Data KPIs/commissions` ↔ "AAC 2026 Sales Commissions
  Script" (bound, `1kt5rVEw…`); `Sales Data KPIs/aac-cockpit` ↔ "AAC Snapshot Pipeline"
  (`1Dd7GVub…`); `Financial/aac-bill-intake/gas` ↔ "AAC AP Intake (dry run)" (`1hIdNvfr…`). All
  three carry the canonical block as of 2026-07-20. To enumerate the account's script projects:
  Drive `files.list mimeType='application/vnd.google-apps.script'` + Apps Script
  `projects.getContent`; bound scripts like commissions are absent from that Drive list.

## Deploying and running

- **Deploys and headless runs go through `gas`, no clasp token (2026-09-09).** Every AAC Apps
  Script repo deploys itself from GitHub (claude-dotfiles `gas/`; team skill `gas-deploy`): merge
  to the default branch = release; `node <claude-dotfiles>/gas/cli/gas.js run owner/repo <fn>
  '[args]' --wait 10` = `clasp run-function`; `gas pull <scriptId>` = `clasp pull`;
  `gas logs --project gpt-sheets-access-475817` = `clasp logs`.
- **Other ways to run deployed code:** (1) `clasp run-function <fn>`: PUBLIC fns only (a
  name ending in `_` is private), under the clasp token. (2) **`doPost` web app**: runs as the owner with the full
  grant (incl. Drive); gate it with a secret + whitelist, `clasp deploy` a fresh version (the
  `@HEAD` deployment has no usable `/exec`), and POST via **PowerShell `Invoke-RestMethod`**
  (curl 411s on Apps Script's 302). (3) The sheet menu or a trigger.
- **Execution history:** `GET script.googleapis.com/v1/processes:listScriptProcesses?scriptId=…`
  (scope `script.processes`); the service account can do this without clasp. Use exactly that
  endpoint: `processes?userProcessFilter.scriptId=…` filters to processes the *caller* started, so
  a service account gets `0` rows, which reads as "never ran" and is false.

## Re-authenticating clasp

When the token dies (7-day cycle, consent screen in Testing), run
`node "C:/Users/Dan/Claude/Projects/Meta/message-board/tools/clasp-auth.js"` (or `npm run auth`
from that repo) and paste the command it prints. It works from any project: the credential is
machine-wide. The tool regenerates the full command from a required-scope list, finds the creds
file by matching `client_id`, and verifies the result with `tokeninfo` instead of trusting
`expiry_date`.

**A bare `clasp login` is always wrong and fails silently, two ways** (both verified against
installed clasp 3.3.0 source, 2026-08-01):

1. **Wrong OAuth client.** clasp ships its own public client `1072944905499-…`
   (`@google/clasp/build/src/auth/oauth_client.js`); every AAC token belongs to the private client
   `594980791877-1r31l7idb4nc5js9ag2d28s5eni5joj5`, so `--creds` pointing at that client's secret
   JSON is mandatory. It lives at `~/.config/client_secret_594980791877-….json`, local and never
   synced (moved out of OneDrive Downloads 2026-09-30 so a credential no longer syncs to every PC;
   the tools' `CREDS_SEARCH_DIRS` include `~/.config`).
2. **Scopes silently dropped.** clasp's `DEFAULT_SCOPES` (`build/src/commands/login.js`) omit
   `spreadsheets`, full `drive`, `mail.google.com` and `script.processes`, and `authorize()` never
   sends `include_granted_scopes` (`build/src/auth/auth_code_flow.js`), so anything not explicitly
   requested is **removed from the grant**. `~/.clasprc.json` is shared by every AAC project, so
   that quietly breaks Gmail/Drive work elsewhere while `clasp push` still succeeds.

**Done when** `tokeninfo` shows the full grant AND the one CI copy of this credential is
refreshed: aac-cockpit's `CLASPRC_JSON` secret (used by deploy.yml + promote.yml; no other AAC
repo has one), via `gh secret set CLASPRC_JSON < ~/.clasprc.json` from the aac-cockpit repo.
Skip it and the next CI deploy dies on `invalid_grant` (it did on 2026-08-17).

## From a cloud container

Which credential carries a Google call is a property of the **surface**, not of the caller. Three
transports reach the same identity, the service account above; share the workbook Editor with
that address and any of them can read it. One helper in claude-dotfiles picks between them:
`python3 <claude-dotfiles>/tools/google-rest.py transport|whoami|cell|get|doc-read|doc-replace`.

**Revising a Google Doc in place (issue 1216).** The Drive connector's `update_file` changes only
title and folder; asked for new text it answers `400 Unknown name "textContent"`, and the agent
that then creates a "v2" leaves two documents for one piece of work. Revise the Doc over its own id:

1. Share it Editor with the SA, through the connector, since a Doc the connector made is the
   owner's: `share_file(fileId, "gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com", "writer")`.
2. Write the whole new body to a `.md` file (or `.html`, `.docx`, `.txt`) and run
   `python3 <claude-dotfiles>/tools/google-rest.py doc-replace <docId> <file>`. Drive converts it
   into the Doc (`files.update`, `uploadType=media`), keeping the id, link, sharing and revision
   history, and the command prints the body read back from the Doc. `doc:<otherDocId>` in place of
   the file copies another Doc's body through `.docx` and exits 1 unless the two read-backs match.
3. `doc-read <docId>` prints the current body as plain text; read it first, so the revision starts
   from what is there.

Verified 2026-10-01 on the service-rates research Doc: `doc-replace <v1 id> doc:<v2 id>` read back
identical to v2, and v2 went to the trash through the connector's `trash_file` (only the owner can
trash a My Drive file, so the SA cannot).

- **Pro/Max cloud session (`CLAUDE_CODE_REMOTE=true`)**: the key is an *environment API
  credential* held by the agent proxy, which mints the access token and attaches `Authorization`
  to every `*.googleapis.com` request. Send plain `curl` / `urllib` / `requests` with **no**
  Authorization header and no key file to `sheets.googleapis.com`, `www.googleapis.com/drive/v3`,
  `script.googleapis.com`, `cloudresourcemanager.googleapis.com` and `logging.googleapis.com`;
  all arrive as the SA. `google.oauth2.service_account` / `AuthorizedSession` are wrong here:
  nothing is on disk to load, and `google-auth` is not installed. The proxy **replaces** a header
  you send (a deliberately bogus bearer token still answers `200` as the SA), so code that signs
  here fails silently, running as a principal it did not choose.
- **Team / Enterprise**: those plans have no API-credentials section ("aren't available on Team
  or Enterprise plans yet"), so the key JSON rides the `GPT_SHEETS_SA_KEY_JSON` environment
  variable on an owner-only environment and the PC code path applies, reading the JSON from the
  variable instead of the file. Check that variable **before** `CLAUDE_CODE_REMOTE`: a Team
  container sets `CLAUDE_CODE_REMOTE=true` too, but its proxy attaches nothing, so the ambient
  branch would send an unauthenticated request straight into a 401.
- **The PC**: the key file and `service_account` → `AuthorizedSession`, as under *Identities*.

**Gmail rides none of them.** `mail.google.com` on the SA token answers `400 Precondition check
failed`: the SA has no mailbox, and a personal @gmail.com cannot delegate domain-wide. Gmail from
a cloud session is the claude.ai **Gmail connector**; on the PC it is the clasp token. The helper
refuses Gmail URLs on every transport so the failure never reads as a scope problem.

**Verify before believing any of the above** (expected results from a Pro/Max cloud container,
2026-09-16, issue 172):

```
ls ~/.config/gpt-sheets-access-475817-853f8648243b.json   # No such file or directory
echo "[$GPT_SHEETS_SA_KEY_JSON]"                           # []
python3 tools/google-rest.py transport   # cloud-proxy  CLAUDE_CODE_REMOTE (agent proxy attaches Authorization; we send none)
python3 tools/google-rest.py whoami      # gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com
python3 tools/google-rest.py cell 1dBhSYwk1lHXAosMtbdQ4qI73Rb60BBiB4S6h42ruUQg "Script Errors!A1"   # Timestamp
curl -sS -o /dev/null -w '%{http_code}\n' https://gmail.googleapis.com/gmail/v1/users/me/profile    # 400
```

`whoami` answering the SA address is the proof the transport is live; a `401` there means the
surface is not the one you assumed (a Team container with the variable unset, most often).
