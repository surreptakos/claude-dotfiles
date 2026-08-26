---
name: o3-prep-surface-outputs
description: Attach every O3 .docx the run produced to chat via SendUserFile — both files when the agenda was authored, private prep alone when it was not
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5faad2cd-370b-439d-b979-fc8b8447a1b5
  modified: 2026-08-25T22:48:49.423Z
---

Every AAC O3 prep run MUST end by attaching every generated .docx into the chat via `SendUserFile` (`display: "attach"`, `status: "normal"` on a user-requested run, `status: "proactive"` on unattended). The private prep docx is always written. The agenda docx is written only when `content.json` carries an `agenda` block (SKILL.md:85, 109, 144) — attach both when the agenda was authored, attach the private prep alone when it was not. Do this in the same message as the completion summary. Do NOT just print filenames and let Dan hunt the OneDrive folder.

**Why:** Dan called this out 2026-08-18 mid-turn during Rob's O3 prep: "I need the O3 docs HERE in the chat so I can click them to open. Don't make me go searching for them." Files that exist only as text-pasted paths add friction to the very last mile of the routine.

**How to apply:** After `verify_o3_pair.py` returns `status pass`, immediately call `SendUserFile` with the produced docx path(s) and a short caption naming what was attached (e.g., "Private prep + shareable agenda for <Person>'s <time> O3." when both, "Private prep for <Person>'s <time> O3 — no agenda block authored." when only one). Then post the completion summary. Codified in `.claude/skills/aac-o3-prep/SKILL.md` (Completion summary section) and in every `routines/o3-prep-*.md` (all five: rob, lynne, mark, nick, steffi) as of 2026-08-18. Related: [[status-questions-not-build-orders]].
