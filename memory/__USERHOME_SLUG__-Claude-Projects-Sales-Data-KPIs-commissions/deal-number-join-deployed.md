---
name: deal-number-join-deployed
description: Deal_Number join fix DEPLOYED 2026-08-12 (PR #17, #16 closed); clasp token healthy again; OSH-Patterson CO1 skip is CORRECT, do not "fix" it
metadata:
  type: project
---

PR #17 merged `d4e8966`, pushed live 2026-08-12, sync verified: `Jobs Billing: 58 (joined: 52 Deal_Number, 0 W_O, 6 Work_Order)` (was `0 W_O, 48 Work_Order`). #16 closed. #15 (Aug stub verification) now UNBLOCKED — its table figures predate the sync, re-read first.

**Why:** skip line names `6551719000042369002` OSH-Patterson-Intercom-Internal CO1 — no deal exists for it, attaching to Z-3937 would re-create the overwrite bug. Skipping is the feature working; recorded in DECISIONS.md.

**How to apply:** clasp token is CLEAN (20 scopes, verified via `node tools/clasp-auth.js`) — [[sheet-rest-api-access]] claims of dead token/403 are stale. `reauth-clasp.ps1` deleted (PR #18); restore `git checkout 1106c0f -- reauth-clasp.ps1`. `clasp logs` unreliable for Logger output — query Cloud Logging `entries:list` on `projects/gpt-sheets-access-475817` instead.
