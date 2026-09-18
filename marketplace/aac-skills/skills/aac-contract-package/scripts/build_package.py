"""Build a contract package from a job folder's _facts.json.

Usage:
    python build_package.py "<job folder>"            build, then verify
    python build_package.py "<job folder>" --facts    write a starter _facts.json
    python build_package.py "<job folder>" --no-verify

One input, one command, the package out: the Schedule of Equipment and
Services, and the master agreement and Rider for Additional Locations when the
situation row in references/CONTRACT-PACKAGE-RULES.md §2 calls for them (a
commercial record names its situation in deal.package_situation). Change a
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
EQ_SYS_ROW = 22          # the template's own System line (B22)
EQ_START = 23
EQ_CAP = 50
EQ_END = EQ_START + EQ_CAP - 1  # row 72
DEP_CELL = 'G74'
SVC_SITE_CELL = 'B79'
SVC_SYS_ROW = 80         # the template's own System line under Services
SVC_SYS_CELL = f'B{SVC_SYS_ROW}'
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
# The subgroup label text the template carries in B81/B87/B98, keyed by kind,
# for the rows a multi-System schedule writes below the first System's block.
SVC_LABELS = {'new': 'New Services', 'replacement': 'Replacement Services',
              'existing': 'Existing Services'}
# Multi-System schedule (issue #226, spec 215 stream B): the Site and System
# blocks repeat inside the same anchored regions per the amended cell map in
# references/SCHEDULE-GENERATION-PROCEDURE.md §4. Under Equipment and Labor
# every System after the first takes one row of the fill region for its
# System line; under Services, when more than one System sells a service,
# the region from the System line at SVC_SYS_ROW to SVC_END is filled top to
# bottom with one System sub-block per System (its subgroup label rows only
# for subgroups that carry lines). Repeated rows take the template's own
# styles for that role (rows EQ_SYS_ROW, SVC_SYS_ROW, SVC_LABEL_ROW,
# SVC_ITEM_ROW) through xlsx_surgical.copy_row_styles; rows are hidden or
# shown, never inserted or deleted, and a region that cannot hold the
# schedule refuses before anything is written.
SVC_LABEL_ROW = SVC_SUBGROUPS[0][4]                      # 81
SVC_ITEM_ROW = SVC_START                                 # 82
SVC_REGION_ROWS = SVC_END - SVC_SYS_ROW + 1              # 24
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

# Package composition (issue #225, spec 215 stream B). Which documents make
# up the package is governed by the situation rows of
# references/CONTRACT-PACKAGE-RULES.md §2; which Contract family a System
# belongs to is governed by the table in references/SOW-BASELINES.md §3.
# This file cites those sections and reads their content at run time; it
# does not carry their wording. The only thing encoded here is the builder's
# own decision under each row: whether its master and rider generator runs.
PACKAGE_RULES = 'CONTRACT-PACKAGE-RULES.md'
SOW_BASELINES = 'SOW-BASELINES.md'
# (commercial?, deal.package_situation) -> (section of PACKAGE_RULES, master+rider)
PACKAGE_SECTIONS = {
    (True, 'initial'):    ('2.2', True),
    (True, 'subsequent'): ('2.3', False),
    (False, None):        ('2.4', True),
}
# The note under the SOW_BASELINES §3 table collapses every System of a
# residential Project into this one family; the table's column governs the
# commercial side only.
RESIDENTIAL_FAMILY = 'Residential Security'
# The three documents this tool can generate, matched against the situation
# row's bullets (case-insensitive prefix) so the handoff lists only what was
# NOT written here. A bullet that matches nothing stays on the list, which
# is the safe direction.
_GENERATED_DOC_PREFIXES = {
    'schedule': 'schedule of equipment',
    'master':   'master agreement',
    'rider':    'rider for additional locations',
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


def _tree_systems(f):
    """Every (site, system) record of a v1.0 tree, in document order, or a
    SystemExit naming the schema when the tree shape is missing."""
    if 'sites' not in f or not isinstance(f['sites'], list) or not f['sites']:
        raise SystemExit(
            '_facts.json is not a v1.0 tree record: "sites" list is missing '
            'or empty. See skill/aac-contract-package/references/FACTS-SCHEMA.md.'
        )
    pairs = []
    for site in f['sites']:
        systems = site.get('systems') if isinstance(site, dict) else None
        if not isinstance(systems, list) or not systems:
            raise SystemExit(
                f'_facts.json site {site.get("site_name", "?")!r} carries no '
                'systems. See skill/aac-contract-package/references/FACTS-SCHEMA.md.'
            )
        pairs += [(site, s) for s in systems]
    return pairs


def system_families():
    """Approved system name -> Contract family, read from the table in
    references/SOW-BASELINES.md §3 at run time. The reference file is the
    only copy of that table; a name Dan ratifies there is known here on the
    next run without a code change."""
    path = aac_paths.reference(SOW_BASELINES)
    with open(path, encoding='utf8') as fh:
        lines = fh.read().splitlines()
    in_section, header, table = False, None, {}
    for line in lines:
        if line.startswith('## '):
            in_section = line.startswith('## 3)')
            continue
        if not in_section or not line.lstrip().startswith('|'):
            continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if header is None:
            header = cells
            continue
        if all(set(c) <= set('-: ') for c in cells):
            continue  # markdown separator row
        row = dict(zip(header, cells))
        name = row.get('Approved', '')
        family = next((v for k, v in row.items()
                       if k.lower().startswith('contract family')), '')
        if name and family:
            table[name] = family
    if not table:
        raise SystemExit(
            f'cannot read the Contract family column of {path} §3 '
            '(Approved system type names); the package cannot be composed '
            'without it.')
    return table


def package_rules_section(section):
    """(heading, bullets) of one `### <section>` block of
    references/CONTRACT-PACKAGE-RULES.md, read at run time so the handoff
    can cite the row's own words instead of a copy."""
    path = aac_paths.reference(PACKAGE_RULES)
    with open(path, encoding='utf8') as fh:
        lines = fh.read().splitlines()
    heading, bullets, inside = None, [], False
    unescape = lambda s: s.strip().replace('\\*', '*')  # the file's markdown escapes
    for line in lines:
        if line.startswith('#'):
            if inside:
                break
            if line.startswith(f'### {section} '):
                heading = unescape(line[len(f'### {section} '):])
                inside = True
            continue
        if inside and line.startswith('- '):
            bullets.append(unescape(line[2:]))
    if heading is None or not bullets:
        raise SystemExit(f'cannot find §{section} in {path}; the package '
                         'composition cites it and cannot proceed without it.')
    return heading, bullets


