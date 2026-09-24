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
EQ_SITE_ROW = 21         # the template's own Site line (A21/B21/F21/G21)
EQ_SYS_ROW = 22          # the template's own System line (B22)
EQ_START = 23
EQ_CAP = 50
EQ_END = EQ_START + EQ_CAP - 1  # row 72
DEP_CELL = 'G74'
SVC_SITE_ROW = 79        # the template's own Site line under Services (A79/B79)
SVC_SITE_CELL = f'B{SVC_SITE_ROW}'
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
# styles for that role (rows EQ_SITE_ROW, EQ_SYS_ROW, SVC_SITE_ROW,
# SVC_SYS_ROW, SVC_LABEL_ROW, SVC_ITEM_ROW) through
# xlsx_surgical.copy_row_styles; rows are hidden or shown, never inserted or
# deleted, and a region that cannot hold the schedule refuses before
# anything is written.
#
# Multi-Site schedule (issue #227, spec 215 stream B): the same two regions
# also repeat one Site block per Site, the first Site's own line being the
# template's fixed EQ_SITE_ROW/SVC_SITE_ROW row and every further Site
# taking one row of the fill region, carrying that Site's price in F/G under
# Equipment and Labor. A further Site's own first System sits directly below
# its Site line with no spacer row (matching the template's own row
# 21-then-22), the same rule the first Site's own first System already
# follows; the blank-spacer ruling above still separates a Site's second and
# later System sub-blocks.
SVC_LABEL_ROW = SVC_SUBGROUPS[0][4]                      # 81
SVC_ITEM_ROW = SVC_START                                 # 82
SVC_REGION_ROWS = SVC_END - SVC_SYS_ROW + 1              # 24
CLAR_CELL = 'A107'

# Keyed by the Contract family compose() resolves (references/SOW-BASELINES.md
# §3), not by system name — a Project can carry several System types in one
# family (issue 336).
PACKAGES = {
    'Commercial Fire':     ('Commercial Fire Package',
                         'Subscriber - Fire Master Agreement Rev.1.pdf',
                         'Subscriber - Fire Rider Additional Locations Rev.1.pdf'),
    'Commercial Security': ('Commercial Security Package',
                         'Commercial Security Master Agreement Rev.1.pdf',
                         'Commercial - Security Rider Additional Locations Rev.1.pdf'),
    'Elevator Monitoring': ('Elevator Package',
                         'Elevator Monitoring Agreement.pdf',
                         'Elevator - Security Rider Additional Locations Rev.1.pdf'),
}
# Forms this builder can fill. build_agreements refuses any other family by
# name (issue 40's field-map ruling; Elevator Monitoring is issue 335,
# Residential is issue 337).
MAPPED_FAMILIES = tuple(PACKAGES)
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

# Commercial Security Master Agreement field map, derived from the form's own
# field dump (issue #40 evidence comment, 58 fields; ruling 1 in the same
# thread: every mapped box is set explicitly, template state never consulted).
# Field names are exactly what pypdf's PdfReader.get_fields() returns for
# fixtures/New Agreements 8-22-19/Commercial Security Package/Commercial
# Security Master Agreement Rev.1.pdf — some carry a leading "." from the
# form's own AcroForm hierarchy; that is not a naming convention this file
# chose, it is copied verbatim from the field dump.
SECURITY = {
    'date': 'Text1', 'name': 'Text2', 'address': 'Text3', 'phone': 'Text4',
    'cell': 'Text5', 'purchase_price': 'Text6', 'down_payment': 'Text7',
    'balance_due': 'Text10', 'work_begin_date': '.Text11',
    'completion_date': '.Text12', 'charge_install': '.Text11_2',
    'charge_monitoring': '.Text12_2', 'charge_service': 'Text14',
    'charge_inspection': 'Text15', 'inspections_per_year': 'Text16',
    'charge_signal_verification': '.Text17', 'charge_remote_access': 'Text18',
    'remote_access_other_describe': '.Text8', 'charge_access_control': 'Text19',
    'charge_self_monitoring': 'Text22', 'charge_cyber': 'Text23',
    'in_lieu_of_amount': '.Text24', 'term': '.Text25',
    # §2 "Check Services Provided"
    'cb_monitoring_services': 'CheckBox1', 'cb_service': 'CheckBox2',
    'cb_inspection': 'CheckBox3', 'cb_remote_access_cameras': 'CheckBox4',
    'cb_access_control_admin': 'CheckBox5', 'cb_signal_verification': 'CheckBox6',
    'cb_self_monitoring': 'CheckBox7', 'cb_cyber': 'CheckBox8',
    'cb_other': 'CheckBox10',
    # §4 billing frequency
    'cb_billing_monthly': 'CheckBox11', 'cb_billing_quarter': 'CheckBox12',
    'cb_billing_semi': 'CheckBox13', 'cb_billing_annual': 'CheckBox14',
    # §4 service selectors
    'cb_4a_install': 'CheckBox15', 'cb_4a_monitoring': 'CheckBox16',
    'cb_service_percall': 'CheckBox17', 'cb_service_monthly': 'CheckBox18',
    'cb_4c_inspection': 'CheckBox19', 'cb_4d_signal_verification': 'CheckBox20',
    'cb_4e_remote_access': 'CheckBox21', 'cb_4e_recording_device': 'CheckBox22',
    'cb_4e_cloud_storage': 'CheckBox23', 'cb_4e_video_smartphone': 'CheckBox24',
    'cb_4e_self_monitoring': 'CheckBox25', 'cb_4e_remote_access_subscriber': 'CheckBox26',
    'cb_4e_audio': 'CheckBox29', 'cb_4e_other': 'CheckBox30',
    'cb_4f_access_control': 'CheckBox32', 'cb_4f_remote_admin': 'CheckBox33',
    'cb_4f_onsite_admin': 'CheckBox34', 'cb_4f_data_storage': 'CheckBox35',
    'cb_4f_data_backup': 'CheckBox36', 'cb_4g_self_monitoring': 'CheckBox38',
    'cb_4h_cyber': 'CheckBox39', 'cb_in_lieu_of': 'CheckBox40',
}

