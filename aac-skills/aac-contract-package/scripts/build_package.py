"""Build a contract package from a job folder's _facts.json.

Usage:
    python build_package.py "<job folder>"            build, then verify
    python build_package.py "<job folder>" --facts    write a starter _facts.json
    python build_package.py "<job folder>" --no-verify

One input, one command, three documents out: the Schedule of Equipment and
Services, the master agreement, and the Rider for Additional Locations. Change a
fact and rebuild; nothing is edited by hand in three places.

Bullet text lives in the skill's references/clarifications.json and nowhere else.
This file selects bullets; it does not carry their wording. Dan holds language
authority over the text, so edits go in the JSON.

Schedules are written through xlsx_surgical only. openpyxl is used for reading.

Standards ship inside the skill. The jobs drive is derived from the job folder
you name, so nothing is hardcoded to a drive letter. Run
`python aac_paths.py "<job folder>"` to see what resolved.
"""
import sys, os, re, json, shutil, zipfile, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import xlsx_surgical as X
import aac_paths

SHEET = 'Equip & Services'
CR = '\r\n'

# Schedule template coordinates after the 50/20 expansion (issue 38).
# Equipment: rows 23-72 (50 fillable). Purchase Price G73, Deposit G74,
# Balance G75 (=G73-G74). Service block header rows 77-80 (Site B79, System
# B80). Services split into three labeled subgroups totalling 20 fillable
# items:
#     New (label row 81, B81)          fill rows 82-86  cap 5
#     Replacement (label row 87, B87)  fill rows 88-97  cap 10
#     Existing (label row 98, B98)     fill rows 99-103 cap 5
# Monthly Total G104; clarifications block A107.
#
# Issue 39 lifts the fill caps from 12/9 to 50/20 and toggles row visibility
# per-row: filled rows unhidden, unused rows in each fill region hidden.
# GROUPED-FILL (owner ruling 2026-09-01) supersedes the pre-#39 flat fill:
# services land inside their subgroup, per-subgroup overflow raises a
# split-the-schedule SystemExit, and the Replacement/Existing label rows
# are hidden only when their subgroup is unused. Labels are NEVER cleared
# while any subgroup is in use. Row-visibility runs through
# xlsx_surgical.set_row_hidden (the sanctioned write path — hard rule 2)
# rather than inserting or reindexing rows.
EQ_START = 23
EQ_CAP = 50
EQ_END = EQ_START + EQ_CAP - 1  # row 72
DEP_CELL = 'G74'
SVC_SITE_CELL = 'B79'
SVC_SYS_CELL = 'B80'
# Per-subgroup fill regions (kind, first row, cap, label cell, label row).
# Order matches the visual order down the sheet.
SVC_SUBGROUPS = (
    ('new',         82,  5, 'B81', 81),
    ('replacement', 88, 10, 'B87', 87),
    ('existing',    99,  5, 'B98', 98),
)
SVC_KINDS = tuple(k for k, *_ in SVC_SUBGROUPS)
SVC_CAP = sum(cap for _, _, cap, _, _ in SVC_SUBGROUPS)  # 20
SVC_START = SVC_SUBGROUPS[0][1]                          # 82
SVC_END = SVC_SUBGROUPS[-1][1] + SVC_SUBGROUPS[-1][2] - 1  # 103
CLAR_CELL = 'A107'

