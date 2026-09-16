#!/usr/bin/env python3
"""Tests for tools/google-rest.py. Run:  python3 tools/google-rest.test.py

Nothing here touches the network: the transports are chosen from an env dict, and the two
key-bearing ones are proved by the seam they call, not by signing a real JWT.
"""

import importlib.util
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("google_rest", HERE / "google-rest.py")
gr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gr)

MISSING_KEY = {"GOOGLE_APPLICATION_CREDENTIALS": "/nonexistent/sa-key.json"}


class Transport(unittest.TestCase):
    def test_team_env_beats_cloud_and_key_file(self):
        # A Team cloud container sets CLAUDE_CODE_REMOTE too, and its proxy attaches nothing.
        env = dict(MISSING_KEY, GPT_SHEETS_SA_KEY_JSON='{"type":"service_account"}',
                   CLAUDE_CODE_REMOTE="true")
        self.assertEqual(gr.pick_transport(env)[0], "team-env")

    def test_cloud_when_remote_and_no_key(self):
        self.assertEqual(gr.pick_transport(dict(MISSING_KEY, CLAUDE_CODE_REMOTE="true"))[0],
                         "cloud-proxy")

    def test_pc_key_when_file_present_and_not_remote(self):
        env = {"GOOGLE_APPLICATION_CREDENTIALS": str(Path(__file__))}  # any existing file
        self.assertEqual(gr.pick_transport(env)[0], "pc-key")

    def test_no_transport_raises(self):
        with self.assertRaises(gr.GoogleAccessError):
            gr.pick_transport(dict(MISSING_KEY))


class CloudRequest(unittest.TestCase):
    def test_sends_no_authorization_and_drops_one_passed_in(self):
        headers = gr.cloud_headers({"Authorization": "Bearer self-signed", "X-Trace": "1"})
        self.assertNotIn("authorization", {k.lower() for k in headers})
        self.assertEqual(headers["X-Trace"], "1")

    def test_cloud_get_never_builds_a_credential(self):
        env = dict(MISSING_KEY, CLAUDE_CODE_REMOTE="true")
        sent = {}

        def fake_urlopen(req):
            sent["headers"] = dict(req.headers)
            return _Resp(200, b'{"ok":true}')

        with _patch(gr.urllib.request, "urlopen", fake_urlopen), \
                _patch(gr, "authorized_session", _boom):
            status, body = gr.get("https://sheets.googleapis.com/v4/spreadsheets/x/values/A1",
                                  {"Authorization": "Bearer self-signed"}, env)
        self.assertEqual((status, body), (200, '{"ok":true}'))
        self.assertNotIn("authorization", {k.lower() for k in sent["headers"]})


class KeyBearingRequest(unittest.TestCase):
    def test_key_file_transport_signs_through_authorized_session(self):
        env = {"GOOGLE_APPLICATION_CREDENTIALS": str(Path(__file__))}
        calls = []

        class Session:
            def get(self, url, headers=None):
                calls.append(url)
                return _Resp(200, b"signed", text="signed")

        with _patch(gr, "authorized_session", lambda t, e: calls.append(t) or Session()):
            status, body = gr.get("https://sheets.googleapis.com/v4/spreadsheets/x/values/A1",
                                  None, env)
        self.assertEqual((status, body), (200, "signed"))
        self.assertEqual(calls[0], "pc-key")


class Gmail(unittest.TestCase):
    def test_refused_on_every_transport(self):
        for env in ({"CLAUDE_CODE_REMOTE": "true"},
                    {"GPT_SHEETS_SA_KEY_JSON": "{}"},
                    {"GOOGLE_APPLICATION_CREDENTIALS": str(Path(__file__))}):
            with self.assertRaises(gr.GoogleAccessError) as ctx:
                gr.get("https://gmail.googleapis.com/gmail/v1/users/me/profile", None, env)
            self.assertIn("Precondition check failed", str(ctx.exception))


class CellUrl(unittest.TestCase):
    def test_range_with_a_space_is_one_encoded_segment(self):
        url = gr.cell_url("1dBhSYwk", "Script Errors!A1")
        self.assertEqual(url, "https://sheets.googleapis.com/v4/spreadsheets/1dBhSYwk"
                              "/values/Script%20Errors%21A1")


class _Resp:
    def __init__(self, status, body, text=None):
        self.status, self.status_code, self._body, self.text = status, status, body, text

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


def _boom(*_a, **_k):
    raise AssertionError("the cloud transport must not build a credential")


class _patch:
    """Minimal attribute patch: unittest.mock is not used elsewhere in this repo's python tests."""

    def __init__(self, target, name, value):
        self.target, self.name, self.value = target, name, value

    def __enter__(self):
        self.old = getattr(self.target, self.name)
        setattr(self.target, self.name, self.value)

    def __exit__(self, *_exc):
        setattr(self.target, self.name, self.old)
        return False


if __name__ == "__main__":
    unittest.main(verbosity=2)
