# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

This repo adds a sixth state the upstream table lacks: `ready-for-local-agent`, work a desktop session can do with no person in the loop but a cloud container cannot. `docs/agents/issue-tracker.md` (Triage states) defines it.

Edit the right-hand column to match whatever vocabulary you actually use.

## PRDs are first-class, not just a label

An issue labeled `prd` is a **container**, not an atomic work item: it holds a problem statement, the locked decisions, and a checklist of child tickets (sub-issues). It moves through the *same* five states, but each state reads differently on a container:

| State on a PRD      | Means                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `needs-triage`      | Not yet decomposed — nobody has confirmed scope or broken it into tickets                  |
| `ready-for-agent`   | Decomposition is the next step and an agent can do it (`/to-tickets`)                      |
| `ready-for-human`   | Fully decomposed; everything left on the umbrella is an owner action (answers, gates)      |
| `needs-info`        | Decomposition blocked on the reporter/owner                                                |
| `wontfix`           | The whole initiative is rejected — write it to `.out-of-scope/` like any enhancement       |

Rules that follow:

- **Implementation work never happens on a PRD issue.** It happens on child tickets, which carry their own triage states independently.
- **A decomposed PRD's real status is its children.** The umbrella state only says whose move it is on the umbrella itself.
- **Close rule:** a PRD closes when all children are closed (done or `wontfix`). State the close rule in a comment at decomposition time.
- `prd` + one state label, always — same one-category-one-state invariant as atomic issues.

## Permanent state containers carry no state role

An open issue labelled `orchestrator` or `wayfinder:map` is a permanent state container: living
state a master orchestrator or a wayfinder session reads and writes, open by design and never
closed. It is not a work item, so none of the five state roles fits — `ready-for-agent` and
`ready-for-human` put permanent infrastructure in a grabbable or working queue, `needs-triage` and
`needs-info` both imply someone owes an action, and `wontfix` would close it.

Ruling (Dan, from grill session 2026-09-18, issue 206): **exempt by existing tag, not a sixth
state role.** Either label alone is enough to satisfy the state-role check — the `/session-end`
state-role audit (`tools/tracker-audit.js`'s untriaged check) and the session-check queue queries
both treat `orchestrator` and `wayfinder:map` as a triage state on their own, without suppressing a
genuine miss on any other issue. The label is still a category, not a workflow state, so it never
counts toward the conflicting-triage check — a decision brief legitimately carries `orchestrator`
(or `wayfinder:map`) AND `ready-for-human`.