PACKAGES = {
    'Fire Alarm':       ('Commercial Fire Package',
                         'Subscriber - Fire Master Agreement Rev.1.pdf',
                         'Subscriber - Fire Rider Additional Locations Rev.1.pdf'),
    'Commercial Security': ('Commercial Security Package',
                         'Commercial Security Master Agreement Rev.1.pdf',
                         'Commercial Security Rider Additional Locations Rev.1.pdf'),
}
# Commercial Fire All-in-One field map, derived from the form's own layout.
FIRE = {
    'name': '.Text2', 'phone': '.Text3', 'address': '.Text4', 'email': '.Text5',
    'cell': '.Text6', 'comm_value': '.Text7', 'code_initial': '.Text8',
    'plans_filed_by': '.Text9', 'monitoring': '.Text10', 'service_monthly': '.Text11',
    'inspection': '.Text12', 'inspections_per_year': '.Text13', 'ul_cert': '.Text14',
    'in_lieu_of': '.Text15', 'term': '.Text16',
    'cb_comm_system': '.CheckBox1', 'cb_to_code': '.CheckBox2',
    'cb_area_refuge': '.CheckBox3', 'cb_wireless': '.CheckBox4',
    'cb_monthly': '.CheckBox5', 'cb_quarter': '.CheckBox6',
    'cb_semi': '.CheckBox7', 'cb_annual': '.CheckBox8',
    'cb_monitoring': '.CheckBox9', 'cb_service_percall': '.CheckBox10',
    'cb_service_monthly': '.CheckBox11', 'cb_inspections': '.CheckBox12',
    'cb_insp_fire': '.CheckBox13', 'cb_insp_refuge': '.CheckBox14',
    'cb_insp_wireless': '.CheckBox15', 'cb_ul': '.CheckBox16',
    'cb_in_lieu_of': '.CheckBox17',
}

# Canonical schedule-line-item names that populate the three RMR fields on
# the Commercial Fire master (monitoring, inspection, repair service).
# Names are cited from `skill/aac-contract-package/references/
# MAPPING-APPENDIX.md` §3 mapping table — that file is the source of truth
# and Dan holds language authority over it (CLAUDE.md hard rule 1). The
# quoted em-dash is U+2014, matching the reference file's characters. A
# unit test enforces that every name here also appears verbatim in the
# appendix, so a rename or removal there breaks tests instead of drifting
# silently. The schema-level question — whether `services[].description`
# should carry a full enum of every MAPPING-APPENDIX RMR name — stays open
# in `skill/aac-contract-package/references/FACTS-SCHEMA.md` — Q6 Resolved
# 2026-09-10, kept out of the schema.
_FIRE_MASTER_MONITORING_NAMES = (
    'Fire Alarm Monitoring via Phone Line',
    'Fire Alarm Monitoring via Mesh Radio',
    'Fire Alarm Monitoring via Cellular Radio',
    'Fire Alarm Monitoring via Dual Path Cellular Radio & IP — 6 Hour Supervision',
    'Fire Alarm Monitoring via Sole Path Cellular Radio — 1 Hour Supervision',
)
_FIRE_MASTER_INSPECTION_NAMES = (
    'Annual Fire Alarm Inspections',
    'Quarterly Fire Alarm Inspections',
)
_FIRE_MASTER_REPAIR_SERVICE_NAMES = (
    'Repair Service — Access Control / CCTV / Intrusion / Fire Alarm '
    '(see attached Addendum of Covered Equipment)',
)

# Each fire-master category pairs a trigger substring (kept for its false-
# positive detection value — the same three tokens the pre-issue-33 matcher
# used) with the canonical-name whitelist and a human label used in errors.
_FIRE_MASTER_CATEGORIES = (
    ('monitoring',      _FIRE_MASTER_MONITORING_NAMES,      'monitoring'),
    ('inspection',      _FIRE_MASTER_INSPECTION_NAMES,      'inspection'),
    ('repair service',  _FIRE_MASTER_REPAIR_SERVICE_NAMES,  'repair_service'),
)


def _norm_desc(s):
    """Lowercase and collapse whitespace for case-insensitive comparison.
    The reference file's canonical names are compared through this
    normalizer, so trivial whitespace or case drift in a _facts.json line
    does not force a manual re-quote.
    """
    return re.sub(r'\s+', ' ', str(s).strip().lower())