# Elevator Monitoring Agreement field map (issue #40 evidence comment,
# 2026-08-20: 15 text fields, no checkboxes, term fixed in §5 clause text —
# no field). Unlike the Fire form's widgets, these field names carry no
# leading dot. 'address'/'address2' and 'location'/'location2' and
# 'description'/'description2' are each one logical value split across two
# form blanks on the printed page; this builder always writes the whole
# value into the first blank and leaves the continuation blank empty.
ELEVATOR = {
    'date': 'Text1', 'address': 'Text2', 'name': 'Text3', 'address2': 'Text4',
    'phone': 'Text5', 'cell': 'Text6', 'location': 'Text7', 'location2': 'Text8',
    'description': 'Text9', 'description2': 'Text10', 'comm_channel': 'Text11',
    'connection_charge': 'Text12', 'setup': 'Text13', 'monitoring': 'Text14',
    'frequency': 'Text15',
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


# Commercial Security master §2/§4 RMR-to-box mapping (issue 336; issue #40's
# ruling 4: the box for each sold RMR line is the "Contract selections"
# column of the RMR Items sheet "Standard RMR" tab, repo snapshot
# fixtures/google-drive/RMR-Items-2026-08-19.xlsx, Drive-authoritative per
# the issue #15 ruling — MAPPING-APPENDIX.md §3 is the companion pricing/
# description view of the same lines). Names are hardcoded from that column,
# the same pattern the Fire recognizer above uses for its canonical names,
# and cross-checked against the fixture by
# tests/test_build_package_security_rmr_recognition.py so a Drive-side
# rename fails a test instead of drifting silently.
#
# 'monitoring' / 'monitoring_smart': Contract selections = "Monitoring
# Center Charges" (smart tiers add "+ Remote Access by Subscriber").
_SECURITY_MONITORING_NAMES = (
    'Commercial Security Monitoring via Phone Line',
    'Commercial Security Monitoring via Cellular Radio',
)
_SECURITY_MONITORING_SMART_NAMES = (
    'Commercial Smart Security Monitoring via Cellular Radio',
    'Commercial Smart Building Security Monitoring via Cellular Radio',
)
# 'remote_access': Contract selections = "Remote Access by Subscriber" alone.
_SECURITY_REMOTE_ACCESS_NAMES = (
    'DMP Advanced Reporting, per door (ethernet)',
    'DMP Advanced Reporting, per door (cellular)',
    'Elements Cloud Access Control, per door',
    'Eagle Eye - 911 Camera Sharing (monthly fee per camera)',
)
# 'remote_access_video': Contract selections = "Remote Access by Subscriber"
# plus "Video Data to Subscriber's Smart Phone" and "Cloud Service Data
# Storage and Retrieval" (several also add "Recording Device"). Approximated
# here as one bucket that ticks all three §4(e) sub-boxes — the sheet does
# not need per-line sub-box precision for this ticket's acceptance criteria;
# splitting the sub-boxes item-by-item is a follow-on (see the discovery
# filed with this ticket).
_SECURITY_REMOTE_ACCESS_VIDEO_NAMES = (
    'DMP Video - 4000/5000 Series - up to 8 Cameras',
    'DMP Video - 4000/5000 Series - up to 12 Cameras',
    'DMP Video - 4000/5000 Series - up to 16 Cameras',
    'DMP Video - 6000 Series Cloud Services - up to 8 Cameras',
    'DMP Video - 6000 Series Cloud Services - up to 12 Cameras',
    'DMP Video - 6000 Series Cloud Services - up to 16 Cameras',
    'DMP Video - 6000 Series - Smart Analytics (per camera)',
    'DMP Video - XV Gateways AlarmVision Advanced Analytics, per camera',
    'DMP - Virtual Keypad Video Doorbell License',
    'VX Series Standard Camera Package - 4 Devices, 7-Day Storage',
    'VX Series Standard Camera Package - 4 Devices, 30-Day Storage',
    'VX Series Single Doorbell Package - 1 Device, 30-Day Storage',
    'VX Series Extended Camera Package - 12 Devices, 30-Day Storage',
    'Alarm.com Pro Video',
    'Alarm.com Pro Video with Analytics',
    'Alarm.com Premium Video',
    'Alarm.com Video Expansion add-on',
    'Total Connect Video - 7 Day Storage',
    'Total Connect Video - 30 Day Storage',
    'Total Connect Video - Additional Camera Storage',
    'Remote Video Services for Local Video System',
    'Maxpro Cloud Video Service - Recorder',
    'Maxpro Cloud Video Service - Camera cloud storage',
    'Alta Cloud Access Control, Video Intercom Cloud Storage - 30 Days',
    'Alta Cloud Access Control, Video Intercom Cloud Storage - 60 Days',
    'Alta Intercom License, Premium',
    'Alta Cloud Video with Analytics and 30 Days of Cloud Storage - Per Camera',
    'Alta Cloud Video with Analytics and 60 Days of Cloud Storage - Per Camera',
    'Alta Cloud Video with Analytics and 90 Days of Cloud Storage - Per Camera',
    'Alta Cloud LPR Analytics Add-On - Per Camera',
    'Eagle Eye Cloud VMS, 1 FPS, 30-day storage, per camera',
    'Monthly Eagle Eye Networks VMS Per Camera License with 1MP, 30 Days Retention',
    # Sheet row 102 carries a typo ("Ca,era") and an embedded newline;
    # quoted verbatim rather than silently corrected (hard rule 1 — this
    # file cites the sheet, it does not restate a cleaned-up version of it).
    '180deg. Cabinet Appliance with Solar/Cellular/Back-up Battery \n'
    'monthly charge per Cabinet/Ca,era Appliance',
    '4MP 60-day retention cloud recording monthly per camera',
)
# 'access_control_other': Contract selections = "Remote Access by
# Subscriber" + 'Other "See Schedule"' — the combine route (MAPPING-
# APPENDIX.md §1 rule 6) always applies to these.
_SECURITY_ACCESS_CONTROL_OTHER_NAMES = (
    'Win-Pak Hosted Access Control - each door',
    'Maxpro Cloud Access Control - per door',
    'Alta Cloud Access Control, Basic Tier - Up to X Entry/Entries',
    'Alta Cloud Access Control, Premium Tier - Up to X Entry/Entries',
    'Alta Cloud Access Control, Enterprise Tier - Up to X Entry/Entries',
    'Brivo Access Professional Edition - Base Plan',
    'Brivo Access Professional Edition - Reader Tier 1',
    'Brivo Access Standard Edition - Base Data Plan Yearly',
    'Brivo Access Standard Edition - Tier 1 Reader Data Plan',
    'Brivo Access Standard Edition - Tier 2 Reader Data Plan',
    'Brivo Access Standard Edition - Tier 3 Reader Data Plan',
)
# 'other_only': Contract selections = 'Other "See Schedule"' alone — also
# always the combine route.
_SECURITY_OTHER_ONLY_NAMES = (
    'Honeywell WIN-PAK SMU (Software Maintenance Upgrade Program)',
    'Standard Software Support Agreement - Pro-Watch XXXXX Edition',
    'Software Upgrade Agreement',
    'Azure Active Directory, 500 users, 60-minute sync, Alta Access',
    'Azure Active Directory, 1000 users, 60-minute sync, Alta Access',
    'Azure Active Directory, 500 users, 15-minute sync, Alta Access',
    'Azure Active Directory, 1000 users, 15-minute sync, Alta Access',
    'Remote Tech Support',
    'Communication Assurance Program',
)
# 'self_monitoring': Contract selections = "Self-Monitoring (under Remote
# Subscriber Access)".
_SECURITY_SELF_MONITORING_NAMES = ('Maxpro Cloud Health Notifications',)
# 'signal_verification': closest existing CS-form box is §2/§4(d) "Alarm
# Signal Verification" — the sheet's own box name is "Video Verification",
# which this form does not carry as a separate box. Best-fit mapping,
# recorded as a discovery with this ticket rather than left silent.
_SECURITY_SIGNAL_VERIFICATION_NAMES = ('Video Alarm Verification Service',)
# 'no_rmr': generates no recurring line at all. Not a Standard RMR tab row
# (Axis-based access control needs no hosted service, so the RMR sheet
# carries nothing for it); cited from MAPPING-APPENDIX.md §3 instead, whose
# note says exactly this ("If no RMR is sold... read 'N/A'").
_SECURITY_NO_RMR_NAMES = ('Axis-based Access Control — no hosted service',)
# 'unmapped': the RMR Items sheet leaves Contract selections blank or marks
# it "?" for these rows (ruling 4) — the box stays unticked and the sold
# line is named as a question in the handoff text, never guessed.
_SECURITY_UNMAPPED_NAMES = (
    '50 additional intercom call recipients, Alta Access Control',
    '500 additional active users, Alta Access Control',
    '1000 additional active users, Alta Access Control',
    'Alta Cloud Access Control, Mobile Credentials - 10 Users',
)


def _security_rmr_lookup():
    table = {}
    groups = (
        ('monitoring', _SECURITY_MONITORING_NAMES),
        ('monitoring_smart', _SECURITY_MONITORING_SMART_NAMES),
        ('remote_access', _SECURITY_REMOTE_ACCESS_NAMES),
        ('remote_access_video', _SECURITY_REMOTE_ACCESS_VIDEO_NAMES),
        ('access_control_other', _SECURITY_ACCESS_CONTROL_OTHER_NAMES),
        ('other_only', _SECURITY_OTHER_ONLY_NAMES),
        ('self_monitoring', _SECURITY_SELF_MONITORING_NAMES),
        ('signal_verification', _SECURITY_SIGNAL_VERIFICATION_NAMES),
        ('no_rmr', _SECURITY_NO_RMR_NAMES),
        ('unmapped', _SECURITY_UNMAPPED_NAMES),
        ('repair_service', _FIRE_MASTER_REPAIR_SERVICE_NAMES),
    )
    for cat, names in groups:
        for n in names:
            table[_norm_desc(n)] = cat
    return table


_SECURITY_RMR_CATEGORY = _security_rmr_lookup()
_SECURITY_AMOUNT_CATS = ('monitoring', 'monitoring_smart', 'remote_access',
                         'remote_access_video', 'access_control_other',
                         'other_only', 'self_monitoring', 'signal_verification')


def _categorize_security_master_rmr(systems):
    """Categorize every service line across ``systems`` for the Commercial
    Security master's §2/§4 boxes (RMR amounts sum across Systems the way
    issue #226 does for the Fire fields). Returns ``(amounts, unmapped)``:
    ``amounts`` maps each of ``_SECURITY_AMOUNT_CATS`` to a summed monthly
    dollar figure (``qty * unit``) or ``None`` when nothing sold that
    category; ``unmapped`` lists ``(system_name, service)`` pairs whose RMR
    row carries no Contract selections value (ruling 4) — never guessed,
    always a question for the handoff. Repair Service and "no RMR" lines are
    recognized but excluded from ``amounts`` — Repair Service drives the
    §2/§4(b) service box separately (ruling 3) and "no RMR" lines drive
    nothing. A description this table does not recognize at all is left
    alone, same as the Fire recognizer's treatment of non-Fire-master lines.
    """
    amounts = dict.fromkeys(_SECURITY_AMOUNT_CATS)
    unmapped = []
    for s in systems:
        for svc in s.get('services') or ():
            cat = _SECURITY_RMR_CATEGORY.get(_norm_desc(svc.get('description', '')))
            if cat in (None, 'no_rmr', 'repair_service'):
                continue
            if cat == 'unmapped':
                unmapped.append((s['system'], svc))
                continue
            amt = float(svc.get('qty', 1)) * float(svc.get('unit', 0))
            amounts[cat] = (amounts[cat] or 0.0) + amt
    return amounts, unmapped


# Canonical Elevator Monitoring master RMR names, cited from
# skill/aac-contract-package/references/MAPPING-APPENDIX.md §3. Same
# false-positive-guarded pattern as the Fire master's category matcher
# above, with one category (the form's one monitoring $ field).
_ELEVATOR_MASTER_MONITORING_NAMES = (
    'Elevator Monitoring via Phone Line',
    'Cellular Elevator Monitoring with Equipment Lease',
)


def _categorize_elevator_master_rmr(services):
    """The one Elevator-master monitoring RMR line, matched against the
    canonical names above. A description that trips the 'elevator
    monitoring' trigger substring but is not a canonical name raises
    SystemExit naming the offending line — never a silent best-effort fill
    (mirrors _categorize_fire_master_rmr's trigger/whitelist pattern)."""
    canonical = {_norm_desc(x) for x in _ELEVATOR_MASTER_MONITORING_NAMES}
    for s in services or ():
        desc = s.get('description', '')
        n = _norm_desc(desc)
        if 'elevator monitoring' not in n:
            continue
        if n not in canonical:
            raise SystemExit(
                'build_agreements: services description '
                f'{desc!r} tripped the elevator-master "elevator monitoring" '
                'matcher but is not a canonical Elevator-master RMR name. '
                'Accepted names per skill/aac-contract-package/references/'
                'MAPPING-APPENDIX.md §3:\n  ' +
                '\n  '.join(repr(x) for x in _ELEVATOR_MASTER_MONITORING_NAMES) +
                '\nFix the services entry in _facts.json (either quote a '
                'canonical name, or remove the line if it does not belong '
                'on the Elevator master).'
            )
        return s
    return None


def _elevator_master_rmr(systems):
    """The Elevator master's one monthly monitoring amount, summed across
    the Systems that carry a canonical line (mirrors _fire_master_rmr's
    category-sum pattern); None when no System carries one."""
    total = None
    for s in systems:
        pick = _categorize_elevator_master_rmr(s['services'])
        if pick is not None:
            total = (total or 0.0) + float(pick['unit'])
    return total


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


def _sys_entry(sysrec):
    """One System record in the working shape build_schedule / build_sow /
    select_bullets consume: designation, scope, equipment and services,
    with missing optional blocks defaulted to empty (Q7 Resolved in
    references/FACTS-SCHEMA.md); a missing kind tag on a service line is
    left absent and the services fill warns and defaults to "new"."""
    scope = sysrec.get('scope') or {}
    return {
        'system': sysrec['system'],
        'designation': sysrec['designation'],
        'scope': {
            'coverage_sentence': scope.get('coverage_sentence', ''),
            'extra_sentences': list(scope.get('extra_sentences') or []),
        },
        'equipment': list(sysrec.get('equipment') or []),
        'services': list(sysrec.get('services') or []),
    }


def _flatten_v1(f):
    """Normalise a v1.0 tree record into the working shape build_schedule /
    build_agreements / select_bullets / build_sow consume.

    ``systems`` is every System of every Site, in record order — the shape
    #226 introduced, unchanged here — for the code that reasons about the
    whole Project (the SOW, clarification and exclusion selection, the
    Contract-family RMR rollups). ``sites`` is new for #227: one entry per
    Site, each carrying its own price and its own ``systems`` slice, for
    the code that lays out the repeated Site blocks (``plan_equipment_rows``,
    ``plan_service_rows``, ``build_schedule``). A single-Site record is the
    same shape with one entry in ``sites``.

    ``customer.site_name``/``site_address`` and ``pricing`` continue to
    name one Site and one price the way they did before #227, for the
    header block (A10/C10), the schedule and agreement filenames and the
    payments-bullet threshold — none of which the amended cell map (
    references/SCHEDULE-GENERATION-PROCEDURE.md §4) says anything about for
    more than one Site. ``customer.site_name``/``site_address`` take the
    first Site (the schedule's header predates the multi-Site amendment and
    is silent on it); ``pricing.price`` is the total Purchase Price across
    every Site's line (what G73 sums to). ``pricing.deposit`` is ``None``
    (build_schedule's standing 50%-over-$5,000 rule then applies to that
    total, unchanged from before #227) when no Site sets one explicitly, or
    else the sum of every Site's own deposit, an unset Site's own share
    defaulting to $0 — the payments bullet states the 50% rule once, for
    the whole schedule, with no per-Site form, so a Site left unset is not
    given one of its own invention. Both readings are this file's own
    choice, not a standard's — recorded as a discovery for Dan to rule on
    (hard rule 7).

    Package composition and the cross-family refusal (issue #225) run over
    the whole tree in ``compose`` before this normaliser is reached.
    """
    pairs = _tree_systems(f)
    sites_raw = f['sites']

    cust = dict(f.get('customer') or {})
    cust['site_name'] = sites_raw[0]['site_name']
    cust['site_address'] = sites_raw[0]['site_address']

    total_price = sum(float(site['price']) for site in sites_raw)
    # Every Site left ``deposit`` unset: defer to build_schedule's own
    # standing default (the 50%-over-$5,000 rule applied to the aggregate
    # Purchase Price, unchanged from before #227 — single-Site math is the
    # same either way). Any Site sets one explicitly: sum the ones given
    # and default an unset Site's own share to $0 rather than inventing a
    # per-Site reading of a rule the standard states once, for the whole
    # schedule (BASELINES.md's payments bullet has no per-Site form).
    if any(site.get('deposit') is not None for site in sites_raw):
        total_deposit = sum(float(site.get('deposit') or 0) for site in sites_raw)
    else:
        total_deposit = None
    pricing = {
        'price': total_price,
        'price_source': sites_raw[0].get('price_source', ''),
        'deposit': total_deposit,
    }

    systems = [_sys_entry(sysrec) for _, sysrec in pairs]
    sites = [{
        'site_name': site['site_name'],
        'site_address': site['site_address'],
        'price': float(site['price']),
        'systems': [_sys_entry(sysrec) for sysrec in site['systems']],
    } for site in sites_raw]

    return {
        'customer': cust,
        'deal': dict(f.get('deal') or {}),
        'pricing': pricing,
        'systems': systems,
        'sites': sites,
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
    library, the record's coverage and extra sentences, and the closer.

    The designation enters the sentence as the phrase the library maps
    its token to (``sow_designation_phrases``), so the article agrees
    and the addition token reads the way references/SOW-BASELINES.md §2
    says to write it; a token outside §2's four refuses."""
    sys_name = s['system']
    tpl = L['sow_templates'].get(sys_name)
    if not tpl:
        raise SystemExit(f'no SOW template for system "{sys_name}"')
    phrases = L['sow_designation_phrases'].get(s['designation'])
    if phrases is None:
        raise SystemExit(
            f'System {sys_name!r} has designation {s["designation"]!r}; the SOW '
            f'designation token is one of {", ".join(L["sow_designation_phrases"])} '
            '(skill/aac-contract-package/references/SOW-BASELINES.md §2). Fix '
            '_facts.json.')
    parts = [tpl.format(**phrases)]
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


def plan_equipment_rows(sites):
    """The rows of the Equipment and Labor fill region (EQ_START..EQ_END),
    top to bottom: a ``('site', site)`` row (that Site's price, in F/G) for
    every Site after the first, a ``('system', name)`` row for every System
    after the very first System of the very first Site, and ``('item',
    line)`` for every equipment line — the repeated Site and System
    sub-blocks of references/SCHEDULE-GENERATION-PROCEDURE.md §4 (issues
    #226 and #227). The very first Site's own line is the template's fixed
    EQ_SITE_ROW/EQ_SYS_ROW pair, so neither gets a row here. A Site's own
    first System follows its Site row directly, with no spacer (matching
    the template's own row 21-then-22); one blank spacer row still
    separates a Site's second and later System sub-blocks (owner ruling
    2026-09-18).

    Refuses before anything is written when one System's lines exceed the
    per-System cap or the region cannot hold every Site and System, naming
    the System (and, with more than one Site, the Site) where the overflow
    begins."""
    rows, offender = [], None
    very_first = True
    for site in sites:
        systems = site['systems']
        if not very_first:
            rows.append(('site', site))
        for k, s in enumerate(systems):
            eq = s['equipment']
            if len(eq) > EQ_CAP:
                whom = f" for System {s['system']!r}" if (len(sites) > 1 or len(systems) > 1) else ''
                raise SystemExit(f'{len(eq)} equipment lines{whom} exceed the {EQ_CAP}-line '
                                 'cap in the schedule template. Split the schedule '
                                 'across two packages.')
            if very_first:
                very_first = False
            elif k == 0:
                rows.append(('system', s['system']))
            else:
                rows += [('blank', None), ('system', s['system'])]
            rows += [('item', item) for item in eq]
            if len(rows) > EQ_CAP and offender is None:
                offender = (s['system'], site['site_name'] if len(sites) > 1 else None)
    if offender is not None:
        off_sys, off_site = offender
        n_systems = sum(len(s['systems']) for s in sites)
        n_items = sum(len(sy['equipment']) for s in sites for sy in s['systems'])
        if len(sites) == 1:
            raise SystemExit(
                f'the Equipment and Labor region of the schedule template holds '
                f'{EQ_CAP} rows; {n_systems} Systems need {len(rows)} ({n_items} '
                f'equipment lines plus {n_systems - 1} System lines, each behind '
                f'a blank spacer row), '
                f'{len(rows) - EQ_CAP} more than it has, and the overflow begins '
                f'inside System {off_sys!r}. Split the schedule across two packages.')
        raise SystemExit(
            f'the Equipment and Labor region of the schedule template holds '
            f'{EQ_CAP} rows; {len(sites)} Sites and {n_systems} Systems need '
            f'{len(rows)} ({n_items} equipment lines plus Site and System lines, '
            f'some behind a blank spacer row), {len(rows) - EQ_CAP} more than it '
            f'has, and the overflow begins inside System {off_sys!r} at Site '
            f'{off_site!r}. Split the schedule across two packages.')
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


def plan_service_rows(sites):
    """How the Services region is filled, decided before anything is written.

    ``None`` when no System at any Site sells a service (the section then
    reads N/A) — a Site with no selling System carries no Site block here,
    the same way a non-selling System carries no System sub-block. Exactly
    one Site with exactly one selling System keeps the template's fixed
    subgroup rows: ``('grouped', site, system, buckets)``. Everything else
    fills the region from the System line at SVC_SYS_ROW down to SVC_END,
    top to bottom: a ``('site', site)`` row for every selling Site after
    the first (the first selling Site's own line is the template's fixed
    SVC_SITE_ROW), then, within each Site, one System sub-block per selling
    System with a subgroup label row only for the subgroups that carry
    lines, one blank spacer row between a Site's own consecutive System
    sub-blocks and none between a Site row and its own first System
    (references/SCHEDULE-GENERATION-PROCEDURE.md §4, issues #226 and #227):
    ``('sequential', first_selling_site, rows)`` where each row is
    ``('blank', None)``, ``('site', site)``, ``('system', name)``,
    ``('label', kind)`` or ``('item', service)``. A region that cannot hold
    every Site and System refuses, naming the System (and, with more than
    one selling Site, the Site) where the overflow begins."""
    site_selling = []
    for site in sites:
        selling = [(s, _service_buckets(s)) for s in site['systems'] if s['services']]
        if selling:
            site_selling.append((site, selling))
    if not site_selling:
        return None
    if len(site_selling) == 1 and len(site_selling[0][1]) == 1:
        site, selling = site_selling[0]
        s, buckets = selling[0]
        return ('grouped', site, s, buckets)

    rows, offender = [], None
    for site_idx, (site, selling) in enumerate(site_selling):
        if site_idx:
            rows.append(('site', site))
        for sys_idx, (s, buckets) in enumerate(selling):
            just_after_site = bool(site_idx) and sys_idx == 0
            if rows and not just_after_site:
                rows.append(('blank', None))
            rows.append(('system', s['system']))
            for kind, *_ in SVC_SUBGROUPS:
                if buckets[kind]:
                    rows.append(('label', kind))
                    rows += [('item', svc) for svc in buckets[kind]]
            if len(rows) > SVC_REGION_ROWS and offender is None:
                offender = (s['system'], site['site_name'] if len(site_selling) > 1 else None)
    if offender is not None:
        off_sys, off_site = offender
        total_systems = sum(len(sel) for _, sel in site_selling)
        if len(site_selling) == 1:
            raise SystemExit(
                f'the Services region of the schedule template holds {SVC_REGION_ROWS} '
                f'rows; {total_systems} Systems need {len(rows)} (System lines, subgroup '
                f'labels, service lines and one blank spacer row between Systems), '
                f'{len(rows) - SVC_REGION_ROWS} more than it '
                f'has, and the overflow begins inside System {off_sys!r}. Split the '
                'schedule across two packages.')
        raise SystemExit(
            f'the Services region of the schedule template holds {SVC_REGION_ROWS} '
            f'rows; {len(site_selling)} Sites and {total_systems} Systems selling a '
            f'service need {len(rows)} (Site lines, System lines, subgroup labels, '
            f'service lines and blank spacer rows), {len(rows) - SVC_REGION_ROWS} '
            f'more than it has, and the overflow begins inside System {off_sys!r} at '
            f'Site {off_site!r}. Split the schedule across two packages.')
    return ('sequential', site_selling[0][0], rows)


def _write_service(w, r, s):
    w.set_num(SHEET, f'A{r}', s['qty'])
    w.set_inline_text(SHEET, f'B{r}', s['description'])
    w.set_num(SHEET, f'F{r}', s['unit'])
    w.set_num(SHEET, f'G{r}', round(s['qty'] * s['unit'], 2))


def _site_line(site):
    """One Site's 'Site: <name>, <address>' text for a Site line cell."""
    return f"Site: {site['site_name']}, {site['site_address'].replace(chr(10), ', ')}"


def build_schedule(job, f, L, R):
    cust, deal, pr, systems, sites = (f['customer'], f['deal'], f['pricing'],
                                      f['systems'], f['sites'])
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
    eq_rows = plan_equipment_rows(sites)
    svc_plan = plan_service_rows(sites)
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

    price = float(pr['price'])  # aggregate Purchase Price across every Site
    w.set_inline_text(SHEET, 'B21', siteline)
    w.set_num(SHEET, 'F21', sites[0]['price'])
    w.set_num(SHEET, 'G21', sites[0]['price'])
    w.set_inline_text(SHEET, f'B{EQ_SYS_ROW}', f"System: {sites[0]['systems'][0]['system']}")
    for i, (role, payload) in enumerate(eq_rows):
        r = EQ_START + i
        if role == 'blank':
            continue        # the template's fill rows are empty already
        if role == 'site':
            w.copy_row_styles(SHEET, EQ_SITE_ROW, r)
            w.set_inline_text(SHEET, f'A{r}', '-')
            w.set_inline_text(SHEET, f'B{r}', _site_line(payload))
            w.set_num(SHEET, f'F{r}', payload['price'])
            w.set_num(SHEET, f'G{r}', payload['price'])
        elif role == 'system':
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
        # One System at one Site sells services: the template's fixed
        # subgroup rows. Per-subgroup fill + row-visibility toggle. Labels
        # are never cleared; the label row is hidden only when the subgroup
        # is unused. The selling Site need not be the first (issue #227): a
        # Site with no selling System carries no Site block here.
        _, site, s, buckets = svc_plan
        w.set_inline_text(SHEET, SVC_SITE_CELL, _site_line(site))
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
        # More than one selling System, one selling Site, or both: one Site
        # block (and inside it one System sub-block) after another from the
        # System line down, each row styled like the template's own row for
        # that role. A spacer row takes the item row's look and is cleared,
        # since it may land on one of the template's own subgroup label
        # rows. The first selling Site's own line is the template's fixed
        # SVC_SITE_CELL (issue #227; not necessarily ``sites[0]`` when an
        # earlier Site sells nothing).
        _, first_selling_site, rows = svc_plan
        w.set_inline_text(SHEET, SVC_SITE_CELL, _site_line(first_selling_site))
        style_row = {'system': SVC_SYS_ROW, 'label': SVC_LABEL_ROW,
                     'item': SVC_ITEM_ROW, 'blank': SVC_ITEM_ROW,
                     'site': SVC_SITE_ROW}
        for i, (role, payload) in enumerate(rows):
            r = SVC_SYS_ROW + i
            if r != style_row[role]:
                w.copy_row_styles(SHEET, style_row[role], r)
            if role == 'blank':
                w.set_inline_text(SHEET, f'B{r}', '')
            elif role == 'site':
                w.set_inline_text(SHEET, f'A{r}', '-')
                w.set_inline_text(SHEET, f'B{r}', _site_line(payload))
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


def _fill_pdf(src, out, txt, cks):
    """Fill a form's text and checkbox fields explicitly and write the
    result. Shared by every mapped agreement (Fire, Commercial Security,
    Elevator Monitoring):
    every checkbox on the form gets set from ``cks`` (never left at the
    template's own state) and every field named in ``txt`` gets its value,
    including an explicit empty string for a field the record holds no
    fact for — the pypdf field dump this ticket's acceptance criteria asks
    for shows that as a set-but-blank field, not an untouched one."""
    from pypdf import PdfReader, PdfWriter
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


def _elevator_agreement_fields(f):
    """(text, checks) for the Elevator Monitoring Agreement and its rider
    (issue 335), in the same shape as _fire_agreement_fields so the family
    dispatch in build_agreements shares one _fill_pdf/naming path.

    Identity, pricing and the billing-frequency word fill the same way the
    Commercial Fire map fills the equivalent fields, citing the same
    governing files; the monthly monitoring amount comes from the Elevator
    rows of references/MAPPING-APPENDIX.md §3 via _elevator_master_rmr.
    Billing frequency has no checkbox on this form (a free-text "payable
    ___ in advance" blank), so the word written is the one the Fire map
    ticks as FIRE['cb_quarter'], per MAPPING-APPENDIX.md §1 rule 3 and
    DRAFTER-PRESEND-CHECKLIST.md item 9.

    Fields the v1.0 deal record holds no fact for — the agreement date (no
    date fact exists in the schema; the Fire rider's own date field is
    blank for the same reason), elevator location if different, elevator
    description, communication channel, the §1(b) connection charge and
    the §4 one-time set-up charge — are set to an explicit empty string
    (hard rule 7: no inferred fill) and recorded as open questions in
    docs/GAP-REPORT.md rather than guessed.
    """
    deal, cust = f['deal'], f['customer']
    mon = _elevator_master_rmr(f['systems'])
    amount = lambda x: f'{x:.2f}' if x is not None else 'N/A'

    text = {
        ELEVATOR['name']: cust['subscriber_name'],
        ELEVATOR['address']: cust['billing_address'].replace('\n', ', '),
        ELEVATOR['phone']: cust.get('phone', ''),
        ELEVATOR['cell']: cust.get('cell', ''),
        ELEVATOR['monitoring']: amount(mon),
        ELEVATOR['frequency']: 'quarter annually',
    }
    for k in ('date', 'address2', 'location', 'location2', 'description',
             'description2', 'comm_channel', 'connection_charge', 'setup'):
        text[ELEVATOR[k]] = ''

    rider_text = {'Text16666': cust['subscriber_name'], 'Text26666': '',
                  'Text36666': str(deal['term_years'])}
    return (text, {}, rider_text, {}, 'Elevator Monitoring Agreement',
            'Elevator Rider Additional Locations')


def _fire_agreement_fields(f):
    """(text, checks) for the Commercial Fire master, unchanged from before
    issue 336 — split out of build_agreements so the family dispatch below
    can share one _fill_pdf/naming path with the Commercial Security and
    Elevator Monitoring branches."""
    deal, cust = f['deal'], f['customer']
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
    rider_text = {'Text17777': cust['subscriber_name'], 'Text277777': '',
                  'Text37777': str(deal['term_years'])}
    return text, checks, rider_text, {}, 'Fire Master Agreement', 'Fire Rider Additional Locations'


def _repair_service_line(systems):
    """The one Repair Service RMR line across ``systems``, or ``None`` — the
    shared name both the Fire and Commercial Security masters key their
    contracted-vs-per-call service box on (ruling 3)."""
    target = _norm_desc(_FIRE_MASTER_REPAIR_SERVICE_NAMES[0])
    for s in systems:
        for svc in s.get('services') or ():
            if _norm_desc(svc.get('description', '')) == target:
                return svc
    return None


def _security_agreement_fields(f, dep):
    """(text, checks) for the Commercial Security master (issue 336; issue
    #40's evidence comment and rulings). Every mapped box is set True or
    False explicitly — template state is never consulted (ruling 1). The
    §2 "Check Services Provided" boxes mirror the selected §4 boxes
    mechanically (ruling 5). The combine ("IN LIEU OF") route fires only
    when a sold RMR line needs Other / See Schedule (MAPPING-APPENDIX.md
    §1 rule 6) — access-control-cloud and software-passthrough lines
    always need it, so their line items never get their own §4(f) box;
    when it fires, every other RMR category folds into the same combined
    figure rather than being split out ("do not split... into fragmented
    unsupported entries", same rule).
    """
    import datetime
    deal, cust, pr = f['deal'], f['customer'], f['pricing']
    systems = f['systems']
    amounts, unmapped = _categorize_security_master_rmr(systems)
    amt = lambda x: f'{x:.2f}' if x is not None else 'N/A'

    monitor_amt = amounts['monitoring']
    if amounts['monitoring_smart'] is not None:
        monitor_amt = (monitor_amt or 0.0) + amounts['monitoring_smart']
    remote_amt = amounts['remote_access']
    if amounts['remote_access_video'] is not None:
        remote_amt = (remote_amt or 0.0) + amounts['remote_access_video']
    self_amt = amounts['self_monitoring']
    signal_amt = amounts['signal_verification']
    has_remote = remote_amt is not None or amounts['monitoring_smart'] is not None
    combine = (amounts['access_control_other'] is not None
               or amounts['other_only'] is not None)
    total_all = sum(v for v in amounts.values() if v is not None) or None

    rep = _repair_service_line(systems)
    rep_amt = float(rep['qty']) * float(rep['unit']) if rep else None

    price = float(pr['price'])
    balance = price - (dep or 0)

    text = {
        SECURITY['date']: datetime.date.today().strftime('%m/%d/%Y'),
        SECURITY['name']: cust['subscriber_name'],
        SECURITY['address']: cust['billing_address'].replace('\n', ', '),
        SECURITY['phone']: cust.get('phone', ''),
        SECURITY['cell']: cust.get('cell', ''),
        SECURITY['purchase_price']: f'{price:.2f}',
        SECURITY['down_payment']: f'{dep or 0:.2f}',
        SECURITY['balance_due']: f'{balance:.2f}',
        # Checklist item 8: "TBD" is acceptable only in the approximate
        # start and substantial-completion date fields (CLAUDE.md hard
        # rule 4). The builder writes it explicitly (ruling 2) rather
        # than leaving the cleaned template's own blank.
        SECURITY['work_begin_date']: 'TBD',
        SECURITY['completion_date']: 'TBD',
        SECURITY['charge_install']: 'N/A',
        SECURITY['charge_monitoring']: 'N/A' if combine else amt(monitor_amt),
        SECURITY['charge_service']: amt(rep_amt),
        SECURITY['charge_inspection']: 'N/A',
        SECURITY['inspections_per_year']: 'N/A',
        SECURITY['charge_signal_verification']: 'N/A' if combine else amt(signal_amt),
        SECURITY['charge_remote_access']: 'N/A' if combine else amt(remote_amt),
        SECURITY['remote_access_other_describe']: '',
        SECURITY['charge_access_control']: 'N/A',
        SECURITY['charge_self_monitoring']: 'N/A' if combine else amt(self_amt),
        SECURITY['charge_cyber']: 'N/A',
        SECURITY['in_lieu_of_amount']: amt(total_all) if combine else 'N/A',
        SECURITY['term']: f"{deal['term_years']} years",
    }
    checks = {
        SECURITY['cb_monitoring_services']: (not combine) and monitor_amt is not None,
        SECURITY['cb_service']: True,   # Contract Package Rules: Service is always checked
        SECURITY['cb_inspection']: False,
        SECURITY['cb_remote_access_cameras']: (not combine) and has_remote,
        SECURITY['cb_access_control_admin']: False,
        SECURITY['cb_signal_verification']: (not combine) and signal_amt is not None,
        SECURITY['cb_self_monitoring']: (not combine) and self_amt is not None,
        SECURITY['cb_cyber']: False,
        SECURITY['cb_other']: combine,
        SECURITY['cb_billing_monthly']: False, SECURITY['cb_billing_quarter']: True,
        SECURITY['cb_billing_semi']: False, SECURITY['cb_billing_annual']: False,
        SECURITY['cb_4a_install']: False,
        SECURITY['cb_4a_monitoring']: (not combine) and monitor_amt is not None,
        SECURITY['cb_service_percall']: rep is None,
        SECURITY['cb_service_monthly']: rep is not None,
        SECURITY['cb_4c_inspection']: False,
        SECURITY['cb_4d_signal_verification']: (not combine) and signal_amt is not None,
        SECURITY['cb_4e_remote_access']: (not combine) and has_remote,
        SECURITY['cb_4e_recording_device']: (not combine) and amounts['remote_access_video'] is not None,
        SECURITY['cb_4e_cloud_storage']: (not combine) and amounts['remote_access_video'] is not None,
        SECURITY['cb_4e_video_smartphone']: (not combine) and amounts['remote_access_video'] is not None,
        SECURITY['cb_4e_self_monitoring']: False,
        SECURITY['cb_4e_remote_access_subscriber']: (not combine) and has_remote,
        SECURITY['cb_4e_audio']: False,
        SECURITY['cb_4e_other']: False,
        SECURITY['cb_4f_access_control']: False,
        SECURITY['cb_4f_remote_admin']: False,
        SECURITY['cb_4f_onsite_admin']: False,
        SECURITY['cb_4f_data_storage']: False,
        SECURITY['cb_4f_data_backup']: False,
        SECURITY['cb_4g_self_monitoring']: (not combine) and self_amt is not None,
        SECURITY['cb_4h_cyber']: False,
        SECURITY['cb_in_lieu_of']: combine,
    }
    rider_text = {'Text16666': cust['subscriber_name'], 'Text26666': '',
                  'Text36666': str(deal['term_years'])}
    questions = [
        f'Commercial Security master: {svc.get("description", "")!r} '
        f'(System {sysname!r}) is sold as an RMR service line, but the RMR '
        f'Items sheet\'s Contract selections column leaves that row blank '
        f'or marked "?" — which master-agreement box should it tick?'
        for sysname, svc in unmapped
    ]
    return (text, checks, rider_text, {}, 'Commercial Security Master Agreement',
            'Commercial Security Rider Additional Locations', questions)


def build_agreements(job, f, R, family, dep=None):
    cust = f['customer']
    # Elevator Monitoring dispatches on the System name ahead of Fire, as
    # issue 335 shipped it.
    # The Fire branch keys off the System name, not ``family``, exactly as
    # before issue 336 — a residential Project with a Fire Alarm System
    # already took this branch pre-336 (family is forced to "Residential
    # Security" for any residential record, SOW-BASELINES.md §3 note) and
    # this ticket's scope is the Commercial Security field map only, so
    # that pre-existing dispatch is left untouched (see the discovery filed
    # with this ticket rather than changed here).
    if any(s['system'] == 'Elevator Monitoring' for s in f['systems']):
        pkg_key = 'Elevator Monitoring'
    elif any(s['system'] == 'Fire Alarm' for s in f['systems']):
        pkg_key = 'Commercial Fire'
    elif family == 'Commercial Security':
        pkg_key = 'Commercial Security'
    else:
        return None, None, (
            f'only the {", ".join(MAPPED_FAMILIES)} forms are mapped so far '
            f'({family} is not)')
    folder, mname, rname = PACKAGES[pkg_key]
    mpath = os.path.join(R.agreements_root, folder, mname)
    rpath = os.path.join(R.agreements_root, folder, rname)
    if not os.path.exists(mpath):
        return None, None, f'agreement forms not reachable at {mpath}'

    questions = []
    if pkg_key == 'Commercial Fire':
        text, checks, rider_text, rider_checks, mlabel, rlabel = _fire_agreement_fields(f)
    elif pkg_key == 'Elevator Monitoring':
        text, checks, rider_text, rider_checks, mlabel, rlabel = _elevator_agreement_fields(f)
    else:
        text, checks, rider_text, rider_checks, mlabel, rlabel, questions = \
            _security_agreement_fields(f, dep)
    f.setdefault('held', [])
    f['held'].extend(questions)

    stem = f"{cust['site_name']}_{_slug(cust['site_address'])}"
    mo = os.path.join(job, f'{stem} - {mlabel}.pdf')
    ro = os.path.join(job, f'{stem} - {rlabel}.pdf')
    _fill_pdf(mpath, mo, text, checks)
    _fill_pdf(rpath, ro, rider_text, rider_checks)
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

    # Pre-build gate first (issue 224, spec 215 stream C): a record the
    # standards would reject stops here, before anything is resolved or written.
    # With no record at all, the prerequisite and read_record messages below
    # say what is missing.
    import prebuild_gate
    has_record = os.path.exists(os.path.join(job, '_facts.json'))
    code, findings = prebuild_gate.run(job) if has_record else (0, [])
    if code:
        raise SystemExit('pre-build gate refused the record; nothing written '
                         f'(prebuild_gate.py exit {code}):\n' + '\n'.join(
                             f'  {st}  {item}  —  {detail}'
                             for st, item, detail in findings
                             if st in ('REFUSE', 'BAD')))
    for _, item, detail in (x for x in findings if x[0] == 'WARN'):
        print(f'gate WARN  {item}  —  {detail}')

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
        mo, ro, why = build_agreements(job, f, R, plan['family'], dep)
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
