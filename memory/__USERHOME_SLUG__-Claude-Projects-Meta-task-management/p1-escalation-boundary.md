---
name: p1-escalation-boundary
description: hygiene escalates p2→p1 at strictly <7 days; a deadline at exactly +7 stays p2
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9f2c24a1-34d7-4ecc-ac54-f0ab843bbb05
---

`aacx/pipeline/hygiene.py` `rule_priority_deadline_sync` escalates a p2 to p1 only when its deadline is **strictly less than today+7** (`today <= deadline < today+7`). A deadline at *exactly* today+7 stays p2.

**Why:** Dan parks tasks at exactly +7 days (e.g. deadline 7/24 when today is 7/17) to hold them at p2 — many live Current-Work tasks carry the note "Deadline held past the 7-day line to keep it p2." The original port used inclusive `<=`, which escalated all 32 such parked tasks and inflated the daily p1 count from ~10 to ~48. Found + fixed 2026-07-17 during the go-live dry run. Note the PRD prose says "≤7 days escalates" — the board data and the code's own `_first_business_day_past_line` (line = +7, safe) win over the loose prose. If Dan ever says he actually wants +7 to escalate, flip it back and update `test_p2_deadline_at_exactly_7_day_line_stays_p2`.

**How to apply:** target daily p1 count is ~10; if a hygiene change makes it balloon, suspect this boundary first. Regression tests guard it in `tests/unit/test_hygiene.py`.
