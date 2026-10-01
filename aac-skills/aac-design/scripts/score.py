#!/usr/bin/env python3
"""Strict scorer for an AAC form critique. Implements CRITIQUE.md exactly; judgment stays with the reviewer.

    python3 score.py critique.json [--markdown] [--stamp DELIVERABLE]

--stamp writes .design/<file name>.json next to the deliverable when, and only when, the release
gate passes. The design gate hook (designgate.py stop) refuses to end a turn without a stamp whose
sha256 matches the file's current bytes, so any later edit needs a fresh critique.

critique.json:
{
  "method": "dual-agent (A: <id> · B: <id>)"  |  "DEGRADED: single-context (<reason>)",
  "heuristics": {"1": 3, "2": 4, ..., "7": "n/a: <reason>", ...},        # all ten keys, 0-4 or "n/a: reason"
  "heuristic_notes": {"1": "key issue", ...},                             # optional
  "audit": {"legibility": 3, "print": 4, "fillability": 3, "system": 4, "integrity": 3},   # all five, 0-4
  "cognitive_load_failures": ["chunking", ...],                           # names from the 8-item checklist
  "issues": [{"p": "P1", "what": "...", "fix": "..."}],
  "detector_errors": 0,
  "pages": {"narrow": 1, "wide": 1, "max": 1}
}

Exit 0 = release gate passes, 1 = gate fails, 3 = the critique file is invalid (a missing key,
an out-of-range score, n/a without a reason, an unknown checklist item or severity).

Audit mode (PRD issue 1079) scores a ledger instead of a critique:

    python3 score.py --ledger ledger.json [--markdown] [--tickets] [--stamp]
    python3 score.py --verify TARGET [--commit SHA] [--stamp-dir DIR]

ledger.json, one row per catalog rule that applies to the bundle's surface:
{
  "method": "dual-agent (reviewers: <skill>=<id>, ...; detector after rows)" | "DEGRADED: single-context (<reason>)",
  "bundle": "render/audit-page.html/bundle.json",          # from audit.py; relative to the ledger
  "auditor_owns": ["Design"],                              # the owners whose files the auditor edits
  "rows": [{"id": "A11Y-003", "verdict": "FAIL", "evidence": "evidence/images/desktop-1440.png",
            "owner": "Design", "fix": "...", "priority": "P1"},
           {"id": "A11Y-012", "verdict": "N/A", "reason": "...", "owner": "Design"}, ...]
}
A ledger that misses an applicable catalog id, names one twice or names one that does not apply,
gives N/A without a reason, or leaves a row without an owner is rejected (exit 3). The gate
passes when coverage is complete, no P0 or P1 FAIL is open in the auditor's own files, the run was
not degraded, and a URL carries its deployed commit. --stamp then writes the stamp: a file's
beside it at .design/<name>.json (sha256, the gate reads it), a URL's under --stamp-dir as
url-<hash>.json (address plus commit). --verify says whether that stamp still matches (exit 0) or
has gone stale (exit 1).
"""
import argparse, datetime, hashlib, json, os, re, sys

HEURISTICS = {
    1: 'Visibility of status', 2: 'Match to the real world', 3: 'User control and freedom',
    4: 'Consistency and standards', 5: 'Error prevention', 6: 'Recognition rather than recall',
    7: 'Flexibility and efficiency', 8: 'Aesthetic and minimalist design', 9: 'Error recovery',
    10: 'Help and documentation',
}
AUDIT = {'legibility': 'Legibility and accessibility', 'print': 'Print fidelity',
         'fillability': 'Fill-ability', 'system': 'System and tokens', 'integrity': 'Integrity'}
LOAD_ITEMS = {'single_focus', 'chunking', 'grouping', 'visual_hierarchy', 'one_thing_at_a_time',
              'minimal_choices', 'working_memory', 'progressive_disclosure'}
SEVERITIES = ('P0', 'P1', 'P2', 'P3')


