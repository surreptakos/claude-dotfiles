---
name: message-board-google-access
description: What the claude-code service account can and cannot do on the Message Board script and sheet; only clasp can push code.
metadata: 
  node_type: memory
  type: project
  originSessionId: e225ee62-0293-4970-8a24-a05c32680535
  modified: 2026-07-29T23:10:37.393Z
---

Verified 2026-07-29, after the owner enabled the APIs in the Cloud console (they were all disabled
earlier the same day, which made the service account useless until then).

**Service account** `claude-code@project-id-3741568742576186263.iam.gserviceaccount.com` (key on the
OneDrive Desktop, `writer` on the spreadsheet). It does not expire, so prefer it for reads.

- Works: Apps Script `projects.get` / `getContent` / `versions.list` / `deployments.list` /
  `processes.list` (that last one needs the `script.processes` scope), Sheets read, Drive metadata on
  the spreadsheet, and Sheets write at file level.
- **Cannot push code.** `updateContent` and `versions.create` both return
  `403 User has not enabled the Apps Script API`, pointing at `script.google.com/home/usersettings` —
  a **per-user** toggle a service account has no way to set. This is a ceiling, not a config gap.
  Don't retry it. Two non-fixes already ruled out: the SA holds `roles/owner` on the GCP project
  (unlocked Cloud Resource Manager and Service Usage, changed nothing about `updateContent` —
  different layer), and domain-wide delegation is unavailable because the script's owner is a
  consumer gmail account, so `with_subject` returns `unauthorized_client`. Retried across 90s in case
  it was propagation; it isn't.
- `scripts.run` → 404 (`executionApi.access: MYSELF`). `clasp run-function` fails the same way, with
  "Script function not found. Please make sure script is deployed as API executable."
- **To verify a `clasp push` actually runs, read the script's executions — not the caller's.**
  `GET /v1/processes?userProcessFilter.scriptId=…` returns **0 rows** for the service account, because
  it filters to processes *the caller* started and the SA starts none; that empty list looks like "no
  executions" and is not. Use `GET /v1/processes:listScriptProcesses?scriptId=…` instead, which
  reports executions *of* the script. The 15-minute `checkBoardsAutorun` trigger is then a free
  post-deploy smoke test: a load-time error in `Code.js` fails every execution, so the first
  `COMPLETED` after the push timestamp proves the new code parses and runs in V8.
- `projects.getContent` returns files named `Code` and `appsscript` — **no extensions**. Keying a dict
  on `'Code.js'` raises `KeyError`.
- Drive metadata on the **script** file → 404. A bound script isn't a separate Drive file to anyone
  but its owner. Use the Apps Script API instead; the 404 is not a permissions problem.
- A `getContent` call returned `429 Resource has been exhausted` once and succeeded on retry — treat
  429 here as transient, not as a permission signal.

**Sheet writes are blocked by range protection, not by role.** 12 of the 13 tabs are protected and the
service account is an editor on none of them (`Leads / Jobs` alone has 13 protected ranges, one
covering the whole sheet). Writes fail `400 You are trying to edit a protected cell or object`. Only
`Archived Sheets` is unprotected. Being a file-level `writer` is not enough — SA writes would need it
added as an editor on each protection.

**Pushing code needs the clasp token** at `~/.clasprc.json` (`djgatsakos@gmail.com`, the script's
creator). It can expire on a 7-day cycle while the OAuth consent screen is in Testing.

`tools/header-drift.js` in the repo tries the service account first and falls back to clasp;
`MESSAGE_BOARD_SA_KEY` overrides the key path.

Related: [[aac-apps-script-access]]
