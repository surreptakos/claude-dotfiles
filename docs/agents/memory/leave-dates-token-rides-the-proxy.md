---
name: leave-dates-token-rides-the-proxy
description: "The cloud environment's egress proxy attaches Dan's Leave Dates API token to api.leavedates.com; no variable, no file, and the reader lives in aac-routines"
metadata:
  node_type: memory
  type: project
  originSessionId: session_013rMpxfSLHuyJ2azosnLUKB
  modified: 2026-09-18T23:30:00.000Z
---

Recorded 2026-09-18 (issue 204, Dan's "wire it" ruling). The Leave Dates API token is a proxy-held
credential like the Google one: the session's system prompt lists `api.leavedates.com — Allow +
inject Leave Dates API Token`, so a plain `curl https://api.leavedates.com/me` from a cloud
container answers as Dan with no header, no variable and no file. Nothing in any repo holds the
token; a desktop run sets `LEAVEDATES_API_TOKEN` (a personal token from the portal's Settings > API)
and the reader sends it as a Bearer token.

**The reader is `src/aac_routines/leave_dates.py` in aac-routines**, not here: `probe`, `pending`
(`awaiting_me` = what waits on the caller's approval, from `/pending-approvals`; `requested` =
every open request company-wide) and `out` (approved leave in a window, default this week). Exit 2
is an unreachable surface. The todoist-triage skill rules leave items from it, never from
`hello@leavedates.com` mail.

Surface facts a future probe would otherwise re-learn:

- Every call needs `Accept: application/json`; without it a validation failure comes back as an
  HTML redirect rather than a 422.
- `/reports/leave` needs `report_type=detail-report` and `within=YYYY-MM-DD,YYYY-MM-DD`; `status`
  accepts `requested|approved|cancelled|rejected` (lowercase works; `pending`, `declined` answer
  `500`); `page_size` is ignored, the report pages 15 rows through `page` and carries `total`.
- Rows carry `status`, `status_updated_by`, `status_updated_at`, `requested_at`. The report has no
  approver column; who a request waits on is only `/pending-approvals` for the caller.
- `/leaves?company=…` is the richer per-request object (`APPROVED` uppercase, breakdowns);
  `/employments` has `is_approver`; the OpenAPI document is `https://api.leavedates.com/docs`.

**Verified 2026-09-18** from a cloud container (this transcript is the proof):

```
$ python -m aac_routines.leave_dates probe
{"credential_source": "agent_proxy", "company": "a056204b-…", "as": "dgatsakos@activealarm.com"}
$ python -m aac_routines.leave_dates pending      # awaiting_me: 1 (Lynne, 2026-09-17); requested: 7
$ python -m aac_routines.leave_dates out          # 2026-09-14..20: 16 approved rows
```

The 2026-09-13 mail "Mark Kurland has requested Work from Home, Sept 15" that the 2026-09-15 triage
run turned into an approve-it action reads `Approved, status_updated_by Dan Gatsakos` in the
report: the mail was stale the moment Dan clicked. Related: [[session-env-carries-zoho-and-gas-tokens]].