def compose(record):
    """Decide the package for a v1.0 tree record before anything is written.

    Returns a dict: ``family`` (the Contract family every System maps to),
    ``section`` (the situation row of references/CONTRACT-PACKAGE-RULES.md
    that governs the package), ``situation`` (its heading, read from the
    file), ``documents`` (that row's bullets, read from the file) and
    ``agreements`` (whether the master and rider are part of this package).

    Refuses with SystemExit, nothing written, when: ``deal.commercial`` is
    not set (the composition turns on it and the standard names no
    default); a commercial record has no ``deal.package_situation`` (no
    default in either direction — spec 215 stream B); a System name is not
    in the SOW-BASELINES §3 table, so its family cannot be derived; the
    Systems span more than one Contract family (split instruction, one
    Project per family, listing each System under its family). Residential
    records collapse to one family per the §3 note, so the split never
    fires for them and ``deal.package_situation`` is ignored
    (references/FACTS-SCHEMA.md, ``deal`` block).
    """
    deal = record.get('deal') or {}
    if not isinstance(deal, dict) or deal.get('commercial') is None:
        raise SystemExit(
            'deal.commercial is not set in _facts.json. The package is '
            'composed from the commercial or residential situation row of '
            f'skill/aac-contract-package/references/{PACKAGE_RULES} §2, and '
            'nothing in that file or in FACTS-SCHEMA.md names a default. Set '
            'deal.commercial to true or false.')
    commercial = bool(deal['commercial'])
    situation = deal.get('package_situation') if commercial else None
    if (commercial, situation) not in PACKAGE_SECTIONS:
        shown = 'missing' if situation is None else repr(situation)
        raise SystemExit(
            f'deal.package_situation is {shown} on a commercial record '
            '(deal.commercial is true); it must be "initial" or "subsequent". '
            'The commercial package differs between the two situation rows of '
            f'skill/aac-contract-package/references/{PACKAGE_RULES} §2.2 and '
            '§2.3, and the builder does not default either way. Set the field '
            'in _facts.json (FACTS-SCHEMA.md, deal.package_situation).')
    section, agreements = PACKAGE_SECTIONS[(commercial, situation)]

    table = system_families()
    by_family = {}
    for site, sysrec in _tree_systems(record):
        name = str(sysrec.get('system', '')).strip()
        if name not in table:
            raise SystemExit(
                f'System {name!r} at site {site.get("site_name", "?")!r} is '
                'not an approved system type name, so its Contract family '
                'cannot be derived. Approved names and their families: '
                f'skill/aac-contract-package/references/{SOW_BASELINES} §3. '
                'Fix sites[].systems[].system in _facts.json.')
        family = table[name] if commercial else RESIDENTIAL_FAMILY
        by_family.setdefault(family, []).append(name)
    if len(by_family) > 1:
        listing = '\n'.join(f'  {fam}: {", ".join(names)}'
                            for fam, names in by_family.items())
        raise SystemExit(
            f'the Systems in _facts.json span {len(by_family)} Contract '
            'families and one package carries one family '
            f'(skill/aac-contract-package/references/{SOW_BASELINES} §3; '
            f'{PACKAGE_RULES} §2.8 for a combination fire-and-burglar '
            'panel). Split the packet into one Project per family, each '
            'with its own _facts.json:\n' + listing)
    family = next(iter(by_family))

    heading, bullets = package_rules_section(section)
    return {'family': family, 'section': section, 'situation': heading,
            'documents': bullets, 'agreements': agreements}


