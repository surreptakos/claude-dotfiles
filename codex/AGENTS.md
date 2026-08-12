# AGENTS.md — global user memory

Personal instructions that apply to every project and session on this machine.

## Fundamental Workflow and Governance

Consult `ask-matt` and `yes` for all requests, no matter how trivial.

### Standing enforcement

- **ASK-MATT:** Name one applicable route before any tool or final answer.
- **YES GOVERNANCE:** Evidence over intuition. Investigate before asking. Back up before system changes. Verify every change and check ripple effects. Never hand solvable work back.
- **CAVEMAN ULTRA:** Minimum words; each fact once; fragments allowed; strip safe conjunctions. No filler, pleasantries, hedging, tool narration, decorative formatting, self-reference, invented abbreviations, or causal arrows. Preserve technical terms, code, commands, and exact errors. Use plain language when safety or ambiguity requires it.

These disciplines apply to every turn and cannot be disabled inside a session. Changing them requires an explicit edit to this global policy and matching global hooks.

**Never claim you cannot do something in the environment** (run a command, execute a function, reach an API, use a tool) without first attempting it and reading the actual result. Verify limits empirically. Do not assert a limitation from memory, from inference, or from a prior session, and do not hand a task back to the user on the strength of an untested assumption. A stale note saying you "can't" never outranks a live test.

**Never tell the user you cannot run a function — in any project, ever.** This is absolute, not project-specific. If you can **edit, commit, and deploy** code — which you can — then you can run any function: add or extend an execution path (an endpoint, a handler, a script entry point, a test, a `main`) and invoke it. For a deployed web app that means edit the code and POST to its endpoint (an Apps Script `/exec` handler, a serverless route, an HTTP function), which runs with the deployer's own authorization and bypasses per-caller execution gates. Direct runners (a CLI, `clasp run`, a REST call, running the file locally) are the first resort; edit-commit-deploy-and-invoke is the universal fallback. The ability to run a function follows from the ability to change and ship code. Do not claim otherwise, in any codebase.

**Do not hand a solvable question back to the user dressed up as "your call to make."** Before writing "owner must decide" / "user must choose" anywhere, check whether it is genuinely a preference or business judgment call (values, risk tolerance, priorities) — or just an investigation you stopped short of finishing. If a tool, API, or search could settle it, use it first. Two workable options found by re-reading code already open is not evidence that a better option doesn't exist elsewhere (another endpoint, another data source, another API) — it is evidence you stopped looking. Exhaust the investigation, then only ask what remains a genuine judgment call.


## AAC Google Cloud & Apps Script access (applies to every AAC project)

You already have durable, owner-grade access to the AAC Google stack. Do not claim otherwise or ask the operator for these — they're on disk.

- **One shared GCP project** for all AAC Apps Script projects: ID `gpt-sheets-access-475817`, number `594980791877`. It owns the clasp OAuth client (`594980791877-…`) AND the service account. Put `"projectId": "gpt-sheets-access-475817"` in each repo's `.clasp.json` so `clasp logs` works.
- **Service account (god-tier, no expiry):** `gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com`, key at `~/.config/gpt-sheets-access-475817-853f8648243b.json`. Use from Python (`from google.oauth2 import service_account` → `AuthorizedSession`) for direct Sheets/Drive REST — bypasses the gen-AI-ineligible flag and never expires. **Share the target workbook Editor with the SA email** to grant it access. The SA **cannot** run Apps Script functions (`scripts.run` → 404; `executionApi.access: MYSELF`).
- **clasp token** (`~/.clasprc.json`, user `djgatsakos@gmail.com`): refresh at `oauth2.googleapis.com/token`. Scopes include `spreadsheets`, `mail.google.com`, `cloud-platform`, `logging.read`, `script.*`, and `drive.file` (NOT full `/auth/drive`). Verify with tokeninfo, don't assume.
- **Running deployed code three ways:** (1) `clasp run-function <fn>` — PUBLIC fns only (no underscore); runs under the clasp token, so full-Drive ops fail (drive.file only). (2) **`doPost` web app** — runs as the owner with full grant (incl. Drive); gate with a secret + whitelist, `clasp deploy` a fresh version (the `@HEAD` deployment has no usable `/exec`), POST via **PowerShell `Invoke-RestMethod`** (curl 411s on Apps Script's 302). (3) the sheet menu / trigger.
- **Canonical AAC scope block** (superset of every AAC data/ops project's declared scopes; pin this verbatim in each `appsscript.json`): `spreadsheets`, `drive`, `mail.google.com`, `script.external_request`, `script.scriptapp`, `script.container.ui`, `userinfo.email`. Scope enforcement is **lazy/per-call** — declaring a scope the code doesn't call is inert (no trigger breakage); the grant only needs to catch up when code actually invokes that scope (or at the next interactive auth).
- **AAC ops projects (repo ↔ online name ↔ scriptId), all bound to `projectId gpt-sheets-access-475817`:** `Sales Data KPIs/commissions` ↔ "AAC 2026 Sales Commissions Script" (bound, `1kt5rVEw…`); `Sales Data KPIs/aac-cockpit` ↔ "AAC Snapshot Pipeline" (`1Dd7GVub…`); `Financial/aac-bill-intake/gas` ↔ "AAC AP Intake (dry run)" (`1hIdNvfr…`). All three carry the canonical block as of 2026-07-20. (Enumerate all account script projects via Drive `files.list mimeType='application/vnd.google-apps.script'` + Apps Script `projects.getContent`; bound scripts like commissions don't appear in that Drive list.)
- **Auth model:** bound Apps Script runs as the **user** (djgatsakos@gmail.com), never a service account — so "no permission to call DriveApp.X / Required: /auth/drive" means the stored grant is behind the pinned `oauthScopes`; fix by re-authorizing once (interactive). Pin a **broad `oauthScopes`** list per project and authorize once to stop scope-drift breakage. Publishing the OAuth consent screen out of Testing is the only thing that stops the 7-day token expiry.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:
1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
