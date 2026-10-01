#!/usr/bin/env python3
"""The evidence bundle every audit adapter writes, and its validator (issue 1088).

    python3 evidence.py validate DIR [DIR ...]

One shape for every surface, so reviewers and the scorer never special-case one. The web adapter
(web_audit.js), the document and deck adapter and the PDF adapter (doc_audit.py) all write it.

DIR/bundle.json:
{
  "schema": "aac-design/evidence@1",
  "adapter": "web" | "docx" | "pptx" | "pdf",
  "surface": "<a CATALOG.json surface: the ledger's surface for this bundle>",
  "target": "<what was audited, as given>",
  "subject": {"kind": "file", "path": "...", "sha256": "<64 hex>"}
           | {"kind": "url", "url": "...", "commit": "<deployed commit or null>"}
           | {"kind": "drive", "url": "<Drive link>", "file_id": "...", "revision": "...", ...},  # drive.py
  "captured": "<ISO time>",
  "images":    ["<rendered page image>", ...],        # PNG, at least one
  "structure": ["<structure dump>", ...],             # DOM and accessibility tree, document XML, text layer
  "text": "text.txt",                                 # the plain-text export
  "review_set":   [...],    # every file a reviewer may see before its ledger rows are in
  "detector_set": [...],    # withheld until then; always holds findings.json
  "measures": {"<measure>": {"status": "ok" | "unavailable", ...}},
  "fault_count": <len(findings.json faults)>
}

DIR/findings.json: {"target": ..., "faults": [{"measure": "<a key of measures>", "catalog_ids": [...],
"kind": "...", "what": "...", "where": "..."}]}. Images, structure and text sit in the review set.

Exit 0 = every bundle valid, 1 = a bundle breaks the shape (each problem printed), 2 = usage.
"""
import datetime, hashlib, json, os, re, sys

SCHEMA = 'aac-design/evidence@1'
ADAPTERS = ('web', 'docx', 'pptx', 'pdf')
CATALOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'catalog', 'CATALOG.json')
PNG = b'\x89PNG\r\n\x1a\n'


def load_catalog():
    with open(CATALOG, encoding='utf-8') as f:
        return json.load(f)


def file_subject(path):
    path = os.path.abspath(path)
    with open(path, 'rb') as f:
        return {'kind': 'file', 'path': path, 'sha256': hashlib.sha256(f.read()).hexdigest()}


def ids_for(catalog, surface, detector=None, adapter=None):
    """Catalog rows on this surface whose checks name the detector rule or adapter measure."""
    return [r['id'] for r in catalog['rows'] if surface in r['surfaces']
            and any((detector and c.get('detector') == detector) or (adapter and c.get('adapter') == adapter)
                    for c in r['checks'])]


def write_bundle(out, *, adapter, surface, target, subject, images, structure, measures, faults,
                 extra_review=(), extra_detector=(), **more):
    """findings.json and bundle.json; the images, structure files and text.txt are already in out."""
    review = list(images) + list(structure) + ['text.txt'] + list(extra_review)
    with open(os.path.join(out, 'findings.json'), 'w', encoding='utf-8') as f:
        json.dump({'target': target, 'faults': faults}, f, indent=2)
    bundle = {'schema': SCHEMA, 'adapter': adapter, 'surface': surface, 'target': target, 'subject': subject,
              'captured': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
              'images': list(images), 'structure': list(structure), 'text': 'text.txt',
              'review_set': review, 'detector_set': ['findings.json'] + list(extra_detector),
              'measures': measures, 'fault_count': len(faults), **more}
    with open(os.path.join(out, 'bundle.json'), 'w', encoding='utf-8') as f:
        json.dump(bundle, f, indent=2)
    return bundle