def _flatten_v1(f):
    """Normalise a v1.0 tree record into the working shape the
    build_schedule / build_agreements / select_bullets code consumes: the
    one Site's identity and pricing at the top, and ``systems`` — one entry
    per System at that Site, in record order, each carrying its
    designation, scope, equipment and services. A single-System record is
    the same shape with one entry (issue #226, spec 215 stream B).

    Refuses a record with more than one Site with a message naming the
    ticket (the multi-Site schedule is issue #227), so the failure mode is
    a clear pointer instead of a silent one-Site build of a multi-Site
    packet. Package composition and the cross-family refusal (issue #225)
    run over the whole tree in ``compose`` before this normaliser is
    reached.

    Missing optional blocks default to empty (Q7 Resolved in
    references/FACTS-SCHEMA.md); a missing kind tag on a service line is
    left absent and the services fill warns and defaults to "new".
    """
    pairs = _tree_systems(f)
    if len(f['sites']) > 1:
        raise SystemExit(
            f'{len(f["sites"])} sites in _facts.json — the multi-site '
            'schedule is issue #227. Split the packet into one _facts.json '
            'per Site until then.'
        )
    site = f['sites'][0]

    cust = dict(f.get('customer') or {})
    cust['site_name'] = site['site_name']
    cust['site_address'] = site['site_address']

    pricing = {
        'price': site['price'],
        'price_source': site.get('price_source', ''),
        'deposit': site.get('deposit'),
    }

    systems = []
    for _, sysrec in pairs:
        scope = sysrec.get('scope') or {}
        systems.append({
            'system': sysrec['system'],
            'designation': sysrec['designation'],
            'scope': {
                'coverage_sentence': scope.get('coverage_sentence', ''),
                'extra_sentences': list(scope.get('extra_sentences') or []),
            },
            'equipment': list(sysrec.get('equipment') or []),
            'services': list(sysrec.get('services') or []),
        })

    return {
        'customer': cust,
        'deal': dict(f.get('deal') or {}),
        'pricing': pricing,
        'systems': systems,
        'flags': dict(f.get('flags') or {}),
        'job_clarifications': list(f.get('job_clarifications') or []),
        'held': list(f.get('held') or []),
    }


