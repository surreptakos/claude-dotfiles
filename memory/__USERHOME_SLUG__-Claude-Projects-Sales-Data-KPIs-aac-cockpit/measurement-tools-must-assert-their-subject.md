---
name: measurement-tools-must-assert-their-subject
description: "A verification tool that does not confirm WHAT it measured reports coverage it does not have; make it throw, not fall back."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4d5f5f05-e328-4aa4-88a9-2f1f0153c66e
  modified: 2026-08-12T21:15:19.706Z
---

A tool built to prove a change is safe must **assert the identity of what it just measured**, and throw when it cannot confirm it. On 2026-08-12 `tools/board-style-snapshot.js` drove all five served surfaces through one page against one harness and accepted whatever was on screen once a generic "looks rendered" check passed. The Monthly never loaded — its selector entry only appears when the harness workbook spans a *completed* month — so the capture recorded the **weekly** board under the name `month`, and the VP surfaces were read mid-replacement (828 elements where a clean read gives 1,160). Nothing failed. I published "verified pixel-neutral across all five surfaces, 4,117 elements" from it, in a merged PR, an ADR and CLAUDE.md.

**Why:** a wrong measurement filed under the right name is worse than a missing one — it reads as coverage, so nobody looks again. A generic readiness condition (`document.querySelectorAll('*').length > 300`) is satisfied by the *previous* subject, which is exactly the silent-fallback shape. The conclusion happened to survive re-measurement; that was luck, not method.

**How to apply:** for any before/after or diff tool — (1) prove it deterministic first by diffing two *unmodified* captures; (2) give each subject its own fixture/server when its data needs differ; (3) read the app's own state for identity (`env.surface`) plus a structural fingerprint (section ids), and **throw** on mismatch rather than capturing; (4) wait on the app's real readiness signals, not a count that any page would pass; (5) when a published figure turns out wrong, correct it everywhere it was cited and record what the first run got wrong — see [[verify-before-filing-cite-the-check]] and [[dont-park-a-vague-defect-report]].

Related: [[mutation-test-backup-not-git-checkout]] · [[the-served-page-runs-in-the-browser-pane]] · [[board-values-must-be-payload-keys]]
