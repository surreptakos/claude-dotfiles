---
name: reporting-style-plain-english
description: "Dan wants replies as plain-English status, no monospace, no paths, no working artifacts"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1cd5b732-9ffd-4118-a927-66ef3a8ff03b
  modified: 2026-09-02T18:40:33.302Z
---

Dan reads replies as status, not as working material. Stated 2026-09-02, after
a run of replies he judged too long and too technical.

Rules he gave, in his words: plain English report of status, detailed
explanations only if needed, no file paths, no code, nothing formatted in
monospaced text. PRs, tickets, specs and PRDs are for the agent, not for him.

**Why:** He is the reader of the outcome, not of the mechanism. Monospace in a
reply is a tell that working material leaked into a status update. Length alone
was not the problem — he corrected that reading explicitly: "I don't think it's
just length. It's unnecessary info."

**How to apply:** Lead with what happened and what it means for him. Name things
in words rather than by path or symbol. Put commands, diffs, schemas and
evidence tables in the PR, the ticket or a file, then say in one sentence that
they exist. Ask for a decision in plain terms. Enforced mechanically by the
pre-send lint, which now flags code fences, inline code spans and file paths in
a reply, alongside the word cap Dan set at 250 and a 28-word sentence cap. See
[[pre-send-lint-discipline]].