def read_record(job):
    """The job folder's _facts.json as the v1.0 tree, unflattened."""
    p = os.path.join(job, '_facts.json')
    if not os.path.exists(p):
        raise SystemExit(f'no _facts.json in {job}\nRun with --facts to write a starter.')
    with open(p, encoding='utf8') as fh:
        return json.load(fh)


def load(job):
    return _flatten_v1(read_record(job))


def lib():
    with open(aac_paths.CLARIFICATIONS, encoding='utf8') as fh:
        return json.load(fh)


def select_bullets(f, L):
    """Choose clarifications and exclusions and put them in the library's order.

    Selection logic lives here; wording and print order live in clarifications.json.
    """
    c, e = L['clarifications'], L['exclusions']
    sys_names = [s['system'] for s in f['systems']]
    replaces = any(s['designation'] in ('replacement', 'takeover') for s in f['systems'])
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
    # The system-specific set, once per System sold; a bullet two Systems
    # share prints once.
    for name in sys_names:
        picked += [(b['order'], b['text']) for b in c['by_system'].get(name, [])]
    reused = replaces and fl.get('equipment_reused')
    if reused:
        picked += [(b['order'], b['text']) for b in c['reused_takeover']]
    if fl.get('new_construction'):
        picked += [(b['order'], b['text']) for b in c.get('new_construction', [])]
    for j in f.get('job_clarifications', []):
        if isinstance(j, dict):
            picked.append((j.get('order', default_order), j['text']))
        else:
            picked.append((default_order, j))
    clar = _unique([t for _, t in sorted(picked, key=lambda x: x[0])])

    ex, last = [], None
    for b in e['universal']:
        if b.get('always_last'):
            last = b['text']; continue
        txt = b['text']
        if b['id'] == 'periodic_maintenance' and fl.get('detector_cleaning_discussed'):
            txt = e['conditional']['detector_cleaning']['merged_text']
        # Item 21 applicability tag the record can decide: existing-equipment removal
        # applies only when existing equipment sits in or near the scope.
        if b['id'] == 'existing_removal' and not (replaces or fl.get('equipment_reused')):
            continue
        ex.append(txt)
    if fl.get('submittals_excluded_confirmed'):
        ex.append(e['conditional']['submittals']['text'])
    for name in sys_names:
        ex += [b['text'] for b in e['by_system'].get(name, [])]
    if reused:
        ex += [b['text'] for b in e.get('reused_takeover', [])]
    if fl.get('new_construction'):
        ex += [b['text'] for b in e.get('new_construction', [])]
    ex = _unique(ex)
    if last:
        ex.append(last)
    return clar, ex


def _unique(texts):
    """The texts in order, each printed once."""
    seen, out = set(), []
    for t in texts:
        if t not in seen:
            seen.add(t); out.append(t)
    return out


def _sow_paragraph(s, L):
    """One System's scope-of-work paragraph: its template from the bullet
    library, the record's coverage and extra sentences, and the closer."""
    sys_name = s['system']
    tpl = L['sow_templates'].get(sys_name)
    if not tpl:
        raise SystemExit(f'no SOW template for system "{sys_name}"')
    parts = [tpl.format(designation=s['designation'])]
    if s['scope'].get('coverage_sentence'):
        parts.append(s['scope']['coverage_sentence'])
    parts += list(s['scope'].get('extra_sentences', []))
    closer = L.get('sow_closer_by_system', {}).get(sys_name)
    if closer is None:
        closer = L['sow_closer_fire'] if sys_name == 'Fire Alarm' else L['sow_closer']
    if closer:
        parts.append(closer)
    return ' '.join(p.strip() for p in parts if p.strip())


