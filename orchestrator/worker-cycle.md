# Worker cycle prompt template — RETIRED

> **RETIRED 2026-09-15 (issue 217, parent spec #207).** The cloud runbook was rewritten to the
> per-repo Routine model, which dispatches triage, to-tickets and the fleet in-session. There are
> no worker sessions and no `create_session` calls anywhere in the new runbook. Kept as a
> pointer only; do not spawn from this template. `RUNBOOK.md` is the live runbook.
>
> The prior body of this file (the worker-cycle prompt template, its eight numbered steps, the
> setup notes and the hard rails) lives in git history: `git log -p -- orchestrator/worker-cycle.md`
> from any clone; the last live revision is commit `4d002f2` (before the 2026-09-15 rewrite). It
> is not restated here so this file cannot be mistaken for live guidance, and so no product-
> prefixed connector tool name lingers in `orchestrator/` — every connector tool the new runbook
> reaches for is named by suffix (see `RUNBOOK.md`'s Rails section).
