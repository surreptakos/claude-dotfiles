---
name: desk-channel-intake-progress
description: "Status of the desk-channel-intake feature — which of the 13 issues are done/verified vs human-gated, as of 2026-07-20"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3d49ce01-d0f0-448b-afa6-781fff136b93
  modified: 2026-07-21T20:37:04.558Z
---

Orchestrated build of the Zoho Desk AP channel (PRD + ADR-0002, issues 01–13 in
`.scratch/desk-channel-intake/`). All work is on `main`, sandbox-only (Desk 932165744, BILL stage),
verified live. `node --test` at 134/134.

**DONE & live-verified in sandbox** (commits fbcb2f2→efe790c):
- #1 tier/GL-override/ticket-field logic (pure, fixtured)
- #4 tracer: Desk webhook `doPost` → thread-attachment fetch → engine → tier → BILL bill + cf
  write-back + comment. `/exec` deployment `AKfycbzfzU80…` (pinned — see [[gas-verification-loop]]).
- #6 idempotency + partial-failure (re-fire → one bill, key preserved; distinct WRITEBACK-FAILED)
- #5 held-tier Data-verify creates the bill from CORRECTED fields (corrected GL provably on the line)
- #10 structured rejection → BILL archive + manual-QBD-void note + cf_ap_stage='Rejected'
- #11 feedback: wrong-vendor→Aliases suggestion, wrong-GL→'GL Overrides' sheet (confirm-before-live;
  feeds #1's glOverrideLookup). Sheet tab in the Aliases spreadsheet.
- #12 payment poll → Paid/close (classifier `billPaymentState`; installer not auto-run)
- #9 (digest half) `escalationTier` classifier + weekly digest `runWeeklyDigest` (recipient
  Script Property `DIGEST_RECIPIENT`, fallback dgatsakos@activealarm.com). Native Desk escalation
  Workflow Rules deferred (need AP dept). **WORKING** — sends via `GmailApp.sendEmail` (Digest.gs:173),
  covered by the already-granted `mail.google.com` scope; no re-auth needed. NOTE: earlier live errors
  at 2026-07-20T20:20 ("no permission to call MailApp.sendEmail / Required: script.send_mail") were the
  pre-fix `MailApp` version; switched to GmailApp on 2026-07-21 (comment at Digest.gs:166 documents
  why — MailApp needs the narrower script.send_mail scope that's NOT in the manifest). Those stale
  ERROR lines still linger in `clasp logs`; do not read them as a current failure — a clean manual
  run of runWeeklyDigest (no consent prompt, "execution completed") is the authoritative signal.
- #2 (partial) 11 AP custom fields created + `Ap Stage`; `DESK_AP_FIELD_MAP` Script Property. Gate
  state is custom field `cf_ap_stage` (NOT native status — see [[desk-provisioning-api-facts]]).

**HUMAN-GATED remainder** (not doable by the agent):
- Desk admin UI (sandbox): create the **AP department** (`POST /departments` blocked, missing
  Desk.basic.CREATE) + seed **Rejection Reason** picklist choices. Then agent scripts the webhook +
  #9 escalation Workflow Rules + #8 via the settings API (scope in hand).
- #8 vendor comment thread — needs the AP dept + channel.
- #12 real paid→closed cell — needs a human to pay one sandbox bill, then `runPaymentPoll`.
- #3 BILL prod cutover + retire approval policy + a PROD-portal Zoho token (stored separately —
  tokens are portal-bound, [[zoho-desk-token-scope]]).
- #13 M365 auto-forward ap@ → Desk channel + From-Address + the two live checks.
- #7 legacy-166 recovery — needs #3+#13 live.

Many defects were caught by verifying against reality: write-back silently no-oped (wrong cf key),
attachment path missing `/content`, re-fire blanked the reconciliation key, `PATCH status='Closed'`
silently no-ops (use 'Closed or Done'). See [[gas-verification-loop]] for the deploy/verify method.
