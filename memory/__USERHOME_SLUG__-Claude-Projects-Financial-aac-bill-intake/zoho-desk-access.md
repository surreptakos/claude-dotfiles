---
name: zoho-desk-access
description: "Zoho Desk admin API/MCP access confirmed — prod + sandbox org IDs, edition, departments, and MCP surface limits"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 778e1340-d671-4348-b1ce-71de6962e369
---

Confirmed 2026-07-17 via the connected Zoho Desk MCP: the session has **admin** API access (`isAdminInOrg: true`) to Active Alarm's Desk.

- **Prod portal** "Active Alarm Company" — orgId `874367220`, edition **ZohoOne** (so Enterprise-tier Desk features are available, incl. Deluge and multi-department). primaryContact dgatsakos.
- **Sandbox portal** — orgId `882152284`, edition Enterprise, `isSandboxPortal: true`, primaryContact nremblake. Use this for live verification before touching prod.
- **Prod departments:** "Active Alarm Company" (default, id `1073870000000006907`) and "OSH Service" / Oak Street Health Service (id `1073870000000808039`, currently **disabled**). AP invoices are ~all Oak Street Health work, so the OSH structure is relevant.

**MCP surface is operations-only:** tickets, comments, threads, replies, contacts, accounts, calls/events/tasks, plus read-only orgs/departments/reply-mail-addresses. It does NOT expose provisioning (create department / custom field / status / webhook / email channel). Those require the **Desk REST API with an admin (Desk.settings) OAuth token** — the plan is to drive them as GAS setup functions reading creds from Script Properties, sandbox-first then prod, per [[gas-verification-loop]]. The M365 auto-forward rule and email-channel verification have no API path from here (M365 connector is read/search only).

Part of the Desk-channel AP intake work (`.scratch/desk-channel-intake/`, ADR-0002).
