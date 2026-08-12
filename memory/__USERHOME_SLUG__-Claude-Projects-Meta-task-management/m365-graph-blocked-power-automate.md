---
name: m365-graph-blocked-power-automate
description: "M365 rides Power Automate exports to Google Drive, fetched by gdrive_fetch.py; Graph and the OneDrive drop folder are both dead ends."
metadata: 
  node_type: memory
  type: project
  originSessionId: a0763e0a-04b9-4438-8ff5-492227b6e056
  modified: 2026-07-31T20:02:46.955Z
---

M365 transport, as of 2026-07-31 (PRs #112 + follow-ups): Power Automate flows export
each source as **Graph-shaped JSON to Google Drive**; `scripts/gdrive_fetch.py`
downloads them to `data/m365-inbox`, `scripts/m365_import.py` ingests the folder, and
each Drive copy that ingested cleanly is trashed. Step 2 of the sweep runs
`gdrive_fetch.py`. **All 19 sources delivering; `never=0`.** There is no `--hydrate`
step any more — the exports carry full bodies.

**Two dead ends — do not revive either:**

- **Graph (`scripts/m365_sync.py`, #55).** Tenant admin blocks user-consent for every
  read scope, so the token cannot be minted at all. Verified: `/me` → 200,
  `/me/messages` → 403 `ErrorAccessDenied`, scope claim
  `ChannelMessage.Send openid profile User.Read email`. Script stays on disk unused.
- **OneDrive drop folder.** Sync client can't be depended on: ~81,000 files in the
  scope, so server-change enumeration backs off. Two exports took ~15 min; a third
  never arrived in 27+ min while plainly present server-side.

**Credential:** the clasp token, which the sweep already refreshes to send the brief.
Its grant covers `mail.google.com` **and full `/auth/drive`** — the older note claiming
`drive.file` only was wrong; tokeninfo disproved it. Also reads Gmail, which is the
fallback if Drive is ever DLP-blocked.

**How to apply:**
- Never substitute an Outlook/Teams/Calendar MCP connector for the sweep fetch — see
  [[teams-mcp-no-paging]] (20 newest messages, no cursor, ignores `since`).
- Flows must emit `body` not `bodyPreview` (`to_item` prefers the preview), wrap the
  array under `value`, and name files `<source>__<key>__<ts>.json` — Teams uses the
  *person id*, since chat ids contain a colon.
- `flows/gen_flows.py` regenerates all 19 definitions; `flows/build_package.py` packages
  them. Package layout is undocumented and cost two failed imports — the reference is
  Dan's own tenant export, and the layout is pinned by `tests/unit/test_flow_packages.py`.
- Verify against live data, not just tests: real connector output exposed HTML chat
  titles, a duplicated calendar organizer, and image-only messages ingesting empty —
  none of which unit tests could have caught. See
  [[verify-inferences-against-the-store]].
- `m365_import.py` is deliberately network-free, so moving back in-tenant (a SharePoint
  library staged into `data/m365-inbox`) would cost no code.
