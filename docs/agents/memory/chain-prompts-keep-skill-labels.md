---
name: chain-prompts-keep-skill-labels
description: A prompt that chains triage or to-tickets into the fleet must let each skill pick its own state label and widen the fleet's input instead
metadata:
  type: feedback
---

On 2026-09-28 a session wrote a routine prompt chaining /triage, /to-tickets and /ticket-fleet.
Because the fleet was pointed at `ready-for-local-agent`, the prompt told triage and to-tickets to
put that label on everything they produced. Dan objected: that overrides the categorisation each
skill owns (triage's state machine, to-tickets' `ready-for-agent` default), so a cloud-ready ticket
gets mislabelled just to fit the downstream filter.

**Why:** the label is the tracker's record of where a ticket can run. Forcing it to suit one
consumer corrupts it for every other reader (the scout, the audit, the owner's label queries).

**How to apply:** when chaining skills, never instruct an upstream skill which state label to
choose. Adapt the consumer instead. The fleet's `label` arg takes one label, so for more than one,
build the set yourself (open issues with any agent-ready label, minus Maybe Someday and open
`agent/issue-<N>-` PRs) and pass it as `tickets`. An explicit `tickets` list skips the fleet's own
Maybe Someday filter, which is why the caller filters. See [[routine-sessions-run-acceptedits]].

Source: https://github.com/surreptakos/claude-dotfiles/issues/955
