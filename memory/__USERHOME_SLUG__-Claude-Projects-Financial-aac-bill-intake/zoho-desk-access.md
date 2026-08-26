---
name: zoho-desk-access
description: "Zoho Desk access — prod org 874367220 (ZohoOne), 3 active departments incl AP; token PROD-bound with wide CRM+Desk superset; sandbox unreachable; MCP is ops-only"
metadata:
  node_type: memory
  type: reference
  originSessionId: 778e1340-d671-4348-b1ce-71de6962e369
  modified: 2026-08-26T14:08:09.634Z
---

## Live account facts

- **Prod portal** "Active Alarm Company" — orgId `874367220`, edition **ZohoOne** (Enterprise-tier Desk features, incl. Deluge and multi-department). primaryContact dgatsakos.
- **Prod departments (three active):** **AP** (`1073870000032818112`, the configured intake one), **Active Alarm Company**, and **OSH Service**. Confirm live with `deskDepartmentConfigDiag` — that diagnostic exists because a stale comment claimed AP was never created. Check the diagnostic, not this list.
- **Sandbox is unreachable.** Previous sandboxes (`882152284`, then `932165744`) are abandoned; the current PROD-bound token 403s `OAUTH_ORG_MISMATCH` on every org-scoped sandbox call. No working sandbox Desk credential exists. Sandbox work would need a fresh sandbox-portal grant (portal-bound rule below).
- **MCP session** has admin API access (`isAdminInOrg: true`) — confirmed 2026-07-17.

## Token binding

- **The current `ZOHO_REFRESH_TOKEN` is PROD-bound and wide** — carries `ZohoCRM.modules.ALL ZohoCRM.settings.ALL ZohoCRM.users.ALL ZohoCRM.org.ALL ZohoCRM.bulk.ALL ZohoCRM.notifications.ALL ZohoCRM.coql.READ Desk.tickets.ALL Desk.contacts.ALL Desk.tasks.ALL Desk.basic.ALL Desk.settings.ALL Desk.events.ALL Desk.articles.ALL Desk.search.READ` (installed 2026-08-05, #61). Superset of everything the pipeline uses. Prior Desk-only token in `ZOHO_REFRESH_TOKEN_BAK`; `zohoTokenRestore()` rolls back.
- **A Desk OAuth token is portal-bound** — one token does not serve both portals. A prod-context grant answers 200 for prod and 403 `OAUTH_ORG_MISMATCH` for sandbox on every org-scoped call, while org-agnostic `GET /organizations` still lists both. At any future prod+sandbox split, store both refresh tokens (e.g. `ZOHO_REFRESH_TOKEN_SANDBOX` / `_PROD`) and select by portal — not just swap `DESK_ORG_ID`.
- **Lesson: Dan holds wide tokens from this self-client — ask him for one before prescribing the api-console grant ceremony.** OAuth refresh does not escalate scope; a new grant is minted only in `api-console.zoho.com` behind an admin login. Probe candidates with `zohoToken2Probe` (statuses only, never prints values); promote with `zohoTokenPromote2`. Live-portal check: `zohoWhichPortal` (read-only, probes both org ids).

## MCP surface — ops only

The connected Desk MCP exposes tickets, comments, threads, replies, contacts, accounts, calls/events/tasks, plus read-only orgs/departments/reply-mail-addresses. It does NOT expose provisioning (create department / custom field / status / webhook / email channel). Those go through the Desk REST API with the wide token above.

Part of the Desk-channel AP intake work (`.scratch/desk-channel-intake/`, ADR-0002). See [[gas-verification-loop]], [[desk-provisioning-api-facts]].
