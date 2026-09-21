---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.
disable-model-invocation: false
metadata:
  modified: "2026-09-21T03:41:57Z"
  previous-modified: "2026-08-20T00:41:59Z"
  revision: "2"
  content-sha: "887d6d1e56f2"
---

Run a `/grilling` session, using the `/domain-modeling` skill.

## One adversarial pass before the spec is published

When the interview has settled and before the thinking goes to `/to-spec`, spend one sub-agent on
attacking it. Give a fresh context the plan as it stands, plus the `CONTEXT.md` entries and ADRs it
rests on, and tell it to argue that the plan fails: the assumption nobody checked, the case the
design has no answer for, the ADR whose rejected alternative was dismissed too fast. Its tools are
Read, Grep, Glob and Bash — no Edit, no Write — so it argues instead of quietly rewriting.

The context that ran the interview cannot do this: it produced the plan and will defend it.

Put each objection back to the user as a grilling question and settle it. Changing the plan is free
here and expensive once the spec is published.
