---
status: accepted
---

# Jev picks the ask-matt route; the model may appeal once

Until 2026-09-25 the model named its own ask-matt route with `declare-claude`, and the gate checked
only that the name was on `ALLOWED_FLOWS`. On 2026-09-25 a design request ("I need to be able to
give feedback to the model ... not sure how best to do that") went through as `direct-answer` and
got a build plan with no grill. Dan asked for gates that force every answer through the proper
route. Settled in a grill-with-docs session the same day; terms are in `CONTEXT.md`.

The decision:

- **TypeSafe Jev picks the route** by walking the route tree over the user's message, the previous
  turn's route and the model's last question. The whole tree is one POST, walked in code, to fit
  the prompt hook's 5-second budget.
- **The gate covers engineering work only.** Other work (contract packages, review audits, Todoist
  triage) runs as before.
- **The model may appeal once per turn** through a gate command that logs the wanted route and the
  reason; the pre-send lint then refuses the reply until its first line states the appeal. A
  committed setting can turn appeals off, making Jev's pick final.
- **Jev unavailable:** the model picks, and the reply opens `route unchecked: Jev unavailable`.
- **One tool limit:** build routes open their skill before the first edit. Helper calls (hook
  input carries `agent_id`) are exempt. Scheduled runs skip the gate for now; a committed setting
  can turn on a `routine` route limited to the task file's listed writes.

## Considered options

- **The model picks and Jev checks it (option B).** This is the arrangement that failed: a check
  that runs on the model's own label inherits the model's framing of the request.
- **Jev final from day one, no appeal.** Kept as the stricter setting; Dan chose to start with
  appeals so a mis-route has a visible way out.
- **Read-only talk routes.** Chosen, then dropped after the adversarial pass: those routes must
  write (the pre-send lint draft, `CONTEXT.md`, ADRs, research notes), and shell commands write
  unchecked anyway, so the limit either blocked correct work or was trivially bypassed.
- **A route per work skill (contract package, review audit ...).** Rejected: ask-matt is an
  engineering map, and ten more leaves are ten more places to mis-route.
- **Blocking the turn, or taking the heaviest route, when Jev is down.** Rejected: one stops all
  work during an outage, the other turns every question into an interview.

## Consequences

`jev.py` needs Choice questions (it builds only Nouls today). The prompt hook's Jev budget must
cover the correction check and the route tree in one request. Codex has no Skill tool, so the Codex
path keeps today's self-declared behaviour. Detecting a scheduler-started session without trusting
message text is unresolved and goes to the spec.
