---
name: verify-inferences-against-the-store
description: Reading a document well does not make conclusions drawn from it true — query the live store before ticketing.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4e698a6c-aabd-4d8b-ae77-bbdbc50a06f0
  modified: 2026-07-30T00:28:55.428Z
---

On 2026-07-29 a 146-file audit produced sound reads and **five wrong conclusions drawn from them**.
Every one was caught by running a query, never by re-reading:

1. "No durable negative attribution in the repo" — `routing.yaml` already had `exclude_aliases`.
2. "The Daily Huddle post-body query fix was never lifted" — already in `config/sources.yaml`, verbatim.
3. "Missing cursors for sent mail / shared mailboxes / calendar" — `source_cursors` exists, all three registered.
4. "The per-direct digest is still needed" — superseded; `scheduled/o3-prep.md` reads the store.
5. "1,002 unowned items would flood ASSIGN, fix by scoping to open loops" — 985 of them are correctly
   classified non-actionable noise; the real population is 17, and the fix is excluding no-priority
   items, not scoping by loop.

**Why:** an audit document is a summary written at one moment. The repo moves, and a claim of the form
"X is absent from this codebase" is a claim about *now* — it decays. Four ticketable candidates in that
session turned out to be already-done work; ticketing them would have sent an agent to build what
existed.

**How to apply:** before ticketing anything sourced from a document, grep the repo for the concept and,
when the claim is about volume or shape, query `data/aac.db` directly. State counts from the store, not
from the document. When a number drives a design decision (a display cap, a threshold), lock it with a
fixture that would fail under the wrong reading — a comment recording the number will not survive.

Corollary: the reads themselves held up. The failure mode is inference, not comprehension, so the fix
is a verification step and not more careful reading. Related: [[open-work-must-be-ticketed]],
[[tracker-audit-tool]], [[legacy-onedrive-folder-mined]].
