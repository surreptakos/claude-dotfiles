#!/usr/bin/env python3
r"""Reach Google REST as the AAC service account from any surface this repo runs on.

Three transports carry the same identity
(`gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com`), and which one applies is a
property of the surface, not of the caller:

  team-env     `GPT_SHEETS_SA_KEY_JSON` holds the key JSON. The API-credentials section does not
               exist on Team/Enterprise plans, so an owner-only environment variable carries the
               key and this code signs its own requests.
  cloud-proxy  A claude.ai/code container on the Pro/Max account (`CLAUDE_CODE_REMOTE=true`). The
               key is an environment API credential held by the agent proxy, which mints the token
               and attaches `Authorization` to every `*.googleapis.com` request. Sending our own
               header there is wrong twice over: there is no key to load, and a self-signed JWT
               collides with the proxy's header.
  pc-key       The owner's PC: the key file on disk, `service_account` -> `AuthorizedSession`.

Order matters. A Team cloud container also sets `CLAUDE_CODE_REMOTE=true`, but its proxy attaches
nothing, so the explicit key must win over the ambient one. Verified 2026-09-14 (issue 164 comment
5667782333) and again 2026-09-16 (issue 172).

Gmail rides none of them: `mail.google.com` on an SA token answers `400 Precondition check failed`
(the SA has no mailbox, and a personal @gmail.com cannot delegate). Gmail from a cloud session is
the claude.ai Gmail connector; on the PC it is the clasp token.

Usage:
  python3 tools/google-rest.py transport
  python3 tools/google-rest.py whoami
  python3 tools/google-rest.py cell <spreadsheetId> "<Tab!A1>"
  python3 tools/google-rest.py get <url>
  python3 tools/google-rest.py doc-read <docId>
  python3 tools/google-rest.py doc-replace <docId> <file.md|.html|.docx|.txt | doc:<sourceDocId>>
Exit 0 on a 2xx, 1 on anything else.

doc-replace revises a Google Doc in place (issue 1216): the Drive connector's `update_file` changes
only title and folder, so a second pass that goes through it ends as a "v2" beside v1. This uploads
the new body over the Doc's own id (Drive `files.update`, `uploadType=media`; Drive converts
Markdown, HTML, .docx or plain text into the Doc, keeping its id, link, sharing and revision
history), then exports it as plain text and prints that read-back. `doc:<sourceDocId>` copies
another Doc's whole body (through .docx, so headings, lists and tables survive) and exits 1 unless
the two read-backs match; a .txt source must match too. The service account must be Editor on the
target (Viewer on a source Doc): a Doc made through the Drive connector is the owner's, so share it
with the connector's `share_file` first (a 403 `insufficientFilePermissions` means it was not).
Trashing the stale copy is the connector's `trash_file`: only the owner can trash a My Drive file.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

KEY_PATH = "~/.config/gpt-sheets-access-475817-853f8648243b.json"
TEAM_ENV = "GPT_SHEETS_SA_KEY_JSON"
UA = "aac-google-access/1.0 (tools/google-rest.py)"
SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets"]
GMAIL_REFUSAL = (
    "google-rest: Gmail cannot ride the service account (mail.google.com -> 400 Precondition "
    "check failed: the SA has no mailbox, and a personal @gmail.com cannot delegate). Use the "
    "claude.ai Gmail connector from a cloud session, or the clasp token on the PC."
)


class GoogleAccessError(Exception):
    """A request this helper refuses to make, or a surface it cannot reach Google from."""


def key_file(env):
    return os.path.expanduser(env.get("GOOGLE_APPLICATION_CREDENTIALS") or KEY_PATH)


def pick_transport(env=None):
    """Return (name, reason) for the surface `env` describes. Never touches the network."""
    env = os.environ if env is None else env
    if env.get(TEAM_ENV, "").strip():
        return "team-env", f"{TEAM_ENV} (key JSON in the environment; this code signs)"
    if env.get("CLAUDE_CODE_REMOTE", "").strip().lower() == "true":
        return "cloud-proxy", "CLAUDE_CODE_REMOTE (agent proxy attaches Authorization; we send none)"
    path = key_file(env)
    if os.path.isfile(path):
        return "pc-key", f"{path} (key file on disk; this code signs)"
    raise GoogleAccessError(
        f"google-rest: no transport - {TEAM_ENV} unset, CLAUDE_CODE_REMOTE not true, "
        f"and no key file at {path}"
    )


def is_gmail(url):
    """True for any Gmail endpoint, whichever host spelling is used."""
    parts = urllib.parse.urlsplit(url)
    return parts.netloc.startswith("gmail.googleapis.com") or parts.path.startswith("/gmail/v1")


def cloud_headers(headers=None):
    """Headers for the proxy transport: everything the caller asked for except Authorization.

    Dropping a passed-in header is deliberate, and honest about what the proxy does: it *replaces*
    the caller's `Authorization` for `*.googleapis.com` rather than passing it through (verified
    2026-09-16 - a deliberately bogus bearer token still answered 200 as the SA). Code that signs
    here does not fail, it silently runs as a different principal than it believes; better to send
    nothing and have the transport be the thing the reader sees.
    """
    out = {k: v for k, v in (headers or {}).items() if k.lower() != "authorization"}
    out.setdefault("User-Agent", UA)
    return out


def authorized_session(transport, env):
    """An `AuthorizedSession` for the two key-bearing transports. Imported lazily on purpose: the
    cloud container has no `google-auth` installed and needs none."""
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account

    if transport == "team-env":
        info = json.loads(env[TEAM_ENV])
        creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    else:
        creds = service_account.Credentials.from_service_account_file(key_file(env), scopes=SCOPES)
    return AuthorizedSession(creds)


def request(method, url, data=None, headers=None, env=None):
    """`method` `url` on whichever transport this surface provides. Returns (status, body_bytes):
    an export can be a binary .docx."""
    env = os.environ if env is None else env
    if is_gmail(url):
        raise GoogleAccessError(GMAIL_REFUSAL)
    transport, _reason = pick_transport(env)
    if transport == "cloud-proxy":
        req = urllib.request.Request(url, data=data, headers=cloud_headers(headers), method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()
    resp = authorized_session(transport, env).request(method, url, data=data,
                                                      headers=cloud_headers(headers))
    return resp.status_code, resp.content


def get(url, headers=None, env=None):
    """GET `url` on whichever transport this surface provides. Returns (status, body_text)."""
    status, body = request("GET", url, headers=headers, env=env)
    return status, body.decode("utf-8")


DRIVE = "https://www.googleapis.com/drive/v3/files/"
DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files/"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
UPLOAD_TYPES = {".html": "text/html", ".htm": "text/html", ".md": "text/markdown",
                ".markdown": "text/markdown", ".txt": "text/plain", ".docx": DOCX}


def upload_type(path):
    """The MIME type Drive converts from, by the source file's extension; plain text otherwise."""
    return UPLOAD_TYPES.get(os.path.splitext(path)[1].lower(), "text/plain")