def validate(d, catalog=None):
    """Every way the bundle in d breaks the shape; an empty list means it is valid."""
    catalog = catalog or load_catalog()
    p = []
    try:
        with open(os.path.join(d, 'bundle.json'), encoding='utf-8') as f:
            b = json.load(f)
    except (OSError, ValueError) as e:
        return [f'bundle.json unreadable: {e}']
    if not isinstance(b, dict):
        return ['bundle.json is not an object']
    if b.get('schema') != SCHEMA:
        p.append(f'schema is {b.get("schema")!r}, not {SCHEMA!r}')
    if b.get('adapter') not in ADAPTERS:
        p.append(f'adapter {b.get("adapter")!r} is not one of {ADAPTERS}')
    if b.get('surface') not in catalog['surfaces']:
        p.append(f'surface {b.get("surface")!r} is not a catalog surface {catalog["surfaces"]}')
    if not isinstance(b.get('target'), str) or not b.get('target'):
        p.append('target is missing')
    s = b.get('subject') or {}
    if s.get('kind') == 'file':
        if not s.get('path') or not re.fullmatch(r'[0-9a-f]{64}', str(s.get('sha256', ''))):
            p.append('a file subject needs its path and sha256')
    elif s.get('kind') == 'url':
        if not s.get('url') or 'commit' not in s:
            p.append('a URL subject needs its address and a commit key')
    elif s.get('kind') == 'drive':
        if not s.get('file_id') or not s.get('revision'):
            p.append('a Drive subject needs its file id and revision id')
    else:
        p.append('subject.kind must be "file", "url" or "drive"')
    try:
        datetime.datetime.fromisoformat(str(b.get('captured')).replace('Z', '+00:00'))
    except ValueError:
        p.append(f'captured {b.get("captured")!r} is not an ISO time')
    lists = {}
    for k in ('images', 'structure', 'review_set', 'detector_set'):
        v = b.get(k)
        if not isinstance(v, list) or not v or not all(isinstance(x, str) and x for x in v):
            p.append(f'{k} must be a non-empty list of file names')
            v = []
        lists[k] = v
    review, detector = set(lists['review_set']), set(lists['detector_set'])
    for k in ('images', 'structure'):
        for x in lists[k]:
            if x not in review:
                p.append(f'{k} file {x} is not in the review set')
    if b.get('text') != 'text.txt' or 'text.txt' not in review:
        p.append('the plain-text export text.txt must be in the review set')
    if review & detector:
        p.append(f'{sorted(review & detector)} sit in both the review and the detector set')
    if 'findings.json' not in detector:
        p.append('findings.json must be in the detector set')
    for x in sorted(review | detector):
        f = os.path.join(d, x)
        if os.path.isabs(x) or '..' in x.replace('\\', '/').split('/'):
            p.append(f'{x} is not a path inside the bundle')
        elif not os.path.isfile(f):
            p.append(f'{x} is listed but not in the bundle')
    for x in lists['images']:
        f = os.path.join(d, x)
        if os.path.isfile(f):
            with open(f, 'rb') as fh:
                if fh.read(8) != PNG:
                    p.append(f'image {x} is not a PNG')
    m = b.get('measures')
    if not isinstance(m, dict) or not m:
        p.append('measures must be a non-empty object')
        m = {}
    for k, v in m.items():
        if not isinstance(v, dict) or v.get('status') not in ('ok', 'unavailable'):
            p.append(f'measure {k} needs a status of "ok" or "unavailable"')
    try:
        with open(os.path.join(d, 'findings.json'), encoding='utf-8') as f:
            faults = json.load(f).get('faults')
    except (OSError, ValueError, AttributeError) as e:
        return p + [f'findings.json unreadable: {e}']
    if not isinstance(faults, list):
        return p + ['findings.json carries no faults list']
    if b.get('fault_count') != len(faults):
        p.append(f'fault_count {b.get("fault_count")} but findings.json holds {len(faults)}')
    known = {r['id'] for r in catalog['rows']}
    for i, x in enumerate(faults):
        for k in ('measure', 'kind', 'what', 'where'):
            if not isinstance(x.get(k), str):
                p.append(f'fault {i} has no {k}')
        if x.get('measure') not in m:
            p.append(f'fault {i} names measure {x.get("measure")!r}, which the bundle does not record')
        ids = x.get('catalog_ids')
        if not isinstance(ids, list) or any(c not in known for c in ids):
            p.append(f'fault {i}: catalog_ids must list catalog ids')
    return p


def main(argv):
    if len(argv) < 2 or argv[0] != 'validate':
        print(__doc__.split('\n\n')[1], file=sys.stderr)
        return 2
    catalog, bad = load_catalog(), 0
    for d in argv[1:]:
        problems = validate(d, catalog)
        bad += bool(problems)
        print(f'{d}: ' + ('valid' if not problems else f'{len(problems)} problem(s)'))
        for x in problems:
            print(f'  - {x}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
