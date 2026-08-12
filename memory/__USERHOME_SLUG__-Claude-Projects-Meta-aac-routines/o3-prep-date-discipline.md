---
name: o3-prep-date-discipline
description: "Dan's standing O3-prep rules — absolute dates only, never assume the O3 date, verify from calendar"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b27b3299-18b7-4c54-8e38-c729d7fa0e29
  modified: 2026-08-10T23:19:04.471Z
---

Dan (2026-08-10), on reviewing Nick's O3 pair from aac-routines:

- Never write "today", "yesterday", "tomorrow", "this morning", "last week" or any relative date in an O3 document — exact dates only. Docs are read on a different day than built.
- Never assume the O3 date; verify the live calendar event and cite it. "Next O3" without an event gets labeled as an assumption.
- Rules apply to ALL directs' preps — encoded once in `.claude/skills/aac-o3-prep/SKILL.md` ("Date discipline" section) so they never need repeating per person.

**Why:** rev 1 said a meeting "ran today" that had been moved off the calendar; relative phrases go stale the moment the doc is read later.

**How to apply:** any agent producing an O3 pair reads the skill's Date discipline section; sweep content JSON for relative-date words before build, zero survivors.
