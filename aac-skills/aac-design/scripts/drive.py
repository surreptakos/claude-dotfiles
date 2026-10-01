#!/usr/bin/env python3
"""Google Docs, Slides and Sheets by Drive link, for aac-design audit mode (issue 1089).

doc_audit.py takes a Drive link in place of a file: the Drive API (v3) exports a Doc to .docx, a
Slides deck to .pptx and a Sheet to .pdf, and the export takes the document, deck or PDF path.
score.py stamps a Drive file by its file id plus revision id and checks the stamp against the
revision Drive reports now, so an edit to the file makes the stamp stale.

The revision is the last id revisions.list returns. An account that may not list revisions (a
Viewer) gets the file's version number instead, written v<N>; it moves on every change too.

The calls ride the AAC service account through the same three transports as claude-dotfiles
tools/google-rest.py (the plugin carries this copy; tools/ is not in its payload), in its order:
GPT_SHEETS_SA_KEY_JSON (Team/Enterprise container, this code signs), CLAUDE_CODE_REMOTE=true (the
agent proxy signs, we send no Authorization), then the key file on the PC. Share the file with the
service account address, Viewer is enough. AAC_DESIGN_DRIVE_API replaces the API base, for a
test's local stand-in; nothing is signed then.
"""
import json, os, re, urllib.error, urllib.parse, urllib.request

API = 'https://www.googleapis.com/drive/v3'
SA = 'gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com'
KEY_PATH = '~/.config/gpt-sheets-access-475817-853f8648243b.json'
TEAM_ENV = 'GPT_SHEETS_SA_KEY_JSON'
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
OOXML = 'application/vnd.openxmlformats-officedocument'
# Google type -> (export extension, export MIME type)
TYPES = {
    'application/vnd.google-apps.document': ('docx', f'{OOXML}.wordprocessingml.document'),
    'application/vnd.google-apps.presentation': ('pptx', f'{OOXML}.presentationml.presentation'),
    'application/vnd.google-apps.spreadsheet': ('pdf', 'application/pdf'),
}
LINK = re.compile(r'^https?://(docs|drive)\.google\.com/', re.I)
ID = r'([A-Za-z0-9_-]{10,})'


class DriveError(Exception):
    pass


def is_link(s):
    return bool(LINK.match(str(s)))


def file_id(link):
    m = re.search(r'/d/' + ID, link) or re.search(r'[?&]id=' + ID, link)
    if not m:
        raise DriveError(f'no Drive file id in {link}')
    return m.group(1)


def transport(env=None):
    env = os.environ if env is None else env
    if env.get('AAC_DESIGN_DRIVE_API', '').strip():
        return 'local', f'AAC_DESIGN_DRIVE_API ({env["AAC_DESIGN_DRIVE_API"]})'
    if env.get(TEAM_ENV, '').strip():
        return 'team-env', f'{SA} ({TEAM_ENV})'
    if env.get('CLAUDE_CODE_REMOTE', '').strip().lower() == 'true':
        return 'cloud-proxy', f'{SA} (agent proxy)'
    key = os.path.expanduser(env.get('GOOGLE_APPLICATION_CREDENTIALS') or KEY_PATH)
    if os.path.isfile(key):
        return 'pc-key', f'{SA} (key file)'
    raise DriveError(f'no Google transport: {TEAM_ENV} unset, CLAUDE_CODE_REMOTE not true, and no key file at {key}')


def get(path, params):
    """(status, body bytes) for GET <API>/<path>?<params> on this surface's transport."""
    name, _ = transport()
    base = os.environ.get('AAC_DESIGN_DRIVE_API', '').strip().rstrip('/') or API
    url = f'{base}/{path}?{urllib.parse.urlencode(params)}'
    if name in ('local', 'cloud-proxy'):
        try:
            with urllib.request.urlopen(urllib.request.Request(url), timeout=120) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except urllib.error.URLError as e:
            raise DriveError(f'Drive API unreachable: {e.reason}')
    try:  # the key-bearing transports; google-auth is imported only here
        from google.auth.transport.requests import AuthorizedSession
        from google.oauth2 import service_account
    except ImportError:
        raise DriveError('google-auth is needed to sign Drive calls with the service account key: pip install google-auth requests')
    if name == 'team-env':
        creds = service_account.Credentials.from_service_account_info(json.loads(os.environ[TEAM_ENV]), scopes=SCOPES)
    else:
        key = os.path.expanduser(os.environ.get('GOOGLE_APPLICATION_CREDENTIALS') or KEY_PATH)
        creds = service_account.Credentials.from_service_account_file(key, scopes=SCOPES)
    r = AuthorizedSession(creds).get(url, timeout=120)
    return r.status_code, r.content


def refusal(fid, status, body):
    try:
        why = json.loads(body)['error']['message']
    except (ValueError, KeyError, TypeError):
        why = body[:200].decode('utf-8', 'replace').strip()
    return f'Drive file {fid} cannot be opened by {transport()[1]}: HTTP {status} {why}'


def describe(fid):
    s, body = get(f'files/{fid}', {'fields': 'id,name,mimeType,version', 'supportsAllDrives': 'true'})
    if s != 200:
        raise DriveError(refusal(fid, s, body))
    return json.loads(body)


def revision(fid):
    """The file's current revision id, or v<version> when this account may not list revisions."""
    revs, params = [], {'fields': 'nextPageToken,revisions(id)', 'pageSize': '1000'}
    while True:
        s, body = get(f'files/{fid}/revisions', params)
        if s != 200:
            break
        d = json.loads(body)
        revs += d.get('revisions') or []
        if not d.get('nextPageToken'):
            break
        params = dict(params, pageToken=d['nextPageToken'])
    if s == 200 and revs:
        return revs[-1]['id']
    meta = describe(fid)
    if not meta.get('version'):
        raise DriveError(refusal(fid, s, body))
    return f'v{meta["version"]}'


def fetch(link, dest):
    """Export the linked file into dest; return (exported path, the bundle's drive subject)."""
    fid = file_id(link)
    meta = describe(fid)
    if meta.get('mimeType') not in TYPES:
        raise DriveError(f'Drive file {fid} is {meta.get("mimeType")}, not a Google Doc, Slides deck or Sheet')
    ext, mime = TYPES[meta['mimeType']]
    rev = revision(fid)
    s, data = get(f'files/{fid}/export', {'mimeType': mime})
    if s != 200:
        raise DriveError(refusal(fid, s, data))
    if revision(fid) != rev:
        raise DriveError(f'Drive file {fid} changed while it was exported; run the audit again')
    stem = re.sub(r'[^A-Za-z0-9._-]+', '-', meta.get('name') or '').strip('-.')[:60] or fid
    os.makedirs(dest, exist_ok=True)
    path = os.path.join(dest, f'{stem}.{ext}')
    with open(path, 'wb') as f:
        f.write(data)
    return path, {'kind': 'drive', 'url': link, 'file_id': fid, 'revision': rev, 'name': meta.get('name'),
                  'mime_type': meta['mimeType'], 'exported_as': mime}
