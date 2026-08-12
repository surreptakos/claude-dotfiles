---
name: todoist-sync-script
description: "scripts/todoist_sync.py moves Todoist fetch/ingest/reconcile/writes out of Claude to kill the sweep's token cost."
metadata: 
  node_type: memory
  type: project
  originSessionId: 101e363c-442a-4724-896b-dd21bb1c9fcf
  modified: 2026-07-27T17:40:11.018Z
---

The daily sweep's dominant token cost was pulling every Todoist board **through
Claude's context** just to pipe into `aacx ingest` — MCP `find-tasks` has no
"since" filter, so a quiet day streamed ~600 task objects to find ~9 new ones
(a 2026-07-23 run hit ~360k tokens, mostly this). Outlook/Teams/Calendar MCP
tools are already incremental (afterDateTime / newest-N) and cheap; Todoist was
the whole problem, and it's the one connector that needs **no Microsoft Graph** —
Todoist has a plain token REST API.

`scripts/todoist_sync.py` (stdlib-only, runs under the Python312 interpreter) is
the cron-side replacement for the Todoist part of scheduled/daily-sweep.md steps
2-3 + 4a: fetch all registered boards over the API → `aacx ingest` per board →
`aacx reconcile-membership` with the full snapshot. `--execute-writes` drains
`aacx golive-actions` (still the single source of truth; live_writes OFF → [])
and executes creates/updates/reschedules/completes/moves/assigns, then
`aacx act --record`. Priority is inverted between the two systems (Todoist API
4=urgent = aacx "p1"); the script maps both directions.

**Token (resolved 2026-07-27):** `_token()` resolves in order — env
`TODOIST_API_TOKEN`, then `TODOIST_API_TOKEN_FILE`, then
`~/.config/aac/todoist_api_token` (the durable copy, now on disk). The file
fallback exists because a Windows scheduled task does NOT reliably inherit a
User env var set after the host process started, so the env var alone left the
cron sweep one reboot from breaking. The scheduled `daily-morning-update`
SKILL.md was also stale (still said fetch/write Todoist via MCP `find-tasks` /
"the matching Todoist MCP tool"); rewritten to defer to the now-correct
`scheduled/daily-sweep.md` and drive everything through the script. Both were
the reason the 2026-07-27 09:10 run left no fresh renders / unwritten store.

**Validated live 2026-07-23** (token now exists): read+reconcile path works; write
path works on the unified **v1 API** — REST v2 is **410 Gone** on this account, so
all reads AND writes must use `api.todoist.com/api/v1` (create/update/reschedule
→200, complete/delete→204, move→200 with project_id change verified). `assign`
(v1 update w/ assignee_id, shared-project only) is the one kind still not
live-tested (would notify a real collaborator). Priority is inverted: API int
4=urgent = aacx "p1".

Two gotchas found & fixed: (1) v1 `added_at` is **microsecond** precision vs the
MCP's millisecond, so the first script run re-hashed every active/shared-board
item → bumped `enrich_version` (155 items) AND `dedup_checked_version` (228),
inflating both worklists. Fix is NOT to reformat (API micro is now consistent
run-over-run); absorb the one-time transition by **carrying prior
enrichments + dedup_checked_version forward to the current version** (pure SQL,
no re-classification). (2) `create` outcomes for `act --record` must carry
`item_id` (pending row has todoist_id NULL → matched on item_id) and put the
NEW task id in `todoist_id` for the stub — the script now does this; without it
creates stay pending and re-fire/duplicate next run.

Given no Graph, Outlook/Teams/Calendar fetch stays in an interactive Claude
session (cheap, incremental); classification (enrich/dedup) moved to a direct
Anthropic API call — shipped 2026-07-27, see [[classify-script]]. See also
[[first-live-run-2026-07-23]], [[sweep-needs-full-board-resync]].
