---
name: bill-approver-routing
description: "Approver routing is already measured — PR #34's comments are the source of record; five live BILL policies; service-vs-project needs the job board, not BILL"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4bcae75c-97a9-4c15-9c38-daae586dd1c0
  modified: 2026-07-31T21:47:03.794Z
---

**Read `gh pr view 34 --comments` before planning any approver or GL-confidence work.** PR #34 is a
draft that has been open since before 2026-07-30 and its comment thread — not its body — carries the
measurements:

- Holdout, train before 2026-05-08, test after, minSupport 8, minPurity 0.95, on 544 unseen bills:
  **356 auto-coded right (65.4%), 1.7% wrong.**
- **GL predicts the approver 96.8%** of the time across 37 GL values. Taking each GL's most common
  approver is right that often, which is why the approver-mining half of the miner can retire.
- **A 17-row table of every GL with a clean dominant approver**, which is what a BILL approval policy
  takes directly. Four of the five live policies already key on `CHART_OF_ACCOUNT_ID`, so this is
  "a UI afternoon, no code, no deploy". Six more GLs are genuinely mixed and need a human ruling:
  Building repairs & maintenance, Lock Work, Avantguard / Becklar, Engineering / Plans, Cost of
  Goods, Telephone. Tracked as #47 — do not re-derive the table.
- The comparison the report still owes: how often today's `DominantGL` gate auto-codes the same 544,
  and how many it gets wrong. 65.4% at 1.7% wrong only matters if it beats what already ships.

On 2026-07-31 an agent read only `gh pr view 34 --json state`, saw OPEN, believed an issue that said
"blocked on PR #34's report", and spent a session re-deriving 96.8% and the coverage numbers off the
live API. `tracker-audit.js` check 7 (`blocker-may-be-answered`) and DASHBOARD.md's Open PRs section
now both fire on this shape.

**Five ACTIVE BILL approval policies**, all keyed `CHART_OF_ACCOUNT_ID` and/or `VENDOR_ID`, none with
a catch-all. Read them with `clasp run-function demoPolicyInventory` and `demoPolicyRaw <fragment>`:
General Monitoring → AP Administrator; Subscription (2 subscription GLs) → AP Administrator; Dan's
Approval (6 vendors) → Daniel Gatsakos; Steffi's Approval (4 parts GLs) → Orders Invoices; Outside
Labor - Project (GL + NTI) → AP Administrator + Daniel Gatsakos. **v3 create only accepts
`BILL_AMOUNT` rules**, so GL and vendor policies have to be made in the BILL UI; `demoCreateGapPolicy`
is pre-authorized (Dan, 2026-07-27) for exactly one AP-Administrator gap policy and POSTs only.

**BILL has no work-order criterion, so native routing can never see the job board.** Service versus
project must be decided by the pipeline before the bill is created — that is issue #45 (sync the W/O
registry off the Message Board's `Leads / Jobs` tab, 816 project W/Os) and #46 (ask for the W/O when
a COGS bill has none, minus a recurring list: General Monitoring, CCTV Subscriptions, Access Control
Subscriptions, Avantguard / Becklar, Monitoring, Johnson Controls / ADT / Tyco).

**`Projects Approver` and `Project Invoices` are ONE account**, `projects@activealarm.com`; the
second name is stale. **The user was created 2026-07-23** (`List/User.json`), so it is days old, and
AP Administrator covered that work before it existed — five accounts appear in history, not six.

Its 11 bills as first approver include ones dated back to 2025-10, all assigned within days of the
account existing. **Never read that history as a settled routing pattern, and never read a bill's
past-due age as time spent waiting on this account.** Both PR #34 ("almost no history and nobody
watching it") and an earlier version of #47 ("stranded, 86–126 days past due") got this wrong; Dan
had already said the account was new and had stuff put on it. Three bills are genuinely `ASSIGNED`/
`WAITING` as of 2026-07-31 ($3,859) and are tracked in #47.

So `Outside labor` showing Services Invoices at 94–96% against a policy that names AP Administrator
is the service-versus-project split, **not a misconfiguration to fix**. Do not file it as one.

Export history from Node, never from Apps Script: `node tools/export-bills.js --since YYYY-MM-DD
[--approvers]` reads the whole 11.6k-bill history in about a minute. See [[intake-queue-live]] and
[[bill-notes-api-facts]].
