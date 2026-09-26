# Worker cycle prompt template — RETIRED

> **RETIRED 2026-09-15 (issue 217, parent spec #207).** The cloud runbook was rewritten to the
> per-repo Routine model, which dispatches triage, to-tickets and the fleet in-session. There are
> no worker sessions and no `create_session` calls anywhere in the new runbook. Kept as a
> pointer only; do not spawn from this template. The live runbook is `LOCAL-RUNBOOK.md` since
> 2026-09-23 (ADR 0001); `RUNBOOK.md` keeps the shared rules and the paused cloud venue.
>
> The prior body of this file (the worker-cycle prompt template, its eight numbered steps, the
> setup notes and the hard rails) lives in git history: `git log -p -- orchestrator/worker-cycle.md`
> from any clone; the last live revision is commit `4d002f2` (before the 2026-09-15 rewrite). It
> is not restated here so this file cannot be mistaken for live guidance, and so no product-
> prefixed connector tool name lingers in `orchestrator/` — every connector tool the new runbook
> reaches for is named by suffix (see `RUNBOOK.md`'s Rails section).

## Shell shapes a worktree agent should know

Every fleet worker runs in an isolated worktree, where the Bash tool refuses shell shapes whose
text it cannot prove is not git (looped or `;`-joined `gh` calls, heredocs, byte-level pipelines).
The refused shapes and the working spelling for each are listed in
`aac-skills/ticket-fleet/REFUSED-SHAPES.md`, under "Shell shapes the worktree guard refuses" - read them
there; they are deliberately not repeated here.
