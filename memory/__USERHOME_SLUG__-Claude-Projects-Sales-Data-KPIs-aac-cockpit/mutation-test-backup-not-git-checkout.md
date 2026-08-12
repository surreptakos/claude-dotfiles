---
name: mutation-test-backup-not-git-checkout
description: "Never revert a mutation test with `git checkout --` on a file whose real edits are uncommitted; copy to the scratchpad first."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a6ed8c90-20ee-4d6f-8130-e73aba68b846
  modified: 2026-07-31T20:44:52.659Z
---

When mutation-testing an assertion (break the code, confirm the test goes red, revert), copy the file to the
scratchpad and restore from that copy. `git checkout -- <file>` reverts to HEAD, which discards every
uncommitted real edit in that file too.

**Why:** on 2026-07-31 I mutation-checked the #69 due-date read, then ran `git checkout -- Code.js` — and
silently lost all six uncommitted #68/#69 edits. The suite went green because the tests were also reverted, so
nothing flagged it; I only noticed by grepping for a constant I had just added.

**How to apply:** `cp <file> "$SCRATCHPAD/<file>.good"` → mutate → run → `cp "$SCRATCHPAD/<file>.good" <file>`.
Or commit first, then mutate. Never `git checkout` a dirty file. See [[git-bash-tmp-invisible-to-windows-python]]
for the sibling trap about which temp directory that copy can live in.
