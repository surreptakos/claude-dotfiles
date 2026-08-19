---
name: o3-prep-surface-outputs
description: Attach both O3 .docx outputs to chat via SendUserFile on every AAC O3 prep run
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5faad2cd-370b-439d-b979-fc8b8447a1b5
  modified: 2026-08-18T15:35:02.599Z
---

Every AAC O3 prep run MUST end by attaching the two generated .docx files (private prep + shareable agenda) into the chat via `SendUserFile` (`display: "attach"`, `status: "normal"` on a user-requested run, `status: "proactive"` on unattended). Do this in the same message as the completion summary. Do NOT just print filenames and let Dan hunt the OneDrive folder.

**Why:** Dan called this out 2026-08-18 mid-turn during Rob's O3 prep: "I need the O3 docs HERE in the chat so I can click them to open. Don't make me go searching for them." Files that exist only as text-pasted paths add friction to the very last mile of the routine.

**How to apply:** After `verify_o3_pair.py` returns `status pass`, immediately call `SendUserFile` with both docx paths and a short caption (e.g., "Private prep + shareable agenda for <Person>'s <time> O3."). Then post the completion summary. This is codified in `.claude/skills/aac-o3-prep/SKILL.md` (Completion summary section) and in every `routines/o3-prep-*.md` (all five: rob, lynne, mark, nick, steffi) as of 2026-08-18. Related: [[status-questions-not-build-orders]].
