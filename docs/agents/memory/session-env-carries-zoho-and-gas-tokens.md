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

- **Zoho** — `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` (the durable trio),
  `ZOHO_ACCESS_TOKEN` (one access token, minted when the variables were set; Zoho access tokens
  expire after one hour, so it is stale by the time it matters) and `ZOHO_API_DOMAIN`
  (`https://www.zohoapis.com`, the US data centre, whose OAuth host is `accounts.zoho.com`).
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
mints a fresh access token from the trio on every run (the stored one is a fallback only), sends
`Authorization: Zoho-oauthtoken …` (a `Bearer` header answers `INVALID_TOKEN`), and prints no
token: `probe` shows scope, `expires_in` and `api_domain`, which is also how to learn what the
grant covers before assuming CRM, Books or Desk. Desk is on `desk.zoho.com`, Books on
`www.zohoapis.com/books/v3`; pass those as full URLs.

**Not yet proven live (2026-09-18):** the auto-mode classifier refused every call that put a
credential on the wire from this session (`Credential Exploration`), so the trio's grant, the
scope list and the GitHub token's login are unverified. Run `probe` and `whoami` in a session
where the operator allows it, and replace this paragraph with the transcript. The helper's own
tests (`python3 tools/zoho-rest.test.py`) cover the picker, the token request and the header
without a network. Related: [[caveman-base-url-stays-with-the-proxy]] for a variable that must
*not* live in the environment.