def _categorize_fire_master_rmr(services):
    """Return (monitoring, inspection, repair_service) service dicts by
    matching each `services[].description` against the canonical Fire-master
    RMR names cited from `skill/aac-contract-package/references/
    MAPPING-APPENDIX.md` §3.

    A description that trips a category trigger substring but is not an
    exact canonical name for that category raises `SystemExit` naming the
    offending line — never a silent best-effort fill. This catches the two
    trap patterns issue 33 called out: "Fire Extinguisher Inspection"
    landing in the fire-monitoring inspection cell, and "Repair Service
    Deposit" reading as recurring repair-service RMR.

    Descriptions with no trigger substring (e.g. cloud video subscriptions)
    are not fire-master RMR lines and are left alone. Multiple canonical
    lines for the same category keep the current first-wins behavior; the
    scope of this ticket is false-positive fills, not duplicate policy.
    """
    picked = {'monitoring': None, 'inspection': None, 'repair_service': None}
    for s in services or ():
        desc = s.get('description', '')
        n = _norm_desc(desc)
        for trigger, canonical_names, cat in _FIRE_MASTER_CATEGORIES:
            if trigger not in n:
                continue
            canonical = {_norm_desc(x) for x in canonical_names}
            if n not in canonical:
                raise SystemExit(
                    'build_agreements: services description '
                    f'{desc!r} tripped the fire-master "{trigger}" '
                    'matcher but is not a canonical Fire-master RMR '
                    f'name for that category. Accepted names per '
                    'skill/aac-contract-package/references/'
                    'MAPPING-APPENDIX.md §3:\n  ' +
                    '\n  '.join(repr(x) for x in canonical_names) +
                    '\nFix the services entry in _facts.json (either '
                    'quote a canonical name, or remove the line if it '
                    'does not belong on the Fire master).'
                )
            if picked[cat] is None:
                picked[cat] = s
            break
    return picked['monitoring'], picked['inspection'], picked['repair_service']


# STARTER is the tree-shape v1.0 record ratified by Dan on 2026-09-10 (issue
# #215 stream A). The schema and its companion live at
# skill/aac-contract-package/references/facts.schema.json and
# skill/aac-contract-package/references/FACTS-SCHEMA.md; every field the code
# below reads appears in STARTER, and every unread field is a provenance
# field the pre-build gate consumes (Q2 Resolved in the companion):
#   - customer.entity_verified: A.1 verification track record
#   - sites[].price_source: source-precedence provenance per
#     references/SCHEDULE-GENERATION-PROCEDURE.md §1
# The commercial default carries deal.package_situation = "initial" so the
# starter validates against the schema's conditional required rule
# (commercial => package_situation). A drafter editing the starter for a
# repeat commercial Project changes it to "subsequent"; a residential deal
# flips deal.commercial to False and removes the situation.
STARTER = {
    "customer": {"subscriber_name": "", "billing_address": "",
                 "phone": "", "cell": "", "email": "",
                 "entity_verified": False, "assumed_name": None,
                 "state_of_incorporation": None},
    "sites": [{
        "site_name": "", "site_address": "",
        "price": 0, "price_source": "proposal", "deposit": None,
        "systems": [{
            "system": "Fire Alarm",
            "designation": "new",
            "scope": {"coverage_sentence": "", "extra_sentences": []},
            "equipment": [{"qty": 1, "description": ""}],
            "services": [{"qty": 1, "description": "", "unit": 0, "kind": "new"}],
        }],
    }],
    "deal": {"rep": "", "prospect": "", "work_order": None,
             "package_situation": "initial",
             "commercial": True, "term_years": 5,
             "paid_by": "subscriber", "lender": None,
             "inspections_per_year": None},
    "flags": {"prevailing_wage": False, "tax_exempt": False,
              "customer_furnished_equipment": False,
              "detector_cleaning_discussed": False,
              "submittals_excluded_confirmed": False,
              "equipment_reused": False, "fire_alarm_to_code": False,
              "no_master_agreement": False, "new_construction": False},
    "job_clarifications": [],
    "held": []
}


