---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
metadata:
  modified: "2026-09-21T03:41:40Z"
  previous-modified: "2026-08-20T00:41:59Z"
  revision: "2"
  content-sha: "c82ce8144abb"
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

You act on the findings: fix what it found, then put the new diff to another fresh reviewer. Reach
for /code-review when you want its two-axis Standards + Spec read — as that sub-agent's
instruction, never in this context.

Commit your work to the current branch.
