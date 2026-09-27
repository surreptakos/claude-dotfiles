---
name: vendored-copy-provenance-needs-upstream-history
description: "Before calling a vendored skill 'unmodified' or 'wording-only', diff it against every upstream revision, never a keyword grep or the current upstream head alone (2026-09-27, PR 928)"
metadata:
  node_type: memory
  type: feedback
  modified: 2026-09-27T19:40:00Z
---

To decide whether a copied skill (the matt-pocock set, anything under `aac-skills/` that came from
another repo) carries local edits, compare it with **the upstream repo's full history**: unshallow
the clone, and for each file find the upstream revision it is closest to; the lines left over are
the local edits. A match against some past revision means "old upstream copy", safe to resync.

Two stand-ins that gave the wrong answer on PR 928:
- a grep for local vocabulary (`claude-dotfiles`, `issue N`, `Dan`, `gh api`) classed 13 skills as
  wording-only; three of them (grill-with-docs, handoff, to-spec) carried real local rules with none
  of those words;
- a diff against the current upstream head alone mixes upstream drift with local edits and cannot
  tell them apart.

Also normalise before comparing: this repo stores the copies CRLF, and em-dash vs. other
punctuation churn upstream makes whole files look rewritten when the words are unchanged.
