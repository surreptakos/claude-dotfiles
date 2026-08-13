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
