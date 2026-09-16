---
name: aac-google-access
description: Durable owner-grade access to the AAC Google stack (GCP project, service account, clasp token, Apps Script projects). Load before any Sheets, Drive, Gmail or Apps Script work in an AAC project, when a Google API call fails on auth or scope, when clasp needs re-authenticating, or before claiming you lack Google access.
metadata:
  modified: '2026-09-16T15:18:31Z'
  previous-modified: '2026-09-16T15:14:41Z'
  revision: '59'
  content-sha: f3f9133c4444
---

# AAC Google Cloud & Apps Script access

You already have durable, owner-grade access to the AAC Google stack. Do not claim otherwise or ask the operator for these — they're on disk. Moved here from the global `CLAUDE.md` on 2026-09-03 (concision trim); content unchanged.

- **Apps Script deploys and headless runs need no clasp token any more (2026-09-09).** Every AAC Apps Script repo deploys itself from GitHub (claude-dotfiles `gas/`; team skill `gas-deploy`): merge to the default branch = release; `node <claude-dotfiles>/gas/cli/gas.js run owner/repo <fn> '[args]' --wait 10` = `clasp run-function`; `gas pull <scriptId>` = `clasp pull`; `gas logs --project gpt-sheets-access-475817` = `clasp logs`. The clasp token below stays only for Sheets/Drive REST from a machine that has it; never re-mint it for a deploy, and never tell the owner a deploy needs it.
- **One shared GCP project** for all AAC Apps Script projects: ID `gpt-sheets-access-475817`, number `594980791877`. It owns the clasp OAuth client (`594980791877-…`) AND the service account. Put `"projectId": "gpt-sheets-access-475817"` in each repo's `.clasp.json` so `clasp logs` works.
- **Service account (god-tier, no expiry):** `gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com`, key at `~/.config/gpt-sheets-access-475817-853f8648243b.json`. Use from Python (`from google.oauth2 import service_account` → `AuthorizedSession`) for direct Sheets/Drive REST — bypasses the gen-AI-ineligible flag and never expires. **That signing path is the PC and Team transports only** — in a cloud container the key is not on disk and signing is wrong; see *From a cloud container* below. **Share the target workbook Editor with the SA email** to grant it access. The SA **cannot** run Apps Script functions (`scripts.run` → 404; `executionApi.access: MYSELF`).
- **clasp token** (`~/.clasprc.json`, user `djgatsakos@gmail.com`): refresh at `oauth2.googleapis.com/token`. Verified by tokeninfo **2026-07-31**, the grant is: `mail.google.com` (full Gmail — read AND send), **full `/auth/drive`** plus `drive.file` and `drive.metadata.readonly`, `spreadsheets`, `cloud-platform`, `service.management`, `logging.read`, `script.*` (projects/deployments/scriptapp/external_request/container.ui/webapp.deploy), `userinfo.email`, `userinfo.profile`, `openid`. This entry previously claimed `drive.file` only and NOT full `/auth/drive` — that was wrong, and believing it would have ruled out a working transport. Still: verify with tokeninfo, don't assume, including against this list.
- **RE-AUTHENTICATING CLASP — never hand-write the command.** When the token dies (7-day cycle, consent screen in Testing), run `node "C:/Users/Dan/Claude/Projects/Meta/message-board/tools/clasp-auth.js"` — or `npm run auth` from that repo — and paste the command it prints. It works from any project: the credential is machine-wide. **A bare `clasp login` is always wrong and fails silently, two ways** (both verified against installed clasp 3.3.0 source, 2026-08-01). (1) **Wrong OAuth client** — clasp ships its own public client `1072944905499-…` (`@google/clasp/build/src/auth/oauth_client.js`); every AAC token belongs to the private client `594980791877-1r31l7idb4nc5js9ag2d28s5eni5joj5`, so `--creds` pointing at that client's secret JSON is mandatory (it lives at `~/OneDrive - Active Alarm Company, Inc/Downloads/client_secret_594980791877-….json` — NOT plain `~/Downloads`; the tools' `CREDS_SEARCH_DIRS` gained this dir 2026-08-17 after every copy printed the `<DOWNLOAD FROM GCP…>` placeholder for want of it). (2) **Scopes silently dropped** — clasp's `DEFAULT_SCOPES` (`build/src/commands/login.js`) omit `spreadsheets`, full `drive`, `mail.google.com` and `script.processes`, and `authorize()` never sends `include_granted_scopes` (`build/src/auth/auth_code_flow.js`), so anything not explicitly requested is **removed from the grant**. Since `~/.clasprc.json` is shared by every AAC project, that quietly breaks Gmail/Drive work elsewhere while `clasp push` still succeeds. The tool regenerates the full command from a required-scope list, finds the creds file by matching `client_id`, and verifies the result with `tokeninfo` instead of trusting `expiry_date`. **After every re-auth, also refresh the one CI copy of this credential:** aac-cockpit's `CLASPRC_JSON` secret (used by deploy.yml + promote.yml; no other AAC repo has one) — `gh secret set CLASPRC_JSON < ~/.clasprc.json` from the aac-cockpit repo, else the next CI deploy dies on `invalid_grant` (it did on 2026-08-17).
- **Reading Apps Script execution history:** use `GET script.googleapis.com/v1/processes:listScriptProcesses?scriptId=…` (scope `script.processes`). **Not** `processes?userProcessFilter.scriptId=…` — that filters to processes the *caller* started, so a service account gets `0` rows, which reads as "never ran" and is not. The service account can do this; it does not need clasp.
- **Running deployed code three ways:** (1) `clasp run-function <fn>` — PUBLIC fns only (no underscore); runs under the clasp token, whose grant DOES include full `/auth/drive` (see above — the old "drive.file only, full-Drive ops fail" note was wrong). A `Required: /auth/drive` error from a bound script is the project's pinned `oauthScopes`, not the token. (2) **`doPost` web app** — runs as the owner with full grant (incl. Drive); gate with a secret + whitelist, `clasp deploy` a fresh version (the `@HEAD` deployment has no usable `/exec`), POST via **PowerShell `Invoke-RestMethod`** (curl 411s on Apps Script's 302). (3) the sheet menu / trigger.
- **Canonical AAC scope block** (superset of every AAC data/ops project's declared scopes; pin this verbatim in each `appsscript.json`): `spreadsheets`, `drive`, `mail.google.com`, `script.external_request`, `script.scriptapp`, `script.container.ui`, `userinfo.email`. Scope enforcement is **lazy/per-call** — declaring a scope the code doesn't call is inert (no trigger breakage); the grant only needs to catch up when code actually invokes that scope (or at the next interactive auth).
- **AAC ops projects (repo ↔ online name ↔ scriptId), all bound to `projectId gpt-sheets-access-475817`:** `Sales Data KPIs/commissions` ↔ "AAC 2026 Sales Commissions Script" (bound, `1kt5rVEw…`); `Sales Data KPIs/aac-cockpit` ↔ "AAC Snapshot Pipeline" (`1Dd7GVub…`); `Financial/aac-bill-intake/gas` ↔ "AAC AP Intake (dry run)" (`1hIdNvfr…`). All three carry the canonical block as of 2026-07-20. (Enumerate all account script projects via Drive `files.list mimeType='application/vnd.google-apps.script'` + Apps Script `projects.getContent`; bound scripts like commissions don't appear in that Drive list.)
- **Auth model:** bound Apps Script runs as the **user** (djgatsakos@gmail.com), never a service account — so "no permission to call DriveApp.X / Required: /auth/drive" means the stored grant is behind the pinned `oauthScopes`; fix by re-authorizing once (interactive). Pin a **broad `oauthScopes`** list per project and authorize once to stop scope-drift breakage. Publishing the OAuth consent screen out of Testing is the only thing that stops the 7-day token expiry.

## From a cloud container

Which credential carries a Google call is a property of the **surface**, not of the caller. Three
transports reach the same identity, `gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com`;
share the workbook Editor with that address and any of them can read it. One helper in
claude-dotfiles picks between them so a caller never has to:
`python3 <claude-dotfiles>/tools/google-rest.py transport|whoami|cell|get`.

- **Pro/Max cloud session (`CLAUDE_CODE_REMOTE=true`)** — the key is an *environment API
  credential* held by the agent proxy, which mints the access token and attaches `Authorization`
  to every `*.googleapis.com` request. Send **no** Authorization header and load no key file:
  `google.oauth2.service_account` / `AuthorizedSession` are wrong here (there is nothing on disk
  to load, and `google-auth` is not even installed). Plain `curl` / `urllib` / `requests` to
  `sheets.googleapis.com`, `www.googleapis.com/drive/v3`, `script.googleapis.com`,
  `cloudresourcemanager.googleapis.com` and `logging.googleapis.com` all arrive as the SA.
  The proxy **replaces** a header you send rather than passing it through — a deliberately bogus
  bearer token still answers `200` as the SA — so code that signs here does not fail loudly, it
  silently runs as a principal it did not choose.
- **Team / Enterprise** — the API-credentials section does not exist on those plans ("aren't
  available on Team or Enterprise plans yet"), so the key JSON rides the `GPT_SHEETS_SA_KEY_JSON`
  environment variable on an owner-only environment and the PC code path applies, reading the JSON
  from the variable instead of the file. Check that variable **before** `CLAUDE_CODE_REMOTE`: a
  Team container sets `CLAUDE_CODE_REMOTE=true` too, but its proxy attaches nothing, so the
  ambient branch would send an unauthenticated request straight into a 401.
- **The PC** — unchanged: the key file at
  `~/.config/gpt-sheets-access-475817-853f8648243b.json`, `service_account` → `AuthorizedSession`.

**Gmail rides none of them.** `mail.google.com` on the SA token answers `400 Precondition check
failed` — the SA has no mailbox, and a personal @gmail.com cannot delegate domain-wide. Gmail from
a cloud session is the claude.ai **Gmail connector**; on the PC it is the clasp token. The helper
refuses Gmail URLs on every transport so the failure never reads as a scope problem.

**Verification commands** (run them before believing any of the above; transcript from a Pro/Max
cloud container, 2026-09-16, issue 172):

```
$ ls ~/.config/gpt-sheets-access-475817-853f8648243b.json; echo "GPT_SHEETS_SA_KEY_JSON=[$GPT_SHEETS_SA_KEY_JSON]"
ls: cannot access '/root/.config/gpt-sheets-access-475817-853f8648243b.json': No such file or directory
GPT_SHEETS_SA_KEY_JSON=[]

$ python3 tools/google-rest.py transport
cloud-proxy	CLAUDE_CODE_REMOTE (agent proxy attaches Authorization; we send none)

$ python3 tools/google-rest.py whoami
gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com

$ python3 tools/google-rest.py cell 1dBhSYwk1lHXAosMtbdQ4qI73Rb60BBiB4S6h42ruUQg "Script Errors!A1"
Timestamp

$ curl -sS -o /dev/null -w '%{http_code}\n' https://gmail.googleapis.com/gmail/v1/users/me/profile
400
```

`whoami` answering the SA address is the proof the transport is live; a `401` there means the
surface is not the one you assumed (a Team container with the variable unset, most often).
