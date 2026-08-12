---
name: hygiene-contract-regex-overmatch
description: "The contract/schedule hygiene rule's regex over-matches bare \"lease\"/\"schedule review\"/\"contract review\", promoting non-contract backlog tasks to p1."
metadata: 
  node_type: memory
  type: project
  originSessionId: 00cb47d3-f162-4e5e-8c90-434e58987915
  modified: 2026-07-28T21:03:56.526Z
---

`aacx/pipeline/hygiene.py` `_CONTRACT_RE` matches bare `lease`, `schedule review`, `contract review`, `direct-hire` anywhere in content/description, so `is_contract_or_schedule` fires on non-contract tasks. On the 2026-07-17 sweep it flagged 6 Work-backlog rows for auto p1+due/deadline-today promotion, all spurious: 3 false positives ("add lease transformation to GPM within Zoho", "automate schedule review… tell Amanda", "put contract review on an outside-counsel retainer") and 3 self-declared duplicates of already-p1 Current Work items (two Express Pros Agreements refs 6h5Qv2vCPFVHwCwJ/6h5QvJJP6HmMcmcr, one Level Up signature 6h5QvVM9qGvgh6jr).

**Why:** executing them would create duplicate/false p1s and push the board 18→24 p1 (target ≈10), degrading the morning board.

**How to apply:** during the daily sweep, before executing `contract/schedule review -> always p1` auto-updates, sanity-check the target is an actual contract/schedule to review (not a Zoho/GPM config task, a process-automation task, a hiring/retainer decision, or a backlog duplicate of an active p1). Hold spurious ones and report. Durable fix: tighten the regex (require agreement/contract context, exclude backlog duplicates) and dedup the Express Pros / Level Up backlog rows against their Current Work originals. Relates to [[reschedule-needs-existing-due]].

**Ticketed 2026-07-28** as `.scratch/bugs/issues/03-contract-schedule-regex-over-matches.md` (`ready-for-agent`) — don't re-triage it. Re-measured that day over all 547 open hygiene-scope tasks: 8 predicate matches, 4 false positives. The new finding is that **3 of the 4 now carry `no-sweep`** — Dan suppressed this bug by hand, spending ADR 0001 labels on it, which is why nothing fires today. The 4th ("RECORD: CDW-L MPSA executed") is unpromoted only because it sits at p4, outside `rule_priority_deadline_sync`'s p1|p2 range. So the sweep-time sanity check above is still needed, but the reason it looks quiet is a workaround, not a fix.
