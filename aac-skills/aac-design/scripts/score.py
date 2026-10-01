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

Audit mode (issue 1084): the same command on an audit ledger instead of a critique.

    python3 score.py ledger.json [--markdown] [--report PAGE.html] [--stamp FILE_OR_URL]
    python3 score.py --check-stamp FILE_OR_URL [--commit SHA]

ledger.json:
{
  "method": "dual-agent (reviewers: accessibility-review=<id> · detector: <id>)" | "DEGRADED: ...",
  "surface": "web",                                             # a CATALOG.json surface
  "subject": {"kind": "file", "path": "...", "sha256": "<64 hex>"}
           | {"kind": "url", "url": "https://...", "commit": "<deployed commit>"},
  "auditor": "Design",                                          # the owner whose open P0/P1 block
  "reviewers": [{"skill": "accessibility-review", "agent": "<id>",
                 "rows_in": "<ISO time>", "detector_shown": "<ISO time>"}],
  "rows": [{"id": "A11Y-003", "verdict": "FAIL", "evidence": "findings.json#/faults/0",
            "owner": "Design", "file": "page.html", "fix": "...", "priority": "P1"},
           {"id": "A11Y-026", "verdict": "N/A", "reason": "..."}]
}

A ledger is invalid (exit 3) when it misses an applicable catalog id, repeats or invents one, gives
N/A without a reason, a PASS or FAIL without evidence, a FAIL without owner, fix and priority, a
catalogued skill without its reviewer, or detector output shown to a reviewer before its rows were
in. The gate: coverage complete, no open P0 or P1 owned by the auditor, not degraded. --stamp binds
a file stamp to the audited sha256 and a URL stamp (.design/url-<hash>.json under the current
folder) to the address plus deployed commit; --check-stamp exits 0 while the stamp is fresh and 1
once the file's bytes or the deployed commit moved.

The last two outputs (issue 1086), written whatever the gate says:

    python3 score.py ledger.json --handoff handoff/ --tickets tickets.json
    python3 score.py --file-tickets tickets.json --repo OWNER/NAME