def _flatten_v1(f):
    """Normalise a v1.0 tree record into the flat working shape the
    build_schedule / build_agreements / select_bullets code consumes.

    Stream A (issue #217) lands the tree shape and the schema without
    changing the single-Site single-System output layout; multi-Site,
    multi-System composition ships in stream B (issue #218) which will
    replace this normaliser with a walker over sites/systems.

    Refuses a record with more than one Site or more than one System per
    Site with a message naming the stream-B ticket, so the failure mode is
    a clear pointer instead of a silent one-System build of a multi-System
    packet.

    Missing optional blocks default to empty (Q7 Resolved in
    references/FACTS-SCHEMA.md); a missing kind tag on a service line is
    left absent and the grouped-fill code warns and defaults to "new".
    """
    if 'sites' not in f or not isinstance(f['sites'], list) or not f['sites']:
        raise SystemExit(
            '_facts.json is not a v1.0 tree record: "sites" list is missing '
            'or empty. See skill/aac-contract-package/references/FACTS-SCHEMA.md.'
        )
    if len(f['sites']) > 1:
        raise SystemExit(
            f'{len(f["sites"])} sites in _facts.json — multi-site builds '
            'ship in stream B (issue #218). Split the packet into one '
            '_facts.json per Site until then.'
        )
    site = f['sites'][0]
    if 'systems' not in site or not isinstance(site['systems'], list) or not site['systems']:
        raise SystemExit(
            f'_facts.json site {site.get("site_name", "?")!r} carries no '
            'systems. See skill/aac-contract-package/references/FACTS-SCHEMA.md.'
        )
    if len(site['systems']) > 1:
        raise SystemExit(
            f'{len(site["systems"])} systems at site '
            f'{site.get("site_name", "?")!r} — multi-system builds ship in '
            'stream B (issue #218). Split the packet into one _facts.json '
            'per System until then.'
        )
    sysrec = site['systems'][0]

    cust = dict(f.get('customer') or {})
    cust['site_name'] = site['site_name']
    cust['site_address'] = site['site_address']

    deal = dict(f.get('deal') or {})
    deal['system'] = sysrec['system']
    deal['designation'] = sysrec['designation']

    pricing = {
        'price': site['price'],
        'price_source': site.get('price_source', ''),
        'deposit': site.get('deposit'),
    }

    scope = sysrec.get('scope') or {}
    flat = {
        'customer': cust,
        'deal': deal,
        'pricing': pricing,
        'equipment': list(sysrec.get('equipment') or []),
        'services': list(sysrec.get('services') or []),
        'scope': {
            'coverage_sentence': scope.get('coverage_sentence', ''),
            'extra_sentences': list(scope.get('extra_sentences') or []),
        },
        'flags': dict(f.get('flags') or {}),
        'job_clarifications': list(f.get('job_clarifications') or []),
        'held': list(f.get('held') or []),
    }
    return flat


def load(job):
    p = os.path.join(job, '_facts.json')
    if not os.path.exists(p):
        raise SystemExit(f'no _facts.json in {job}\nRun with --facts to write a starter.')
    with open(p, encoding='utf8') as fh:
        raw = json.load(fh)
    return _flatten_v1(raw)


def lib():
    with open(aac_paths.CLARIFICATIONS, encoding='utf8') as fh:
        return json.load(fh)