def doc_text(text):
    """A Doc's text as compared after a write: no BOM, LF line ends, no trailing blanks."""
    lines = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(line.rstrip() for line in lines).strip()


def doc_export(doc_id, mime="text/plain", env=None):
    """A Doc's body exported as `mime`, as bytes. Raises on anything but a 200."""
    url = (DRIVE + urllib.parse.quote(doc_id, safe="") + "/export?supportsAllDrives=true&mimeType="
           + urllib.parse.quote(mime, safe=""))
    status, body = request("GET", url, env=env)
    if status != 200:
        raise GoogleAccessError(f"google-rest: export {doc_id} as {mime} -> {status}: "
                                f"{body.decode('utf-8', 'replace')}")
    return body


def doc_read(doc_id, env=None):
    """A Doc's body as plain text, normalized by `doc_text`."""
    return doc_text(doc_export(doc_id, env=env).decode("utf-8"))


def doc_replace(doc_id, source, env=None):
    """Replace the body of Doc `doc_id` with `source` (a file path, or doc:<id> for another Doc's
    body) and read it back. Returns (read_back_text, matched) - matched is None when the source is
    HTML, Markdown or .docx, whose plain-text form only Drive's own conversion defines."""
    expected = None
    if source.startswith("doc:"):
        # .docx, not HTML: Drive's HTML export styles lists by CSS class, and importing it drops
        # every bullet and number (seen on the rates Doc, 2026-10-01); a .docx round trip keeps them.
        src_id = source[4:]
        data, mime = doc_export(src_id, DOCX, env), DOCX
        expected = doc_read(src_id, env)
    else:
        with open(source, "rb") as fh:
            data = fh.read()
        mime = upload_type(source)
        if mime == "text/plain":
            expected = doc_text(data.decode("utf-8"))
    url = (DRIVE_UPLOAD + urllib.parse.quote(doc_id, safe="")
           + "?uploadType=media&supportsAllDrives=true&fields=id,mimeType")
    ctype = mime if mime == DOCX else f"{mime}; charset=utf-8"
    status, body = request("PATCH", url, data=data, headers={"Content-Type": ctype}, env=env)
    body = body.decode("utf-8", "replace")
    if status != 200:
        raise GoogleAccessError(f"google-rest: update {doc_id} -> {status}: {body}")
    kept = json.loads(body)
    if kept.get("id") != doc_id or kept.get("mimeType") != "application/vnd.google-apps.document":
        raise GoogleAccessError(f"google-rest: update {doc_id} did not keep a Google Doc: {body}")
    back = doc_read(doc_id, env)
    return back, (None if expected is None else back == expected)