--handoff writes one list per owner (handoff/<owner>.md) of its findings, fixes and priorities; the
owner is each FAIL row's own field, and a FAIL with none makes the ledger invalid rather than land in
a list. --tickets drafts one ticket per open accessibility FAIL with its WCAG criterion (the catalog
row's, or the row's "wcag" field where the rule names none) and severity, prints the drafts and files
nothing. --file-tickets prints the drafts again and files the unfiled ones with gh; without --repo it
files nothing and exits 2, because the target repository is an input, never assumed.
"""
import argparse, datetime, hashlib, html, json, os, re, sys

CATALOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'catalog', 'CATALOG.json')
VERDICTS = ('PASS', 'FAIL', 'N/A')

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


# ------------------------------------------------------------------ audit mode: the ledger
def when(ts, what):
    try:
        t = datetime.datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
    except ValueError:
        raise Invalid(f'{what}: {ts!r} is not an ISO time')
    return t if t.tzinfo else t.replace(tzinfo=datetime.timezone.utc)


def validate_ledger(l, catalog):
    for k in ('method', 'surface', 'subject', 'auditor', 'reviewers', 'rows'):
        if k not in l:
            raise Invalid(f'missing "{k}"')
    m = l['method']
    if not (m.startswith('dual-agent') or m.startswith('DEGRADED')):
        raise Invalid('method must start with "dual-agent" or "DEGRADED"')
    if l['surface'] not in catalog['surfaces']:
        raise Invalid(f'surface {l["surface"]!r} is not one of {catalog["surfaces"]}')
    sub = l['subject']
    if sub.get('kind') == 'file':
        if not re.fullmatch(r'[0-9a-f]{64}', str(sub.get('sha256', ''))) or not sub.get('path'):
            raise Invalid('a file subject needs its path and sha256')
    elif sub.get('kind') == 'url':
        if not sub.get('url') or not str(sub.get('commit') or '').strip():
            raise Invalid('a URL subject needs its address and deployed commit')
    else:
        raise Invalid('subject.kind must be "file" or "url"')
    known = {r['id']: r for r in catalog['rows']}
    applicable = {i: r for i, r in known.items() if l['surface'] in r['surfaces']}
    seen = set()
    for row in l['rows']:
        rid = row.get('id')
        if rid not in known:
            raise Invalid(f'row {rid!r} is not a catalog id')
        if rid not in applicable:
            raise Invalid(f'{rid} does not apply to surface {l["surface"]}')
        if rid in seen:
            raise Invalid(f'{rid} has two rows')
        seen.add(rid)
        v = row.get('verdict')
        if v not in VERDICTS:
            raise Invalid(f'{rid}: verdict must be one of {VERDICTS}')
        if v == 'N/A':
            if len(str(row.get('reason') or '').strip()) < 3:
                raise Invalid(f'{rid}: N/A needs a reason')
            continue
        if not str(row.get('evidence') or '').strip():
            raise Invalid(f'{rid}: {v} needs an evidence reference')
        if v == 'FAIL' and not str(row.get('owner') or '').strip():
            # Every open finding lands in exactly one owner's handoff list (issue 1086); none goes unassigned.
            raise Invalid(f'{rid}: FAIL has no owner, so it would land in no handoff list')
        if v == 'FAIL' and (row.get('priority') not in SEVERITIES or not row.get('fix')):
            raise Invalid(f'{rid}: FAIL needs owner, fix and priority in {SEVERITIES}')
    missing = sorted(set(applicable) - seen)
    if missing:
        raise Invalid(f'ledger misses {len(missing)} applicable catalog id(s): {", ".join(missing)}')
    # One isolated reviewer per catalogued skill; detector output reaches it only after its rows.
    by_skill = {r.get('skill'): r for r in l['reviewers']}
    for skill in sorted({r['skill'] for r in applicable.values()}):
        r = by_skill.get(skill)
        if not r or not r.get('agent'):
            raise Invalid(f'no reviewer recorded for {skill}')
        rows_in = when(r.get('rows_in'), f'{skill} rows_in')
        if r.get('detector_shown') is not None and when(r['detector_shown'], f'{skill} detector_shown') < rows_in:
            raise Invalid(f'detector output reached the {skill} reviewer before its rows were in')
    return applicable


def score_ledger(l, catalog):
    applicable = validate_ledger(l, catalog)
    rows = l['rows']
    fails = [r for r in rows if r['verdict'] == 'FAIL']
    blocking = [r for r in fails if r['priority'] in ('P0', 'P1') and r['owner'] == l['auditor']]
    owners = {}
    for r in fails:
        owners.setdefault(r['owner'], []).append(r['id'])
    gate = {
        f'coverage_complete ({len(rows)}/{len(applicable)} applicable ids)': len(rows) == len(applicable),
        f'no_open_P0_or_P1_owned_by_{l["auditor"]}': not blocking,
        'not_degraded': not l['method'].startswith('DEGRADED'),
    }
    return {
        'mode': 'audit', 'surface': l['surface'], 'subject': l['subject'],
        'coverage': {'applicable': len(applicable), 'rows': len(rows)},
        'verdicts': {v: sum(1 for r in rows if r['verdict'] == v) for v in VERDICTS},
        'open': {s: sum(1 for r in fails if r['priority'] == s) for s in SEVERITIES},
        'open_by_owner': owners, 'blocking': [r['id'] for r in blocking],
        'gate': gate, 'passes': all(gate.values()),
    }


def method_line(m):
    return ('Method: ' + m) if m.startswith('dual') else '⚠️ ' + m


def subject_line(sub):
    return (f'{sub["path"]} (sha256 {sub["sha256"][:12]})' if sub['kind'] == 'file'
            else f'{sub["url"]} (deployed commit {sub["commit"]})')


def ledger_markdown(l, r):
    out = [method_line(l['method']), '', f'Subject: {subject_line(l["subject"])}',
           f'Coverage: {r["coverage"]["rows"]}/{r["coverage"]["applicable"]} applicable catalog ids; '
           + ', '.join(f'{k} {v}' for k, v in r['verdicts'].items()),
           'Open: ' + ', '.join(f'{k} {v}' for k, v in r['open'].items()), '', 'Release gate:']
    out += [f'- {"PASS" if ok else "FAIL"} {k}' for k, ok in r['gate'].items()]
    for owner in r['open_by_owner']:
        out += ['', f'Open for {owner}:']
        out += [f'- {x["id"]} {x["priority"]}: {x["fix"]}' for x in l['rows'] if x['verdict'] == 'FAIL' and x['owner'] == owner]
    out.append(f'\n**Gate: {"PASS" if r["passes"] else "FAIL"}**')
    return '\n'.join(out)


PAGE_CSS = (
    ':root{--bg:#fff;--fg:#1a1a1a;--line:#bbb;--bad:#a4161a;--ok:#1b5e20;--warn:#fff4d6}'
    '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#121212;--fg:#eee;--line:#555;--bad:#ff8a80;--ok:#9ccc65;--warn:#3a2f00}}'
    ':root[data-theme="dark"]{--bg:#121212;--fg:#eee;--line:#555;--bad:#ff8a80;--ok:#9ccc65;--warn:#3a2f00}'
    'body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:960px;padding:16px}'
    '.method{font-weight:600;margin:0 0 8px}.degraded{background:var(--warn);padding:8px}'
    'table{border-collapse:collapse;display:block;overflow-x:auto}td,th{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}'
    '.fail{color:var(--bad)}.pass{color:var(--ok)}')


def ledger_page(l, r, catalog):
    """The findings page, rendered in the session. Its first line is the method line."""
    e = html.escape
    # A house row (AAC-WR-001, the tokens) cites its rule instead of restating it.
    words = {row['id']: row.get('words') or row.get('cites', '') for row in catalog['rows']}
    degraded = l['method'].startswith('DEGRADED')
    fails = sorted((x for x in l['rows'] if x['verdict'] == 'FAIL'), key=lambda x: (x['priority'], x['id']))
    parts = [f'<p class="method{" degraded" if degraded else ""}" id="method">{e(method_line(l["method"]))}</p>',
             f'<h1>Design audit findings</h1><p>{e(subject_line(l["subject"]))} · surface {e(l["surface"])} · '
             f'{r["coverage"]["rows"]}/{r["coverage"]["applicable"]} catalog ids · '
             + ' · '.join(f'{k} {v}' for k, v in r['verdicts'].items()) + '</p>',
             f'<h2>Gate: {"PASS" if r["passes"] else "FAIL"}</h2><ul>']
    parts += [f'<li class="{"pass" if ok else "fail"}">{"PASS" if ok else "FAIL"} {e(k)}</li>' for k, ok in r['gate'].items()]
    parts.append('</ul>')
    for owner in r['open_by_owner']:
        parts.append(f'<h2>Open for {e(owner)}</h2><table><tr><th>P</th><th>Rule</th><th>File</th><th>Evidence</th><th>Fix</th></tr>')
        parts += [f'<tr><td>{e(x["priority"])}</td><td>{e(x["id"])}: {e(words.get(x["id"], ""))}</td><td>{e(str(x.get("file", "")))}</td>'
                  f'<td>{e(x["evidence"])}</td><td>{e(x["fix"])}</td></tr>' for x in fails if x['owner'] == owner]
        parts.append('</table>')
    na = [x for x in l['rows'] if x['verdict'] == 'N/A']
    if na:
        parts.append('<h2>Not applicable</h2><ul>')
        parts += [f'<li>{e(x["id"])}: {e(words.get(x["id"], ""))}. {e(x["reason"])}</li>' for x in na]
        parts.append('</ul>')
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Design audit findings</title>'
            f'<style>{PAGE_CSS}</style></head><body>' + ''.join(parts) + '</body></html>\n')


# ------------------------------------------------------------------ audit mode: handoff and tickets (issue 1086)
def open_findings(l, catalog):
    words = {row['id']: row.get('words') or row.get('cites', '') for row in catalog['rows']}
    return [dict(x, owner=x['owner'].strip(), rule=words.get(x['id'], '').replace('**', '')) for x in
            sorted((x for x in l['rows'] if x['verdict'] == 'FAIL'), key=lambda x: (x['priority'], x['id']))]


def owner_slug(owner):
    return re.sub(r'[^a-z0-9]+', '-', owner.lower()).strip('-') or 'owner'


def write_handoff(folder, l, r, catalog):
    """One list per owner of its findings, fixes and priorities, as <folder>/<owner>.md; returns the paths.
    Validation already refused a FAIL with no owner, so no finding is left unassigned."""
    lists = {}
    for x in open_findings(l, catalog):
        lists.setdefault(x['owner'], []).append(x)
    slugs = {}
    for owner in lists:
        if owner_slug(owner) in slugs:
            raise Invalid(f'owners {slugs[owner_slug(owner)]!r} and {owner!r} would share one handoff file')
        slugs[owner_slug(owner)] = owner
    os.makedirs(folder, exist_ok=True)
    cell = lambda v: str(v).replace('|', '\\|').replace('\n', ' ')
    paths = []
    for owner, rows in lists.items():
        out = [f'# Design audit handoff: {owner}', '', method_line(l['method']), '',
               f'Subject: {subject_line(l["subject"])}', f'Gate: {"PASS" if r["passes"] else "FAIL"}',
               f'Open for {owner}: {len(rows)} ('
               + ', '.join(f'{s} {sum(1 for x in rows if x["priority"] == s)}' for s in SEVERITIES) + ')',
               '', '| P | Rule | File | Evidence | Fix |', '|---|---|---|---|---|']
        out += [f'| {x["priority"]} | {cell(x["id"] + ": " + x["rule"])} | {cell(x.get("file", ""))} | '
                f'{cell(x["evidence"])} | {cell(x["fix"])} |' for x in rows]
        p = os.path.join(folder, owner_slug(owner) + '.md')
        open(p, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
        paths.append(p)
    return paths


def ticket_drafts(l, catalog):
    """One draft per open accessibility FAIL, carrying its WCAG criterion and severity; PASS and N/A give none."""
    skill = {row['id']: row['skill'] for row in catalog['rows']}
    drafts = []
    for x in open_findings(l, catalog):
        if skill.get(x['id']) != 'accessibility-review':
            continue
        # The criterion is the catalog row's own (**1.4.3** ...) or, for a rule that names none (the
        # common issues, the testing steps), the ledger row's "wcag" field.
        m = re.match(r'(\d+\.\d+\.\d+) ', x['rule'])
        crit = str(x.get('wcag') or (m.group(1) if m else '')).strip()
        if not re.fullmatch(r'\d+\.\d+\.\d+', crit):
            raise Invalid(f'{x["id"]}: an accessibility FAIL needs its WCAG criterion; its catalog row names '
                          'none, so give the ledger row "wcag": "<n.n.n>"')
        rule = x['rule'][len(m.group(0)):] if m else x['rule']
        title = f'[a11y] WCAG {crit} ({x["priority"]}): {rule}' + (f' in {x["file"]}' if x.get('file') else '')
        body = '\n'.join([
            f'**WCAG criterion:** {crit} (WCAG 2.1 AA)', f'**Severity:** {x["priority"]}',
            f'**Rule:** {x["id"]}: {x["rule"]}', f'**Owner:** {x["owner"]}', f'**File:** {x.get("file", "")}',
            f'**Evidence:** {x["evidence"]}', f'**Subject:** {subject_line(l["subject"])}', '',
            f'**Fix:** {x["fix"]}', '', f'From an aac-design audit. {method_line(l["method"])}'])
        drafts.append({'id': x['id'], 'wcag': crit, 'severity': x['priority'], 'owner': x['owner'],
                       'title': title, 'body': body})
    return drafts


def drafts_markdown(drafts):
    out = [f'Ticket drafts: {len(drafts)}, one per open accessibility FAIL']
    for i, d in enumerate(drafts, 1):
        out += ['', f'--- ticket {i} of {len(drafts)}' + (f', filed: {d["filed"]}' if d.get('filed') else ', not filed'),
                f'Title: {d["title"]}', '', d['body']]
    return '\n'.join(out)


def file_tickets(path, repo):
    """Show every draft, then file the unfiled ones into the named repository. The repository is an
    input, never guessed. AAC_DESIGN_GH (a JSON array) stands in for gh in the tests."""
    import subprocess
    doc = json.load(open(path, encoding='utf-8'))
    print(drafts_markdown(doc['drafts']))
    if not repo or not re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
        print('\nnot filed: name the target repository with --repo OWNER/NAME', file=sys.stderr)
        return 2
    gh = json.loads(os.environ['AAC_DESIGN_GH']) if os.environ.get('AAC_DESIGN_GH') else ['gh']
    failed = 0
    for d in doc['drafts']:
        if d.get('filed'):
            continue
        p = subprocess.run(gh + ['api', f'repos/{repo}/issues', '--method', 'POST', '--input', '-'],
                           input=json.dumps({'title': d['title'], 'body': d['body']}),
                           capture_output=True, text=True, encoding='utf-8')
        try:
            url = json.loads(p.stdout)['html_url'] if p.returncode == 0 else None
        except (ValueError, KeyError, TypeError):
            url = None
        if not url:
            failed += 1
            print(f'not filed: {d["id"]}: {(p.stderr or p.stdout).strip()}', file=sys.stderr)
            continue
        d['filed'] = url
        json.dump(doc, open(path, 'w', encoding='utf-8'), indent=2)   # a rerun skips what is filed
        print(f'filed: {d["id"]} {url}', file=sys.stderr)
    return 1 if failed else 0


def sha256_file(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def file_stamp_path(p):
    return os.path.join(os.path.dirname(os.path.abspath(p)), '.design', os.path.basename(p) + '.json')


def url_stamp_path(url):
    return os.path.join('.design', 'url-' + hashlib.sha256(url.encode('utf-8')).hexdigest()[:16] + '.json')


def is_url(t):
    return bool(re.match(r'^[a-z][a-z0-9+.-]*://', t, re.I)) and not t.lower().startswith('file://')


def stamp_ledger(target, l, r):
    """Write the stamp; return its path, or a line starting 'not written' saying why not."""
    sub = l['subject']
    if is_url(target):
        if sub['kind'] != 'url' or sub['url'] != target:
            return f'not written, the ledger audits {sub.get("url") or sub.get("path")}, not {target}'
        out, body = url_stamp_path(target), {'url': target, 'commit': sub['commit']}
    else:
        if sub['kind'] != 'file':
            return f'not written, the ledger audits {sub["url"]}, not a file'
        if sha256_file(target) != sub['sha256']:
            return f'not written, {target} changed since the audit (its sha256 no longer matches the ledger)'
        out, body = file_stamp_path(target), {'file': os.path.basename(target), 'sha256': sub['sha256']}
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    body.update({'passes': True, 'mode': 'audit', 'method': l['method'], 'surface': l['surface'],
                 'coverage': r['coverage'], 'verdicts': r['verdicts'], 'open_by_owner': r['open_by_owner'],
                 'stamped': datetime.datetime.now().isoformat(timespec='seconds')})
    json.dump(body, open(out, 'w', encoding='utf-8'), indent=2)
    return out


def check_stamp(target, commit):
    if is_url(target):
        if not commit:
            return 2, 'a URL stamp is checked against the deployed commit: pass --commit'
        sp = url_stamp_path(target)
    else:
        sp = file_stamp_path(target)
    try:
        s = json.load(open(sp, encoding='utf-8'))
    except (OSError, ValueError):
        return 1, f'no stamp at {sp}'
    if is_url(target) and s.get('commit') != commit:
        return 1, f'stale: stamped at commit {s.get("commit")}, deployed is {commit}'
    if not is_url(target) and s.get('sha256') != sha256_file(target):
        return 1, f'stale: {target} changed since it was stamped'
    if not s.get('passes'):
        return 1, 'the stamp records a failed gate'
    return 0, f'fresh: {sp}'


def audit_main(a, ledger):
    catalog = json.load(open(CATALOG, encoding='utf-8'))
    try:
        r = score_ledger(ledger, catalog)
        drafts = ticket_drafts(ledger, catalog) if a.tickets else None
        handoff = write_handoff(a.handoff, ledger, r, catalog) if a.handoff else []
    except Invalid as e:
        print(f'invalid ledger: {e}', file=sys.stderr); sys.exit(3)
    if drafts is None:
        print(ledger_markdown(ledger, r) if a.markdown else json.dumps(r, indent=2))
    else:   # the drafts are shown here, before anything is filed
        print(ledger_markdown(ledger, r) + '\n\n' + drafts_markdown(drafts) if a.markdown
              else json.dumps(dict(r, ticket_drafts=drafts), indent=2))
        json.dump({'method': ledger['method'], 'subject': ledger['subject'], 'drafts': drafts},
                  open(a.tickets, 'w', encoding='utf-8'), indent=2)
        print(f'tickets: {len(drafts)} draft(s) in {a.tickets}, not filed; file them with '
              f'--file-tickets {a.tickets} --repo OWNER/NAME once the target repository is named', file=sys.stderr)
    for p in handoff:
        print(f'handoff: {p}', file=sys.stderr)
    if a.handoff and not handoff:
        print('handoff: nothing open, no list written', file=sys.stderr)
    if a.report:
        open(a.report, 'w', encoding='utf-8').write(ledger_page(ledger, r, catalog))
        print(f'report: {a.report}', file=sys.stderr)
    if a.stamp and r['passes']:
        out = stamp_ledger(a.stamp, ledger, r)
        print(f'stamp: {out}', file=sys.stderr)
        if out.startswith('not written'):
            sys.exit(1)
    elif a.stamp:
        print('stamp: not written, the gate failed', file=sys.stderr)
    sys.exit(0 if r['passes'] else 1)


def main():
    # The method line (· and the degraded ⚠️) and the ticket drafts carrying it must print the same on a
    # Windows desktop, whose piped stdout is otherwise cp1252 with CRLF.
    for s in (sys.stdout, sys.stderr):
        s.reconfigure(encoding='utf-8', newline='\n')
    ap = argparse.ArgumentParser()
    ap.add_argument('critique', nargs='?', help='critique.json (build mode) or ledger.json (audit mode)')
    ap.add_argument('--markdown', action='store_true')
    ap.add_argument('--stamp', metavar='DELIVERABLE')
    ap.add_argument('--report', metavar='PAGE', help='audit mode: write the findings page (HTML) here')
    ap.add_argument('--check-stamp', metavar='FILE_OR_URL')
    ap.add_argument('--commit', help='with --check-stamp on a URL: the commit deployed now')
    ap.add_argument('--handoff', metavar='FOLDER', help='audit mode: write one handoff list per owner here')
    ap.add_argument('--tickets', metavar='DRAFTS', help='audit mode: draft one ticket per open accessibility FAIL')
    ap.add_argument('--file-tickets', metavar='DRAFTS', help='show the drafts, then file them into --repo')
    ap.add_argument('--repo', metavar='OWNER/NAME', help='with --file-tickets: the target repository')
    a = ap.parse_args()
    if a.file_tickets:
        sys.exit(file_tickets(a.file_tickets, a.repo))
    if a.check_stamp:
        code, msg = check_stamp(a.check_stamp, a.commit)
        print(f'stamp: {msg}', file=sys.stderr if code else sys.stdout)
        sys.exit(code)
    if not a.critique:
        ap.error('a critique or ledger file is required')
    c = json.load(open(a.critique, encoding='utf-8'))
    if 'rows' in c:
        audit_main(a, c)
    if a.report or a.handoff or a.tickets:
        ap.error('--report, --handoff and --tickets take an audit ledger')
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
