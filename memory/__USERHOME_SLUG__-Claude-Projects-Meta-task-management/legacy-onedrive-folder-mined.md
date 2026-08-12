---
name: legacy-onedrive-folder-mined
description: "The old Cowork assistant folder is fully audited — read the ledger, do not re-mine the folder."
metadata: 
  node_type: memory
  type: project
  originSessionId: 4e698a6c-aabd-4d8b-ae77-bbdbc50a06f0
  modified: 2026-07-30T00:28:31.996Z
---

`__USERHOME__\OneDrive - Active Alarm Company, Inc\Claude` (the Cowork-era AAC assistant this repo
replaced) was fully audited 2026-07-29. All **146 files** enumerated, hashed, extracted, and read line
by line, each with a per-file fingerprint.

**Read `docs/audit/legacy-onedrive-ledger.md` (on master) instead of re-opening the folder.** It carries
every file's verdict, byte-level derivation proofs, and a status block mapping each salvage action to
its outcome. `docs/audit/legacy-onedrive-manifest.txt` has the raw 146-row index with SHAs.

Outcome: six issues cut (#83–#88 incl. PRD #90), two folds into existing issues (#44, #84), **four
candidates withdrawn as already-done**. 30 files in the folder are byte-provably deletable.

Three things are genuinely unmined and still worth lifting — `manager-tools-kb.md` (the Manager Tools
doctrine, zero repo footprint), `memory/context/directory.md` (~60 external counterparties), and the
unmined half of `memory/glossary.md` including the personal/home decoder. Those are #83, #84, #85.

Do not re-propose the standing-fronts colour roll-up from the ledger's Sections 6–7 — it was specced,
rejected, and replaced. See [[three-queues-not-colours]].

Re-extraction is scripted if ever needed: `docs/audit/extract-legacy-folder.py` rebuilds all 146 text
dumps in about a minute. Related: [[open-work-must-be-ticketed]], [[verify-inferences-against-the-store]].