def build_sow(f, L):
    """The scope of work: one paragraph per System, in the order the Systems
    appear under Equipment and Labor. With more than one System each
    paragraph opens with its label — the System's approved name and a colon
    — per the per-System labelled paragraph form of references/SOW-BASELINES.md
    §1; a single System keeps the unlabelled paragraph the cell map's A15
    row describes, so single-System output is unchanged."""
    paragraphs = [_sow_paragraph(s, L) for s in f['systems']]
    if len(paragraphs) == 1:
        return paragraphs[0]
    return (CR * 2).join(f"{s['system']}: {p}" for s, p in zip(f['systems'], paragraphs))


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


def _systems_label(names):
    """The Systems a schedule carries, as its filename names them: one name
    alone, two joined with '&', three or more comma-separated with '&'
    before the last. A character a Windows filename cannot carry becomes
    '-' (the approved name Audio/Visual is the case)."""
    if len(names) == 1:
        label = names[0]
    elif len(names) == 2:
        label = ' & '.join(names)
    else:
        label = ', '.join(names[:-1]) + ', & ' + names[-1]
    return re.sub(r'[<>:"/\\|?*]', '-', label)


def plan_equipment_rows(systems):
    """The rows of the Equipment and Labor fill region (EQ_START..EQ_END),
    top to bottom: ``('blank', None)`` then ``('system', name)`` for every
    System after the first (the first System's line is the template's own
    EQ_SYS_ROW) and ``('item', line)`` for every equipment line — the
    repeated System sub-blocks of references/SCHEDULE-GENERATION-PROCEDURE.md
    §4, one blank spacer row between consecutive sub-blocks.

    Refuses before anything is written when one System's lines exceed the
    per-System cap or the region cannot hold every System, naming the
    System where the overflow begins."""
    rows, offender = [], None
    for k, s in enumerate(systems):
        eq = s['equipment']
        if len(eq) > EQ_CAP:
            whom = f" for System {s['system']!r}" if len(systems) > 1 else ''
            raise SystemExit(f'{len(eq)} equipment lines{whom} exceed the {EQ_CAP}-line '
                             'cap in the schedule template. Split the schedule '
                             'across two packages.')
        if k:
            rows += [('blank', None), ('system', s['system'])]
        rows += [('item', item) for item in eq]
        if len(rows) > EQ_CAP and offender is None:
            offender = s['system']
    if offender is not None:
        n_items = sum(len(s['equipment']) for s in systems)
        raise SystemExit(
            f'the Equipment and Labor region of the schedule template holds '
            f'{EQ_CAP} rows; {len(systems)} Systems need {len(rows)} ({n_items} '
            f'equipment lines plus {len(systems) - 1} System lines, each behind '
            f'a blank spacer row), '
            f'{len(rows) - EQ_CAP} more than it has, and the overflow begins '
            f'inside System {offender!r}. Split the schedule across two packages.')
    return rows


def _service_buckets(s):
    """One System's service lines partitioned by kind, in record order
    (owner ruling 2026-09-01: GROUPED-FILL). A missing kind defaults to
    "new" with a warning (the ruling's "absent tag defaults to New,
    validator flags missing tag" clause); an unknown kind refuses; a
    subgroup over its cap refuses, naming the System and the subgroup."""
    buckets = {k: [] for k in SVC_KINDS}
    for idx, svc in enumerate(s['services']):
        kind = svc.get('kind')
        if kind is None:
            print(f'WARNING: service #{idx + 1} of System {s["system"]!r} missing '
                  f'"kind" tag; defaulting to "new". Add "kind": "new"/"replacement"/'
                  f'"existing" to _facts.json services.', file=sys.stderr)
            kind = 'new'
        if kind not in SVC_KINDS:
            raise SystemExit(f'service #{idx + 1} of System {s["system"]!r} has '
                             f'unknown kind "{kind}"; allowed: {", ".join(SVC_KINDS)}')
        buckets[kind].append(svc)
    for kind, _, cap, _, _ in SVC_SUBGROUPS:
        if len(buckets[kind]) > cap:
            raise SystemExit(
                f'{len(buckets[kind])} {kind} service lines for System '
                f'{s["system"]!r} exceed the {cap}-line cap for that subgroup in '
                'the schedule template. Split the schedule across two packages.')
    return buckets


