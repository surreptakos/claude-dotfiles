---
name: reproduce-as-the-viewer-who-reported-it
description: "Could not reproduce" is not a finding until the viewer, rep and week are named — Dan tests as Sandbox Rep, not as a default rep.
metadata:
  type: feedback
---

Dan reported "I can't add an obstacle" twice. The first investigation (#134) concluded **"Obstacles — could
not reproduce"** and shipped a fix for the other half of the report. It came back on 2026-08-02, and the cause
was that he was viewing the **Sandbox Rep**, whose deal picker was empty (`pickerDeals: 0` against the mirror's
36) — so no card in section 04 could be created at all.

Everything the first investigation checked was true. The markup was correct, `ds_author_test` did prove the
blank card binds, the `newRow` set was complete. None of it answers what the picker offers **on the report the
reporter is actually looking at**.

**Why:** a defect report carries an implicit viewer, rep and week, and the default one you reach for is rarely
his. Verifying the mechanism in the abstract can pass while the feature is unusable for the only person using
it.

**How to apply:** before writing "could not reproduce", state which viewer, which rep and which week you
reproduced under, and check that it is the reporter's. Dan tests as **Sandbox Rep** — assume that unless he
says otherwise. `inspectBoardData(email, weekIso, targetRep)` takes all three; run it as the reporter's
combination rather than the default. Related: [[dont-park-a-vague-defect-report]],
[[broken-join-looks-like-zero-coverage]], [[the-served-page-runs-in-the-browser-pane]].
