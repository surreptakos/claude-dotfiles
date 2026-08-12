---
name: step3-stage-backfill-explosion
description: STEP 3 billing/triage stages fire on the whole historical backlog on first wired run; hygiene mass-escalates the +7 parked p2 batch. Held on 2026-07-20.
metadata: 
  node_type: memory
  type: project
  originSessionId: 24b585b8-f42c-48ed-a4a6-70b356ace643
  modified: 2026-07-20T23:47:34.094Z
---

On the `feat/step3-sweep-wiring` branch, the daily sweep's newly-wired STEP 3 stages over-fire on their first real run because they have no "already-processed backlog" bound:

- **billing (`aacx/render/billing.py`)** — treats every historical billing@ item with no prior `create` action as a "genuinely-open" p1 ask and writes `mode='auto'` create rows. On 2026-07-20 that was **86 p1 creates** from pure automation noise (Forte Payments/Funding summaries, SAP webinar spam, vendor auto-replies). No noise filter, no date bound; `confirmed_handled` only suppresses items whose topic has a resolved commitment or a later same-topic item, so untopiced noise all reads as "open."
- **triage (`aacx/pipeline/triage_actions.py`)** — surfaces historically-enriched comm items that never got a create action; on 2026-07-20 that included 2 stale p4 noise items (old USPS delivery id 1506, Anthropic receipt id 5938) alongside the 3 legitimately-classified p3 captures.
- **hygiene (`rule_priority_deadline_sync`)** — working as written, but Dan batch-parks ~50 p2 tasks at deadline = today+7 to hold them at p2 (strict `<7` boundary). Three days later they fall inside the window and the rule escalates all ~50 to p1+today at once. See [[p1-escalation-boundary]].
- **capture-log render (`aacx/render/capture_log.py`)** — logs EVERY `create` action by payload as "created …", regardless of execution status, so a hold run still writes phantom "created p1" rows (prior runs already left SAP/Forte phantom entries in the gitignored `data/capture-log.md`).

Executing the full `mode:auto` list would have created/promoted ~140 p1 tasks due today vs the sweep's own `p1 ≈ 10` acceptance target. **Held the entire computed action list (executed nothing against Todoist), same as the [[hygiene-contract-regex-overmatch]] precedent.** Pending action rows left intact as an audit trail; capture-log additions reverted.

**How to apply:** until these stages get a backlog bound (a "first-seen after cursor" / already-swept guard) — tracked in `docs/prd/step3-parity-and-sweep-fixes.md` — do NOT blind-execute `mode:auto` creates from billing/triage or the mass p2→p1 hygiene batch. Verify counts against acceptance (`p1 ≈ 10`, zero past-due) first; hold and report when a stage over-fires.