def plan_service_rows(systems):
    """How the Services region is filled, decided before anything is written.

    ``None`` when no System sells a service (the section then reads N/A).
    One System with services keeps the template's fixed subgroup rows:
    ``('grouped', system, buckets)``. Two or more fill the region from the
    System line at SVC_SYS_ROW down to SVC_END, top to bottom, with one
    System sub-block per System that carries services, a subgroup label
    row only for the subgroups that carry lines and one blank spacer row
    between consecutive sub-blocks (references/
    SCHEDULE-GENERATION-PROCEDURE.md §4): ``('sequential', rows)`` where
    each row is ``('blank', None)``, ``('system', name)``, ``('label',
    kind)`` or ``('item', service)``. A region that cannot hold every
    System refuses, naming the System where the overflow begins."""
    selling = [(s, _service_buckets(s)) for s in systems if s['services']]
    if not selling:
        return None
    if len(selling) == 1:
        return ('grouped',) + selling[0]
    rows, offender = [], None
    for s, buckets in selling:
        if rows:
            rows.append(('blank', None))
        rows.append(('system', s['system']))
        for kind, *_ in SVC_SUBGROUPS:
            if buckets[kind]:
                rows.append(('label', kind))
                rows += [('item', svc) for svc in buckets[kind]]
        if len(rows) > SVC_REGION_ROWS and offender is None:
            offender = s['system']
    if offender is not None:
        raise SystemExit(
            f'the Services region of the schedule template holds {SVC_REGION_ROWS} '
            f'rows; {len(selling)} Systems need {len(rows)} (System lines, subgroup '
            f'labels, service lines and one blank spacer row between Systems), '
            f'{len(rows) - SVC_REGION_ROWS} more than it '
            f'has, and the overflow begins inside System {offender!r}. Split the '
            'schedule across two packages.')
    return ('sequential', rows)


def _write_service(w, r, s):
    w.set_num(SHEET, f'A{r}', s['qty'])
    w.set_inline_text(SHEET, f'B{r}', s['description'])
    w.set_num(SHEET, f'F{r}', s['unit'])
    w.set_num(SHEET, f'G{r}', round(s['qty'] * s['unit'], 2))


