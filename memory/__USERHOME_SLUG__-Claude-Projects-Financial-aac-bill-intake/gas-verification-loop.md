---
name: gas-verification-loop
description: How to deploy + verify the AAC AP intake GAS pipeline headlessly against the BILL sandbox
metadata: 
  node_type: memory
  type: project
  originSessionId: 20672470-b9c8-407b-98b2-b7d7f76a4661
  modified: 2026-07-20T23:30:26.748Z
---

The `gas/` Apps Script pipeline is deployed and processes real forwarded AAC invoice mail; as of
2026-07-17 its Script Properties point at the **BILL SANDBOX** (`gateway.stage.bill.com`), with the
Anthropic key + BILL creds set.

Verify changes headlessly (no Gmail UI needed) from `gas/`:
- `clasp push -f` — deploy (`.claspignore` keeps `*.test.js`, `README.md`, configs out).
- `clasp run ping` — side-effect-free; confirms env=SANDBOX/PROD before any run.
- `clasp run reprocessReview` — re-runs the `bill-review` pile; dedup-safe (already-created bills
  become DUPLICATE, so re-running loses fresh CREATE/NO-ATTACH outcomes — read them once).
- `clasp run tailLog` — dumps the last N Log-sheet rows; the **Log sheet is the source of truth**
  for per-invoice outcomes (the run's stdout summary is easily truncated).

Builds on [[clasp-run-autonomy]] and [[gas-testing-architecture]]. Oversize handling splits two
caps: `MAX_CLAUDE_BYTES` (20MB read) vs `MAX_BILL_ATTACH_BYTES` (6MB upload). Big invoices are read
+ coded, then the PDF is SPLIT into sub-5MB page-range parts (vendored pdf-lib in `PdfLib.gs` +
`PdfSplit.gs`; pure bin-packing = `core.binPackPages`) and ALL parts attached (`… (part k of N)`).
A SINGLE page over the cap is DOWNSAMPLED: rendered via the Drive REST API and attached as a JPEG
image (flagged lossy). The split/downsample run as a fire-and-forget async batch after the sync
write pass — pdf-lib is promise-based and GAS drains the queue before teardown. All verified
end-to-end against the BILL sandbox.

**Auth facts for headless verification (learned 2026-07-17):**
- clasp runs as **djgatsakos@gmail.com** (script owner); its token has `drive.file` (NOT full
  `/auth/drive`). `scripts.run` enforces caller-token ⊇ script scopes, so GAS `DriveApp`
  (needs full drive) FAILS under clasp run. Fix: use the **Drive REST API via
  `ScriptApp.getOAuthToken()` + UrlFetch** — works with `drive.file`, so it runs under both clasp
  run and the trigger. Never use `DriveApp` for new code here.
- SA key on disk: `__USERHOME_FWD__/.config/gpt-sheets-access-475817-853f8648243b.json`
  (`gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com`, project = the `.clasp.json`
  projectId). SA **can** drive Drive/Sheets REST (files.create returns 200) but **cannot** run
  Apps Script functions — `scripts.run` → 404 (script `executionApi.access: MYSELF`, owner-only).
- To run deployed code as the owner headlessly: deploy a temporary secret-gated `doPost` web app
  (`clasp deploy`), call `/exec`, then `clasp undeploy`. Deploy out-of-band only — never commit the
  dispatcher or its secret; remove the deployment after.
- Drive thumbnails are **progressive** JPEGs; pdf-lib `embedJpg` only accepts **baseline**, so
  attach the rendered JPEG directly rather than rebuilding a PDF.

Confirm PDF *rendering* only in prod (stage corrupts uploads).

**Web-app `/exec` is a PINNED deployment (learned 2026-07-20).** The Desk webhook target `/exec` URL
serves a specific deployment version, NOT HEAD. `clasp push` updates HEAD (so `clasp run` sees new
code immediately) but does NOT change what `/exec` serves. To update the live webhook endpoint you
must redeploy the pinned deployment: `clasp deploy --deploymentId <existing-id>` (find ids via
`clasp deployments`). The AP-intake `/exec` deployment is `AKfycbzfzU80…` (was @9, now @11+). Forgetting
this = POSTing to `/exec` runs STALE code and gives a FALSE green. Always redeploy before an
`/exec`-based live verification. (`clasp run` is unaffected — it runs pushed HEAD.)
