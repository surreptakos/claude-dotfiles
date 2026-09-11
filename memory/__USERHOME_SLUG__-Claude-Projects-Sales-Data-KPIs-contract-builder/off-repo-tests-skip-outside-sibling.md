---
name: off-repo-tests-skip-outside-sibling
description: "Off-repo-dependent tests (history guard, mapping leak scans) skip silently unless run from the main clone or a sibling worktree; CI never runs them"
metadata: 
  node_type: memory
  type: project
  originSessionId: 299e98d5-c35f-4466-9aa6-1bc92e7159fa
  modified: 2026-09-11T13:37:53.878Z
---

The history-boundary guard and the mapping leak scans find `aac-golden-packages/` by walking up from the test file to a sibling folder. A worktree under Temp, or anywhere not beside the main clone, skips all of them (34 skips on 2026-09-11), and CI has no mapping at all, so a green CI run plus a green fleet verifier can still hide a guard failure. PR #263 (2026-09-11) passed both and failed `test_no_new_mapping_identifier_after_boundary` on the master's own run, because it edited a test file that already carried mapping values.

**Why:** a merge that fails this guard turns the local pre-commit fast lane red for every later commit on the pilot PC.

**How to apply:** before merging any fleet PR that touches `tests/` or `fixtures/`, run the full suite on its head from the main clone (`git switch --detach <head>`), with nothing else running in that clone because HEAD must not move mid-run. A run whose skip count is not zero does not count. See [[contract-builder-project-state]].
