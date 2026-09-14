# AGENTS.md — global user memory

Personal instructions that apply to every project and session on this machine.

## Fundamental Workflow and Governance

Consult `ask-matt` and `yes` for all requests, no matter how trivial.

### Standing enforcement

- **ASK-MATT:** Name one applicable route before any tool or final answer.
- **YES GOVERNANCE:** Evidence over intuition. Investigate before asking. Back up before system changes. Verify every change and check ripple effects. Never hand solvable work back.
- **CAVEMAN ULTRA:** Minimum words; each fact once; fragments allowed; strip safe conjunctions. No filler, pleasantries, hedging, tool narration, decorative formatting, self-reference, invented abbreviations, or causal arrows. Preserve technical terms, code, commands, and exact errors. Use plain language when safety or ambiguity requires it.

These disciplines apply to every turn and cannot be disabled inside a session. Changing them requires an explicit edit to this global policy and matching global hooks.

**Never claim you cannot do something in the environment** (run a command, execute a function, reach an API, use a tool) without first attempting it and reading the actual result. Verify limits empirically. Do not assert a limitation from memory, from inference, or from a prior session, and do not hand a task back on the strength of an untested assumption. A stale note saying you "can't" never outranks a live test.

**Never tell the user you cannot run a function — in any project, ever.** You can edit, commit, and deploy code, so you can run any function: add an execution path (endpoint, handler, script entry point, test, `main`) and invoke it. For a deployed web app, edit the code and POST its endpoint (Apps Script `/exec`, a serverless route); it runs with the deployer's authorization and bypasses per-caller gates. Direct runners first (CLI, `clasp run`, REST, running the file locally); edit-commit-deploy-and-invoke is the universal fallback.

**Do not hand a solvable question back to the user as "your call to make."** Before writing "owner must decide" / "user must choose", check whether it is a preference or business judgment call — or an investigation you stopped short of finishing. If a tool, API, or search could settle it, use it first. Two workable options found in code already open is evidence you stopped looking, not that nothing better exists. Exhaust the investigation, then ask only what remains a judgment call.

## AAC Google Cloud & Apps Script access

Durable, owner-grade access is on disk. Do not claim otherwise or ask the operator for these.

- **Shared GCP project** for every AAC Apps Script project: ID `gpt-sheets-access-475817`, number `594980791877`. Owns the clasp OAuth client and the service account. Put `"projectId": "gpt-sheets-access-475817"` in each repo's `.clasp.json` so `clasp logs` works.
- **Service account, no expiry:** `gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com`, key at `~/.config/gpt-sheets-access-475817-853f8648243b.json`. Use from Python (`google.oauth2.service_account` → `AuthorizedSession`) for direct Sheets/Drive REST — bypasses the gen-AI-ineligible flag, never expires. Share the target workbook Editor with the SA email. The SA cannot run Apps Script functions (`scripts.run` → 404; `executionApi.access: MYSELF`).
- **clasp token** (`~/.clasprc.json`, user `djgatsakos@gmail.com`): refresh at `oauth2.googleapis.com/token`. Scopes include `spreadsheets`, `mail.google.com`, `cloud-platform`, `logging.read`, `script.*`, and `drive.file` (NOT full `/auth/drive`). Verify with tokeninfo, do not assume. Re-auth via the AAC helper, never a bare `clasp login`.
- **Canonical AAC scope block** (pin verbatim in each `appsscript.json`): `spreadsheets`, `drive`, `mail.google.com`, `script.external_request`, `script.scriptapp`, `script.container.ui`, `userinfo.email`. Scope enforcement is lazy/per-call — a declared but uncalled scope is inert; the grant catches up when code invokes it or at the next interactive auth.
- **Run deployed code — primary:** `node <claude-dotfiles>/gas/cli/gas.js run owner/repo <fn> '[args]' --wait 10`. Every AAC Apps Script repo carries `gas.json` + a vendored `SelfDeploy.js` (claude-dotfiles `gas/`); a merge to the default branch is the release. History: `clasp logs` (needs `projectId` in `.clasp.json`).
- **Run deployed code — legacy fallbacks (pre-2026-09-09; `clasp push` and `clasp run-function` are retired — memory notes marked "retired path" describe these):** (a) `clasp run-function <fn>` — public fns only (no underscore); runs under the clasp token so full-Drive ops fail (drive.file only). (b) `doPost` web app — runs as the owner with full grant (Drive included); gate with a secret + whitelist, `clasp deploy` a fresh version (the `@HEAD` deployment has no usable `/exec`), POST via PowerShell `Invoke-RestMethod` (curl 411s on Apps Script's 302). (c) sheet menu / trigger.
- **Auth model:** bound Apps Script runs as the user, never a service account — so "no permission to call DriveApp.X / Required: /auth/drive" means the stored grant is behind the pinned `oauthScopes`; fix by re-authorizing once (interactive). Pin a broad `oauthScopes` per project and authorize once to stop scope-drift breakage. Publishing the OAuth consent screen out of Testing is the only thing that stops the 7-day token expiry.
- **AAC ops projects (repo ↔ online name ↔ scriptId), all bound to `projectId gpt-sheets-access-475817`, all carry the canonical scope block as of 2026-07-20:** `Sales Data KPIs/commissions` ↔ "AAC 2026 Sales Commissions Script" (bound, `1kt5rVEw…`); `Sales Data KPIs/aac-cockpit` ↔ "AAC Snapshot Pipeline" (`1Dd7GVub…`); `Financial/aac-bill-intake/gas` ↔ "AAC AP Intake (dry run)" (`1hIdNvfr…`).
- **Enumerate all account Apps Script projects** via Drive `files.list mimeType='application/vnd.google-apps.script'` + Apps Script `projects.getContent`. Bound scripts (e.g. commissions) do not appear in that Drive list — read the container spreadsheet's `.clasp.json` or the sheet menu.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:
1. `agent-browser open <url>` — navigate.
2. `agent-browser snapshot -i` — get interactive elements with refs (@e1, @e2).
3. `agent-browser click @e1` / `fill @e2 "text"` — interact using refs.
4. Re-snapshot after page changes.