def select_bullets(f, L):
    """Choose clarifications and exclusions and put them in the library's order.

    Selection logic lives here; wording and print order live in clarifications.json.
    """
    c, e = L['clarifications'], L['exclusions']
    sys_name = f['deal']['system']
    price = float(f['pricing']['price'] or 0)
    fl, deal = f['flags'], f['deal']
    paid_by = deal.get('paid_by', 'subscriber')
    default_order = L.get('_job_clarification_default_order', 40)

    cond = c['conditional']
    lender_pays = paid_by == 'lender' and bool(deal.get('lender'))
    picked = []
    for b in c['universal']:
        txt = b['text']
        # BASELINES 2026-08-26 (OPEN-DECISIONS item 21): the deposit sentence and the
        # credit-card fee are one payments bullet; the deposit half applies over $5,000
        # when Subscriber pays. Wording lives in clarifications.json (merged_text).
        if b['id'] == 'payments' and price > 5000 and not lender_pays:
            txt = cond['deposit']['merged_text']
        # Same ruling: the access bullet's delay clause is appended only on accounts
        # with no master agreement (ACCOUNT-RULES.md); Commercial ¶13 governs elsewhere.
        if b['id'] == 'access' and fl.get('no_master_agreement'):
            txt = cond['access_no_master']['merged_text']
        # Ruling 2026-09-18 (OPEN-DECISIONS item 23): the Repair Service sentence prints on
        # every agreement; a no-master account's schedule never refers to one.
        if b['id'] == 'validity' and fl.get('no_master_agreement'):
            txt = cond['validity_no_master']['merged_text']
        picked.append((b['order'], txt))
    if lender_pays:
        b = cond['third_party_finance']
        picked.append((b['order'], b['text'].format(lender=deal['lender'])))
    if deal.get('commercial') and not fl.get('prevailing_wage'):
        b = cond['prevailing_wage_not_subject']; picked.append((b['order'], b['text']))
    for key, flag in (('tax_exempt', 'tax_exempt'),
                      ('customer_furnished', 'customer_furnished_equipment')):
        if fl.get(flag):
            b = cond[key]; picked.append((b['order'], b['text']))
    picked += [(b['order'], b['text']) for b in c['by_system'].get(sys_name, [])]
    reused = deal['designation'] in ('replacement', 'takeover') and fl.get('equipment_reused')
    if reused:
        picked += [(b['order'], b['text']) for b in c['reused_takeover']]
    if fl.get('new_construction'):
        picked += [(b['order'], b['text']) for b in c.get('new_construction', [])]
    for j in f.get('job_clarifications', []):
        if isinstance(j, dict):
            picked.append((j.get('order', default_order), j['text']))
        else:
            picked.append((default_order, j))
    clar = [t for _, t in sorted(picked, key=lambda x: x[0])]

    ex, last = [], None
    for b in e['universal']:
        if b.get('always_last'):
            last = b['text']; continue
        txt = b['text']
        if b['id'] == 'periodic_maintenance' and fl.get('detector_cleaning_discussed'):
            txt = e['conditional']['detector_cleaning']['merged_text']
        # Item 21 applicability tag the record can decide: existing-equipment removal
        # applies only when existing equipment sits in or near the scope.
        if b['id'] == 'existing_removal' and not (
                deal['designation'] in ('replacement', 'takeover') or fl.get('equipment_reused')):
            continue
        ex.append(txt)
    if fl.get('submittals_excluded_confirmed'):
        ex.append(e['conditional']['submittals']['text'])
    ex += [b['text'] for b in e['by_system'].get(sys_name, [])]
    if reused:
        ex += [b['text'] for b in e.get('reused_takeover', [])]
    if fl.get('new_construction'):
        ex += [b['text'] for b in e.get('new_construction', [])]
    if last:
        ex.append(last)
    return clar, ex


def build_sow(f, L):
    sys_name = f['deal']['system']
    tpl = L['sow_templates'].get(sys_name)
    if not tpl:
        raise SystemExit(f'no SOW template for system "{sys_name}"')
    parts = [tpl.format(designation=f['deal']['designation'])]
    if f['scope'].get('coverage_sentence'):
        parts.append(f['scope']['coverage_sentence'])
    parts += list(f['scope'].get('extra_sentences', []))
    closer = L.get('sow_closer_by_system', {}).get(sys_name)
    if closer is None:
        closer = L['sow_closer_fire'] if sys_name == 'Fire Alarm' else L['sow_closer']
    if closer:
        parts.append(closer)
    return ' '.join(p.strip() for p in parts if p.strip())


def _jurisdiction_phrase(state):
    """Render the incorporation phrase from the record's state, never a literal.

    Governed by references/DRAFTER-PRESEND-CHECKLIST.md A.2 (assumed-name
    format). The reference wording quotes an Illinois example; this routine
    reads the state from the record and picks the English article. Semantic
    ambiguity — default-to-Illinois vs required-when-assumed-name — is Open
    Question Q3 in skill/aac-contract-package/references/FACTS-SCHEMA.md
    (Resolved 2026-08-25: required-when-assumed-name, full state names only).
    """
    article = 'an' if state[:1].upper() in ('A', 'E', 'I', 'O', 'U') else 'a'
    return f"{article} {state} corporation"


