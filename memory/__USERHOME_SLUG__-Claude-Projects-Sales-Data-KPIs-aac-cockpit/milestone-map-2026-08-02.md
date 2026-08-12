---
name: milestone-map-2026-08-02
description: "M1 is now one criterion — Dan's parity signoff — and the eight milestones were re-cut on 2026-08-02 around what actually gates it."
metadata: 
  node_type: memory
  type: project
  originSessionId: 3ef79b06-15a0-4db5-a082-fb32e5b11563
  modified: 2026-08-02T04:40:39.209Z
---

Dan, 2026-08-02: **M1's exit criteria are "simply my signoff that the board has perfect functional parity
with the pre-Design page."** Everything else was dropped or moved. He also ruled that the pre-Design page
**was faster**, so the speed cluster is parity work and stays.

- **M1 — Functional parity with the pre-Design page.** 9 open: three regressions (#117 manager authoring,
  #106 published week reads the lock not the publication row, #114 week pill unreachable) plus speed
  (#96, #100, #101, #102, #103, #108). All backend, no Design dependency.
- **M2** Monthly/Quarterly · **M3** Account Coverage · **M4** Publication runs unattended (no tickets — it
  closes on four Wednesdays) · **M5** Mark's verdict (no tickets — one human answer).
- **M6** Infrastructure and operations · **M7** Tests, tooling and retired code · **M8** Figures and copy the
  report never settled. Created 2026-08-02 to hold what was blocking M1 without being parity.

**How to apply:** before putting anything in M1, ask whether the old page did it. If it did not, it is not
parity and belongs elsewhere — that test is the whole point of the re-cut. **#59 is blocked on the signoff
itself**: it deletes Dashboard_v2, which is the reference for what parity means.

Two milestones that used to have no `M#` (the Design-asks queue and "the served report works for whoever
opens it") were folded in and closed; the `frontend` label does the Design grouping now.

Related: [[one-owner-per-file]], [[nothing-lives-only-in-chat]].