def cell_url(spreadsheet_id, a1):
    """Sheets values URL for one A1 range. The range is quoted whole: a tab name carrying a space
    (`Script Errors!A1`) is one path segment, and an unquoted one 404s."""
    return (
        "https://sheets.googleapis.com/v4/spreadsheets/"
        + urllib.parse.quote(spreadsheet_id, safe="")
        + "/values/"
        + urllib.parse.quote(a1, safe="")
    )


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
        if cmd == "whoami":
            # Drive's `about` reports the authenticated principal on every transport, so one
            # command answers "who does Google think I am?" without knowing which one is live.
            status, body = get("https://www.googleapis.com/drive/v3/about?fields=user")
            if status != 200:
                print(body, file=sys.stderr)
                return 1
            print(json.loads(body)["user"]["emailAddress"])
            return 0
        if cmd == "cell":
            if len(args) != 2:
                raise GoogleAccessError("google-rest: cell <spreadsheetId> <A1Range>")
            status, body = get(cell_url(args[0], args[1]))
            if status != 200:
                print(body, file=sys.stderr)
                return 1
            values = json.loads(body).get("values") or [[""]]
            print(values[0][0] if values[0] else "")
            return 0
        if cmd == "get":
            if len(args) != 1:
                raise GoogleAccessError("google-rest: get <url>")
            status, body = get(args[0])
            print(body)
            return 0 if 200 <= status < 300 else 1
        if cmd == "doc-read":
            if len(args) != 1:
                raise GoogleAccessError("google-rest: doc-read <docId>")
            print(doc_read(args[0]))
            return 0
        if cmd == "doc-replace":
            if len(args) != 2:
                raise GoogleAccessError("google-rest: doc-replace <docId> <file|doc:<sourceDocId>>")
            back, matched = doc_replace(args[0], args[1])
            print(back)
            verdict = {True: "read-back matches the source",
                       False: "read-back DIFFERS from the source",
                       None: "read back above; a converted source, compare by eye"}[matched]
            print(f"google-rest: https://docs.google.com/document/d/{args[0]}/edit body replaced; "
                  f"{verdict}", file=sys.stderr)
            return 1 if matched is False else 0
    except GoogleAccessError as exc:
        print(exc, file=sys.stderr)
        return 1
    print(f"google-rest: unknown command {cmd!r}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
