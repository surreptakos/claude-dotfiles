---
name: stale-pending-actions-persist
description: re-running plan does NOT retract prior pending action rows; golive-actions still returns superseded ones. Void them or they execute.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f1f29b8d-a5d4-4a36-8f49-8c6357011f21
  modified: 2026-07-23T17:49:01.360Z
---

`plan`/`triage`/`billing` INSERT new `pending` rows into the `actions` table but never retract prior pending rows. If a classification is corrected mid-run and plan re-run produces 0 new actions, the OLD pending `mode:auto` rows still sit in `actions` with `status='pending'`, and **`golive-actions` still returns them** (it returns every pending auto row, not just this run's). Executing them applies the superseded/wrong action.

**How to apply:** after correcting an enrichment/classification and re-running the compute stages, check `SELECT id,kind,todoist_id,mode,status,reason FROM actions WHERE status='pending'`. Void the stale rows before executing: `UPDATE actions SET status='skipped', result_json=..., executed_at=... WHERE id IN (...)`. Then re-run `golive-actions` to confirm it reflects the corrected set. Done 2026-07-23 for rows 943-948 (superseded by [[enrich-owner-is-actor-not-referent]] fix). `status='skipped'` is the existing terminal status the backfill-bound rows use.
