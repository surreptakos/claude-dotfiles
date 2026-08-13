---
name: overnight-shift-2026-08-13
description: "Overnight autonomous shift 2026-08-13: 16 issues worked, 12 closed live-verified, 7 gated releases, Data-verify 60 to 34; the Desk API facts that bit"
metadata: 
  node_type: memory
  type: project
  originSessionId: c914f9ae-7160-499d-aa89-83cf1c97bc4d
  modified: 2026-08-13T16:38:35.484Z
---

Owner-directed overnight shift (goal: every Data-verify ticket to Work-validate or Rejected). Ledger in HANDOFF.md "MORNING REPORT" section. Data-verify 60 → 34, Work-validate 26 → 41 (bills UNASSIGNED/UNPAID), Rejected 3 → 20, queue empty, fresh arrivals auto-dispose.

**Desk/Blueprint facts measured this shift (each cost a live failure):**
- A captured ticket refuses status writes TWO ways: 422 naming the blueprint, and a BARE 403 `FORBIDDEN` with no blueprint word. Detect both (`blueprintRefusalOfStatus`).
- `POST /tickets/{id}/transitions/{tid}/perform` works, echoes `updatedState` as a PLAIN STRING, and refuses ANY field envelope (`"An extra parameter 'cf' is found"`) — land cf via PATCH first, perform bare.
- Site matching must score jobSite and lineSummary SEPARATELY — joined text let real line items hand a second board site two shared tokens and ambiguity failed a clean match closed (AP-117).
- Subagent runner that worked: `claude -p --model claude-opus-4-7 --dangerously-skip-permissions --strict-mcp-config --output-format json < prompt.md` in a per-issue worktree; classifier blocks some launches stochastically — retry or implement inline.
- Sweep/repair/probe tools left behind: `apRequeueOpenBefore(beforeIso, dry, max)`, `deskRepairBillIdsFromLog(sinceIso, dry)`, `siteWorkOrderDiag(site)`, `crmCustomerDiag(wo)`.

Open threads: 125 (verify per-cause tag names on a live ticket), 128 (ready-for-human: BILL has ZERO approval policies — do not fix the unreadable path first), 134 (parallel drain), 135 (no-document email class, 11 tickets), 70 (awaits organic NO-VENDOR). See [[urlfetch-quota-is-the-ceiling]] and [[owner-ruling-registry-membership-wo]].
