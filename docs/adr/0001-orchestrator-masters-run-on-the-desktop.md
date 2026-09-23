---
status: accepted
supersedes: the 2026-09-15 retirement of orchestrator/LOCAL-RUNBOOK.md (issue 217, spec #207)
---

# Orchestrator masters run on the desktop, not as cloud Routines

On 2026-09-15 the four per-repo master orchestrators moved from the desktop watchdog to hourly
claude.ai cloud Routines. On 2026-09-23 Dan moved them back ("Go local"): a cloud session cannot
run a pass unattended. Three things block it, all measured:

- A Routine-fired session runs `acceptEdits`, not the repo's `auto` (see the
  `routine-sessions-run-acceptedits` memory note). Any tool missing from `permissions.allow`
  prompts, with nobody there to answer.
- The Workflow confirmation for `ticket-fleet` still appeared, offering only "Allow once", in
  repos whose allow list already names `Workflow`.
- A session started from the app runs `auto`. The classifier refuses commands on the shape of
  their text (issue 543 lists eight categories), and the widened `autoMode.allow` ruling did
  not stop it. `bypassPermissions` is not offered in the cloud.

The desktop profile runs `bypassPermissions` with the dangerous-mode prompt skipped, so a local
master never sees the classifier or a permission prompt.

## Considered options

- **Keep widening the cloud allow list and the `autoMode.allow` prose.** Tried from 2026-09-14 to
  2026-09-22 (issues 170, 245, 543, 651). Every round found a new prompt or category.
- **Remote Control from the cloud app into the PC.** This still runs on the desktop. It only
  changes where the window shows, so it is the same decision.

## Consequences

- `LOCAL-RUNBOOK.md` and the watchdog scripts come back as live, and `RUNBOOK.md` becomes the
  retired one. The per-repo state issues, the venue guard and `Pass complete` stay as they are,
  with `venue: local-pc`.
- The PC has to stay on. A pass that is due while it is off is skipped, not queued. That is the
  price of running unattended.
- The cloud Routines are paused, not deleted, so going back is a toggle.
