---
name: live-writes-on-noise-gate-open
description: live_writes has been ON since ~2026-07-23 but the chat/notification noise gate still leaks; sweep writes must be inspected before executing.
metadata: 
  node_type: memory
  type: project
  originSessionId: f1f26f1a-2495-460b-b613-8bb347c63a30
  modified: 2026-07-29T14:52:54.702Z
---

As of 2026-07-29 `aacx golive-status` reads `live_writes: on`, so `scripts/todoist_sync.py --execute-writes` will really write. But the noise gates from [[chat-items-need-null-priority]] are NOT holding through the `classify.py` path: the 2026-07-29 run produced 111 auto actions (103 `create`), most of them Teams conversation fragments ("I'll take a look", "Got a minute?"), Zoho AP ticket-assignment notifications, and the sweep's own Morning Brief / Red Team self-send emails read back out of the inbox — including several landing p1 in Current Work.

Tracked as [GitHub issue #44](https://github.com/surreptakos/aac-task-management/issues/44). Its 103 pending create rows should be voided, not executed (see [[stale-pending-actions-persist]]).

**Why:** flag-ON plus a leaking gate means an unattended sweep floods the live board and blows the p1≈10 acceptance target; ~80 junk tasks would need manual cleanup.

**How to apply:** on a flag-ON run, read the `content` field of every `create` in `aacx golive-actions` before running `--execute-writes`. If conversational fragments or notification mail appear, hold the write half, report, and leave the rows pending — the precedent Dan set on 2026-07-17 and 2026-07-20 ([[step3-stage-backfill-explosion]]). Do not judge/void individual items yourself; that is classification work the script owns.
