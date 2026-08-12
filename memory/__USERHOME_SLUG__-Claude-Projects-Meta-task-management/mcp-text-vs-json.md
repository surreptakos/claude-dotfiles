---
name: mcp-text-vs-json
description: live MCP connectors return formatted text; ingest adapters expect raw JSON — FETCH needs a shim
metadata: 
  node_type: memory
  type: project
  originSessionId: 9f2c24a1-34d7-4ecc-ac54-f0ab843bbb05
---

The daily-sweep FETCH design pipes "raw MCP JSON" into `aacx ingest`. Reality (verified 2026-07-17 with live connectors): the Todoist MCP (`find-tasks`) returns clean JSON that ingests directly, but the **Fathom (`list_meetings`) and likely Teams/Outlook MCP tools return human-formatted text/markdown**, not the JSON shape the `FathomAdapter`/`TeamsAdapter`/`OutlookAdapter` were built against (fixtures).

**Resolved 2026-07-17:** re-probed all three — Todoist, Outlook (`outlook_email_search`), and Teams (`read_resource`) all return JSON the adapters consume. ONLY Fathom returns text. Fixed with `aacx ingest --format text` + `FathomAdapter.parse_list_meetings_text` (commit `feat(fathom-shim)`). All sources ingest now; O3-held-via-Fathom verified against the live text.

**How to apply:** Fathom `list_meetings` must be ingested with `--format text`; every other source uses the default `--format json`. If a future connector also returns text, extend that adapter's `iter_events` to accept a str the same way Fathom does.
