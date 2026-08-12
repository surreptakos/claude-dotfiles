---
name: clasp-push-never-deletes-remote-files
description: "clasp push only adds and updates — deleting a local file leaves it in the Apps Script project; use the API's updateContent to remove it."
metadata: 
  node_type: memory
  type: reference
  originSessionId: cb11045a-f3c9-40ed-906f-93c6b5917caf
  modified: 2026-07-30T18:17:12.526Z
---

`clasp push` (v3.3.0) never removes a remote file. Delete a file locally and push, and clasp reports **"Script is already up to date"** while the file stays in the Apps Script project — so a scratch file pushed to run something once silently persists in production.

**How to apply:** verify with `clasp pull` into a temp dir and list what comes back; don't trust the push output. To actually remove a file, `PUT https://script.googleapis.com/v1/projects/{scriptId}/content` with the full intended file set (it replaces the whole set). Mint a token from `~/.clasprc.json` → `tokens.default` (`client_id`, `client_secret`, `refresh_token`) against `oauth2.googleapis.com/token`.

For this repo the intended set is exactly `Code.js`, `Dashboard_v2.html`, `Components.html`, `Signals.html`, `appsscript.json`. Note file `name` in the API payload is the basename **without** extension, with `type` `SERVER_JS` / `HTML` / `JSON`.

Using the live script as a one-off runner is safe enough for read/write jobs the local machine can't authenticate for (it holds the Zoho credentials in Script Properties), but diff live against the worktree first — `clasp pull` output differs from the repo only by CRLF, so compare CR-normalized or every file looks changed.
