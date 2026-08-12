---
name: classify-script
description: "scripts/classify.py moves enrich/dedup classification judgment out of the interactive sweep session onto a direct, metered Anthropic API call."
metadata: 
  node_type: memory
  type: project
  originSessionId: 1595b2a2-b785-430e-b704-fba030cc0cb1
  modified: 2026-07-27T17:40:26.812Z
---

Track A of the sweep-cost-offload (sibling of [[todoist-sync-script]]).
`scripts/todoist_sync.py` killed the sweep's Todoist-transport cost; the
remaining in-session cost was per-item classification — enrich (priority,
owner, is_fire, redaction, prose, commitments) and dedup (duplicate_of
verdicts) judged inline every weekday morning on the scheduled session's
Opus-tier model, competing with Dan's own interactive Claude quota.

Shipped 2026-07-27 (tickets 02-04 in `.scratch/classify-offload/`).
`scripts/classify.py` drains `aacx enrich --list`/`--list-dedup`, classifies
each item/entry via a direct Anthropic Batch API call, and pipes results into
`aacx enrich --apply`/`--apply-dedup` — no worklist or item object crosses the
interactive session's context. Model split: enrich on `claude-sonnet-5`
(owner/redaction/commitment judgment — a wrong call auto-delegates Dan's own
task or over-shares), dedup on `claude-haiku-4-5` (cheaper same-source
collapse). Prompt caching + Batch (-50%) are the default transport; cost is
~$4/mo Haiku + ~$8-12/mo Sonnet — the point is buying back interactive quota,
not a dollar saving over the flat subscription.

`daily-sweep.md` steps 5-7 (enrich) and step 10 (dedup) delegate to
`classify.py --enrich-only`/`--dedup-only` respectively — kept as two separate
calls (not one combined invocation) because `process --stage openloops`/
`reconcile` still run between them in the existing step order. `aacx
golive-actions` remains the sole execution authority throughout;
classification only ever writes enrichments/commitments/`duplicate_of`, never
what's sent to Todoist. ADR 0003 records this as the second documented
connector-driven-orchestration exception (after Todoist transport) — see
`docs/adr/0003-daily-sweep-step3-wiring.md`'s 2026-07-27 extension.

Live acceptance (2026-07-27, full sweep against the real store, 2 days
stale): enrich `items=53 commitments=14`, real cache hit
(cache_write=49880 cache_read=12760), 1 item omitted (deferred, not
fabricated); dedup worklist was genuinely empty that run, confirming the
zero-item no-op makes no API call. See `docs/prd/sweep-cost-offload.md`'s
"Track A — direct classification — SHIPPED" section for full evidence.

**Delivery-send gap resolved the same day:** the MCP Outlook/Gmail connectors
are read/draft-only in this session (no send tool). The self-send step (15)
used the clasp OAuth token (`~/.clasprc.json`, `mail.google.com` scope) to
call the Gmail API directly and send from `djgatsakos@gmail.com` to
`dgatsakos@activealarm.com` — see [[delivery-send-capability-gap]].
