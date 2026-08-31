"""Machine-checkable half of DRAFTER-PRESEND-CHECKLIST.md, bundled with the
AAC contract package skill.

Usage:  python verify_package.py "<job folder>" [--quiet]
Exit:   0 = no FAILs, 1 = at least one FAIL, 2 = bad input.

Reads only. Never writes to the job folder and never saves a workbook.

Every check reports PASS, FAIL, WARN or SKIP. SKIP means the input the check
needed was not found; it is never silently treated as a pass.

Anchors are located by searching for their labels, not by fixed row numbers.
Rows get inserted and deleted per job, so a fixed cell map only works on a
freshly built schedule and produces false failures on everything else.

Formula values are recomputed from their ranges rather than read from Excel's
cache, because a cached value is stale until Excel reopens the file.

Covers the mechanical items only. Designation, which conditional clarifications
a job earns, BASELINES section 0 merges, legal-entity verification and print
layout stay human.
"""
import sys, os, re, fnmatch, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

CLAR_RANGE = (12, 16)
EXCL_RANGE = (8, 10)
DEPOSIT_THRESHOLD = 5000.0
DEPOSIT_RATE = 0.50
SHEET = 'Equip & Services'

CANON = ('at the site listed above',
         'as itemized in the Equipment and Labor section')
DESIGNATIONS = ('new', 'replacement', 'takeover', 'addition')
SYSTEMS = ('Intrusion Alarm', 'Video Surveillance', 'Access Control', 'Fire Alarm',
           'Elevator Monitoring', 'Audio/Visual', 'Nurse Call', 'Area of Refuge',
           'Network', 'Standalone Intercom', 'Visitor Management',
           'Standalone Environmental Monitoring')
SVC_GROUPS = ('New Services', 'Replacement Services', 'Existing Services')

ENTITY = re.compile(r"\b[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,5}\s*,?\s*"
                    r"(?:Inc\.?|LLC|L\.L\.C\.|Corp\.?|Corporation|Company|Co\.|Ltd\.?"
                    r"|LP|PLLC|Church|District)\b")
# a part number: mixed letters+digits, 4+ chars, and not a spec/unit token
PART = re.compile(r'\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+\b'
                  r'|\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z]{2,}[0-9]{3,}[A-Z0-9]*\b')
UNIT_OK = re.compile(r'^\d+(MP|TB|GB|MB|FPS|K|X|AWG|V|AH|W)$|^CAT\d[A-Z]*$|^POE\+?$|^H\.?26[45]$')

results = []
def rec(st, item, detail=''):
    results.append((st, item, detail))

def money(v):
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    m = re.search(r'[\d,]+\.?\d*', str(v))
    return float(m.group(0).replace(',', '')) if m else None

def parts_in(s):
    out = []
    for tok in re.findall(r'[A-Za-z0-9./+-]+', s or ''):
        u = tok.upper().strip('.')
        if UNIT_OK.match(u) or u in ('AAC', 'AHJ', 'LTE', 'UL', 'IP', 'CO', 'HVAC', 'NVR', 'DVR'):
            continue
        if PART.fullmatch(u):
            out.append(tok)
    return out

# Subfolders never searched for package documents: archived/superseded copies
# live here (2026-08-24 portfolio diag: 15 jobs with only "Old docs" drafts).
SKIP_DIRS = ('old', 'old docs', 'old documents', 'archive', 'archived',
             'superseded', 'backup', 'backups')

def find_files(job, patterns, exclude=()):
    hits = []
    for dirpath, dirs, files in os.walk(job):
        dirs[:] = [d for d in dirs
                   if d.lower() not in SKIP_DIRS
                   and not d.startswith('_') and not d.startswith('.')]
        for f in files:
            if f.startswith('~$') or any(x.lower() in f.lower() for x in exclude):
                continue
            if any(fnmatch.fnmatch(f, pat) for pat in patterns):
                hits.append(os.path.join(dirpath, f))
    return sorted(set(hits), key=os.path.getmtime, reverse=True)

def pdf_fields(path):
    try:
        from pypdf import PdfReader
        return {k: (v.get('/V') if v.get('/V') is not None else '')
                for k, v in (PdfReader(path).get_fields() or {}).items()}
    except Exception:
        return {}

