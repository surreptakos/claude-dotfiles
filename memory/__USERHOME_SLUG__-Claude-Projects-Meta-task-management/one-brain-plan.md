---
name: one-brain-plan
description: "The north-star plan — one brain (aacx store), all deliverables are views; Phase 1 merged to master; Phase 2 go-live machinery (tickets 28-29) built + verified 2026-07-22, live_writes flag left OFF (Dan-gated)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9ea4bdb6-2369-4650-9b9e-7a4c8ff48269
  modified: 2026-07-23T13:37:10.699Z
---

Dan's north star for the task-management assistant: **one digital brain** (the
aacx store) that feeds the daily report, O3s, weekly wins, and later personal/
birthdays — no decoupled tool he reconciles by hand.

Grilled to shared understanding on 2026-07-22 (ask-matt → grilling, under YES
discipline). All 4 phases specced + ticketed (issues 23–36). **Phase 1 build COMPLETE +
verified** on `feat/phase1-open-loop-engine` (2026-07-22, one commit per
ticket, 264 tests green incl. the case-51280 regression): 23 (open-loop
detector + `commitments.origin`), 24 (direction-aware closure — owes_dan
closes only on a genuine counterparty comms reply, never a meeting/calendar/
doc, upholding never-close-on-inference), 25 (support@/service@ shared
mailboxes + shared `is_noise` filter wired into openloops+triage), 26
(delegation radar, propose-only), 27 (email-to-self delivery payload +
propose-only run mode; sweep's execute-auto-actions step gated off). **Merged
to master 2026-07-22** (merge commit `1b2a907`; 264 tests green on master) but
**not yet pushed to origin**. The live go-live (real Todoist writes) is Phase 2.

Canonical record lives IN THE REPO (read these, not this memo, for detail):
- `docs/adr/0006-one-brain-all-views.md` — the anchor decision.
- `docs/CONTEXT.md` — vocabulary, the 9 decisions, the 4-phase plan, live status.

Phase 1 (first to build) = open-loop engine **+** delegation radar, propose-only
(no live writes), after closing the `support@`/`service@` ingest gap and
root-causing why only 2 commitments exist. See [[o3-routines-full-playbook]] and
[[step3-stage-backfill-explosion]] (Phase 2 go-live rides on that backfill bound).

Two Phase-1 parameters Dan decided 2026-07-22, both now shipped on the branch:
daily report **delivered by email-to-self** (dgatsakos@activealarm.com, Outlook
— issue 27 default); open-loop **aging window = 1 business day** (set in
`config/openloops.yaml`; code-default fallback constant stays 2). Noise-filter
follow-up is closed (issue 25 shipped it).

**Phase 2 go-live machinery built + MERGED to master + pushed 2026-07-23**
(merge `2a22560`; 283 tests green incl. case-51280; acceptance criteria revised
+ full checklist in `docs/HANDOFF.md`; the scheduled-task wrapper
`~/.claude/scheduled-tasks/daily-morning-update/SKILL.md` now routes through
`golive-actions`). Remaining to actually go live = ops flip only (authenticated
sweep → `aacx golive-enable` → enable the disabled `daily-morning-update` task):
- Pre-flight DONE: `ALTER TABLE commitments ADD COLUMN origin TEXT NOT NULL
  DEFAULT 'enrich'` applied to the live `data/aac.db` (backup
  `data/aac.db.pre-origin-bak`; 2 pre-existing rows backfilled to enrich).
  Verified: openloops/reconcile/enrich-apply run clean (no "no such column").
- Ticket 28 (`a01dd82`): `aacx golive-report` — store-only, read-only go-live
  acceptance report (`aacx/pipeline/golive_report.py`), executes nothing.
- Ticket 29 (`a8d3b42`): durable `live_writes` flag in `meta` (default OFF) +
  `executable_auto_actions` guard + CLI `golive-status`/`-enable`/`-disable`/
  `-actions`; `scheduled/daily-sweep.md` step 12 rewired to be flag-gated.
- **`live_writes` is OFF on the live DB and stays OFF** — flipping it on +
  enabling the disabled `daily-morning-update` task is the Dan-gated go/no-go,
  NOT autonomous. First live-snapshot dry run (stale 7/21 store, no fresh
  fetch): past-due 18 / p1 18 (above the 0 / ~10 targets), 64 bounded auto
  updates+reschedules, **0 auto creates (729 creates backfill-bounded — no p1
  explosion)**, 14 propose reschedules. Definitive green gate needs a fresh
  authenticated sweep.