def band(pct):
    return ('Excellent' if pct >= 90 else 'Good' if pct >= 70 else 'Acceptable' if pct >= 50
            else 'Poor' if pct >= 30 else 'Critical')


def audit_band(total):
    return ('Excellent' if total >= 18 else 'Good' if total >= 14 else 'Acceptable' if total >= 10
            else 'Poor' if total >= 6 else 'Critical')


def load_band(n):
    return 'low' if n <= 1 else 'moderate' if n <= 3 else 'high'


class Invalid(Exception):
    pass


def validate(c):
    for k in ('method', 'heuristics', 'audit', 'issues', 'cognitive_load_failures', 'detector_errors', 'pages'):
        if k not in c:
            raise Invalid(f'missing "{k}"')
    m = c['method']
    if not (m.startswith('dual-agent') or m.startswith('DEGRADED')):
        raise Invalid('method must start with "dual-agent" or "DEGRADED"')
    h = {int(k): v for k, v in c['heuristics'].items()}
    if set(h) != set(HEURISTICS):
        raise Invalid(f'heuristics must have keys 1-10; missing {sorted(set(HEURISTICS) - set(h))}')
    for k, v in h.items():
        if isinstance(v, str):
            if not v.lower().startswith('n/a:') or len(v) < 8:
                raise Invalid(f'heuristic {k}: "n/a" needs a reason ("n/a: <reason>")')
        elif not (isinstance(v, int) and 0 <= v <= 4):
            raise Invalid(f'heuristic {k}: score {v!r} is not an integer 0-4')
    if set(c['audit']) != set(AUDIT):
        raise Invalid(f'audit must have exactly {sorted(AUDIT)}')
    for k, v in c['audit'].items():
        if not (isinstance(v, int) and 0 <= v <= 4):
            raise Invalid(f'audit {k}: score {v!r} is not an integer 0-4')
    bad = set(c['cognitive_load_failures']) - LOAD_ITEMS
    if bad:
        raise Invalid(f'unknown cognitive-load items {sorted(bad)}; use {sorted(LOAD_ITEMS)}')
    for i in c['issues']:
        if i.get('p') not in SEVERITIES or not i.get('what') or not i.get('fix'):
            raise Invalid(f'issue needs p in {SEVERITIES}, "what" and "fix": {i}')
    p = c['pages']
    for k in ('narrow', 'wide', 'max'):
        if not isinstance(p.get(k), int):
            raise Invalid(f'pages.{k} must be an integer')
    return h


def score(c):
    h = validate(c)
    scored = {k: v for k, v in h.items() if isinstance(v, int)}
    mx = 4 * len(scored)
    total = sum(scored.values())
    pct = round(100 * total / mx, 1) if mx else 0.0
    audit_total = sum(c['audit'].values())
    counts = {s: sum(1 for i in c['issues'] if i['p'] == s) for s in SEVERITIES}
    fails = len(c['cognitive_load_failures'])
    pages_ok = c['pages']['narrow'] <= c['pages']['max'] and c['pages']['wide'] <= c['pages']['max']
    gate = {
        'heuristics_at_least_good (>=70%)': pct >= 70,
        'audit_at_least_good (>=14/20)': audit_total >= 14,
        'no_P0_or_P1': counts['P0'] == 0 and counts['P1'] == 0,
        'detector_clean (0 errors)': c['detector_errors'] == 0,
        'cognitive_load_not_high (<=3 failures)': fails <= 3,
        'fits_page_budget_both_stand_ins': pages_ok,
        'not_degraded': not c['method'].startswith('DEGRADED'),
    }
    return {
        'heuristics': {'total': total, 'max': mx, 'pct': pct, 'band': band(pct),
                       'na': [k for k, v in h.items() if isinstance(v, str)]},
        'audit': {'total': audit_total, 'max': 20, 'band': audit_band(audit_total)},
        'cognitive_load': {'failures': fails, 'band': load_band(fails)},
        'issues': counts, 'gate': gate, 'passes': all(gate.values()),
        'questions_required': sum(counts.values()) >= 3,
    }


