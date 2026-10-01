---
name: implement
description: Implement a piece of work based on a spec or set of tickets.
metadata:
  disable-model-invocation: 'true'
  modified: '2026-09-30T21:48:11Z'
  previous-modified: '2026-09-30T16:21:27Z'
  revision: '4'
  content-sha: 6ac0431c58bc
---

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

## Review is a separate context

Once the work is done, do not review it yourself. The context that wrote the code holds every
assumption that produced the bug, so its review confirms where it should refute. Launch a
sub-agent instead: a fresh context handed the diff (`git diff <fixed-point>...HEAD`), the ticket or
spec, and the test command — and nothing about how you arrived at the code.

Write its prompt on the model of the blind verifier in `aac-skills/ticket-fleet/ticket-fleet.js`,
which this repeats at one-ticket scale:

- Its job is to refute, not to confirm. It defaults to a failing verdict unless evidence forces a
  pass.
- Its tools are Read, Grep, Glob and Bash — no Edit, no Write, no commit, no push. A reviewer that
  can patch the code under review has stopped being one. State that restriction in the prompt, and
  where the sub-agent launcher takes a tool list, pass exactly those four.
- It has not been told what you concluded and never will be. It judges the diff against the
  criteria.
- Its evidence is a command it ran plus the decisive output line, quoted verbatim, with the real
  exit code rather than a pipeline's. "The tests pass" is not evidence.
- It returns a verdict plus findings, one per unmet criterion, and proposes no diffs.
- A criterion that says where code must never run ("never inside the snapshot job", "never on
  the write path") is checked transitively: trace every caller chain of the new function back to
  its entry points, not only the direct call sites. Write the criterion into the brief that way.
  (2026-09-30: a live Zoho read reached the Monday snapshot through the board builder; three
  reviews that grepped for a direct call passed it.)
- A doc-consistency criterion names every document that states the rule, and the guard it asks
  for is positive (each statement of the rule says the current thing), not a ban on one old
  phrase: a reworded stale copy passes a phrase ban.

You act on the findings: fix what it found, then put the new diff to another fresh reviewer. Fix a finding in the mechanism, never by shrinking the scope the user stated: re-read the request's own words ("anything", "everything", "all") before narrowing what the work covers, and when no mechanism fix exists, ask before shipping the narrower version. Reach
for /code-review when you want its two-axis Standards + Spec read — as that sub-agent's
instruction, never in this context.

Commit your work to the current branch.
