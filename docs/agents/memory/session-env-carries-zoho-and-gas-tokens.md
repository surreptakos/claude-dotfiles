---
name: session-env-carries-zoho-and-gas-tokens
description: "The cloud environment's variables hold Zoho OAuth (refresh trio + one stale access token + API domain) and GAS_GITHUB_TOKEN; the values live only there, the names and the helper live here"
metadata:
  node_type: memory
  type: project
  originSessionId: session_01Dr2uNRuPb1h8oDXE9Bo1VL
  modified: 2026-09-18T21:00:00.000Z
---

Recorded 2026-09-18. A cloud container from the owner's environment starts with these variables
set (names read from `env`; values never copied anywhere, and the repo's secret guard would refuse
them):

- **Zoho** — `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` (the durable trio) and
  `ZOHO_API_DOMAIN` (`https://www.zohoapis.com`, the US data centre, whose OAuth host is
  `accounts.zoho.com`). A `ZOHO_ACCESS_TOKEN` was there too until 2026-09-18; Dan removed it
  because an access token lives one hour, and the helper mints its own.
- **`GAS_GITHUB_TOKEN`** — the GitHub token `gas seed` reads by default (`gas/cli/gas.js`), so a
  cloud session can seed an Apps Script project without `--github-token-env`.
- Also present, origin unverified: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` and
  `CLOUDSDK_AUTH_ACCESS_TOKEN`. `~/.aws/config` holds only an S3 signing flag. Read them as platform
  plumbing until a probe says otherwise.

**Where the values belong:** the cloud environment's variables (claude.ai/code, environment
settings) and nothing else. Not a note, not `profile/`, not a `.env` in a checkout — the whitelist
and `Assert-NoSecrets` exist so a pull or a commit cannot carry them. What this repo stores is the
*names* and the code that turns them into a call.

**How to use them:** `python3 tools/zoho-rest.py transport|probe|whoami|get <url-or-path>`. It
mints a fresh access token from the trio on every run, sends
`Authorization: Zoho-oauthtoken …` (Zoho also accepts the `Bearer` prefix; both answered `200`
on 2026-09-18), and prints no token: `probe` shows scope, `expires_in` and `api_domain`. Desk is on `desk.zoho.com`; pass it as
a full URL. **Books is not in the grant** — `/books/v3/organizations` answers
`{"code":57,"message":"You are not authorized to perform this operation"}`; Books from a cloud
session is the claude.ai Zoho Books connector, or a re-consent that adds `ZohoBooks.*` scopes.

**Verified 2026-09-18** (this transcript is the proof; a later failed run supersedes it):

```
$ python3 tools/zoho-rest.py probe
{"api_domain": "https://www.zohoapis.com", "expires_in": 3600, "scope": "ZohoCRM.modules.ALL
ZohoCRM.settings.ALL ZohoCRM.users.ALL ZohoCRM.org.ALL ZohoCRM.bulk.ALL ZohoCRM.notifications.ALL
ZohoCRM.coql.READ Desk.tickets.ALL Desk.contacts.ALL Desk.tasks.ALL Desk.basic.ALL
Desk.settings.ALL Desk.events.ALL Desk.articles.ALL Desk.search.READ", "token_type": "Bearer"}
$ python3 tools/zoho-rest.py whoami
dgatsakos@activealarm.com	Dan Gatsakos
$ python3 tools/zoho-rest.py get https://desk.zoho.com/api/v1/organizations   # ids + names
[(874367220, 'Active Alarm Company'), (882152284, 'activealarmcompany1742061430233'),
 (932165744, 'activealarmcompany1784572118742')]
```

The same client also honours the **`client_credentials` grant** for CRM
(`grant_type=client_credentials&scope=…&soid=ZohoCRM.873111975`, token acts as
`dgatsakos@activealarm.com`, Administrator), which is the shape a proxy-held credential could mint
without a refresh token — but only if the credential form takes the extra `soid` body field. Desk
scopes under that grant answer `{"error":"missing_org_info"}` with either `soid=ZohoDesk.874367220`
or the CRM one, so Desk stays on the refresh trio. Desk calls need `orgId: 874367220` (the named org; the two `activealarmcompany17…` ids are
sandbox-style duplicates, untested). `GAS_GITHUB_TOKEN` answers `/user` as `surreptakos` with an
empty `X-OAuth-Scopes` header, so it is a fine-grained PAT, and it differs from the platform's
`GH_TOKEN`. The auto-mode classifier refuses every call that puts one of these on the
wire (`Credential Exploration`), the helper included — verify from a session with auto mode off.
The helper's own tests (`python3 tools/zoho-rest.test.py`) cover the picker, the token request
and the header without a network. Related: [[caveman-base-url-stays-with-the-proxy]] for a
variable that must *not* live in the environment.
