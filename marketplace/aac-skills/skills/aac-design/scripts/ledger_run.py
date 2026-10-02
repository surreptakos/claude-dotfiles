#!/usr/bin/env python3
"""Audit mode, step 2 as one command: one isolated reviewer process per catalogued skill (issue 1087).

    python3 ledger_run.py EVIDENCE --out ledger.json [--surface S] [--auditor Design] [--owners Design,Code]
                          [--brief FILE] [--batch 60] [--jobs 4] [--model M] [--timeout 1800] [--work DIR]
                          [--skills a,b]

Why it exists: the ledger needs one isolated reviewer per skill that sees the detector set only after its
rows are in. A session without the Agent tool (a fleet worker, a sub-agent) could only run every reviewer
in its own context. That run is DEGRADED, so the gate fails on not_degraded, and the first reviewer to
judge after the context met findings.json breaks the order, so score.py rejects the ledger (exit 3,
"detector output reached the ... reviewer before its rows were in"). The rep-board rerun hit both.

Here every reviewer is its own `claude -p --restricted` process, which confines its file tools to a
staging folder holding only the bundle's review_set, the skill's own rule text and its rows. No detector
file is in reach, whatever context launched the run.

1. Rows, blind: the skill's applicable rows go out in batches of --batch, each to a fresh process. A row
   comes back with a verdict, and its evidence must name a review_set file. Bad or missing rows are asked
   for once more. rows_in is when the skill's last batch returned.
2. Detector: once every skill's rows are in, a fresh process per skill gets its rows and the detector_set.
   It marks every fault that names one of its ids real or false positive (accessibility-review also gets
   axe.json and the faults that name no id). A real fault may turn a PASS into a FAIL; that row keeps
   "blind_verdict" and "after_detector": true. detector_shown is when that process started, so it always
   follows rows_in. The script stamps both times itself, so the order holds by construction.

The ledger's method is "dual-agent (...)" and every reviewer records its session ids. Feed it to score.py.

AAC_DESIGN_REVIEWER (a JSON array) replaces the reviewer command, as AAC_DESIGN_GH does in score.py: it
runs in the staging folder with the prompt on stdin and prints the claude --output-format json envelope
or the bare reply.

Exit 0 = ledger written with every applicable id, 1 = ledger written but ids are still missing (named;
score.py will refuse it), 2 = usage, 3 = the bundle is invalid or no reviewer could be run.
"""
import argparse, concurrent.futures, datetime, json, os, re, shutil, subprocess, sys, threading

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import evidence  # noqa: E402

VERDICTS = ('PASS', 'FAIL', 'N/A')
SEVERITIES = ('P0', 'P1', 'P2', 'P3')
LOCK = threading.Lock()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def log(msg):
    with LOCK:
        print(f'ledger_run: {msg}', file=sys.stderr, flush=True)


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-') or 'skill'


# ------------------------------------------------------------------ the reviewer's source text
def source_files(skill, rows, catalog):
    """(absolute source, path under source/) for the skill's rule text: a vendored skill in full, a house
    source's file or folder, and any other file its rows cite."""
    out = {}
    def add_tree(root):
        for d, _, files in os.walk(root):
            for f in files:
                p = os.path.join(d, f)
                out[os.path.normpath(p)] = os.path.relpath(p, root).replace('\\', '/')
    for s in catalog.get('sources', []):
        if s['skill'] == skill:
            add_tree(os.path.join(SKILL_DIR, s['vendored']))
    for h in catalog.get('house', []):
        if h['skill'] == skill:
            p = os.path.normpath(os.path.join(SKILL_DIR, h['file']))
            if os.path.isdir(p):
                add_tree(p)
            elif os.path.isfile(p):
                out[p] = os.path.basename(p)
    for r in rows:
        p = os.path.normpath(os.path.join(SKILL_DIR, r['file']))
        if p not in out and os.path.isfile(p):
            out[p] = os.path.basename(p)
    return out


def cite(row, files):
    rel = files.get(os.path.normpath(os.path.join(SKILL_DIR, row['file'])), row['file'])
    return f'source/{rel}:{row.get("line", "")}'