def pdf_text(path):
    import subprocess
    try:
        return subprocess.run(['pdftotext', '-layout', path, '-'],
                              capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return ''


# ---------- registry entity-name check ----------
# Governing rule lives in references/DRAFTER-PRESEND-CHECKLIST.md A.1 (verified
# entity source is the state Secretary of State record) and A.2 (assumed-name
# format). OPEN-DECISIONS.md item 19 (resolved 2026-08-21) permits a registry
# lookup as a verify-and-flag WARN — never a silent correction. The rep-confirmed
# name governs the package; this check is advisory.
#
# Offline-safe by design: this reads a cached registry snapshot dropped into
# the job folder (or a shared cache directory) by a prior step. It never opens
# a network connection and never writes into the job folder. Absent cache is
# a SKIP, not a FAIL.

def _registry_norm(s):
    """Whitespace-collapsed, case-folded, punctuation-trimmed for compare only.
    Used inside this file's comparator; the on-disk name is never rewritten."""
    if s is None:
        return ''
    x = re.sub(r'\s+', ' ', str(s)).strip().lower()
    return x.strip('.,')


def registry_lookup(job, sub_name):
    """Return (registry_dict, source_label) or (None, reason).

    Search order:
      1. ``_registry.json`` at the top of the job folder.
      2. A file named after the subscriber (slugified) inside the directory
         named by the ``AAC_REGISTRY_CACHE`` env var, if set and readable.

    Nothing else is tried. No network. No jobs-drive lookup beyond the folder
    the caller already handed us. A missing, empty, or unreadable cache is
    reported so the caller can SKIP; nothing here raises."""
    import json
    if not sub_name:
        return None, 'no subscriber name to check'
    p = os.path.join(job, '_registry.json')
    if os.path.isfile(p):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict):
                return data, os.path.basename(p)
            return None, f'{os.path.basename(p)} is not a JSON object'
        except Exception as e:
            return None, f'{os.path.basename(p)} unreadable ({type(e).__name__})'
    cache_dir = os.environ.get('AAC_REGISTRY_CACHE')
    if cache_dir and os.path.isdir(cache_dir):
        slug = re.sub(r'[^A-Za-z0-9]+', '_', sub_name).strip('_').lower()
        for fname in (f'{slug}.json',):
            cp = os.path.join(cache_dir, fname)
            if os.path.isfile(cp):
                try:
                    with open(cp, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    if isinstance(data, dict):
                        return data, f'{fname} (AAC_REGISTRY_CACHE)'
                    return None, f'{fname} is not a JSON object'
                except Exception as e:
                    return None, f'{fname} unreadable ({type(e).__name__})'
    return None, 'no registry cache in job folder or AAC_REGISTRY_CACHE'


def registry_matches(sub_name, reg):
    """True iff ``sub_name`` reconciles to the registry record.

    Match rules (comparison only; never rewrites the schedule cell):
      * exact equality with ``legal_name`` (normalized) is a match;
      * exact equality with any entry in ``assumed_names`` is a match;
      * the DRAFTER-PRESEND A.2 format
        ``"[Legal Entity], an <state> corporation, d/b/a [Assumed]"``
        is a match when the sub name contains both the legal name and one
        assumed name and carries a d/b/a token.
    Anything else falls through to WARN and the rep decides."""
    if not isinstance(reg, dict):
        return False
    subj = _registry_norm(sub_name)
    if not subj:
        return False
    legal = _registry_norm(reg.get('legal_name'))
    assumed_raw = reg.get('assumed_names') or []
    if not isinstance(assumed_raw, list):
        assumed_raw = []
    assumed = [_registry_norm(a) for a in assumed_raw if a]
    if legal and subj == legal:
        return True
    for a in assumed:
        if a and subj == a:
            return True
    if legal and legal in subj and ('d/b/a' in subj or ' dba ' in f' {subj} '):
        for a in assumed:
            if a and a in subj:
                return True
    return False


class Sheet:
    """Label-anchored view of an Equip & Services tab."""
    def __init__(self, path):
        import openpyxl
        self.wb = openpyxl.load_workbook(path, data_only=False)
        self.wbv = openpyxl.load_workbook(path, data_only=True)
        self.ws = self.wb[SHEET]
        self.wsv = self.wbv[SHEET]
        self.maxr = self.ws.max_row

    def t(self, ref):
        v = self.ws[ref].value
        return '' if v is None else str(v)

    def v(self, ref):
        return self.wsv[ref].value

    def col(self, c, r):
        return self.t(f'{c}{r}')

    def row_where(self, col, pred, start=1, end=None):
        for r in range(start, (end or self.maxr) + 1):
            if pred(self.col(col, r).strip()):
                return r
        return None

    def rows_where(self, col, pred):
        return [r for r in range(1, self.maxr + 1) if pred(self.col(col, r).strip())]

    def resolve(self, ref):
        f = self.ws[ref].value
        if isinstance(f, str) and f.startswith('='):
            m = re.match(r'^=SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$', f.replace(' ', ''))
            if m:
                c, a, b = m.group(1), int(m.group(2)), int(m.group(4))
                tot = 0.0
                for r in range(a, b + 1):
                    x = self.v(f'{c}{r}')
                    if isinstance(x, (int, float)):
                        tot += float(x)
                return tot, 'recomputed'
            return None, 'formula is not a simple SUM'
        return money(f), 'literal'

    def clarifications(self):
        """Return (clarifications_text, exclusions_text, cell).

        The block is one cell holding bulleted text. The "CLARIFICATIONS AND
        EXCLUSIONS" heading above it is a separate cell with no bullets, so a
        candidate must actually contain bullets to qualify.
        """
        best = None
        for r in range(1, self.maxr + 1):
            for c in 'AB':
                s = self.t(f'{c}{r}')
                if '\u2022' not in s or len(s) < 120:
                    continue
                if best is None or len(s) > len(best[0]):
                    best = (s, f'{c}{r}')
        if not best:
            return '', '', None
        s, cell = best
        lo = s.lower()
        i = lo.find('exclusion')
        if i > 0:
            return s[:i], s[i:], cell
        return s, '', cell


def verify(job):
    job = job.rstrip('\\/')
    scheds = find_files(job, ['*Equip & Svc Schedule*.xlsx', '*Equip & Services*.xlsx',
                              '*Equip & Svc*.xlsx', '*Equip*Sv*Schedule*.xlsx',
                              '*Service Schedule*.xlsx'], exclude=['Template', 'BACKUP'])
    if not scheds:
        pdfs = find_files(job, ['*Equip & Svc*.pdf', '*Equip & Services*.pdf'], exclude=['Template'])
        rec('N/A', 'Drafted schedule present',
            'only exported/signed PDFs in folder' if pdfs else 'no drafted schedule yet')
        return
    sched = scheds[0]
    if len(scheds) > 1:
        rec('WARN', 'One schedule in the folder',
            f'{len(scheds)} found; newest used: {os.path.basename(sched)}')
    try:
        S = Sheet(sched)
    except KeyError:
        rec('FAIL', 'Schedule readable', f"no '{SHEET}' tab in {os.path.basename(sched)}")
        return
    rec('PASS', 'Schedule read', os.path.basename(sched))

    # ---------------- anchors ----------------
    hdr = S.row_where('A', lambda s: s.upper().startswith('SCHEDULE OF EQUIPMENT'))
    sub_lbl = S.row_where('A', lambda s: s.rstrip(':').lower() == 'subscriber')
    sow_lbl = S.row_where('A', lambda s: s.upper().startswith('SCOPE OF WORK'))
    eq_lbl = S.row_where('A', lambda s: s.upper().startswith('EQUIPMENT'))
    svc_lbl = S.row_where('A', lambda s: s.upper() == 'SERVICES')
    qty_hdrs = [r for r in S.rows_where('A', lambda s: s.lower() == 'qty')
                if S.col('B', r).strip().lower() == 'description']
    pp_row = S.row_where('E', lambda s: 'purchase price' in s.lower())
    dep_row = S.row_where('E', lambda s: s.lower().startswith('deposit'))
    bal_row = S.row_where('E', lambda s: 'balance due' in s.lower())
    mt_row = S.row_where('E', lambda s: 'monthly total' in s.lower())

    missing = [n for n, r in [('SCHEDULE OF EQUIPMENT heading', hdr), ('SCOPE OF WORK', sow_lbl),
                              ('EQUIPMENT heading', eq_lbl), ('Purchase Price', pp_row)] if not r]
    if missing:
        rec('FAIL', 'Schedule structure recognised', 'missing anchor: ' + ', '.join(missing))
        return

    # ---------------- A) headings and identity ----------------
    rec('PASS' if S.col('A', hdr).strip().upper() == 'SCHEDULE OF EQUIPMENT AND SERVICES' else 'FAIL',
        'Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"', S.col('A', hdr))
    rec('PASS' if S.col('A', eq_lbl).strip().upper() == 'EQUIPMENT AND LABOR' else 'WARN',
        'Equipment heading reads "EQUIPMENT AND LABOR"', S.col('A', eq_lbl))

    sub_name = site = ''
    if sub_lbl:
        sub = S.col('A', sub_lbl + 1).strip()
        site = S.col('C', sub_lbl + 1).strip()
        sub_name = sub.splitlines()[0].strip() if sub else ''
    rec('PASS' if sub_name and sub_name != '?' else 'FAIL', 'Subscriber block filled',
        sub_name or '(empty)')
    rec('PASS' if site and site != '?' else 'FAIL', 'Site block filled',
        site.splitlines()[0] if site else '(empty)')

    rep_row = S.row_where('E', lambda s: 'sales represent' in s.lower())
    pro_row = S.row_where('E', lambda s: s.lower().startswith('prospect'))
    rec('PASS' if rep_row and S.col('G', rep_row).strip() else 'FAIL', 'Sales representative filled',
        S.col('G', rep_row) if rep_row else '(no label)')
    rec('PASS' if pro_row and S.col('G', pro_row).strip() else 'FAIL', 'Prospect # filled',
        S.col('G', pro_row) if pro_row else '(no label)')

    # ---- registry entity-name check (advisory; OPEN-DECISIONS.md #19) ----
    reg, reg_src = registry_lookup(job, sub_name)
    if reg is None:
        rec('SKIP', 'Registry entity-name matches', reg_src)
    else:
        legal = str(reg.get('legal_name') or '').strip()
        src = str(reg.get('source') or 'registry').strip()
        asof = str(reg.get('as_of') or '').strip()
        tag = f'{reg_src}; {src}' + (f'; as_of {asof}' if asof else '')
        if registry_matches(sub_name, reg):
            rec('PASS', 'Registry entity-name matches',
                f'schedule "{sub_name}" reconciles to registry ({tag})')
        else:
            rec('WARN', 'Registry entity-name matches',
                f'schedule "{sub_name}" vs registry "{legal}" ({tag}); '
                f'rep-confirmed name governs (see DRAFTER-PRESEND-CHECKLIST A.1)')

    # ---------------- B) scope of work ----------------
    sow = ' '.join(S.col('A', r) for r in range(sow_lbl + 1, min(sow_lbl + 4, eq_lbl))).strip()
    if not sow or sow.lower().rstrip() in ('active alarm company will', 'active alarm company will '):
        rec('FAIL', 'Scope of work written', '(empty or stub)')
    else:
        for frag in CANON:
            rec('PASS' if frag in sow else 'WARN', f'SOW carries "{frag[:38]}"')
        rec('PASS' if any(f' {d} ' in sow.lower() for d in DESIGNATIONS) else 'WARN',
            'SOW designation token present', '/'.join(DESIGNATIONS))
        rec('FAIL' if re.search(r'\bproposal\b', sow, re.I) else 'PASS', 'SOW does not say "proposal"')
        for tok in ('[', ']', 'TBD'):
            rec('FAIL' if tok in sow else 'PASS', f'No "{tok}" in the SOW')
        pn = parts_in(sow)
        rec('FAIL' if pn else 'PASS', 'No part numbers in the SOW', ', '.join(pn[:4]))

    # ---------------- C) equipment block ----------------
    eq_hdr = next((r for r in qty_hdrs if r > eq_lbl), None)
    eq_end = pp_row - 1
    if not eq_hdr:
        rec('SKIP', 'Equipment line checks', 'no Qty/Description header after the EQUIPMENT heading')
        eq_items = []
    else:
        blk = range(eq_hdr + 1, eq_end + 1)
        eq_items = [r for r in blk if S.col('B', r).strip()
                    and not S.col('B', r).strip().startswith(('Site:', 'System:'))]
        sysrows = [r for r in blk if S.col('B', r).strip().startswith('System:')]
        noqty = [r for r in eq_items if S.v(f'A{r}') in (None, '')]
        rec('FAIL' if noqty else 'PASS', 'Every equipment line carries a Qty',
            ('rows ' + ','.join(map(str, noqty))) if noqty else f'{len(eq_items)} lines')
        bad = []
        for r in eq_items:
            bad += [f'B{r}:{p}' for p in parts_in(S.col('B', r))]
        rec('FAIL' if bad else 'PASS', 'No part numbers in equipment descriptions', '; '.join(bad[:4]))
        if sysrows:
            names = [S.col('B', r) for r in sysrows]
            ok = all(any(s in n for s in SYSTEMS) for n in names)
            rec('PASS' if ok else 'FAIL', 'System headers use approved names', '; '.join(names)[:80])
        else:
            rec('WARN', 'System header present', 'no "System:" line in the equipment block')

    # ---------------- D) pricing block ----------------
    f_pp = S.col('G', pp_row)
    rec('PASS' if re.match(r'^=SUM\(G\d+:G\d+\)$', f_pp.replace(' ', '')) else 'WARN',
        'Purchase Price is a SUM over the equipment rows', f_pp or '(empty)')
    price, psrc = S.resolve(f'G{pp_row}')
    rec('PASS' if price else 'FAIL', 'Purchase Price non-zero', f'{price} ({psrc})')
    dep = money(S.v(f'G{dep_row}')) if dep_row else None
    if bal_row:
        fb = S.col('G', bal_row).replace(' ', '')
        want = f'=G{pp_row}-G{dep_row}' if dep_row else ''
        rec('PASS' if fb == want else 'WARN', 'Balance = Purchase Price less Deposit',
            f'{fb or "(empty)"} expected {want}')
    else:
        rec('SKIP', 'Balance line', 'no "Balance due" label found')

    # ---------------- E) services block ----------------
    svc_hdr = next((r for r in qty_hdrs if svc_lbl and r > svc_lbl), None)
    if svc_hdr and mt_row:
        blk = range(svc_hdr + 1, mt_row)
        svc_items = [r for r in blk if S.col('B', r).strip()
                     and not S.col('B', r).strip().startswith(('Site:', 'System:'))
                     and S.col('B', r).strip() not in SVC_GROUPS]
        f_mt = S.col('G', mt_row).replace(' ', '')
        rec('PASS' if re.match(r'^=SUM\(G\d+:G\d+\)$', f_mt) else 'WARN',
            'Monthly Total is a SUM', f_mt or '(empty)')
        if svc_items:
            # a continuation line describing a replaced service carries no qty by design
            priced = [r for r in svc_items if money(S.v(f'G{r}')) is not None]
            noqty = [r for r in priced if S.v(f'A{r}') in (None, '')]
            rec('FAIL' if noqty else 'PASS', 'Every priced service line carries a Qty',
                ('rows ' + ','.join(map(str, noqty))) if noqty else f'{len(priced)} priced lines')
            mt, msrc = S.resolve(f'G{mt_row}')
            tot = sum(money(S.v(f'G{r}')) or 0 for r in priced)
            rec('PASS' if mt is not None and abs(mt - tot) < 0.01 else 'FAIL',
                'Monthly Total equals the service lines', f'{mt} ({msrc}) vs {tot}')
        else:
            na = any('n/a' in S.col('B', r).strip().lower() for r in blk)
            rec('PASS' if na else 'FAIL', 'No-RMR services section reads N/A rather than blank')
    else:
        rec('SKIP', 'Services block checks', 'no SERVICES header or Monthly Total label')

    # ---------------- F) clarifications and exclusions ----------------
    clar, excl, cell = S.clarifications()
    if not clar:
        rec('SKIP', 'Clarifications block', 'not located')
    else:
        nc, ne = clar.count('•'), excl.count('•')
        rec('PASS' if CLAR_RANGE[0] <= nc <= CLAR_RANGE[1] else 'WARN',
            f'Clarification count within {CLAR_RANGE[0]}-{CLAR_RANGE[1]}', f'{nc} (cell {cell})')
        if excl:
            rec('PASS' if EXCL_RANGE[0] <= ne <= EXCL_RANGE[1] else 'WARN',
                f'Exclusion count within {EXCL_RANGE[0]}-{EXCL_RANGE[1]}', str(ne))
        else:
            rec('WARN', 'Exclusions section present', 'no "Exclusions" header in the block')
        body = clar + excl
        rec('PASS' if 'Pricing is valid for 30 days' in body else 'FAIL',
            'Validity bullet opens "Pricing is valid for 30 days"',
            'found "Quotation is valid"' if 'Quotation is valid' in body else '')
        for tok in ('[', ']', 'TBD'):
            rec('FAIL' if tok in body else 'PASS', f'No "{tok}" in clarifications or exclusions')
        rec('FAIL' if re.search(r'\bproposal\b', body, re.I) else 'PASS',
            'Clarifications do not say "proposal"')
        bad = [b for b in excl.split('•') if 'permit' in b.lower()
               and not re.search(r'permit fee|fees,|fees and|fees assessed', b.lower())]
        rec('FAIL' if bad else 'PASS', 'No exclusion excludes permit procurement',
            bad[0].strip()[:70] if bad else '')
        rec('PASS' if 'procure the permits' in body else 'WARN',
            'Permit procurement clarification present')
        if price:
            has = '50% deposit' in body or '50 % deposit' in body
            if price > DEPOSIT_THRESHOLD:
                rec('PASS' if has else 'FAIL',
                    f'Deposit bullet present (price over ${DEPOSIT_THRESHOLD:,.0f})')
                want = round(price * DEPOSIT_RATE, 2)
                rec('PASS' if dep and abs(dep - want) < 0.01 else 'WARN',
                    'Deposit amount is 50% of Purchase Price', f'{dep} vs expected {want}')
            else:
                rec('PASS' if not has else 'FAIL',
                    f'No deposit bullet (price at or under ${DEPOSIT_THRESHOLD:,.0f})')

    # ---------------- G) proposal reconciliation ----------------
    props = find_files(job, ['*Proposal*.pdf'], exclude=['Old'])
    if not props:
        rec('SKIP', 'Purchase Price equals the proposal total', 'no proposal PDF in folder')
    else:
        pt = pdf_text(props[0])
        totals = [float(x.replace(',', '')) for x in
                  re.findall(r'Total\s+(?:Investment|Price)[^\d$]{0,12}\$?([\d,]+\.?\d*)', pt)]
        totals = sorted(set(totals))
        pname = os.path.basename(props[0])
        if not totals:
            rec('SKIP', 'Purchase Price equals the proposal total', f'no total found in {pname}')
        elif len(totals) > 1:
            hit = any(price and abs(price - t) < 0.01 for t in totals)
            rec('PASS' if hit else 'WARN', 'Purchase Price reconciles to the proposal',
                f'proposal carries {len(totals)} totals ' +
                ', '.join(f'{t:,.2f}' for t in totals) +
                f'; schedule {price:,.2f}' if price else 'no schedule price')
        else:
            pv = totals[0]
            rec('PASS' if price and abs(price - pv) < 0.01 else 'FAIL',
                'Purchase Price equals the proposal total',
                f'schedule {price} vs proposal {pv} ({pname})')

    # ---------------- H) master agreement and rider ----------------
    masters = find_files(job, ['*Master Agreement*.pdf', '*All in One*.pdf', '*Agreements*.pdf'],
                         exclude=['Old', 'Rider', 'LEASE AGREEMENT'])
    riders = find_files(job, ['*Rider*.pdf'], exclude=['Old'])
    if not masters:
        rec('SKIP', 'Master agreement checks', 'no master agreement PDF in folder')
        mterm = None
    else:
        mf = pdf_fields(masters[0])
        known_fire = any(k.startswith('.Text') for k in mf) and any(k.startswith('.CheckBox') for k in mf)
        if mf and not known_fire:
            rec('SKIP', 'Master agreement field checks',
                f'{os.path.basename(masters[0])} is not the mapped Commercial Fire form '
                f'({len(mf)} fields); residential and commercial security forms use a different map')
            mf = {}
            mterm = None
        if not mf:
            rec('SKIP', 'Master agreement checks',
                f'{os.path.basename(masters[0])} has no form fields (flattened or signed)')
            mterm = None
        else:
            mtext = ' '.join(str(v) for v in mf.values())
            mname = next((str(v).strip() for k, v in mf.items() if k.endswith('Text2')), '')
            rec('PASS' if mname and sub_name and mname.lower() == sub_name.lower() else 'FAIL',
                'Master Subscriber name matches the schedule',
                f'master "{mname}" vs schedule "{sub_name}"')
            mterm = next((str(v).strip() for k, v in mf.items() if k.endswith('Text16')), '')
            rec('PASS' if mterm and re.search(r'\d', mterm) else 'FAIL',
                'Master term filled', mterm or '(empty)')
            billing = [k for k in mf if re.search(r'CheckBox[5-8]$', k)
                       and str(mf[k]) not in ('', '/Off')]
            rec('PASS' if len(billing) == 1 else 'FAIL',
                'Exactly one billing frequency ticked', ', '.join(billing) or 'none')
            foreign = set()
            for v in mf.values():
                for mm in ENTITY.finditer(str(v)):
                    nm = mm.group(0).strip()
                    if sub_name and nm.lower() in sub_name.lower(): continue
                    if 'Active Alarm' in nm: continue
                    foreign.add(nm)
            rec('FAIL' if foreign else 'PASS', 'No other customer name in the master fields',
                '; '.join(sorted(foreign)[:3]))
            tbd = [k for k, v in mf.items() if re.search(r'\bTBD\b', str(v))]
            rec('WARN' if tbd else 'PASS', 'No "TBD" outside the two date fields',
                ', '.join(tbd[:5]) + '  (TBD is acceptable only in approximate start and '
                'substantial-completion dates)' if tbd else '')
    if riders and masters:
        rf = pdf_fields(riders[0])
        if rf:
            rname = next((str(v).strip() for k, v in rf.items()
                          if k.lower().startswith('text1')), '')
            rterm = next((str(v).strip() for k, v in rf.items()
                          if k.lower().startswith('text3')), '')
            rec('PASS' if rname and sub_name and rname.lower() == sub_name.lower() else 'FAIL',
                'Rider Subscriber name matches the schedule', f'rider "{rname}"')
            if mterm is None:
                rec('SKIP', 'Rider term equals master term',
                    'master term unknown (form not mapped); rider says ' + (rterm or '(empty)'))
            else:
                a = re.search(r'\d+', mterm or ''); b = re.search(r'\d+', rterm)
                rec('PASS' if a and b and a.group(0) == b.group(0) else 'FAIL',
                    'Rider term equals master term', f'master "{mterm}" vs rider "{rterm}"')
    elif masters:
        rec('SKIP', 'Rider checks', 'no rider PDF in folder')

    # ---------------- I) filename ----------------
    fn = os.path.basename(sched)
    sysnames = [s for s in SYSTEMS if any(s in S.col('B', r) for r in range(1, S.maxr + 1))]
    if sysnames:
        miss = [s for s in sysnames if s.split()[0].lower() not in fn.lower()]
        rec('PASS' if not miss else 'WARN', 'Filename names every system sold',
            ('missing ' + ', '.join(miss)) if miss else ', '.join(sysnames))


def sweep(root, jobs=16):
    import subprocess, time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    me = os.path.abspath(__file__)
    dirs = [d for d in sorted(os.listdir(root))
            if os.path.isdir(os.path.join(root, d))
            and not d.startswith('_') and not d.startswith('.')]

    def one(d):
        try:
            r = subprocess.run([sys.executable, me, os.path.join(root, d), '--quiet'],
                               capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return (d, 'timeout', '')
        if r.returncode == 3:
            return (d, None, '')
        m = re.search(r'(\d+) pass, (\d+) fail, (\d+) warn', r.stdout)
        if not m:
            return (d, '', '')
        pa, fa, wa = map(int, m.groups())
        if fa or wa:
            detail = '; '.join(l.strip() for l in r.stdout.splitlines()
                               if l.startswith('   ') and l.strip())[:110]
            return (d, f'{fa} fail, {wa} warn', detail)
        return (d, 'clean', '')

    t0 = time.time()
    results, done = {}, 0
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futs = {pool.submit(one, d): d for d in dirs}
        for fut in as_completed(futs):
            d, res, detail = fut.result()
            results[d] = (res, detail)
            done += 1
            if done % 25 == 0 or done == len(dirs):
                sys.stderr.write(f'  {done}/{len(dirs)} folders, '
                                 f'{time.time() - t0:.0f}s\n')

    rows, clean, na = [], [], 0
    for d in dirs:
        res, detail = results[d]
        if res is None:
            na += 1
        elif res == 'clean':
            clean.append(d)
        elif res:
            rows.append((d, res, detail))
    print(f'{len(rows)} drafted packages with findings; {len(clean)} clean; '
          f'{na} folders with no drafted schedule\n')
    for d, res, detail in rows:
        print(f'{d[:64]:<64} {res}')
        if detail:
            print(f'    {detail}')
    if clean:
        print('\nClean packages (0 fail, 0 warn):')
        for d in clean:
            print(f'  {d}')
    sys.exit(0)


def main():
    jobs = 16
    argv = list(sys.argv[1:])
    for i, a in enumerate(argv):
        if a.startswith('--jobs'):
            val = a.split('=', 1)[1] if '=' in a else (
                argv[i + 1] if i + 1 < len(argv) else '')
            try:
                jobs = max(1, int(val))
            except ValueError:
                raise SystemExit('--jobs needs a number, e.g. --jobs 32')
            if '=' not in a:
                argv[i + 1] = '--consumed'
            break
    args = [a for a in argv if not a.startswith('--') and a != '--consumed']
    if '--sweep' in sys.argv:
        if not args:
            raise SystemExit('--sweep needs the jobs root, e.g. --sweep "P:\\Jobs"')
        sweep(args[0], jobs=jobs)
    quiet = '--quiet' in sys.argv
    if not args:
        print(__doc__); sys.exit(2)
    job = args[0]
    if not os.path.isdir(job):
        print('not a folder:', job); sys.exit(2)
    print('=' * 78)
    print('PACKAGE VERIFICATION —', os.path.basename(job.rstrip('\\/')))
    print('=' * 78)
    try:
        verify(job)
    except Exception as e:
        rec('FAIL', 'Verifier ran to completion', f'{type(e).__name__}: {e}')
    for st in ('FAIL', 'WARN', 'SKIP', 'N/A', 'PASS'):
        if quiet and st in ('PASS', 'SKIP'):
            continue
        rows = [r for r in results if r[0] == st]
        if not rows: continue
        print(f'\n{st}  ({len(rows)})')
        for _, item, detail in rows:
            print(f'   {item}' + (f'  —  {detail}' if detail else ''))
    n = {st: sum(1 for r in results if r[0] == st)
         for st in ('PASS', 'FAIL', 'WARN', 'SKIP', 'N/A')}
    print('\n' + '-' * 78)
    print(f"{n['PASS']} pass, {n['FAIL']} fail, {n['WARN']} warn, {n['SKIP']} skipped")
    print("Formula values are recomputed from their ranges, not read from Excel's cache.")
    print('Still human: designation, conditional clarification selection, section 0 merges,')
    print('legal-entity verification, print layout.')
    sys.exit(3 if n['N/A'] and not n['PASS'] else (1 if n['FAIL'] else 0))


if __name__ == '__main__':
    main()