def markdown(c, r):
    out = [c['method'] if c['method'].startswith('dual') else '⚠️ ' + c['method'], '',
           '| # | Heuristic | Score | Key issue |', '|---|---|---|---|']
    notes = {int(k): v for k, v in c.get('heuristic_notes', {}).items()}
    for k, name in HEURISTICS.items():
        v = c['heuristics'][str(k)] if str(k) in c['heuristics'] else c['heuristics'][k]
        out.append(f'| {k} | {name} | {v if isinstance(v, int) else "n/a"} | {notes.get(k, v if isinstance(v, str) else "")} |')
    hh = r['heuristics']
    out.append(f'| **Total** | | **{hh["total"]}/{hh["max"]}** | **{hh["band"]} ({hh["pct"]}%)** |')
    out += ['', '| Audit dimension | Score |', '|---|---|']
    out += [f'| {AUDIT[k]} | {v} |' for k, v in c['audit'].items()]
    out.append(f'| **Total** | **{r["audit"]["total"]}/20 {r["audit"]["band"]}** |')
    out += ['', f'Cognitive load: {r["cognitive_load"]["failures"]} of 8 failed ({r["cognitive_load"]["band"]}).',
            'Issues: ' + ', '.join(f'{k} {v}' for k, v in r['issues'].items()), '', 'Release gate:']
    out += [f'- {"PASS" if ok else "FAIL"} {k}' for k, ok in r['gate'].items()]
    out.append(f'\n**Gate: {"PASS" if r["passes"] else "FAIL"}**')
    return '\n'.join(out)


# ----------------------------------------------------------------------------- audit mode
HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(HERE, '..', 'catalog', 'CATALOG.json')
VERDICTS = ('PASS', 'FAIL', 'N/A')


def load_catalog(path=None):
    return json.load(open(path or CATALOG, encoding='utf-8'))


def audit_validate(ledger, catalog, bundle):
    """Raise Invalid unless the ledger covers every applicable catalog rule, one row each."""
    for k in ('method', 'auditor_owns', 'rows'):
        if k not in ledger:
            raise Invalid(f'missing "{k}"')
    m = ledger['method']
    if not (m.startswith('dual-agent') or m.startswith('DEGRADED')):
        raise Invalid('method must start with "dual-agent" or "DEGRADED"')
    owns = ledger['auditor_owns']
    if not isinstance(owns, list) or not owns or not all(isinstance(o, str) and o.strip() for o in owns):
        raise Invalid('auditor_owns must list the owners whose files the auditor edits')
    known = {r['id'] for r in catalog['rows']}
    applicable = [r['id'] for r in catalog['rows'] if bundle['catalog_surface'] in r['surfaces']]
    seen = set()
    for row in ledger['rows']:
        rid = row.get('id')
        if rid in seen:
            raise Invalid(f'ledger rejected: {rid} has two rows')
        seen.add(rid)
        if rid not in known:
            raise Invalid(f'ledger rejected: {rid} is not a catalog id')
        if rid not in applicable:
            raise Invalid(f'ledger rejected: {rid} does not apply to a {bundle["catalog_surface"]} surface')
        v = row.get('verdict')
        if v not in VERDICTS:
            raise Invalid(f'{rid}: verdict must be one of {VERDICTS}')
        if not str(row.get('owner') or '').strip():
            raise Invalid(f'{rid}: every row needs an owner, so the handoff has somewhere to put it')
        if v == 'N/A':
            if len(str(row.get('reason') or '').strip()) < 4:
                raise Invalid(f'{rid}: N/A needs a reason')
            continue
        if not str(row.get('evidence') or '').strip():
            raise Invalid(f'{rid}: {v} needs an evidence reference into the bundle')
        if v == 'FAIL' and (row.get('priority') not in SEVERITIES or not str(row.get('fix') or '').strip()):
            raise Invalid(f'{rid}: FAIL needs a fix and a priority in {SEVERITIES}')
    missing = [i for i in applicable if i not in seen]
    if missing:
        raise Invalid(f'ledger rejected: {len(missing)} applicable catalog ids have no row: {", ".join(missing)}')
    key = bundle['stamp_key']
    if key['kind'] == 'file':
        now = hashlib.sha256(open(key['path'], 'rb').read()).hexdigest() if os.path.exists(key['path']) else None
        if now != key['sha256']:
            raise Invalid(f'the bundle is for an earlier version of {key["path"]}; run audit.py again')
    return applicable


