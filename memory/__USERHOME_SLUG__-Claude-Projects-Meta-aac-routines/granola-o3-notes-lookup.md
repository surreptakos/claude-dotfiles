---
name: granola-o3-notes-lookup
description: "Dan's O3 notes live in Granola titled with a bare date (\"9/15/26\"); find them by participant email + date, and get_meetings returns his typed notes as private_notes"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 1108dec8-e20d-4b97-a7d2-0b18300f6fe7
  modified: 2026-09-15T18:00:36.846Z
---

Dan's O3 recaps are Granola notes captured by him, titled with the bare date (e.g. "9/15/26", "9/1/26"), participants listing the direct's email. There is no "Rob Olsen O3" title or folder. The Granola connector's `get_meetings` returns `<private_notes>` (Dan's typed markdown) separately from the AI `<summary>`; `list_meetings` with `captured_by_me: true` lists them. Fathom holds nothing after 2026-08-20.

**How to apply:** for held/not-held checks and post-O3 intake, list Granola meetings captured by Dan in the window and match on the direct's email plus the O3 date; never match titles. Dan pastes the Markdown agenda into the Granola note at the start of each O3 (tickets #201–#208 in aac-routines), so private_notes is the intake source going forward.
