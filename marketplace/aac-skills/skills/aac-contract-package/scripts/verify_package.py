"""Machine-checkable half of DRAFTER-PRESEND-CHECKLIST.md, bundled with the
AAC contract package skill.

Usage:  python verify_package.py "<job folder>" [--quiet]
Exit:   0 = no FAILs, 1 = at least one FAIL, 2 = bad input,
        3 = no drafted schedule in the folder.

Reads only. Never writes to the job folder and never saves a workbook.

Every check reports PASS, FAIL, WARN or SKIP. SKIP means the input the check
needed was not found; it is never silently treated as a pass.

Anchors are located by searching for their labels, not by fixed row numbers.
Rows get inserted and deleted per job, so a fixed cell map only works on a
freshly built schedule and produces false failures on everything else.

Formula values are recomputed from their ranges rather than read from Excel's
cache, because a cached value is stale until Excel reopens the file.

Covers the mechanical items only. Designation, which conditional clarifications
a job earns, BASELINES section 0 merges and print layout stay human. The
registry entity-name check (section A') is advisory: it WARNs on a mismatch and
the rep-confirmed name governs (OPEN-DECISIONS item 19). The Zoho
cross-checks (zoho_crosscheck.py) are advisory too: WARN or PASS, SKIP without
a credential.
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
# Elevator Monitoring Agreement field shape (issue 335): 15 text fields,
# no leading dot (unlike the Fire form's widgets), no checkboxes. Used to
# tell this form apart from the Fire master and from an unmapped form.
ELEVATOR_MASTER_FIELDS = {f'Text{i}' for i in range(1, 16)}

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

_DATE_FORMATS = ('%m/%d/%Y', '%m/%d/%y', '%m-%d-%Y', '%Y-%m-%d',
                 '%B %d, %Y', '%b %d, %Y', '%B %d %Y', '%b %d %Y')

def parse_date(v):
    """A date from a cell value or a form-field string; None when it is not one."""
    import datetime as _dt
    if isinstance(v, _dt.datetime): return v.date()
    if isinstance(v, _dt.date): return v
    t = re.sub(r'\s+', ' ', str(v or '')).strip()
    for fmt in _DATE_FORMATS:
        try: return _dt.datetime.strptime(t, fmt).date()
        except ValueError: pass
    return None

def schedule_date(S, end_row):
    """(date, where) for the schedule header's Date cell: column G on the
    first column-E 'Date' label above end_row. The template ships that cell
    as =TODAY(), which shows the day the schedule is opened, so it reads as
    today; a literal date reads as itself. (None, reason) otherwise."""
    import datetime as _dt
    r = S.row_where('E', lambda x: x.rstrip(':').strip().lower() == 'date', end=end_row)
    if not r:
        return None, 'no Date label in the schedule header'
    raw = S.ws[f'G{r}'].value
    if isinstance(raw, str) and re.fullmatch(r'=\s*TODAY\(\s*\)', raw.strip(), re.I):
        return _dt.date.today(), f'G{r} =TODAY()'
    d = parse_date(raw) or parse_date(S.v(f'G{r}'))
    return (d, f'G{r}') if d else (None, f'G{r} holds no date')

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

# Drafted-schedule name patterns. '*Svc Schedule.xlsx' catches the Sales Admin
# form '<customer>_<site> - <systems> Svc Schedule.xlsx', which carries no
# "Equip &" token (issue 302).
SCHED_PATTERNS = ['*Equip & Svc Schedule*.xlsx', '*Equip & Services*.xlsx',
                  '*Equip & Svc*.xlsx', '*Equip*Sv*Schedule*.xlsx',
                  '*Service Schedule*.xlsx', '*Svc Schedule.xlsx']

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

# Section H recognizes exactly the master forms build_package.py fills:
# Commercial Fire, Commercial Security (issue 336) and Residential Security
# (issue 337) share the name/term/billing checks through MASTER_FORM_SPECS;
# the Elevator Monitoring Agreement (issue 335) has its own checks keyed on
# ELEVATOR_MASTER_FIELDS. Any other master has no field map and SKIPs, per
# docs/verifier-coverage.md. Detection is an exact
# field-name signature — each form's field dump is fixed, so this never
# mistakes one for another — not the field-count heuristic this replaced.
MASTER_FORM_SPECS = {
    'fire': {'name_key': 'Text2', 'term_key': 'Text16',
             'billing_re': re.compile(r'CheckBox[5-8]$'),
             'billing_names': {5: 'Monthly', 6: 'Quarter Annually',
                               7: 'Semi-Annually', 8: 'Annually'}},
    'security': {'name_key': 'Text2', 'term_key': 'Text25',
                 'billing_re': re.compile(r'CheckBox(1[1-4])$'),
                 'billing_names': {11: 'Monthly', 12: 'Quarter Annually',
                                   13: 'Semi-Annually', 14: 'Annually'}},
    # Residential Security (issue 337): term is Text22 and the four billing
    # options sit at CheckBox11/12/13/14.
    'residential': {'name_key': 'Text2', 'term_key': 'Text22',
                    'billing_re': re.compile(r'CheckBox(1[1-4])$'),
                    'billing_names': {11: 'Monthly', 12: 'Quarter Annually',
                                      13: 'Semi-Annually', 14: 'Annually'}},
}


def _master_form_kind(mf):
    """'fire', 'security', 'residential', 'elevator', or None for a master
    field dump this verifier does not have a map for."""
    if not mf:
        return None
    if set(mf) == ELEVATOR_MASTER_FIELDS:
        return 'elevator'
    if '.Text2' in mf and '.CheckBox17' in mf:
        return 'fire'
    if 'Text2' in mf and 'CheckBox40' in mf:
        return 'security'
    # Residential master fingerprint (issue 337): field names carry no
    # leading dot (unlike Fire), and 'Text1444' / 'CheckBox34' are two field
    # names unique to this form's own layout (the "Other (Describe):"
    # free-text box and the IN LIEU OF checkbox).
    if 'Text1444' in mf and 'CheckBox34' in mf:
        return 'residential'
    return None

# Poppler pdftotext (bundled with poppler-utils on Linux and poppler-windows
# on Windows) is a runtime prerequisite for the proposal-reconciliation and
# other PDF-text checks below. When it is missing on PATH, subprocess.run
# raises FileNotFoundError from execvp — we swallow that so verify does not
# crash on an incomplete environment, but we surface a WARN (once per run)
# so a degraded verify does not read as clean. Aligned with
# extract_package.extract_pdf (issue 180).
_pdftotext_missing_warned = False


def _warn_pdftotext_missing():
    global _pdftotext_missing_warned
    if _pdftotext_missing_warned:
        return
    _pdftotext_missing_warned = True
    rec('WARN', 'pdftotext binary on PATH',
        'poppler pdftotext not on PATH — proposal reconciliation and other '
        'PDF-text checks degraded (install poppler-utils on Linux / '
        'poppler-windows on Windows)')


def pdf_text(path):
    import subprocess
    try:
        return subprocess.run(['pdftotext', '-layout', path, '-'],
                              capture_output=True, text=True, timeout=60).stdout
    except FileNotFoundError:
        _warn_pdftotext_missing()
        return ''
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


# ---- cross-document reconciliation helpers (issue 219) ----
# Governing rules for section J below: skill/aac-contract-package/references/
# DRAFTER-PRESEND-CHECKLIST.md items 7, 9, 22, 23, 24, 32, 33, 35. Each
# section-J finding names the item number and that file so a reviewer can
# walk back to the wording without this code restating it (CLAUDE.md hard
# rule 1).
CHECKLIST = 'DRAFTER-PRESEND-CHECKLIST.md'


def _cite(n):
    return f'checklist item {n}, {CHECKLIST}'


# Filename substrings that mark a workbook as NOT the work-up. A schedule,
# an agreement, a proposal, and the template all live alongside the WU in
# some folders and share the .xlsx extension; the schedule tab-based
# Sheet class already handles the schedule, so the WU finder skips those.
_WU_EXCLUDE = ('template', 'equip & s', 'schedule', 'agreement',
               'proposal', 'master', 'rider', 'covered equipment', 'fsi')
_WU_INCLUDE = ('workup', 'work up', 'work-up', 'wu-', ' wu ', 'wu ',
               '- wu', 'wu.', 'fire-lite', 'fire lite')
# A job's working copy of the master WU template: '<date>-Master WU Template
# <anything> rev<N>.xlsx'. The rev suffix separates it from the pristine
# template, which carries none (issue 302).
_WU_TEMPLATE_COPY = re.compile(r'master wu template.*rev\s*\d+\.xls[xm]$')


def _find_workup(job):
    """Return WU workbook paths in the job folder, newest first.

    Reuses verify_workup.find_workup's substring heuristics but excludes
    the schedule, agreement, proposal, template and other siblings that
    would otherwise match the ``wu`` substring. Never reaches into
    ``old`` / ``archive`` / ``superseded`` / ``backup`` / hidden / dot
    directories (same SKIP_DIRS rule as find_files).
    """
    hits = []
    for dirpath, dirs, files in os.walk(job):
        dirs[:] = [d for d in dirs
                   if d.lower() not in SKIP_DIRS
                   and not d.startswith('_') and not d.startswith('.')]
        for f in files:
            if f.startswith('~$'):
                continue
            low = f.lower()
            ext = os.path.splitext(f)[1].lower()
            if ext not in ('.xlsx', '.xlsm'):
                continue
            if not _WU_TEMPLATE_COPY.search(low):
                if not any(k in low for k in _WU_INCLUDE):
                    continue
                if any(k in low for k in _WU_EXCLUDE):
                    continue
            hits.append(os.path.join(dirpath, f))
    return sorted(set(hits), key=os.path.getmtime, reverse=True)


def _read_workup(path):
    """Extract every text-and-number-bearing cell from a WU workbook.

    Returns ``(text_blob, numeric_values, labelled_totals)``:

    * ``text_blob`` — all non-numeric cell values on visible sheets, space-
      joined; used by the equipment-match check and the discount hunt.
    * ``numeric_values`` — every numeric cell across visible sheets; used
      as a fallback grand-total source when no labelled total is found.
    * ``labelled_totals`` — ``[(row_text, max_number_in_row), ...]`` for
      rows whose text contains ``total`` / ``grand`` / ``investment``.

    Reads only; never saves. Reading with openpyxl is permitted by
    CLAUDE.md hard rule 2 (only *saving* through openpyxl is disallowed).
    """
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    text_bits = []
    nums = []
    labelled = []
    total_hints = ('total', 'grand', 'investment', 'sale price', 'contract')
    for ws in wb.worksheets:
        if ws.sheet_state != 'visible':
            continue
        for row in ws.iter_rows(values_only=True):
            row_text_parts = []
            row_nums = []
            for v in row:
                if v is None:
                    continue
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    nums.append(float(v))
                    row_nums.append(float(v))
                else:
                    s = str(v).strip()
                    if s:
                        text_bits.append(s)
                        row_text_parts.append(s)
            if row_nums and row_text_parts:
                joined = ' '.join(row_text_parts).lower()
                if any(h in joined for h in total_hints):
                    labelled.append((' '.join(row_text_parts), max(row_nums)))
    return ' '.join(text_bits), nums, labelled


def _workup_grand_total(labelled, nums):
    """Return ``(value, source_label)`` or ``(None, None)``.

    Preference order: rows whose text contains ``grand total`` or ``total
    investment``, then any ``total`` row (largest value wins ties), then
    the largest numeric on the sheet (labelled ``(largest numeric)``).
    A None result means the caller should SKIP its dependent check
    (CLAUDE.md hard rule 7).
    """
    if labelled:
        for prio in ('grand total', 'total investment', 'sale price',
                     'total contract', 'contract total', 'total'):
            hits = [(t, v) for t, v in labelled if prio in t.lower()]
            if hits:
                best = max(hits, key=lambda kv: kv[1])
                return best[1], best[0][:60]
    if nums:
        return max(nums), '(largest numeric in work-up)'
    return None, None


def _outgoing_pdfs(job):
    """Return PDFs in the job folder that would ship with the package.

    Excludes the issued proposal (checklist item 32 note: read-only after
    issue), and any file whose name contains ``lease agreement`` (a lease
    that lives beside the sale package but does not ship with it). All
    other exclusions — old/superseded/backup directories, temp files —
    are already handled by find_files' SKIP_DIRS and ~$ filter.
    """
    return [p for p in find_files(job, ['*.pdf'])
            if 'proposal' not in os.path.basename(p).lower()
            and 'lease agreement' not in os.path.basename(p).lower()]


def _entity_norm(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip().strip('.,').strip().lower()


def _foreign_entities(text, sub_name, known_parties=()):
    """Extract entity-shaped names from ``text`` that are neither the
    subscriber nor Active Alarm. Case-insensitive substring check against
    the subscriber name is enough to swallow "Acme Corp" when the
    subscriber is "Acme Corporation, Inc." — the ENTITY regex fires on
    both forms.

    ``known_parties`` are other parties this schedule names on purpose (the
    installing party of a services-only schedule, issue 303); an entity that
    matches one of them is not foreign."""
    known = [k for k in (_entity_norm(p) for p in known_parties) if len(k) >= 4]
    out = set()
    for mm in ENTITY.finditer(text or ''):
        nm = mm.group(0).strip()
        if sub_name and nm.lower() in sub_name.lower():
            continue
        if 'Active Alarm' in nm:
            continue
        n = _entity_norm(nm)
        if any(n == k or n in k or k in n for k in known):
            continue
        out.add(nm)
    return out


# ---- services-only schedules (issue 303) ----
# Governing text: references/SOW-BASELINES.md §7.13 (the services-only
# template and its signals) and references/MAPPING-APPENDIX.md §3a "Repair
# Service start date" (the two-amount presentation). The strings below are
# the literal tokens the verifier searches for; the rules stay in those files.
SERVICES_ONLY_OPENER = 'will provide the recurring services listed in the Services section'
INSTALLING_PARTY = re.compile(
    r'installation agreement with\s+(.+?)(?:\.(?=\s|$)|$)', re.I | re.S)
RS_START_SUFFIX = '(begins one year from installation completion date)'
RS_TWO_AMOUNTS = re.compile(
    r'\$\s?([\d,]+(?:\.\d+)?)\s+for one year following installation completion'
    r'\s+and\s+\$\s?([\d,]+(?:\.\d+)?)\s+per month thereafter', re.I)
SERVICES_ONLY_REF = 'SOW-BASELINES.md §7.13'


def _services_only_signals(S, sow, eq_hdr, eq_lbl, pp_row, price):
    """Return ``{signal_name: bool}`` for the three services-only signals
    named in SOW-BASELINES.md §7.13: the Equipment and Labor block reads
    N/A, the Purchase Price is zero, and the SOW carries the services-only
    opener. The caller treats the schedule as services-only only when all
    three hold."""
    start = (eq_hdr or eq_lbl) + 1
    texts = [S.col('B', r).strip() for r in range(start, pp_row)]
    texts = [t for t in texts if t and not t.startswith(('Site:', 'System:'))]
    if not texts:
        texts = [S.col('A', r).strip() for r in range(start, pp_row)
                 if S.col('A', r).strip()]
    eq_na = bool(texts) and all(t.upper() == 'N/A' for t in texts)
    return {
        'equipment block reads N/A': eq_na,
        'Purchase Price is 0': price is not None and abs(price) < 0.01,
        'SOW carries the services-only opener': SERVICES_ONLY_OPENER.lower() in (sow or '').lower(),
    }


def _installing_parties(sow):
    """Names following "installation agreement with" in a services-only SOW
    (SOW-BASELINES.md §7.13)."""
    return [m.group(1).strip() for m in INSTALLING_PARTY.finditer(sow or '')
            if m.group(1).strip()]


_SUM_RE = re.compile(r'^=SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$')


def _normalize_formula(f):
    """Excel-formula normalization for SUM shape checks.

    Strips every whitespace character (space, tab, non-breaking space), drops
    the ``$`` absolute-reference marker, and uppercases so ``= sum( g14:g40 )``
    and ``=SUM($G$14:$G$40)`` collapse to the same canonical form. Anything not
    a string (formulas can be ``None``) returns ``''`` so callers can match
    without a type guard.
    """
    if not isinstance(f, str):
        return ''
    return re.sub(r'\s+', '', f).replace('$', '').upper()


def _is_sum_range(f):
    """True when ``f`` is a single ``SUM(col_a:col_b)`` over a column range,
    tolerating whitespace, absolute refs, and mixed case."""
    return _SUM_RE.match(_normalize_formula(f)) is not None


def _match_sum_range(f):
    """Return ``(col, first_row, last_row)`` for a single-column ``SUM`` range,
    or ``None`` if the formula is not that shape or spans two columns."""
    m = _SUM_RE.match(_normalize_formula(f))
    if not m:
        return None
    c1, a, c2, b = m.group(1), int(m.group(2)), m.group(3), int(m.group(4))
    if c1 != c2:
        return None
    return c1, a, b


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
            m = _match_sum_range(f)
            if m:
                c, a, b = m
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
    global _pdftotext_missing_warned
    _pdftotext_missing_warned = False
    job = job.rstrip('\\/')
    scheds = find_files(job, SCHED_PATTERNS, exclude=['Template', 'BACKUP'])
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

    # ---- Zoho cross-checks (advisory WARN/SKIP only; issue 229) ----
    # Hard rule 5: Zoho is validated against the package, never trusted, and
    # nothing read from Zoho is written anywhere. See zoho_crosscheck.py.
    try:
        import zoho_crosscheck
        mt_val = S.resolve(f'G{mt_row}')[0] if mt_row else None
        zoho_crosscheck.run(
            job, rec,
            prospect=S.col('G', pro_row).strip() if pro_row else '',
            subscriber=sub_name,
            site=site.splitlines()[0].strip() if site else '',
            monthly_total=mt_val,
            workups=_find_workup(job))
    except Exception as e:
        rec('SKIP', 'Zoho cross-checks ran', f'{type(e).__name__}: {e}')

    # ---------------- B) scope of work ----------------
    sow = ' '.join(S.col('A', r) for r in range(sow_lbl + 1, min(sow_lbl + 4, eq_lbl))).strip()

    # Services-only recognition (SOW-BASELINES.md §7.13, issue 303). All three
    # signals must hold; a partial set WARNs and the ordinary checks run.
    eq_hdr = next((r for r in qty_hdrs if r > eq_lbl), None)
    price, psrc = S.resolve(f'G{pp_row}')
    so_signals = _services_only_signals(S, sow, eq_hdr, eq_lbl, pp_row, price)
    services_only = all(so_signals.values())
    installing = _installing_parties(sow) if services_only else []
    if services_only:
        rec('PASS', 'Services-only schedule recognised',
            f'{SERVICES_ONLY_REF}; ' + ', '.join(so_signals)
            + (f'; installing party: {"; ".join(installing)}' if installing else ''))
    elif any(so_signals.values()):
        rec('WARN', 'Services-only schedule recognised',
            f'{SERVICES_ONLY_REF}; only some signals present — has: '
            + ', '.join(k for k, v in so_signals.items() if v)
            + '; lacks: ' + ', '.join(k for k, v in so_signals.items() if not v))
    so_skip = f'services-only schedule ({SERVICES_ONLY_REF}): no equipment is sold on it'

    sow_written = bool(sow) and sow.lower().rstrip() != 'active alarm company will'
    if not sow_written:
        rec('FAIL', 'Scope of work written', '(empty or stub)')
    elif services_only:
        rec('PASS' if CANON[0] in sow else 'WARN', f'SOW carries "{CANON[0][:38]}"')
        rec('PASS', 'SOW opens with the services-only opener',
            f'{SERVICES_ONLY_REF}; replaces "{CANON[1][:38]}"')
        rec('PASS', 'SOW designation token present',
            f'{SERVICES_ONLY_REF}: the services-only template carries no designation token')
    else:
        for frag in CANON:
            rec('PASS' if frag in sow else 'WARN', f'SOW carries "{frag[:38]}"')
        rec('PASS' if any(f' {d} ' in sow.lower() for d in DESIGNATIONS) else 'WARN',
            'SOW designation token present', '/'.join(DESIGNATIONS))
    if sow_written:
        rec('FAIL' if re.search(r'\bproposal\b', sow, re.I) else 'PASS', 'SOW does not say "proposal"')
        for tok in ('[', ']', 'TBD'):
            rec('FAIL' if tok in sow else 'PASS', f'No "{tok}" in the SOW')
        pn = parts_in(sow)
        rec('FAIL' if pn else 'PASS', 'No part numbers in the SOW', ', '.join(pn[:4]))

    # ---------------- C) equipment block ----------------
    eq_end = pp_row - 1
    if services_only:
        rec('PASS', 'Equipment and Labor section reads N/A', SERVICES_ONLY_REF)
        rec('SKIP', 'Equipment line checks', so_skip)
        eq_items = []
    elif not eq_hdr:
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
    pp_match = _match_sum_range(f_pp)
    rec('PASS' if pp_match and pp_match[0] == 'G' else 'WARN',
        'Purchase Price is a SUM over the equipment rows', f_pp or '(empty)')
    if services_only:
        rec('SKIP', 'Purchase Price non-zero', f'{so_skip}; Purchase Price {price} ({psrc})')
    else:
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
    svc_items = []  # section J below inspects this; keep the name in scope
    if svc_hdr and mt_row:
        blk = range(svc_hdr + 1, mt_row)
        svc_items = [r for r in blk if S.col('B', r).strip()
                     and not S.col('B', r).strip().startswith(('Site:', 'System:'))
                     and S.col('B', r).strip() not in SVC_GROUPS]
        f_mt = S.col('G', mt_row)
        mt_match = _match_sum_range(f_mt)
        rec('PASS' if mt_match and mt_match[0] == 'G' else 'WARN',
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

    # ---- Repair Service two-amount presentation (MAPPING-APPENDIX.md §3a) ----
    # Checked on services-only schedules (issue 303); how it applies to other
    # schedules is left to the ordinary review.
    if services_only:
        item = 'Repair Service two-amount presentation (MAPPING-APPENDIX.md §3a)'
        rs_rows = [r for r in svc_items if 'repair service' in S.col('B', r).lower()]
        if not rs_rows:
            rec('SKIP', item, 'no Repair Service line in the Services section')
        else:
            probs = [f'B{r} does not end "{RS_START_SUFFIX}"' for r in rs_rows
                     if not S.col('B', r).strip().endswith(RS_START_SUFFIX)]
            mt, _ = S.resolve(f'G{mt_row}') if mt_row else (None, '')
            m = RS_TWO_AMOUNTS.search(sow or '')
            if not m:
                probs.append('SOW does not state both monthly amounts')
            else:
                first, second = money(m.group(1)), money(m.group(2))
                if mt is None or abs(second - mt) >= 0.01:
                    probs.append(f'SOW second amount {second:,.2f} vs Monthly Total '
                                 f'{mt if mt is None else f"{mt:,.2f}"}')
            if probs:
                rec('FAIL', item, '; '.join(probs))
            else:
                rec('PASS', item,
                    f'{len(rs_rows)} Repair Service line(s) carry the start-date suffix; '
                    f'SOW states {first:,.2f} then {second:,.2f} = Monthly Total')

    # ---------------- F) clarifications and exclusions ----------------
    clar, excl, cell = S.clarifications()
    so_clar = (f'services-only schedule ({SERVICES_ONLY_REF} sets which bullets it keeps; '
               f'no count range is ratified for it)')
    if not clar:
        rec('SKIP', 'Clarifications block', 'not located')
    else:
        nc, ne = clar.count('•'), excl.count('•')
        if services_only:
            rec('SKIP', f'Clarification count within {CLAR_RANGE[0]}-{CLAR_RANGE[1]}',
                f'{so_clar}; {nc} (cell {cell})')
        else:
            rec('PASS' if CLAR_RANGE[0] <= nc <= CLAR_RANGE[1] else 'WARN',
                f'Clarification count within {CLAR_RANGE[0]}-{CLAR_RANGE[1]}', f'{nc} (cell {cell})')
        if excl and services_only:
            rec('SKIP', f'Exclusion count within {EXCL_RANGE[0]}-{EXCL_RANGE[1]}',
                f'{so_clar}; {ne}')
        elif excl:
            rec('PASS' if EXCL_RANGE[0] <= ne <= EXCL_RANGE[1] else 'WARN',
                f'Exclusion count within {EXCL_RANGE[0]}-{EXCL_RANGE[1]}', str(ne))
        else:
            rec('WARN', 'Exclusions section present', 'no "Exclusions" header in the block')
        if excl:
            # SCHEDULE-GENERATION-PROCEDURE §11a: one blank line between the
            # Clarifications block and the bold Exclusions header. The builder
            # writes it; a hand edit of run 1 drops it (Z-4260, 2026-09-22).
            tail = clar.replace('\r\n', '\n').rstrip(' \t')
            blank = tail.endswith('\n\n')
            rec('PASS' if blank else 'WARN', 'Blank line before the Exclusions header',
                '' if blank else 'the Clarifications run ends without an empty line')
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
        if services_only:
            rec('SKIP', 'Permit procurement clarification present',
                f'services-only schedule ({SERVICES_ONLY_REF}): installation bullets come out')
        else:
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
    if services_only:
        rec('SKIP', 'Purchase Price equals the proposal total',
            f'{so_skip}; any installation proposal belongs to the installing '
            f'party\'s deal')
    elif not props:
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
    masters = find_files(job, ['*Master Agreement*.pdf', '*All in One*.pdf', '*Agreements*.pdf',
                              '*Elevator Monitoring Agreement*.pdf'],
                         exclude=['Old', 'Rider', 'LEASE AGREEMENT'])
    riders = find_files(job, ['*Rider*.pdf'], exclude=['Old'])
    kind = None
    if not masters:
        rec('SKIP', 'Master agreement checks', 'no master agreement PDF in folder')
        mterm = None
        mf = {}
    else:
        mf = pdf_fields(masters[0])
        kind = _master_form_kind(mf)
        if mf and kind is None:
            rec('SKIP', 'Master agreement field checks',
                f'{os.path.basename(masters[0])} is not a mapped form '
                f'({len(mf)} fields); no field map for this form')
            mf = {}
            mterm = None
        if not mf:
            rec('SKIP', 'Master agreement checks',
                f'{os.path.basename(masters[0])} has no form fields (flattened or signed)')
            mterm = None
        elif kind == 'elevator':
            # Elevator Monitoring Agreement (issue 335): 15 text fields, no
            # checkboxes, term fixed in §5 clause text rather than a field.
            mname = str(mf.get('Text3') or '').strip()
            rec('PASS' if mname and sub_name and mname.lower() == sub_name.lower() else 'FAIL',
                'Elevator Monitoring Agreement Subscriber name matches the schedule',
                f'master "{mname}" vs schedule "{sub_name}"'
                ' — DRAFTER-PRESEND-CHECKLIST.md item 3')
            # Filled and equal to the schedule date; reconciling a mismatch is
            # the human's (DRAFTER-PRESEND-CHECKLIST.md item 5).
            mdate_raw = str(mf.get('Text1') or '').strip()
            mdate = parse_date(mdate_raw)
            sdate, how = schedule_date(S, sow_lbl)
            rec('PASS' if mdate and sdate and mdate == sdate else 'FAIL',
                'Elevator Monitoring Agreement date matches the schedule date',
                f'master "{mdate_raw or "(empty)"}"'
                + (' (not a date)' if mdate_raw and not mdate else '')
                + f' vs schedule {sdate.isoformat() if sdate else "(none)"} ({how})'
                ' — DRAFTER-PRESEND-CHECKLIST.md item 5')
            mamt = money(mf.get('Text14'))
            sched_mt = S.resolve(f'G{mt_row}')[0] if mt_row else None
            rec('PASS' if (mamt is not None and sched_mt is not None
                          and abs(mamt - sched_mt) < 0.01) else 'FAIL',
                'Elevator Monitoring Agreement monthly amount matches the schedule',
                f'master {mamt if mamt is not None else "(empty)"} vs schedule '
                f'Monthly Total {sched_mt if sched_mt is not None else "(empty)"}'
                ' — DRAFTER-PRESEND-CHECKLIST.md item 11; MAPPING-APPENDIX.md §3')
            mterm = None
        else:
            spec = MASTER_FORM_SPECS[kind]
            mtext = ' '.join(str(v) for v in mf.values())
            mname = next((str(v).strip() for k, v in mf.items()
                          if k.endswith(spec['name_key'])), '')
            rec('PASS' if mname and sub_name and mname.lower() == sub_name.lower() else 'FAIL',
                'Master Subscriber name matches the schedule',
                f'master "{mname}" vs schedule "{sub_name}"')
            mterm = next((str(v).strip() for k, v in mf.items()
                          if k.endswith(spec['term_key'])), '')
            rec('PASS' if mterm and re.search(r'\d', mterm) else 'FAIL',
                'Master term filled', mterm or '(empty)')
            billing = [k for k in mf if spec['billing_re'].search(k)
                       and str(mf[k]) not in ('', '/Off')]
            rec('PASS' if len(billing) == 1 else 'FAIL',
                'Exactly one billing frequency ticked', ', '.join(billing) or 'none')
            if kind == 'residential':
                # Residential (d) Service paragraph: CONTRACT-PACKAGE-RULES.md
                # §2.7 "Service is always checked on all agreements" — exactly
                # one of (d)(i) per-call or (d)(ii) monthly must be ticked.
                service = [k for k in mf if re.search(r'CheckBox(29|30)$', k)
                          and str(mf[k]) not in ('', '/Off')]
                rec('PASS' if len(service) == 1 else 'FAIL',
                    'Exactly one Service option ticked', ', '.join(service) or 'none')
                mdate = str(mf.get('Text1', '') or '').strip()
                # Purchase Price / Down Payment / Balance are direct form
                # fields on this master (Text6/7/8), unlike the Fire form's
                # delegation to the attached schedule — read the field
                # values themselves rather than pdftotext's rendering (J-7
                # above SKIPs on this form for exactly that reason: the
                # label and the typed value do not land within its 25-char
                # window in the extracted text layer).
                def _num(s):
                    try:
                        return float(str(s).replace(',', ''))
                    except (TypeError, ValueError):
                        return None
                mp, mdp, mbal = (_num(mf.get('Text6')), _num(mf.get('Text7')),
                                _num(mf.get('Text8')))
                if price is None or dep is None:
                    rec('SKIP', 'Master price fields match the schedule',
                        'schedule Purchase Price or Deposit unresolved')
                else:
                    want_bal = price - dep
                    ok = (mp is not None and abs(mp - price) < 0.01
                         and mdp is not None and abs(mdp - dep) < 0.01
                         and mbal is not None and abs(mbal - want_bal) < 0.01)
                    rec('PASS' if ok else 'FAIL',
                        'Master price fields match the schedule',
                        f'master Purchase Price {mf.get("Text6")!r}, Down Payment '
                        f'{mf.get("Text7")!r}, Balance {mf.get("Text8")!r} vs schedule '
                        f'price {price}, deposit {dep}')
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

            # Commercial Security carries fields the Fire form does not:
            # an execution date and its own §2/§4(b) service-box pair.
            if kind == 'security':
                mdate = next((str(v).strip() for k, v in mf.items()
                              if k.endswith('Text1')), '')
                rec('PASS' if re.search(r'\d{1,2}/\d{1,2}/\d{2,4}', mdate) else 'FAIL',
                    'Master agreement date filled', mdate or '(empty)')
                service_on = str(mf.get('CheckBox2', '')) not in ('', '/Off')
                percall_on = str(mf.get('CheckBox17', '')) not in ('', '/Off')
                monthly_on = str(mf.get('CheckBox18', '')) not in ('', '/Off')
                rec('PASS' if service_on and (percall_on != monthly_on) else 'FAIL',
                    'Service boxes: Service checked, exactly one of per-call/contracted ticked',
                    f'Service={service_on}, per-call={percall_on}, contracted={monthly_on}')
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
            if kind == 'residential':
                # DRAFTER-PRESEND-CHECKLIST.md item 14: "Rider: subscriber
                # name and agreement date match the master." Both forms
                # leave this field blank until signing (CLAUDE.md hard rule
                # 4 permits TBD only in the schedule-date fields, not here),
                # so two blanks are as much a match as two identical dates.
                rdate = next((str(v).strip() for k, v in rf.items()
                             if k.lower().startswith('text2')), '')
                rec('PASS' if mdate == rdate else 'FAIL',
                    'Rider agreement date matches the master',
                    f'master "{mdate}" vs rider "{rdate}"')
    elif masters:
        rec('SKIP', 'Rider checks', 'no rider PDF in folder')

    # ---------------- J) cross-document reconciliation (issue 219) ----------------
    # Eight checks the drafter used to run by eye. Each cites its checklist item
    # number and the governing file (DRAFTER-PRESEND-CHECKLIST.md) in the
    # finding's detail; wording of every rule stays in the reference — hard
    # rule 1. A check whose input is missing SKIPs with a reason instead of
    # inventing an answer (hard rule 7).

    wus = _find_workup(job)
    wu_text = ''
    wu_total = None
    wu_source = None
    if wus:
        try:
            wu_text, wu_nums, wu_labelled = _read_workup(wus[0])
            wu_total, wu_source = _workup_grand_total(wu_labelled, wu_nums)
        except Exception as e:
            rec('WARN', 'Work-up readable',
                f'{os.path.basename(wus[0])}: {type(e).__name__}: {e}')
            wu_text = ''
            wu_total = None

    # J-22: Schedule Purchase Price equals the work-up total.
    if services_only:
        rec('SKIP', 'Schedule Purchase Price equals the work-up total',
            f'{_cite(22)}; {so_skip}')
    elif not wus:
        rec('SKIP', 'Schedule Purchase Price equals the work-up total',
            f'{_cite(22)}; no work-up workbook in the folder')
    elif wu_total is None:
        rec('SKIP', 'Schedule Purchase Price equals the work-up total',
            f'{_cite(22)}; no total figure found in '
            f'{os.path.basename(wus[0])}')
    elif price is None:
        rec('SKIP', 'Schedule Purchase Price equals the work-up total',
            f'{_cite(22)}; schedule Purchase Price could not be resolved')
    else:
        ok = abs(price - wu_total) < 0.01
        rec('PASS' if ok else 'FAIL',
            'Schedule Purchase Price equals the work-up total',
            f'{_cite(22)}; schedule {price:,.2f} vs work-up {wu_total:,.2f} '
            f'({wu_source})')

    # J-24: Every schedule equipment line has a matching work-up cost.
    if not wus:
        rec('SKIP', 'Every schedule equipment line has a matching work-up cost',
            f'{_cite(24)}; no work-up workbook in the folder')
    elif not eq_items:
        rec('SKIP', 'Every schedule equipment line has a matching work-up cost',
            f'{_cite(24)}; no equipment lines to check')
    else:
        wu_lower = (wu_text or '').lower()
        missing = []
        for r in eq_items:
            desc = S.col('B', r).strip()
            if not desc:
                continue
            # Words 4+ chars long serve as a low-false-positive fingerprint;
            # the WU description rarely reproduces the schedule wording
            # verbatim but shares at least the first two content words.
            words = [w for w in re.findall(r"[A-Za-z][A-Za-z']+", desc)
                     if len(w) >= 4]
            if not words:
                continue
            key = ' '.join(words[:2]).lower()
            if key not in wu_lower:
                missing.append(f'B{r}: "{desc[:50]}"')
        if missing:
            rec('FAIL', 'Every schedule equipment line has a matching work-up cost',
                f'{_cite(24)}; work-up carries no matching cost for '
                + '; '.join(missing[:3])
                + (f' (+{len(missing) - 3} more)' if len(missing) > 3 else ''))
        else:
            rec('PASS',
                'Every schedule equipment line has a matching work-up cost',
                f'{_cite(24)}; {len(eq_items)} equipment lines matched')

    # J-23: Discount appears exactly once across work-up, schedule, master.
    # A discount taken on two of the three under-prices the job — the
    # checklist's specific concern behind item 23.
    sched_text_parts = []
    for r in range(1, S.maxr + 1):
        for cc in 'ABCDEFG':
            vv = S.t(f'{cc}{r}')
            if vv:
                sched_text_parts.append(vv)
    sched_all_text = ' '.join(sched_text_parts)
    master_field_text = ''
    if masters and mf:
        master_field_text = ' '.join(str(v) for v in mf.values() if v is not None)

    disc_pat = re.compile(r'\bdiscount', re.I)
    disc_sources = []
    if wu_text and disc_pat.search(wu_text):
        disc_sources.append('work-up')
    if disc_pat.search(sched_all_text):
        disc_sources.append('schedule')
    if master_field_text and disc_pat.search(master_field_text):
        disc_sources.append('master')

    if len(disc_sources) <= 1:
        rec('PASS',
            'Discount appears exactly once across work-up, schedule and master',
            f'{_cite(23)}; ' +
            (f'discount recorded in: {disc_sources[0]}' if disc_sources
             else 'no discount in any document'))
    else:
        rec('FAIL',
            'Discount appears exactly once across work-up, schedule and master',
            f'{_cite(23)}; discount recorded in multiple documents: '
            + ', '.join(disc_sources))

    # J-9: Billing frequency is Quarter Annually specifically.
    # Billing-checkbox keys and names come from MASTER_FORM_SPECS[kind] — the
    # Commercial Fire master numbers these boxes differently from the
    # Commercial Security (issue 336) and Residential Security (issue 337)
    # masters. The customer's-written-request exception in
    # the checklist item makes any non-Quarter tick a WARN, not a FAIL.
    if not masters:
        rec('SKIP', 'Billing frequency is Quarter Annually',
            f'{_cite(9)}; no master agreement in the folder')
    elif not mf or kind is None:
        rec('SKIP', 'Billing frequency is Quarter Annually',
            f'{_cite(9)}; master form fields not readable on this form')
    else:
        # The Elevator Monitoring Agreement has no billing checkboxes (a
        # free-text frequency blank), so it has no spec here and falls to
        # the "no billing-frequency checkboxes" SKIP below.
        billing_names = MASTER_FORM_SPECS.get(kind, {}).get('billing_names', {})
        billing = {}
        if billing_names:
            billing_re = re.compile(r'CheckBox(' +
                                    '|'.join(str(n) for n in billing_names) + r')$')
            for k, v in mf.items():
                m = billing_re.search(k)
                if not m:
                    continue
                billing[int(m.group(1))] = str(v) not in ('', '/Off')
        if not billing:
            rec('SKIP', 'Billing frequency is Quarter Annually',
                f'{_cite(9)}; no billing-frequency checkboxes on this master form')
        else:
            names = billing_names
            ticked = [names[k] for k, v in billing.items() if v]
            if ticked == ['Quarter Annually']:
                rec('PASS', 'Billing frequency is Quarter Annually',
                    f'{_cite(9)}; Quarter Annually ticked, others clear')
            elif not ticked:
                rec('FAIL', 'Billing frequency is Quarter Annually',
                    f'{_cite(9)}; no billing frequency ticked')
            else:
                rec('WARN', 'Billing frequency is Quarter Annually',
                    f'{_cite(9)}; ticked {", ".join(ticked)} — Quarter '
                    f'Annually is the default, a written customer request '
                    f'is the only reason to differ')

    # Shared master text for the two dollar-reconciliation checks below.
    master_all_text = ''
    if masters:
        parts = [master_field_text]
        pt = pdf_text(masters[0])
        if pt:
            parts.append(pt)
        master_all_text = '\n'.join(p for p in parts if p)

    # J-7: Master's Purchase Price / Down Payment / Balance reconcile to the
    # schedule. On forms that carry these line items (Commercial Security,
    # residential), the amount beside the label must equal the schedule's
    # pricing block. On the Commercial Fire form the master delegates to the
    # attached schedule, so the pattern is absent and the check SKIPs.
    label_pat = {
        'purchase price': re.compile(
            r'purchase\s*price[^\d$]{0,25}\$?\s?([\d,]+\.?\d*)', re.I),
        'down payment': re.compile(
            r'down\s*payment[^\d$]{0,25}\$?\s?([\d,]+\.?\d*)', re.I),
        'balance': re.compile(
            r'balance[^\d$]{0,25}\$?\s?([\d,]+\.?\d*)', re.I),
    }
    if not masters:
        rec('SKIP', "Master's price, down payment and balance reconcile to schedule",
            f'{_cite(7)}; no master agreement in the folder')
    elif not master_all_text:
        rec('SKIP', "Master's price, down payment and balance reconcile to schedule",
            f'{_cite(7)}; master text unreadable on this form')
    else:
        found = {}
        for label, pat in label_pat.items():
            for mm in pat.finditer(master_all_text):
                try:
                    amt = float(mm.group(1).replace(',', ''))
                except ValueError:
                    continue
                found.setdefault(label, []).append(amt)
        if not found:
            rec('SKIP',
                "Master's price, down payment and balance reconcile to schedule",
                f'{_cite(7)}; master carries no Purchase Price / Down Payment / '
                f'Balance amount (Commercial Fire delegates to the attached schedule)')
        else:
            want = {
                'purchase price': price,
                'down payment': dep,
                'balance': (price - dep) if (price is not None and dep is not None)
                            else None,
            }
            mismatches = []
            for label, amts in found.items():
                expect = want.get(label)
                if expect is None:
                    continue
                if not any(abs(a - expect) < 0.01 for a in amts):
                    mismatches.append(
                        f'{label}: master {amts[0]:,.2f} vs schedule {expect:,.2f}')
            if mismatches:
                rec('FAIL',
                    "Master's price, down payment and balance reconcile to schedule",
                    f'{_cite(7)}; ' + '; '.join(mismatches))
            else:
                rec('PASS',
                    "Master's price, down payment and balance reconcile to schedule",
                    f'{_cite(7)}; master figures match the schedule')

    # J-35: Large no-deposit deals show $0 on the master.
    # Triggered only when the schedule's Purchase Price is over the deposit
    # threshold and the schedule Deposit reads zero (checklist section H).
    if not masters:
        rec('SKIP', 'Large no-deposit deals show $0 on the master',
            f'{_cite(35)}; no master agreement in the folder')
    elif price is None or dep is None:
        rec('SKIP', 'Large no-deposit deals show $0 on the master',
            f'{_cite(35)}; schedule Purchase Price or Deposit unresolved')
    elif not (price > DEPOSIT_THRESHOLD and abs(dep) < 0.01):
        rec('SKIP', 'Large no-deposit deals show $0 on the master',
            f'{_cite(35)}; not a large no-deposit deal '
            f'(price {price:,.2f}, deposit {dep:,.2f})')
    elif not master_all_text:
        rec('SKIP', 'Large no-deposit deals show $0 on the master',
            f'{_cite(35)}; master text unreadable on this form')
    else:
        dp_amts = []
        for mm in label_pat['down payment'].finditer(master_all_text):
            try:
                dp_amts.append(float(mm.group(1).replace(',', '')))
            except ValueError:
                pass
        if not dp_amts:
            rec('SKIP', 'Large no-deposit deals show $0 on the master',
                f'{_cite(35)}; master carries no Down Payment amount to check')
        elif any(a >= 0.01 for a in dp_amts):
            rec('FAIL', 'Large no-deposit deals show $0 on the master',
                f'{_cite(35)}; master Down Payment reads '
                f'{max(dp_amts):,.2f} — expected 0.00')
        else:
            rec('PASS', 'Large no-deposit deals show $0 on the master',
                f'{_cite(35)}; Down Payment = 0.00 on the master')

    # J-32: Foreign-document check across every outgoing document.
    # The existing H-section check only reads the master's form fields; item
    # 32 asks for the same check across schedule cells, rider fields, and any
    # addenda / disclosure / other PDFs going out. The issued proposal is
    # explicitly excluded per the checklist item 32 note.
    doc_foreign = {}
    # A services-only SOW names its installing party on purpose
    # (SOW-BASELINES.md §7.13, issue 303); that name is not foreign.
    sched_foreign = _foreign_entities(sched_all_text, sub_name, installing)
    if sched_foreign:
        doc_foreign[os.path.basename(sched)] = sched_foreign
    for doc in _outgoing_pdfs(job):
        fields = pdf_fields(doc)
        text = ' '.join(str(v) for v in fields.values() if v is not None)
        if not text.strip():
            text = pdf_text(doc)
        found = _foreign_entities(text, sub_name, installing)
        if found:
            doc_foreign[os.path.basename(doc)] = found
    if doc_foreign:
        detail = '; '.join(f'{d}: {", ".join(sorted(names)[:3])}'
                           for d, names in sorted(doc_foreign.items()))
        rec('FAIL', 'No other customer name in any outgoing document',
            f'{_cite(32)}; {detail}')
    else:
        rec('PASS', 'No other customer name in any outgoing document',
            f'{_cite(32)}; every outgoing document names only this subscriber'
            + (f' (installing party named per {SERVICES_ONLY_REF}: '
               f'{"; ".join(installing)})' if installing else ''))

    # J-33: Required attachments present.
    # Trigger set: drawings/placement plans are always expected on the
    # outgoing package (WARN when missing — some monitoring-only jobs ship
    # without one); the Covered Equipment Addenda and the FSI worksheet are
    # required when the schedule sells Repair Service or Inspection RMR
    # (FAIL when missing).
    svc_descs = [S.col('B', r).strip() for r in svc_items]
    rmr_triggers = any(('inspection' in d.lower() or 'repair service' in d.lower())
                       for d in svc_descs)
    drawings = find_files(job, ['*Drawing*.pdf', '*Drawings*.pdf',
                                 '*Placement*.pdf', '*Plan*.pdf'])
    addenda = find_files(job, ['*Covered Equipment*.pdf', '*Addend*.pdf'])
    fsi = find_files(job, ['*FSI*.xls*'])

    fails = []
    warns = []
    if not drawings:
        warns.append('drawings/placement plans PDF')
    if rmr_triggers:
        if not addenda:
            fails.append('Covered Equipment Addenda PDF (Repair Service / '
                         'Inspection sold)')
        if not fsi:
            fails.append('FSI worksheet (Repair Service / Inspection sold)')
    if fails:
        detail = f'{_cite(33)}; missing: ' + '; '.join(fails)
        if warns:
            detail += f'; also missing (WARN): {"; ".join(warns)}'
        rec('FAIL', 'Required attachments present', detail)
    elif warns:
        rec('WARN', 'Required attachments present',
            f'{_cite(33)}; missing: ' + '; '.join(warns))
    else:
        rec('PASS', 'Required attachments present',
            f'{_cite(33)}; ' +
            ('addenda and FSI required and found; drawings/placement plans present'
             if rmr_triggers else
             'drawings/placement plans present; no RMR triggers attendance of addenda'))

    # ---------------- I) filename ----------------
    fn = os.path.basename(sched).replace('_', ' ')
    sysnames = [s for s in SYSTEMS if any(s in S.col('B', r) for r in range(1, S.maxr + 1))]
    # A system whose first word holds a character Windows forbids in a file
    # name (Audio/Visual) cannot appear in the file name as written, and
    # references/ gives no file-name spelling for it. Leave it unchecked and
    # point at the open question rather than invent a spelling (issue 322).
    unspelled = [s for s in sysnames if set(s.split()[0]) & set('\\/:*?"<>|')]
    checkable = [s for s in sysnames if s not in unspelled]
    note = (f'{", ".join(unspelled)} not checked: references/ gives no '
            f'file-name spelling (docs/GAP-REPORT.md §6)') if unspelled else ''
    if checkable:
        miss = [s for s in checkable if s.split()[0].lower() not in fn.lower()]
        rec('PASS' if not miss else 'WARN', 'Filename names every system sold',
            (('missing ' + ', '.join(miss)) if miss else ', '.join(checkable))
            + (f'; {note}' if note else ''))
    elif unspelled:
        rec('SKIP', 'Filename names every system sold', note)


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
    print('print layout.')
    sys.exit(3 if n['N/A'] and not n['PASS'] else (1 if n['FAIL'] else 0))


if __name__ == '__main__':
    main()