def audit_score(ledger, catalog, bundle):
    applicable = audit_validate(ledger, catalog, bundle)
    by_id = {r['id']: r for r in catalog['rows']}
    rows = ledger['rows']
    verdicts = {v: sum(1 for r in rows if r['verdict'] == v) for v in VERDICTS}
    fails = sorted((r for r in rows if r['verdict'] == 'FAIL'), key=lambda r: (r['priority'], r['id']))
    owns = set(ledger['auditor_owns'])
    blocking = [r['id'] for r in fails if r['priority'] in ('P0', 'P1') and r['owner'] in owns]
    gate = {
        'coverage_complete (every applicable catalog id has a row)': len(rows) == len(applicable),
        'no_open_P0_or_P1_in_auditor_files': not blocking,
        'not_degraded': not ledger['method'].startswith('DEGRADED'),
    }
    if bundle['stamp_key']['kind'] == 'url':
        gate['url_has_deployed_commit'] = bool(bundle['stamp_key'].get('commit'))
    handoff = {}
    for r in fails:
        handoff.setdefault(r['owner'], []).append(r)
    tickets = []
    for r in fails:
        c = by_id[r['id']]
        if c['skill'] != 'accessibility-review':
            continue
        m = re.search(r'\*\*(\d+\.\d+\.\d+)\*\*', c['words'])
        wcag = m.group(1) if m else None
        tickets.append({'title': f'a11y: {c["words"].replace("**", "")} ({r["id"]})', 'wcag': wcag,
                        'severity': r['priority'], 'owner': r['owner'],
                        'body': f'WCAG {wcag or "n/a"}, {r["priority"]}. Target: {bundle["target"]}\n\n'
                                f'Rule: {c["words"]} ({c["file"]}:{c["line"]})\nEvidence: {r["evidence"]}\nFix: {r["fix"]}'})
    return {'applicable': len(applicable), 'verdicts': verdicts, 'blocking': blocking, 'gate': gate,
            'passes': all(gate.values()), 'handoff': handoff, 'tickets': tickets}