def build_schedule(job, f, L, R):
    cust, deal, pr = f['customer'], f['deal'], f['pricing']
    name = cust['subscriber_name']
    if cust.get('assumed_name'):
        state = cust.get('state_of_incorporation')
        if not state:
            raise SystemExit(
                "customer.assumed_name is set but customer.state_of_incorporation "
                "is missing; the assumed-name subscriber block cannot be rendered "
                "without a jurisdiction. See "
                "skill/aac-contract-package/references/FACTS-SCHEMA.md Q3; "
                "add the field to _facts.json.")
        name = f"{cust['subscriber_name']}, {_jurisdiction_phrase(state)}, d/b/a {cust['assumed_name']}"
    sub = CR.join([name] + [x for x in cust['billing_address'].split('\n') if x.strip()])
    siteline = f"Site: {cust['site_name']}, {cust['site_address'].replace(chr(10), ', ')}"
    site = CR.join([cust['site_name']] + [x for x in cust['site_address'].split('\n') if x.strip()])

    out = os.path.join(job, f"{cust['site_name']}_{_slug(cust['site_address'])} - "
                            f"{deal['system']} Equip & Svc Schedule.xlsx")
    os.makedirs(R.to_delete, exist_ok=True)
    shutil.copy2(R.schedule_template, out)
    bak = os.path.join(R.to_delete, os.path.basename(out).replace('.xlsx', ' BACKUP pre-build.xlsx'))
    shutil.copy2(R.schedule_template, bak)

    w = X.Workbook(out)
    w.set_inline_text(SHEET, 'A10', sub)
    w.set_inline_text(SHEET, 'C10', site)
    w.set_inline_text(SHEET, 'G10', deal['rep'])
    w.set_inline_text(SHEET, 'G11', str(deal['prospect']))
    w.set_inline_text(SHEET, 'A15', build_sow(f, L))

    price = float(pr['price'])
    w.set_inline_text(SHEET, 'B21', siteline)
    w.set_num(SHEET, 'F21', price)
    w.set_num(SHEET, 'G21', price)
    w.set_inline_text(SHEET, 'B22', f"System: {deal['system']}")
    eq = f['equipment']
    if len(eq) > EQ_CAP:
        raise SystemExit(f'{len(eq)} equipment lines exceed the {EQ_CAP}-line '
                         'cap in the schedule template. Split the schedule '
                         'across two packages.')
    for i, item in enumerate(eq):
        r = EQ_START + i
        w.set_num(SHEET, f'A{r}', item['qty'])
        w.set_inline_text(SHEET, f'B{r}', item['description'])
    # Row-visibility toggle across the equipment fill region. Filled rows
    # unhidden, unused rows hidden — no row insertion, no reindexing (issue 39).
    for i in range(EQ_CAP):
        w.set_row_hidden(SHEET, EQ_START + i, hidden=(i >= len(eq)))

    dep = pr.get('deposit')
    if dep is None:
        dep = round(price * 0.5, 2) if (price > 5000 and deal.get('paid_by') == 'subscriber') else 0
    w.set_num(SHEET, DEP_CELL, dep)

    svc = f.get('services') or []
    if svc:
        w.set_inline_text(SHEET, SVC_SITE_CELL, siteline)
        w.set_inline_text(SHEET, SVC_SYS_CELL, f"System: {deal['system']}")
        # Partition services by kind (owner ruling 2026-09-01: GROUPED-FILL).
        # Services keep their original ordering inside each subgroup. Missing
        # kind defaults to 'new' and prints a warning (validator surface for
        # the ruling's "absent tag defaults to New, validator flags missing
        # tag" clause) — the build still proceeds.
        buckets = {k: [] for k in SVC_KINDS}
        for idx, s in enumerate(svc):
            kind = s.get('kind')
            if kind is None:
                print(f'WARNING: service #{idx + 1} missing "kind" tag; '
                      f'defaulting to "new". Add "kind": "new"/"replacement"/'
                      f'"existing" to _facts.json services.', file=sys.stderr)
                kind = 'new'
            if kind not in SVC_KINDS:
                raise SystemExit(f'service #{idx + 1} has unknown kind '
                                 f'"{kind}"; allowed: {", ".join(SVC_KINDS)}')
            buckets[kind].append(s)
        # Per-subgroup fill + row-visibility toggle. Labels are never
        # cleared; the label row is hidden only when the subgroup is unused.
        for kind, start, cap, label_cell, label_row in SVC_SUBGROUPS:
            items = buckets[kind]
            if len(items) > cap:
                raise SystemExit(
                    f'{len(items)} {kind} service lines exceed the {cap}-line '
                    f'cap for that subgroup in the schedule template. Split '
                    f'the schedule across two packages.')
            for i, s in enumerate(items):
                r = start + i
                w.set_num(SHEET, f'A{r}', s['qty'])
                w.set_inline_text(SHEET, f'B{r}', s['description'])
                w.set_num(SHEET, f'F{r}', s['unit'])
                w.set_num(SHEET, f'G{r}', round(s['qty'] * s['unit'], 2))
            for i in range(cap):
                w.set_row_hidden(SHEET, start + i, hidden=(i >= len(items)))
            # Hide the label row only for Replacement/Existing when their
            # subgroup is empty. The New label (row 81) is always kept
            # visible: New is the default kind and its label is the anchor
            # for the whole services block.
            if kind != 'new':
                w.set_row_hidden(SHEET, label_row, hidden=(not items))
    else:
        w.set_inline_text(SHEET, SVC_SITE_CELL, 'N/A')

    clar, ex = select_bullets(f, L)
    body = lambda items, tail=1: CR + CR.join('• ' + t for t in items) + CR * tail
    w.set_runs(SHEET, CLAR_CELL, {1: body(clar, 2), 3: body(ex)})
    w.save(out + '.tmp'); os.replace(out + '.tmp', out)

    changed = _verify_zip_parts(bak, out)
    return out, changed, len(clar), len(ex), dep


