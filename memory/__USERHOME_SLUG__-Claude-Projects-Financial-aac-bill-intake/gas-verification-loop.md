---
name: gas-verification-loop
description: How to deploy + verify the AAC AP intake GAS pipeline headlessly (env chosen by Script Property; ping reports it)
metadata: 
  node_type: memory
  type: project
  originSessionId: 20672470-b9c8-407b-98b2-b7d7f76a4661
  modified: 2026-08-26T13:56:06.943Z
---

The `gas/` Apps Script pipeline is deployed and processes real forwarded AAC invoice mail. Which
BILL environment its Script Properties point at is a runtime fact — **always ask `clasp run-function
ping`, which reports `env`**. Production went live 2026-07-28; do not assume sandbox from a stale
doc.

Verify changes headlessly (no Gmail UI needed) from `gas/`:
- `clasp push -f` — deploy (`.claspignore` keeps `*.test.js`, `README.md`, configs out).
- `clasp run ping` — side-effect-free; confirms env=SANDBOX/PROD before any run.
- `clasp run reprocessReview` — re-runs the `bill-review` pile; dedup-safe (already-created bills
  become DUPLICATE, so re-running loses fresh CREATE/NO-ATTACH outcomes — read them once).
- `clasp run tailLog` — dumps the last N Log-sheet rows; the **Log sheet is the source of truth**
  for per-invoice outcomes (the run's stdout summary is easily truncated).

Builds on [[clasp-run-autonomy]] and [[gas-testing-architecture]]. Oversize handling splits two
caps: `MAX_CLAUDE_BYTES` (20MB read) vs `MAX_BILL_ATTACH_BYTES` (10 MiB / 10,485,760 bytes upload,
prod's gateway cap measured 2026-07-29). Big invoices are read + coded, then the PDF is SPLIT into
sub-cap page-range parts (vendored pdf-lib in `PdfLib.gs` + `PdfSplit.gs`; pure bin-packing =
`core.binPackPages`) and ALL parts attached (`… (part k of N)`). A SINGLE page over the cap is
DOWNSAMPLED: rendered via the Drive REST API and attached as a JPEG image (flagged lossy). The
split/downsample run as a fire-and-forget async batch after the sync write pass — pdf-lib is
promise-based and GAS drains the queue before teardown. Verify PDF rendering only in prod (stage
corrupts uploads and refuses much lower).

**Auth facts for headless verification (updated 2026-07-31 per tokeninfo):**
- clasp runs as **djgatsakos@gmail.com** (script owner); its token grant DOES include full
  `/auth/drive` plus `drive.file` and `drive.metadata.readonly`, along with `mail.google.com`,
  `spreadsheets`, `cloud-platform`, `script.*`, and `userinfo.*`. `DriveApp` (needs full drive)
  works under clasp run. Any "Required: /auth/drive" error from a bound script is the project's
  pinned `oauthScopes`, not the token; re-authorize interactively to catch the grant up.
- SA key on disk: `__USERHOME_FWD__/.config/gpt-sheets-access-475817-853f8648243b.json`
  (`gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com`, project = the `.clasp.json`
  projectId). SA **can** drive Drive/Sheets REST (files.create returns 200) but **cannot** run
  Apps Script functions — `scripts.run` → 404 (script `executionApi.access: MYSELF`, owner-only).
- To run deployed code as the owner headlessly: deploy a temporary secret-gated `doPost` web app
  (`clasp deploy`), call `/exec`, then `clasp undeploy`. Deploy out-of-band only — never commit the
  dispatcher or its secret; remove the deployment after.
- Drive thumbnails are **progressive** JPEGs; pdf-lib `embedJpg` only accepts **baseline**, so
  attach the rendered JPEG directly rather than rebuilding a PDF.

**Web-app `/exec` is a PINNED deployment (learned 2026-07-20).** The Desk webhook target `/exec` URL
serves a specific deployment version, NOT HEAD. `clasp push` updates HEAD (so `clasp run` sees new
code immediately) but does NOT change what `/exec` serves. To update the live webhook endpoint you
must redeploy the pinned deployment: `clasp deploy --deploymentId <existing-id>` (find ids via
`clasp deployments`). The AP-intake `/exec` deployment is `AKfycbzfzU80…` (was @9, now @11+). Forgetting
this = POSTing to `/exec` runs STALE code and gives a FALSE green. Always redeploy before an
`/exec`-based live verification. (`clasp run` is unaffected — it runs pushed HEAD.)
