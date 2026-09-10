---
name: reporting-style-plain-english
description: "Dan wants replies as plain-English status, no monospace, no paths, no working artifacts"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1cd5b732-9ffd-4118-a927-66ef3a8ff03b
  modified: 2026-09-10T01:57:19.865Z
---

Dan reads replies as status, not as working material. Stated 2026-09-02, after
a run of replies he judged too long and too technical.

Rules he gave, in his words: plain English report of status, detailed
explanations only if needed, no file paths, no code, nothing formatted in
monospaced text. PRs, tickets, specs and PRDs are for the agent, not for him.

**Amended 2026-09-09 — the monospace ban is now a ration, not a ban.** After
making `/i-have-adhd` standing, Dan flipped it himself: that skill's first rule
is to open with the command or path he can act on, and a blanket ban deleted
exactly that. The lint now allows one runnable `bash` fence, up to four inline
spans and up to three distinct paths per reply. Past those caps it is working
material again. The underlying judgment did not change — a reply is a status, and
a pile of monospace is the tell that working material leaked in.

**Why:** He is the reader of the outcome, not of the mechanism. Monospace in a
reply is a tell that working material leaked into a status update. Length alone
was not the problem — he corrected that reading explicitly: "I don't think it's
just length. It's unnecessary info."

Reconfirmed 2026-09-09, and sharpened: a reply can pass the lint and still be
unreadable. He answered "I don't understand what the hell you're saying" to a
status line that said no checks would report on a PR. Every word was plain and
the lint was clean; the sentence still described tooling behaviour instead of
telling him whether anything was wrong. Compression is not the same as clarity.

**How to apply:** Lead with what happened and what it means for him. Name things
in words rather than by path or symbol. When reporting that something did NOT
happen, say whether that is a problem for him before explaining the mechanism -
an absent CI check, a skipped step, an empty result. Never state a negative as a
bare fragment. Put commands, diffs, schemas and
evidence tables in the PR, the ticket or a file, then say in one sentence that
they exist. Ask for a decision in plain terms. Enforced mechanically by the
pre-send lint, which now flags code fences, inline code spans and file paths in
a reply, alongside the word cap Dan set at 250 and a 28-word sentence cap. See
[[pre-send-lint-discipline]].