def _verify_zip_parts(bak, out):
    """Post-save compare: same part list, list of members whose bytes changed.

    Both handles are closed on every path — success and the part-list-changed
    error path — so nothing outside can be tempted to os.replace one of these
    files while a handle is still open (WinError 5 territory). Issue 77.
    """
    with zipfile.ZipFile(bak) as a, zipfile.ZipFile(out) as b:
        if a.namelist() != b.namelist():
            raise SystemExit('zip part list changed; rebuild from the template')
        return [n for n in a.namelist() if a.read(n) != b.read(n)]


def build_agreements(job, f, R):
    from pypdf import PdfReader, PdfWriter
    deal, cust = f['deal'], f['customer']
    if deal['system'] != 'Fire Alarm':
        return None, None, 'only the Commercial Fire form is mapped so far'
    folder, mname, rname = PACKAGES['Fire Alarm']
    mpath = os.path.join(R.agreements_root, folder, mname)
    rpath = os.path.join(R.agreements_root, folder, rname)
    if not os.path.exists(mpath):
        return None, None, f'agreement forms not reachable at {mpath}'

    mon, insp, rep = _categorize_fire_master_rmr(f.get('services', []))

    text = {
        FIRE['name']: cust['subscriber_name'],
        FIRE['phone']: cust.get('phone', ''),
        FIRE['address']: cust['billing_address'].replace('\n', ', '),
        FIRE['email']: cust.get('email', ''),
        FIRE['cell']: cust.get('cell', ''),
        FIRE['comm_value']: 'N/A',
        FIRE['monitoring']: f"{mon['unit']:.2f}" if mon else 'N/A',
        FIRE['service_monthly']: f"{rep['unit']:.2f}" if rep else 'N/A',
        FIRE['inspection']: f"{insp['unit']:.2f}" if insp else 'N/A',
        FIRE['inspections_per_year']: f.get('deal', {}).get('inspections_per_year', '') or
                                     ('one (1)' if insp else 'N/A'),
        FIRE['ul_cert']: 'N/A',
        FIRE['in_lieu_of']: 'N/A',
        FIRE['term']: f"{deal['term_years']} years",
    }
    for k in ('code_initial', 'plans_filed_by'):
        text[FIRE[k]] = ''          # held until Sales answers who filed the plans
    checks = {
        FIRE['cb_comm_system']: False, FIRE['cb_to_code']: bool(f['flags'].get('fire_alarm_to_code')),
        FIRE['cb_area_refuge']: False, FIRE['cb_wireless']: False,
        FIRE['cb_monthly']: False, FIRE['cb_quarter']: True,
        FIRE['cb_semi']: False, FIRE['cb_annual']: False,
        FIRE['cb_monitoring']: bool(mon),
        FIRE['cb_service_percall']: not rep, FIRE['cb_service_monthly']: bool(rep),
        FIRE['cb_inspections']: bool(insp), FIRE['cb_insp_fire']: bool(insp),
        FIRE['cb_insp_refuge']: False, FIRE['cb_insp_wireless']: False,
        FIRE['cb_ul']: False, FIRE['cb_in_lieu_of']: False,
    }

    def fill(src, out, txt, cks):
        r = PdfReader(src); w = PdfWriter(clone_from=src)
        w.set_need_appearances_writer(True)
        vals = {}
        for k, fd in (r.get_fields() or {}).items():
            if fd.get('/FT') == '/Btn':
                if k in cks: vals[k] = '/Yes' if cks[k] else '/Off'
            elif k in txt:
                vals[k] = txt[k]
        for pg in w.pages:
            try: w.update_page_form_field_values(pg, vals, auto_regenerate=False)
            except Exception: pass
        with open(out, 'wb') as fh: w.write(fh)

    stem = f"{cust['site_name']}_{_slug(cust['site_address'])}"
    mo = os.path.join(job, f'{stem} - Fire Master Agreement.pdf')
    ro = os.path.join(job, f'{stem} - Fire Rider Additional Locations.pdf')
    fill(mpath, mo, text, checks)
    fill(rpath, ro, {'Text17777': cust['subscriber_name'], 'Text277777': '',
                     'Text37777': str(deal['term_years'])}, {})
    return mo, ro, None