def build_schedule(job, f, L, R):
    cust, deal, pr, systems = f['customer'], f['deal'], f['pricing'], f['systems']
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

    # Lay every row out before the template is copied, so a refusal (a
    # region that cannot hold the schedule, a subgroup over its cap) writes
    # nothing into the job folder.
    eq_rows = plan_equipment_rows(systems)
    svc_plan = plan_service_rows(systems)
    sow = build_sow(f, L)
    clar, ex = select_bullets(f, L)

    out = os.path.join(job, f"{cust['site_name']}_{_slug(cust['site_address'])} - "
                            f"{_systems_label([s['system'] for s in systems])} "
                            "Equip & Svc Schedule.xlsx")
    os.makedirs(R.to_delete, exist_ok=True)
    shutil.copy2(R.schedule_template, out)
    bak = os.path.join(R.to_delete, os.path.basename(out).replace('.xlsx', ' BACKUP pre-build.xlsx'))
    shutil.copy2(R.schedule_template, bak)

    w = X.Workbook(out)
    w.set_inline_text(SHEET, 'A10', sub)
    w.set_inline_text(SHEET, 'C10', site)
    w.set_inline_text(SHEET, 'G10', deal['rep'])
    w.set_inline_text(SHEET, 'G11', str(deal['prospect']))
    w.set_inline_text(SHEET, 'A15', sow)

    price = float(pr['price'])
    w.set_inline_text(SHEET, 'B21', siteline)
    w.set_num(SHEET, 'F21', price)
    w.set_num(SHEET, 'G21', price)
    w.set_inline_text(SHEET, f'B{EQ_SYS_ROW}', f"System: {systems[0]['system']}")
    for i, (role, payload) in enumerate(eq_rows):
        r = EQ_START + i
        if role == 'blank':
            continue        # the template's fill rows are empty already
        if role == 'system':
            w.copy_row_styles(SHEET, EQ_SYS_ROW, r)
            w.set_inline_text(SHEET, f'B{r}', f'System: {payload}')
        else:
            w.set_num(SHEET, f'A{r}', payload['qty'])
            w.set_inline_text(SHEET, f'B{r}', payload['description'])
    # Row-visibility toggle across the equipment fill region. Filled rows
    # unhidden, unused rows hidden — no row insertion, no reindexing (issue 39).
    for i in range(EQ_CAP):
        w.set_row_hidden(SHEET, EQ_START + i, hidden=(i >= len(eq_rows)))

    dep = pr.get('deposit')
    if dep is None:
        dep = round(price * 0.5, 2) if (price > 5000 and deal.get('paid_by') == 'subscriber') else 0
    w.set_num(SHEET, DEP_CELL, dep)

    if svc_plan is None:
        w.set_inline_text(SHEET, SVC_SITE_CELL, 'N/A')
    elif svc_plan[0] == 'grouped':
        # One System sells services: the template's fixed subgroup rows.
        # Per-subgroup fill + row-visibility toggle. Labels are never
        # cleared; the label row is hidden only when the subgroup is unused.
        _, s, buckets = svc_plan
        w.set_inline_text(SHEET, SVC_SITE_CELL, siteline)
        w.set_inline_text(SHEET, SVC_SYS_CELL, f"System: {s['system']}")
        for kind, start, cap, label_cell, label_row in SVC_SUBGROUPS:
            items = buckets[kind]
            for i, svc in enumerate(items):
                _write_service(w, start + i, svc)
            for i in range(cap):
                w.set_row_hidden(SHEET, start + i, hidden=(i >= len(items)))
            # Hide the label row only for Replacement/Existing when their
            # subgroup is empty. The New label (row 81) is always kept
            # visible: New is the default kind and its label is the anchor
            # for the whole services block.
            if kind != 'new':
                w.set_row_hidden(SHEET, label_row, hidden=(not items))
    else:
        # Two or more Systems sell services: one System sub-block after
        # another from the System line down, each row styled like the
        # template's own row for that role. A spacer row takes the item
        # row's look and is cleared, since it may land on one of the
        # template's own subgroup label rows.
        _, rows = svc_plan
        w.set_inline_text(SHEET, SVC_SITE_CELL, siteline)
        style_row = {'system': SVC_SYS_ROW, 'label': SVC_LABEL_ROW,
                     'item': SVC_ITEM_ROW, 'blank': SVC_ITEM_ROW}
        for i, (role, payload) in enumerate(rows):
            r = SVC_SYS_ROW + i
            if r != style_row[role]:
                w.copy_row_styles(SHEET, style_row[role], r)
            if role == 'blank':
                w.set_inline_text(SHEET, f'B{r}', '')
            elif role == 'system':
                w.set_inline_text(SHEET, f'B{r}', f'System: {payload}')
            elif role == 'label':
                w.set_inline_text(SHEET, f'B{r}', SVC_LABELS[payload])
            else:
                _write_service(w, r, payload)
        for r in range(SVC_SYS_ROW + 1, SVC_END + 1):
            w.set_row_hidden(SHEET, r, hidden=(r - SVC_SYS_ROW >= len(rows)))

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


def _fire_master_rmr(systems):
    """(monitoring, inspection, repair_service) monthly amounts for the
    Commercial Fire master, each summed across the Systems that carry a
    canonical line of that category (spec 215 stream B: RMR categories sum
    across Systems into the master's fields); inside one System the first
    canonical line of a category is the one that counts (issue 33). None
    for a category no System carries."""
    cats = ('monitoring', 'inspection', 'repair_service')
    totals = dict.fromkeys(cats)
    for s in systems:
        for cat, pick in zip(cats, _categorize_fire_master_rmr(s['services'])):
            if pick is not None:
                totals[cat] = (totals[cat] or 0.0) + float(pick['unit'])
    return tuple(totals[c] for c in cats)


