---
name: teams-leave-source
description: Where/how Active Alarm leave data lives in Teams and how to sweep it
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9cddf3e3-b997-4753-8bd7-90d2308275cc
  modified: 2026-07-22T14:44:10.458Z
---

Active Alarm leave/OOO announcements live in Microsoft Teams (M365 connector, signed in as dgatsakos@activealarm.com), team `f89a6fe7-79e3-4005-9c30-dc02d810843b`, across **three cross-posted channels** — the same absence is often posted to more than one, so dedupe by (person, date, category):
- `19:6af0a981b0294789b1235f27ac9107a5@thread.skype` = **Leave Announcements** (primary system of record)
- `19:80a8c8ae5f4f402180ef9631598a74b4@thread.skype` = **General**
- `19:45010e7608f543648b694c73ff7ce8ea@thread.skype` = **Office**

Key gotchas when tabulating:
- **Sender ≠ person out.** Rob Olsen and Stephanie Gatsakos frequently post on others' behalf ("Hal is out sick today"). Attribute to the person named, not the author.
- **Fuzzy terminology.** Sweep many terms: out sick, not feeling well, under the weather, staying home, sick day, vacation, PTO, personal day, off today/tomorrow, out of office, WFH, work from home, appointment, surgery, family emergency.
- **`chat_message_search` limitation:** adding afterDateTime/beforeDateTime drops channel coverage (falls back to a shallow per-chat scan). To cover a full year, search WITHOUT date filters (Graph full-text path reaches channels) and filter dates client-side. Search is relevance-ranked + paginated, so it is thorough but not an exhaustive census.
- Names: "Palm Gatsakos" = email kgatsakos. "Chris G/Chris Gatsakos" ≠ "Chris F/Christopher Freeman".

Deliverable built 2026-07-22: `leave-tracking/Leave_Tracking_2026.xlsx` (Summary by Person / All Absences detail / Methodology). Builder script pattern uses openpyxl. See [[leave-tracking-2026-run]].