def audit_markdown(ledger, catalog, bundle, r):
    """The findings page: the method line first, always."""
    by_id = {c['id']: c for c in catalog['rows']}
    m = ledger['method']
    key = bundle['stamp_key']
    stamp_key = f'sha256 {key["sha256"][:12]}' if key['kind'] == 'file' else f'{key["url"]} at commit {key.get("commit") or "(unknown)"}'
    out = [m if m.startswith('dual') else '⚠️ ' + m, '',
           f'Target: {bundle["target"]} ({bundle["surface"]}, stamp key {stamp_key}).',
           f'Coverage: {len(ledger["rows"])} of {r["applicable"]} applicable catalog rules; '
           + ', '.join(f'{k} {v}' for k, v in r['verdicts'].items()) + '.',
           'Precedence: ' + ' > '.join(t['tier'] for t in catalog['precedence']) + f', ruled {catalog.get("precedence_ruled", "")}.']
    for u in bundle.get('unavailable', []):
        out.append(f'Not measured: {u["what"]}, {u["why"]}.')
    out += ['', '| Priority | Rule | Source | Owner | Evidence | Fix |', '|---|---|---|---|---|---|']
    fails = sorted((f for rows in r['handoff'].values() for f in rows), key=lambda x: (x['priority'], x['id']))
    for f in fails:
        c = by_id[f['id']]
        out.append(f'| {f["priority"]} | {f["id"]}: {c["words"]} | {c["skill"]} {c["file"]}:{c["line"]} | {f["owner"]} | {f["evidence"]} | {f["fix"]} |')
    if not fails:
        out.append('| | No FAIL rows | | | | |')
    out += ['', 'Handoff by owner:']
    for owner, rows in sorted(r['handoff'].items()):
        mine = ' (auditor)' if owner in ledger['auditor_owns'] else ''
        out.append(f'- **{owner}**{mine}: ' + '; '.join(f'{x["priority"]} {x["id"]} {x["fix"]}' for x in rows))
    if not r['handoff']:
        out.append('- nothing open')
    if r['tickets']:
        out += ['', f'Accessibility ticket drafts, {len(r["tickets"])}, not filed (filing needs the target repository named):']
        out += [f'- {t["title"]}: WCAG {t["wcag"]}, {t["severity"]}, owner {t["owner"]}' for t in r['tickets']]
    out += ['', 'Release gate:'] + [f'- {"PASS" if ok else "FAIL"} {k}' for k, ok in r['gate'].items()]
    if r['blocking']:
        out.append(f"  open P0/P1 in the auditor's files: {', '.join(r['blocking'])}")
    out.append(f'\n**Gate: {"PASS" if r["passes"] else "FAIL"}**')
    return '\n'.join(out)


def url_stamp_path(url, stamp_dir):
    return os.path.join(stamp_dir, 'url-' + hashlib.sha256(url.encode('utf-8')).hexdigest()[:16] + '.json')


def audit_stamp(ledger, bundle, r, stamp_dir):
    """A file's stamp sits beside it, where the design gate looks; a URL's carries its commit."""
    key = bundle['stamp_key']
    body = {'passes': True, 'mode': 'audit', 'method': ledger['method'], 'target': bundle['target'],
            'surface': bundle['surface'], 'coverage': {'rows': len(ledger['rows']), 'applicable': r['applicable']},
            'verdicts': r['verdicts'], 'stamped': datetime.datetime.now().isoformat(timespec='seconds')}
    if key['kind'] == 'file':
        d = os.path.join(os.path.dirname(key['path']), '.design')
        out = os.path.join(d, os.path.basename(key['path']) + '.json')
        body = {'file': os.path.basename(key['path']), 'sha256': key['sha256'], **body}
    else:
        d = stamp_dir
        out = url_stamp_path(key['url'], d)
        body = {'url': key['url'], 'commit': key['commit'], **body}
    os.makedirs(d, exist_ok=True)
    json.dump(body, open(out, 'w', encoding='utf-8'), indent=2)
    return out


def verify(target, commit, stamp_dir):
    """(0, why) when TARGET's stamp matches what is there now, (1, why) when it is missing or stale."""
    if re.match(r'https?://', target, re.I):
        p = url_stamp_path(target, stamp_dir)
        if not os.path.exists(p):
            return 1, f'no stamp for {target} under {stamp_dir}'
        s = json.load(open(p, encoding='utf-8'))
        if not commit:
            return 1, f'stamped at commit {s.get("commit")}; pass --commit with the deployed commit to compare'
        if s.get('commit') != commit:
            return 1, f'stale: stamped at commit {s.get("commit")}, the deployed commit is now {commit}'
        return 0, f'current: {target} at commit {commit}'
    p = os.path.join(os.path.dirname(os.path.abspath(target)), '.design', os.path.basename(target) + '.json')
    if not os.path.exists(p):
        return 1, f'no stamp for {target} (expected {p})'
    s = json.load(open(p, encoding='utf-8'))
    now = hashlib.sha256(open(target, 'rb').read()).hexdigest()
    if s.get('sha256') != now or not s.get('passes'):
        return 1, f'stale: stamped sha256 {str(s.get("sha256"))[:12]}, the file is now {now[:12]}'
    return 0, f'current: {target} sha256 {now[:12]}'