def build_agreements(job, f, R):
    from pypdf import PdfReader, PdfWriter
    deal, cust = f['deal'], f['customer']
    if not any(s['system'] == 'Fire Alarm' for s in f['systems']):
        return None, None, 'only the Commercial Fire form is mapped so far'
    folder, mname, rname = PACKAGES['Fire Alarm']
    mpath = os.path.join(R.agreements_root, folder, mname)
    rpath = os.path.join(R.agreements_root, folder, rname)
    if not os.path.exists(mpath):
        return None, None, f'agreement forms not reachable at {mpath}'

    mon, insp, rep = _fire_master_rmr(f['systems'])
    amount = lambda x: f'{x:.2f}' if x is not None else 'N/A'

    text = {
        FIRE['name']: cust['subscriber_name'],
        FIRE['phone']: cust.get('phone', ''),
        FIRE['address']: cust['billing_address'].replace('\n', ', '),
        FIRE['email']: cust.get('email', ''),
        FIRE['cell']: cust.get('cell', ''),
        FIRE['comm_value']: 'N/A',
        FIRE['monitoring']: amount(mon),
        FIRE['service_monthly']: amount(rep),
        FIRE['inspection']: amount(insp),
        FIRE['inspections_per_year']: f.get('deal', {}).get('inspections_per_year', '') or
                                     ('one (1)' if insp is not None else 'N/A'),
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
        FIRE['cb_monitoring']: mon is not None,
        FIRE['cb_service_percall']: rep is None, FIRE['cb_service_monthly']: rep is not None,
        FIRE['cb_inspections']: insp is not None, FIRE['cb_insp_fire']: insp is not None,
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
    raw = read_record(job)
    plan = compose(raw)          # every refusal here lands before a byte is written
    f, L = _flatten_v1(raw), lib()
    print('=' * 78)
    print('BUILD —', f['customer']['subscriber_name'], '|',
          '; '.join(f"{s['system']} ({s['designation']})" for s in f['systems']),
          '|', plan['family'], '|', f'{PACKAGE_RULES} §{plan["section"]}')
    print('=' * 78)

    sched, changed, nc, ne, dep = build_schedule(job, f, L, R)
    print('schedule  ', os.path.basename(sched))
    print('           zip parts changed:', ', '.join(changed))
    print(f'           {nc} clarifications, {ne} exclusions, deposit {dep:,.2f}')

    written = {'schedule'}
    if plan['agreements']:
        mo, ro, why = build_agreements(job, f, R)
    else:
        mo = ro = None
        why = (f'not part of this package: {PACKAGE_RULES} §{plan["section"]} '
               f'({plan["situation"]})')
    if why:
        print('agreements skipped:', why)
    else:
        print('master    ', os.path.basename(mo))
        print('rider     ', os.path.basename(ro))
        written |= {'master', 'rider'}

    # Handoff: the rest of the package for this situation, as the rules file
    # lists it (read at run time), less the documents written above.
    remaining = [d for d in plan['documents']
                 if not any(d.lower().startswith(_GENERATED_DOC_PREFIXES[w])
                            for w in written)]
    print(f'\nHANDOFF — {PACKAGE_RULES} §{plan["section"]}: {plan["situation"]}')
    print('  written by this build:', ', '.join(sorted(written)))
    print('  still required for this situation, not generated by this tool:')
    for d in remaining:
        print('   -', d)
    print(f'  standing notes {PACKAGE_RULES} §2.5–§2.8 apply to every package.')

    if f.get('held'):
        print('\nHELD, left unwritten until answered:')
        for h in f['held']:
            print('  -', h)

    if not a.no_verify:
        print(); sys.stdout.flush()
        os.system(f'"{sys.executable}" "{os.path.join(HERE, "verify_package.py")}" "{job}" --quiet')


if __name__ == '__main__':
    main()
