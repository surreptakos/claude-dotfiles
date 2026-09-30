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
"""
import argparse, datetime, hashlib, json, os, sys

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('critique'); ap.add_argument('--markdown', action='store_true')
    ap.add_argument('--stamp', metavar='DELIVERABLE')
    a = ap.parse_args()
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
