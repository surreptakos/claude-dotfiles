#!/usr/bin/env python3
r"""Reach the Zoho REST APIs (CRM, Books, Desk, ...) with the credential a session already holds.

The cloud environment carries five Zoho variables (memory note
`session-env-carries-zoho-and-gas-tokens`):

  ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN   the durable part: a refresh token never
                                                          expires on its own, and these three mint
                                                          a fresh access token on demand
  ZOHO_ACCESS_TOKEN                                       one access token, minted when the
                                                          variables were set; Zoho access tokens
                                                          live one hour, so treat it as stale
  ZOHO_API_DOMAIN                                         `https://www.zohoapis.com` for the US DC;
                                                          the accounts host follows from it

This helper always prefers minting: a stored access token is only used when the refresh trio is
absent. It never prints a token - `probe` reports scope, expiry and data centre, nothing else -
and every request carries `Authorization: Zoho-oauthtoken <token>`, the prefix Zoho documents
(it accepts `Bearer` too; both verified 2026-09-18).

Usage:
  python3 tools/zoho-rest.py transport            which credentials the surface holds (names only)
  python3 tools/zoho-rest.py probe                mint once; print scope, expires_in, api_domain
  python3 tools/zoho-rest.py whoami               the CRM user the token belongs to
  python3 tools/zoho-rest.py get <url-or-path>    GET; a path such as /crm/v7/org is joined to
                                                  ZOHO_API_DOMAIN, a full URL is used as given
                                                  (Desk lives on desk.zoho.com and wants an
                                                  `orgId` header; the 2026-09-18 grant covers
                                                  CRM and Desk, not Books)
Exit 0 on a 2xx, 1 on anything else.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

REFRESH_KEYS = ("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN")
DEFAULT_API_DOMAIN = "https://www.zohoapis.com"
UA = "aac-zoho-access/1.0 (tools/zoho-rest.py)"


class ZohoAccessError(Exception):
    """A request this helper refuses to make, or a credential the surface does not hold."""


def api_domain(env):
    return (env.get("ZOHO_API_DOMAIN") or DEFAULT_API_DOMAIN).rstrip("/")


def accounts_domain(env):
    """The OAuth host for the data centre `ZOHO_API_DOMAIN` names.

    Zoho keys both by TLD: `www.zohoapis.com` pairs with `accounts.zoho.com`, `www.zohoapis.eu`
    with `accounts.zoho.eu`, and so on. `ZOHO_ACCOUNTS_DOMAIN` overrides when set.
    """
    if env.get("ZOHO_ACCOUNTS_DOMAIN"):
        return env["ZOHO_ACCOUNTS_DOMAIN"].rstrip("/")
    host = urllib.parse.urlsplit(api_domain(env)).netloc
    tld = host.split("zohoapis", 1)[1] if "zohoapis" in host else ".com"
    return "https://accounts.zoho" + tld


def pick_transport(env=None):
    """Return (name, reason) for the credential `env` holds. Never touches the network."""
    env = os.environ if env is None else env
    present = [k for k in REFRESH_KEYS if env.get(k, "").strip()]
    if len(present) == len(REFRESH_KEYS):
        return "refresh", "ZOHO_CLIENT_ID + ZOHO_CLIENT_SECRET + ZOHO_REFRESH_TOKEN (mints per run)"
    if env.get("ZOHO_ACCESS_TOKEN", "").strip():
        missing = sorted(set(REFRESH_KEYS) - set(present))
        return "stored", f"ZOHO_ACCESS_TOKEN only (stale after one hour; missing {', '.join(missing)})"
    raise ZohoAccessError(
        "zoho-rest: no credential - set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN "
        "(or ZOHO_ACCESS_TOKEN) in the environment"
    )


def _post_form(url, fields, urlopen):
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA}, method="POST")
    try:
        with urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


def mint(env=None, urlopen=urllib.request.urlopen):
    """Exchange the refresh token for an access token. Returns the token response dict.

    Zoho answers 200 even when the grant is bad (`{"error": "invalid_code"}`), so the body is
    what decides, not the status.
    """
    env = os.environ if env is None else env
    transport, _reason = pick_transport(env)
    if transport != "refresh":
        raise ZohoAccessError("zoho-rest: cannot mint without the refresh trio (" + ", ".join(REFRESH_KEYS) + ")")
    status, body = _post_form(
        accounts_domain(env) + "/oauth/v2/token",
        {
            "grant_type": "refresh_token",
            "refresh_token": env["ZOHO_REFRESH_TOKEN"],
            "client_id": env["ZOHO_CLIENT_ID"],
            "client_secret": env["ZOHO_CLIENT_SECRET"],
        },
        urlopen,
    )
    try:
        parsed = json.loads(body)
    except ValueError:
        raise ZohoAccessError(f"zoho-rest: token endpoint answered {status} with a non-JSON body")
    if status != 200 or "access_token" not in parsed:
        raise ZohoAccessError(f"zoho-rest: refresh refused ({status}): {parsed.get('error', body)}")
    return parsed


def access_token(env=None, urlopen=urllib.request.urlopen):
    env = os.environ if env is None else env
    transport, _reason = pick_transport(env)
    if transport == "refresh":
        return mint(env, urlopen)["access_token"]
    return env["ZOHO_ACCESS_TOKEN"].strip()


def resolve_url(url_or_path, env):
    if url_or_path.startswith("/"):
        return api_domain(env) + url_or_path
    if not urllib.parse.urlsplit(url_or_path).scheme:
        raise ZohoAccessError(f"zoho-rest: {url_or_path!r} is neither a full URL nor a /path")
    return url_or_path


def get(url_or_path, headers=None, env=None, urlopen=urllib.request.urlopen):
    """GET on the Zoho API with the session's credential. Returns (status, body_text)."""
    env = os.environ if env is None else env
    url = resolve_url(url_or_path, env)
    out = {k: v for k, v in (headers or {}).items() if k.lower() != "authorization"}
    out.setdefault("User-Agent", UA)
    out["Authorization"] = "Zoho-oauthtoken " + access_token(env, urlopen)
    req = urllib.request.Request(url, headers=out)
    try:
        with urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


def public_fields(token_response):
    """The token response minus the token: what `probe` prints and what a log may hold."""
    return {k: v for k, v in token_response.items() if k in ("scope", "expires_in", "api_domain", "token_type")}


def main(argv):
    if not argv or argv[0] in {"-h", "--help"}:
        print(__doc__.strip())
        return 0
    cmd, args = argv[0], argv[1:]
    try:
        if cmd == "transport":
            name, reason = pick_transport()
            print(f"{name}\t{reason}")
            return 0
        if cmd == "probe":
            print(json.dumps(public_fields(mint()), sort_keys=True))
            return 0
        if cmd == "whoami":
            status, body = get("/crm/v7/users?type=CurrentUser")
            if status != 200:
                print(body, file=sys.stderr)
                return 1
            user = json.loads(body)["users"][0]
            print(f"{user.get('email')}\t{user.get('full_name')}")
            return 0
        if cmd == "get":
            if len(args) != 1:
                raise ZohoAccessError("zoho-rest: get <url-or-path>")
            status, body = get(args[0])
            print(body)
            return 0 if 200 <= status < 300 else 1
    except ZohoAccessError as exc:
        print(exc, file=sys.stderr)
        return 1
    print(f"zoho-rest: unknown command {cmd!r}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