def _slug(addr):
    return re.sub(r'\s+', ' ', addr.split('\n')[0]).strip().replace(',', '')


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('job'); ap.add_argument('--facts', action='store_true')
    ap.add_argument('--no-verify', action='store_true')
    a = ap.parse_args()
    job = a.job.rstrip('\\/')
    if not os.path.isdir(job):
        raise SystemExit('not a folder: ' + job)

    if a.facts:
        p = os.path.join(job, '_facts.json')
        if os.path.exists(p):
            raise SystemExit('_facts.json already exists; not overwriting')
        with open(p, 'w', encoding='utf8') as fh:
            json.dump(STARTER, fh, indent=2)
        print('wrote', p)
        return

    R = aac_paths.for_job(job)
    R.require('schedule_template', 'jobs_root')
    if not os.path.exists(aac_paths.CLARIFICATIONS):
        raise SystemExit('bullet library missing from the skill: ' + aac_paths.CLARIFICATIONS)
    f, L = load(job), lib()
    print('=' * 78)
    print('BUILD —', f['customer']['subscriber_name'], '|', f['deal']['system'],
          '|', f['deal']['designation'])
    print('=' * 78)

    sched, changed, nc, ne, dep = build_schedule(job, f, L, R)
    print('schedule  ', os.path.basename(sched))
    print('           zip parts changed:', ', '.join(changed))
    print(f'           {nc} clarifications, {ne} exclusions, deposit {dep:,.2f}')

    mo, ro, why = build_agreements(job, f, R)
    if why:
        print('agreements skipped:', why)
    else:
        print('master    ', os.path.basename(mo))
        print('rider     ', os.path.basename(ro))

    if f.get('held'):
        print('\nHELD, left unwritten until answered:')
        for h in f['held']:
            print('  -', h)

    if not a.no_verify:
        print(); sys.stdout.flush()
        os.system(f'"{sys.executable}" "{os.path.join(HERE, "verify_package.py")}" "{job}" --quiet')


if __name__ == '__main__':
    main()
