#!/usr/bin/env python3
"""Tests for tools/zoho-rest.py. Run:  python3 tools/zoho-rest.test.py

Nothing here touches the network: `urlopen` is injected, and the assertions are about which
credential is chosen, where the token request goes, and that no token ever reaches stdout.
"""

import importlib.util
import io
import json
import unittest
import urllib.error
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("zoho_rest", HERE / "zoho-rest.py")
zr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(zr)

TRIO = {"ZOHO_CLIENT_ID": "cid", "ZOHO_CLIENT_SECRET": "csec", "ZOHO_REFRESH_TOKEN": "rt-secret"}
TOKEN_OK = {"access_token": "at-secret", "scope": "ZohoCRM.users.READ", "expires_in": 3600,
            "api_domain": "https://www.zohoapis.com", "token_type": "Bearer"}


class _Resp:
    def __init__(self, status, body):
        self.status, self._body = status, body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def fake_net(routes, log):
    """`urlopen` that answers by URL and records every request it saw."""
    def urlopen(req):
        log.append(req)
        status, body = routes[req.full_url]
        if status >= 400:
            raise urllib.error.HTTPError(req.full_url, status, "err", {}, io.BytesIO(body))
        return _Resp(status, body)
    return urlopen


class Transport(unittest.TestCase):
    def test_full_trio_is_the_refresh_transport(self):
        self.assertEqual(zr.pick_transport(dict(TRIO))[0], "refresh")

    def test_partial_trio_names_what_is_missing_and_no_value(self):
        with self.assertRaises(zr.ZohoAccessError) as ctx:
            zr.pick_transport({"ZOHO_CLIENT_ID": "cid-value"})
        self.assertIn("ZOHO_CLIENT_SECRET", str(ctx.exception))
        self.assertIn("ZOHO_REFRESH_TOKEN", str(ctx.exception))
        self.assertNotIn("cid-value", str(ctx.exception))  # names, never the value

    def test_nothing_raises(self):
        with self.assertRaises(zr.ZohoAccessError):
            zr.pick_transport({})


class Domains(unittest.TestCase):
    def test_accounts_host_follows_api_domain_tld(self):
        self.assertEqual(zr.accounts_domain({}), "https://accounts.zoho.com")
        self.assertEqual(zr.accounts_domain({"ZOHO_API_DOMAIN": "https://www.zohoapis.eu"}),
                         "https://accounts.zoho.eu")
        self.assertEqual(zr.accounts_domain({"ZOHO_API_DOMAIN": "https://www.zohoapis.com.au/"}),
                         "https://accounts.zoho.com.au")
        self.assertEqual(zr.accounts_domain({"ZOHO_ACCOUNTS_DOMAIN": "https://accounts.example/"}),
                         "https://accounts.example")

    def test_path_joins_api_domain_and_full_url_passes_through(self):
        env = {"ZOHO_API_DOMAIN": "https://www.zohoapis.com/"}
        self.assertEqual(zr.resolve_url("/crm/v7/org", env), "https://www.zohoapis.com/crm/v7/org")
        self.assertEqual(zr.resolve_url("https://desk.zoho.com/api/v1/organizations", env),
                         "https://desk.zoho.com/api/v1/organizations")
        with self.assertRaises(zr.ZohoAccessError):
            zr.resolve_url("crm/v7/org", env)


class Mint(unittest.TestCase):
    def test_posts_refresh_grant_to_accounts_host(self):
        log = []
        net = fake_net({"https://accounts.zoho.com/oauth/v2/token": (200, json.dumps(TOKEN_OK).encode())}, log)
        out = zr.mint(dict(TRIO), net)
        self.assertEqual(out["access_token"], "at-secret")
        req = log[0]
        self.assertEqual(req.get_method(), "POST")
        sent = dict(urllib.parse.parse_qsl(req.data.decode()))
        self.assertEqual(sent, {"grant_type": "refresh_token", "refresh_token": "rt-secret",
                                "client_id": "cid", "client_secret": "csec"})

    def test_200_with_error_body_is_a_refusal(self):
        # Zoho answers 200 to a dead grant; the body carries the verdict.
        net = fake_net({"https://accounts.zoho.com/oauth/v2/token": (200, b'{"error":"invalid_code"}')}, [])
        with self.assertRaises(zr.ZohoAccessError) as ctx:
            zr.mint(dict(TRIO), net)
        self.assertIn("invalid_code", str(ctx.exception))

    def test_probe_prints_no_token(self):
        net = fake_net({"https://accounts.zoho.com/oauth/v2/token": (200, json.dumps(TOKEN_OK).encode())}, [])
        printed = json.dumps(zr.public_fields(zr.mint(dict(TRIO), net)))
        self.assertNotIn("at-secret", printed)
        self.assertIn("ZohoCRM.users.READ", printed)


class Get(unittest.TestCase):
    def test_mints_then_sends_zoho_oauthtoken_header(self):
        log = []
        net = fake_net({
            "https://accounts.zoho.com/oauth/v2/token": (200, json.dumps(TOKEN_OK).encode()),
            "https://www.zohoapis.com/crm/v7/org": (200, b'{"org":[]}'),
        }, log)
        status, body = zr.get("/crm/v7/org", {"Authorization": "Bearer wrong", "X-Trace": "1"}, dict(TRIO), net)
        self.assertEqual((status, body), (200, '{"org":[]}'))
        api_req = log[1]
        self.assertEqual(api_req.get_header("Authorization"), "Zoho-oauthtoken at-secret")
        self.assertEqual(api_req.get_header("X-trace"), "1")

    def test_get_without_the_trio_never_reaches_the_network(self):
        log = []
        net = fake_net({}, log)
        with self.assertRaises(zr.ZohoAccessError):
            zr.get("/crm/v7/org", None, {"ZOHO_CLIENT_ID": "cid"}, net)
        self.assertEqual(log, [])


class Cli(unittest.TestCase):
    def test_transport_prints_names_only(self):
        zr.os.environ.update(TRIO)
        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(zr.main(["transport"]), 0)
            self.assertIn("refresh", buf.getvalue())
            for secret in TRIO.values():
                self.assertNotIn(secret, buf.getvalue())
        finally:
            for k in TRIO:
                zr.os.environ.pop(k, None)


if __name__ == "__main__":
    unittest.main()
