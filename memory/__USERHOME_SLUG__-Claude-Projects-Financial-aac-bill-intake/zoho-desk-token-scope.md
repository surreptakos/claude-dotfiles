---
name: zoho-desk-token-scope
description: Prod-bound ZOHO_REFRESH_TOKEN carries full CRM+Desk superset (2026-08-05); sandbox 932165744 UNREACHABLE since #61 swap; Dan holds spare wide tokens — ask before console ceremony
metadata: 
  node_type: memory
  type: project
  originSessionId: 3d49ce01-d0f0-448b-afa6-781fff136b93
  modified: 2026-08-07T03:56:37.450Z
---

**UPDATE 2026-08-06 (#67 probe):** the #61 token is PROD-bound. Live probe: org `932165744`
(sandbox) answers `403 OAUTH_ORG_MISMATCH` on every org-scoped call; `874367220` answers 200. The
Desk MCP connector hits the same 403. **No working sandbox Desk credential exists** — the 2026-07-20
"active sandbox 932165744" note below is stale for token purposes (org still exists; token can't
reach it). Sandbox work needs Dan to re-mint a sandbox-portal grant (portal-bound rule below).

**UPDATE 2026-08-05 (#61):** the PROD `ZOHO_REFRESH_TOKEN` was replaced with one Dan already held
from THIS self-client, carrying `ZohoCRM.modules.ALL ZohoCRM.settings.ALL ZohoCRM.users.ALL
ZohoCRM.org.ALL ZohoCRM.bulk.ALL ZohoCRM.notifications.ALL ZohoCRM.coql.READ Desk.tickets.ALL
Desk.contacts.ALL Desk.tasks.ALL Desk.basic.ALL Desk.settings.ALL Desk.events.ALL Desk.articles.ALL
Desk.search.READ` — a superset of everything the pipeline uses, CRM fallback (#54) now live. The
prior Desk-only token sits in `ZOHO_REFRESH_TOKEN_BAK`; `zohoTokenRestore()` rolls back. **Lesson:
Dan holds wide tokens from this client — ask him for one before prescribing the api-console grant
ceremony.** Probe any candidate with `zohoToken2Probe` (statuses only, never prints values); promote
with `zohoTokenPromote2`.

**RESOLVED 2026-07-20 (late):** Dan spun up a NEW sandbox and re-minted the grant bound to it. The
active sandbox is now **orgId `932165744`** (portal `activealarmcompany1784572118742`, ENTERPRISE);
old sandbox `882152284` is abandoned, prod stays `874367220`. The current `ZOHO_REFRESH_TOKEN` is
bound to `932165744` and carries BOTH `Desk.settings.ALL` + `Desk.tickets.ALL` (scope probe: settings
200, tickets read 204, tickets write 404-not-403). `DESK_ORG_ID` Script Property set to `932165744`
via `clasp run zohoSetDeskOrgId`. Discover portals with `clasp run zohoListOrgs`. Provisioning (#2)
targets a clean-slate sandbox now — nothing provisioned there yet.

--- original finding (the scope gap that led here) ---

Empirically probed 2026-07-20 (via `clasp run zohoScopeProbe` in `gas/Zoho.gs`): the stored
`ZOHO_REFRESH_TOKEN` (sandbox, DESK_ORG_ID 882152284) carries **`Desk.tickets.ALL`** (read=204 on
`GET /tickets`, write=404 URL_NOT_FOUND on `PATCH /tickets/<fake-id>` — a scope wall would be 403
SCOPE_MISMATCH) but **NOT `Desk.settings.*`** (403 SCOPE_MISMATCH on `GET /organizationFields`,
`/channels`, `/layouts`).

Consequence: the engine's runtime IO (fetch invoice thread-attachment, write back to a ticket, post
comments) works today. But **all structural provisioning is blocked** — AP department, custom
fields, custom statuses, channel/From-Address, ticket-create webhook (Desk-channel issue #2, and
the structural parts of #8/#13).

**Self-serve is not possible:** a Zoho self-client grant code with the added scope is minted only in
the api-console.zoho.com UI behind an admin login (password entry — Prohibited for the agent, and no
Zoho admin credential is held). OAuth refresh does not escalate scope. The connected Desk MCP is
ops-only (no provisioning). So this is a genuine human step, same category as the BILL prod cutover.

**The one unblock (Dan):** re-mint the self-client grant code including BOTH `Desk.settings.ALL`
AND `Desk.tickets.ALL`, paste into the `ZOHO_GRANT_CODE` Script Property, then agent runs
`clasp run zohoExchangeGrant` (stores refresh token, deletes the code) → `zohoScopeProbe` to confirm
→ re-run #2 provisioning.

**CORRECTION 2026-07-20 — a Desk OAuth token is PORTAL-BOUND; one token does NOT serve both
portals** (contra the PRD's "same refresh token serves both portals, only DESK_ORG_ID changes").
Proven: a grant re-minted against the PROD portal returns `200` for prod org 874367220 but
`403 OAUTH_ORG_MISMATCH` for sandbox org 882152284 on every org-scoped call — while org-agnostic
`GET /organizations` still succeeds and lists 882152284. So sandbox and prod each need their OWN
authorized token. Diagnostic: `clasp run zohoWhichPortal` (read-only, probes both org ids).
Implication: to keep sandbox development working, the grant MUST be generated with the **sandbox
portal** as the active Zoho context; a prod-context grant silently breaks sandbox. At prod cutover
(#3) we will need to STORE BOTH refresh tokens (e.g. `ZOHO_REFRESH_TOKEN_SANDBOX` /
`_PROD`) and select by portal, not just swap `DESK_ORG_ID`.

See [[zoho-desk-access]], [[gas-verification-loop]].