# ------------------------------------------------------------------ one reviewer process
def reviewer_cmd(model):
    if os.environ.get('AAC_DESIGN_REVIEWER'):
        return json.loads(os.environ['AAC_DESIGN_REVIEWER'])
    exe = shutil.which('claude')
    if not exe:
        raise RuntimeError('the claude CLI is not on PATH; it runs each reviewer as its own isolated process')
    cmd = [exe, '-p', '--restricted', '--strict-mcp-config', '--tools', 'Read,Glob,Grep',
           '--output-format', 'json', '--no-session-persistence']
    return cmd + (['--model', model] if model else [])


def run_reviewer(cmd, folder, prompt, timeout):
    """(reply text, session id, cost) from one isolated process run in folder."""
    p = subprocess.run(cmd, cwd=folder, input=prompt, capture_output=True, text=True, encoding='utf-8',
                       errors='replace', timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError(f'reviewer exited {p.returncode}: {(p.stderr or p.stdout).strip()[-400:]}')
    try:
        env = json.loads(p.stdout)
    except ValueError:
        env = None
    if isinstance(env, dict) and isinstance(env.get('result'), str):
        if env.get('is_error'):
            raise RuntimeError(f'reviewer reported an error: {env["result"][-400:]}')
        return env['result'], env.get('session_id') or os.path.basename(folder), env.get('total_cost_usd') or 0
    return p.stdout, os.path.basename(folder), 0


def reply_json(text):
    """The last fenced json block in the reply, else the outermost object in it."""
    blocks = re.findall(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.S)
    for cand in reversed(blocks) if blocks else [text[text.find('{'):text.rfind('}') + 1]]:
        try:
            return json.loads(cand)
        except ValueError:
            continue
    return {}


def stage(folder, bundle_dir, names, files, extra):
    """A fresh staging folder: the named bundle files under evidence/, the rule text under source/, and
    the extra files (name -> object) as JSON. Nothing else is in reach of a --restricted process."""
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(os.path.join(folder, 'evidence'))
    for n in names:
        dest = os.path.join(folder, 'evidence', n)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(os.path.join(bundle_dir, n), dest)
    for src, rel in files.items():
        dest = os.path.join(folder, 'source', rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(src, dest)
    for n, obj in extra.items():
        with open(os.path.join(folder, n), 'w', encoding='utf-8') as f:
            json.dump(obj, f, indent=1)


# ------------------------------------------------------------------ prompts
def row_brief(r, files):
    words = (r.get('words') or r.get('cites') or '').replace('\n', ' ')
    checks = ', '.join(f'{k} {v}' for c in r['checks'] for k, v in c.items())
    return f'- {r["id"]} | {cite(r, files)} | {r.get("section", "")} | {words} | checks: {checks}'


ROW_SHAPE = '''Return exactly one object per row:
- PASS or FAIL: "evidence" names the evidence file you judged from, optionally with a pointer
  ("shot-390.png", "dom.json: #aacH1"), and "note" says in one line what you saw or measured.
- FAIL also: "owner" (one of {owners}), "file" (the file to change, or "" when unknown), "fix" (one
  sentence) and "priority": P0 blocks use, P1 serious, P2 should fix, P3 polish. A FAIL against an
  accessibility rule also gives "wcag", its WCAG 2.1 criterion as "n.n.n".
- N/A: "reason", one sentence on why the rule cannot apply to this page.'''


def rows_prompt(skill, bundle, rows, files, a, problems=None):
    review = ', '.join(bundle['review_set'])
    again = ('\nA first answer for these rows was refused: ' + '; '.join(problems) + '. Answer them again.\n'
             if problems else '')
    return f'''You are the {skill} reviewer in an aac-design audit (audit mode, ledger step). You work alone, in an
isolated process. No detector output exists for you: judge only from the evidence and the rule text.

Subject: {subject_text(bundle)} (surface {a.surface}).
{a.brief_text}
Your working folder holds:
- evidence/: the only files you may cite: {review}. The screenshots are full pages at 1440, 768 and
  390 px wide, at 200% zoom, under reduced motion, forced colours and offline. dom.json is every
  element with its computed styles and box (large: search it with Grep); a11y-tree.json is the
  browser accessibility tree; keyboard-walk.json is a scripted Tab walk; text.txt is the page's text.
- source/: {skill}'s own rule text in full. Each row cites its file and line there. Read the rule's
  own words at that line before you judge it, never a summary of it.
- rows.json: the rows below, as data.

Judge every row below against the rendered page. A rule written as build advice ("start by ...",
"choose ...") is judged on whether the page shows its outcome. A rule about a pattern this page does
not have is N/A. Never invent evidence, and change no file.
{ROW_SHAPE.format(owners=', '.join(a.owner_list))}
{again}
Rows (id | rule source | section | words | checks):
{chr(10).join(row_brief(r, files) for r in rows)}

End with one fenced json block and nothing after it:
```json
{{"rows": [{{"id": "...", "verdict": "PASS", "evidence": "...", "note": "..."}}]}}
```'''


def detector_prompt(skill, bundle, n_faults, a):
    return f'''You are the {skill} reviewer in an aac-design audit. Your ledger rows are already in (my-rows.json);
only now do you see the detector output. Subject: {subject_text(bundle)} (surface {a.surface}).
{a.brief_text}
Your folder holds evidence/ (the review files and now the detector files: {', '.join(bundle['detector_set'])}),
source/ ({skill}'s rule text), my-rows.json (your rows) and my-faults.json ({n_faults} detector faults,
each with its index in findings.json and the catalog ids it names; "axe" entries are axe-core violations).

1. Mark every fault in my-faults.json "real" or "false_positive", with a one-line reason checked against
   the screenshots or dom.json.
2. Where a real fault shows that one of your PASS rows is wrong, return that row again as a FAIL (same
   shape as before: evidence, note, owner, file, fix, priority). Change no other row.
{ROW_SHAPE.format(owners=', '.join(a.owner_list))}

End with one fenced json block and nothing after it:
```json
{{"marks": [{{"fault": "findings#0", "mark": "real", "reason": "..."}}], "rows": []}}
```'''


def subject_text(bundle):
    s = bundle['subject']
    return {'url': lambda: f'{s["url"]} (deployed commit {s.get("commit")})',
            'drive': lambda: f'Drive file {s.get("file_id")}',
            'file': lambda: os.path.basename(s.get('path', ''))}.get(s.get('kind'), lambda: bundle['target'])()


# ------------------------------------------------------------------ checking what comes back
def check_row(x, ids, review_set, owners):
    """None when the row is good, else what is wrong with it."""
    rid = x.get('id')
    if rid not in ids:
        return f'{rid!r} is not one of your ids'
    v = x.get('verdict')
    if v not in VERDICTS:
        return f'{rid}: verdict must be PASS, FAIL or N/A'
    if v == 'N/A':
        return None if len(str(x.get('reason') or '').strip()) >= 3 else f'{rid}: N/A needs a reason'
    ev = str(x.get('evidence') or '')
    if not any(n in ev for n in review_set):
        return f'{rid}: evidence must name a review file ({", ".join(review_set)}), got {ev!r}'
    if v == 'FAIL':
        if x.get('owner') not in owners:
            return f'{rid}: owner must be one of {owners}'
        if x.get('priority') not in SEVERITIES or not str(x.get('fix') or '').strip():
            return f'{rid}: a FAIL needs a fix and a priority P0 to P3'
    return None


def ledger_row(x):
    keep = ('id', 'verdict', 'evidence', 'note', 'owner', 'file', 'fix', 'priority', 'reason', 'wcag')
    row = {k: x[k] for k in keep if k in x and x[k] is not None}
    if row['verdict'] != 'FAIL':
        for k in ('owner', 'file', 'fix', 'priority'):
            row.pop(k, None)
    return row


# ------------------------------------------------------------------ the run
def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('evidence', help='the evidence bundle folder (bundle.json)')
    ap.add_argument('--out', required=True, help='the ledger to write')
    ap.add_argument('--surface', help="the ledger's surface (default: the bundle's)")
    ap.add_argument('--auditor', default='Design', help='the owner whose open P0/P1 block the gate')
    ap.add_argument('--owners', default='Design,Code', help='the owners a FAIL may name, comma separated')
    ap.add_argument('--brief', help='a text file every reviewer reads first: what the page is, who owns what')
    ap.add_argument('--batch', type=int, default=60, help='rows per reviewer process')
    ap.add_argument('--jobs', type=int, default=4, help='reviewer processes at once')
    ap.add_argument('--model', help='the model each reviewer runs on (default: the CLI default)')
    ap.add_argument('--timeout', type=int, default=1800, help='seconds one reviewer process may take')
    ap.add_argument('--work', help='where the staging folders go (default: <out>.work beside the ledger)')
    ap.add_argument('--skills', help='only these skills, comma separated: a trial run (the ledger then misses ids)')
    a = ap.parse_args(argv)

    bundle_dir = os.path.abspath(a.evidence)
    problems = evidence.validate(bundle_dir)
    if problems:
        print('ledger_run: the bundle is invalid: ' + '; '.join(problems), file=sys.stderr)
        return 3
    bundle = json.load(open(os.path.join(bundle_dir, 'bundle.json'), encoding='utf-8'))
    catalog = evidence.load_catalog()
    a.surface = a.surface or bundle['surface']
    if a.surface not in catalog['surfaces']:
        ap.error(f'surface {a.surface!r} is not one of {catalog["surfaces"]}')
    a.owner_list = [o.strip() for o in a.owners.split(',') if o.strip()]
    if a.auditor not in a.owner_list:
        a.owner_list.append(a.auditor)
    a.brief_text = open(a.brief, encoding='utf-8').read().strip() + '\n' if a.brief else ''
    work = os.path.abspath(a.work or (os.path.abspath(a.out) + '.work'))
    try:
        cmd = reviewer_cmd(a.model)
    except RuntimeError as e:
        print(f'ledger_run: {e}', file=sys.stderr)
        return 3

    applicable = [r for r in catalog['rows'] if a.surface in r['surfaces']]
    skills = sorted({r['skill'] for r in applicable})
    if a.skills:
        skills = [s for s in skills if s in {x.strip() for x in a.skills.split(',')}]
    by_skill = {s: [r for r in applicable if r['skill'] == s] for s in skills}
    files = {s: source_files(s, by_skill[s], catalog) for s in skills}
    review_set = bundle['review_set']
    got = {s: {} for s in skills}             # skill -> id -> row
    sessions = {s: [] for s in skills}
    finished = {s: None for s in skills}
    cost = [0.0]
    failures = []

    def batch(skill, n, rows, problems=None):
        folder = os.path.join(work, f'{slug(skill)}-{n}')
        stage(folder, bundle_dir, review_set, files[skill], {'rows.json': rows})
        ids = {r['id'] for r in rows}
        try:
            text, sid, usd = run_reviewer(cmd, folder, rows_prompt(skill, bundle, rows, files[skill], a, problems), a.timeout)
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as e:
            log(f'{skill} batch {n}: {e}')
            return []
        bad = []
        with LOCK:
            sessions[skill].append(sid)
            cost[0] += usd
            for x in reply_json(text).get('rows') or []:
                why = check_row(x, ids, review_set, a.owner_list) if isinstance(x, dict) else 'not an object'
                if why:
                    bad.append(why)
                elif x['id'] not in got[skill]:
                    got[skill][x['id']] = ledger_row(x)
            finished[skill] = now()
        log(f'{skill} batch {n}: {len([i for i in ids if i in got[skill]])}/{len(ids)} rows')
        return bad

    # Phase 1: every skill's rows, blind.
    with concurrent.futures.ThreadPoolExecutor(max(1, a.jobs)) as pool:
        jobs = {}
        for s in skills:
            rows = by_skill[s]
            for i in range(0, len(rows), a.batch):
                jobs[pool.submit(batch, s, i // a.batch + 1, rows[i:i + a.batch])] = s
        bad = {s: [] for s in skills}
        for f in concurrent.futures.as_completed(jobs):
            bad[jobs[f]] += f.result()
        retry = {}
        for s in skills:
            left = [r for r in by_skill[s] if r['id'] not in got[s]]
            for i in range(0, len(left), a.batch):
                retry[pool.submit(batch, s, f'retry{i // a.batch + 1}', left[i:i + a.batch],
                                  bad[s][:20] or ['the rows were missing from the reply'])] = s
        for f in concurrent.futures.as_completed(retry):
            f.result()
    rows_in = {s: finished[s] for s in skills}

    # Phase 2: the detector set, only now, one fresh process per skill.
    faults = json.load(open(os.path.join(bundle_dir, 'findings.json'), encoding='utf-8')).get('faults') or []
    axe = []
    if 'axe.json' in bundle['detector_set']:
        try:
            axe = json.load(open(os.path.join(bundle_dir, 'axe.json'), encoding='utf-8')).get('violations') or []
        except (OSError, ValueError):
            axe = []
    all_ids = {r['id'] for r in applicable}
    reviewers = {}

    def detector(skill):
        ids = {r['id'] for r in by_skill[skill]}
        mine = [dict(f, fault=f'findings#{i}') for i, f in enumerate(faults)
                if ids & set(f.get('catalog_ids') or [])
                or (skill == 'accessibility-review' and not all_ids & set(f.get('catalog_ids') or []))]
        if skill == 'accessibility-review':
            mine += [{'fault': f'axe#{i}', 'axe': v} for i, v in enumerate(axe)]
        entry = {'skill': skill, 'agent': (sessions[skill] or ['none'])[0], 'sessions': list(sessions[skill]),
                 'rows_in': rows_in[skill], 'detector_shown': None, 'detector_faults': len(mine), 'marks': []}
        if not mine or not got[skill]:
            return entry
        folder = os.path.join(work, f'{slug(skill)}-detector')
        stage(folder, bundle_dir, review_set + bundle['detector_set'], files[skill],
              {'my-rows.json': list(got[skill].values()), 'my-faults.json': mine})
        entry['detector_shown'] = now()
        try:
            text, sid, usd = run_reviewer(cmd, folder, detector_prompt(skill, bundle, len(mine), a), a.timeout)
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as e:
            log(f'{skill} detector: {e}')
            failures.append(f'{skill} detector pass: {e}')
            return entry
        reply = reply_json(text)
        evid = review_set + bundle['detector_set']
        with LOCK:
            cost[0] += usd
            entry['sessions'].append(sid)
            entry['marks'] = [m for m in reply.get('marks') or [] if isinstance(m, dict)]
            for x in reply.get('rows') or []:
                if not isinstance(x, dict) or x.get('verdict') != 'FAIL' or check_row(x, ids, evid, a.owner_list):
                    continue
                old = got[skill].get(x['id'])
                if old and old['verdict'] == 'PASS':
                    got[skill][x['id']] = dict(ledger_row(x), blind_verdict='PASS', after_detector=True)
        log(f'{skill} detector: {len(entry["marks"])}/{len(mine)} faults marked')
        return entry

    with concurrent.futures.ThreadPoolExecutor(max(1, a.jobs)) as pool:
        for e in pool.map(detector, skills):
            reviewers[e['skill']] = e

    rows = [got[s][r['id']] for s in skills for r in by_skill[s] if r['id'] in got[s]]
    missing = [r['id'] for r in applicable if r['id'] not in got.get(r['skill'], {})]
    method = ('dual-agent (isolated claude -p reviewers, rows before detector: '
              + ' · '.join(f'{s}={reviewers[s]["agent"]}' for s in skills) + ')')
    ledger = {'method': method, 'surface': a.surface, 'subject': bundle['subject'], 'auditor': a.auditor,
              'reviewers': [reviewers[s] for s in skills], 'rows': rows,
              'run': {'tool': 'ledger_run.py', 'started_from': bundle_dir, 'cost_usd': round(cost[0], 2),
                      'missing': missing, 'failures': failures, 'written': now()}}
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(ledger, f, indent=1)
    print(f'ledger_run: {len(rows)}/{len(applicable)} rows from {len(skills)} reviewers; {a.out}')
    if missing:
        print(f'ledger_run: {len(missing)} id(s) still missing: {", ".join(missing[:50])}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
