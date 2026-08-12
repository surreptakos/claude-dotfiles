---
name: o3-routines-full-playbook
description: The 5 weekly O3-prep scheduled tasks run the FULL investigative playbook (not aacx render o3); daily sweep + weekly wrap are aacx.
metadata: 
  node_type: memory
  type: project
  originSessionId: 9ea4bdb6-2369-4650-9b9e-7a4c8ff48269
  modified: 2026-07-21T22:32:11.035Z
---

Stood up 2026-07-21. Seven scheduled tasks registered via the scheduled-tasks MCP:

- `daily-morning-update` (Mon–Fri 09:10) and `weekly-wins-and-watches` (Fri 17:00) run the **aacx** pipeline (`-m aacx …`). `daily-morning-update` is **disabled** pending a GO/NO-GO on the first live-write run (see [[step3-stage-backfill-explosion]]).
- The five `weekly-o3-prep-<name>` (Tue) tasks run the **FULL O3 prep playbook**, not the lean `aacx render o3`. Dan chose full playbook on 2026-07-21 because the deterministic render was structurally identical but content-leaner (no coaching bank, no performance-vs-metrics, `personal`/`exclude_aliases` unused, no not-held carry-forward).

**Why full playbook:** it's connector-driven and investigative — seed+reconcile from the prior brief, Fathom-authoritative O3-held, topic-keyed newest-first sweep across shared mailboxes incl. support@/service@ (which aacx `sources.yaml` does NOT ingest), metrics, WHAT-IS-RED split, stop-slop + chat summary.

**How it's wired (each O3 task is a thin stub → playbook):**
- Method file (read at runtime): `…\OneDrive - Active Alarm Company, Inc\Claude\memory\context\o3-prep-playbook.md`.
- Builder (accustomed, has a `content.json out_dir date` CLI): `…\OneDrive - Active Alarm Company, Inc\Claude\build_o3_form.py`; outputs to the `…\Claude\O3 Prep` folder as `<Full Name> - O3 Prep <date>.docx` + `… - O3 Agenda (shareable) <date>.docx`. Verified working 2026-07-21 (37 KB docx).
- Prior-brief seed helper (Read tool can't open binary .docx): `scheduled/read_docx.py` in the repo.
- Every command uses the full interpreter path — see [[python-interpreter-path]].

**Open items:** Tue O3 times are placeholders (staggered 07:30/08:00/08:30/10:30/11:00) — reset each to ~1h before the real O3 slot. Click "Run now" once per task to pre-approve MCP connectors.