def audit_main(a):
    sys.path.insert(0, HERE)
    import audit
    ledger_path = os.path.abspath(a.ledger)
    try:
        ledger = json.load(open(ledger_path, encoding='utf-8'))
        if not ledger.get('bundle'):
            raise Invalid('missing "bundle"')
        bundle = audit.load_bundle(os.path.join(os.path.dirname(ledger_path), ledger['bundle']))
        catalog = load_catalog(a.catalog)
        r = audit_score(ledger, catalog, bundle)
    except (audit.Invalid, Invalid, OSError, ValueError, KeyError) as e:
        print(f'invalid ledger: {e}', file=sys.stderr); sys.exit(3)
    if a.tickets:
        print(json.dumps(r['tickets'], indent=2))
    elif a.markdown:
        print(audit_markdown(ledger, catalog, bundle, r))
    else:
        print(json.dumps(dict(r, handoff={o: [x['id'] for x in rows] for o, rows in r['handoff'].items()}), indent=2))
    if a.stamp is not None and r['passes']:
        print(f'stamp: {audit_stamp(ledger, bundle, r, os.path.abspath(a.stamp_dir))}', file=sys.stderr)
    elif a.stamp is not None:
        print('stamp: not written, the gate failed', file=sys.stderr)
    sys.exit(0 if r['passes'] else 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('critique', nargs='?'); ap.add_argument('--markdown', action='store_true')
    ap.add_argument('--stamp', metavar='DELIVERABLE', nargs='?', const='',
                    help='build mode: stamp DELIVERABLE; audit mode: stamp the bundle target (no value)')
    ap.add_argument('--ledger', help='audit mode: score this ledger against the catalog and its bundle')
    ap.add_argument('--catalog', help='audit mode: the catalog to score against (default catalog/CATALOG.json)')
    ap.add_argument('--tickets', action='store_true', help='audit mode: print the accessibility ticket drafts')
    ap.add_argument('--verify', metavar='TARGET', help="say whether TARGET's stamp is current (0) or stale (1)")
    ap.add_argument('--commit', help='with --verify on a URL: the deployed commit now')
    ap.add_argument('--stamp-dir', default='.design', help='where URL stamps live (default ./.design)')
    a = ap.parse_args()
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')  # the report's warning sign, on a Windows console too
    if a.verify:
        code, msg = verify(a.verify, a.commit, os.path.abspath(a.stamp_dir))
        print(msg); sys.exit(code)
    if a.ledger:
        audit_main(a)
    if not a.critique:
        ap.error('a critique file, --ledger or --verify is required')
    c = json.load(open(a.critique, encoding='utf-8'))
    try:
        r = score(c)
    except Invalid as e:
        print(f'invalid critique: {e}', file=sys.stderr); sys.exit(3)
    print(markdown(c, r) if a.markdown else json.dumps(r, indent=2))
    if a.stamp and r['passes']:
        d = os.path.join(os.path.dirname(os.path.abspath(a.stamp)), '.design')
        os.makedirs(d, exist_ok=True)
        sha = hashlib.sha256(open(a.stamp, 'rb').read()).hexdigest()
        out = os.path.join(d, os.path.basename(a.stamp) + '.json')
        json.dump({'file': os.path.basename(a.stamp), 'sha256': sha, 'passes': True, 'method': c['method'],
                   'heuristics': r['heuristics'], 'audit': r['audit'], 'issues': r['issues'],
                   'stamped': datetime.datetime.now().isoformat(timespec='seconds')}, open(out, 'w'), indent=2)
        print(f'stamp: {out}', file=sys.stderr)
    elif a.stamp:
        print('stamp: not written, the gate failed', file=sys.stderr)
    sys.exit(0 if r['passes'] else 1)


if __name__ == '__main__':
    main()
