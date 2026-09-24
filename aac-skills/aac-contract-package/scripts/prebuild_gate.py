"""Pre-build gate over a v1.0 deal record (spec 215 stream C, issue 224).

Usage:  python prebuild_gate.py "<job folder | _facts.json>" [--quiet]
                                [--references <folder>]
Exit:   0 = no REFUSE (warnings allowed), 1 = at least one REFUSE,
        2 = bad input (no record, unreadable record or governing file).

Reads only. Never writes anywhere. The builder runs it before anything else
and stops on any refusal; it also runs alone from the command line.

Every finding is REFUSE, WARN, SKIP or PASS, listed the way verify_package.py
lists its findings. A refusal names the field, the offending value and the
governing file and section; it never restates the standard. Approved system
names and their Contract families (SOW-BASELINES.md §3), the RMR names
(MAPPING-APPENDIX.md §3), the schema (facts.schema.json) and each field's
authority (FACTS-SCHEMA.md) are read from the references folder at run time,
so a name Dan ratifies there is known here on the next run. ``--references``
points the gate at another copy of that folder (tests use it).
"""
import sys, os, re, json, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aac_paths
from verify_package import find_files, RS_START_SUFFIX

SOW_BASELINES = 'SOW-BASELINES.md'
MAPPING = 'MAPPING-APPENDIX.md'
PACKAGE_RULES = 'CONTRACT-PACKAGE-RULES.md'
FACTS_DOC = 'FACTS-SCHEMA.md'
SCHEMA = 'facts.schema.json'

# Words that put a service line in an RMR category: the builder's fire-master
# triggers (build_package._FIRE_MASTER_CATEGORIES). A line carrying one must
# be a name from the MAPPING-APPENDIX §3 table.
CATEGORY_TRIGGERS = ('monitoring', 'inspection', 'repair service')
# The lines whose sale on this Project calls for the FSI worksheet, and the
# worksheet's file pattern: the verifier's J-33 trigger and pattern.
FSI_TRIGGERS = ('repair service', 'inspection')
FSI_PATTERNS = ['*FSI*.xls*']
EMAIL = re.compile(r'[^@\s]+@[^@\s]+\.[^@\s]+')
STATUSES = ('REFUSE', 'WARN', 'SKIP', 'PASS')


class BadInput(Exception):
    """The gate cannot audit: exit 2, never a pass."""


def _norm(s):
    return re.sub(r'\s+', ' ', str(s).strip().lower())


def _read(references, name):
    path = os.path.join(references, name)
    try:
        with open(path, encoding='utf8') as fh:
            return fh.read()
    except OSError as e:
        raise BadInput(f'cannot read governing file {path}: {e}')


def section_table(references, name, heading):
    """Rows (dicts keyed by the header cells) of the first markdown table
    under the ``## <heading>`` section of a reference file."""
    rows, header, inside = [], None, False
    for line in _read(references, name).splitlines():
        if line.startswith('## '):
            if inside and header:
                break
            inside = line.startswith(f'## {heading}')
            continue
        if not inside or not line.lstrip().startswith('|'):
            continue
        cells = [c.strip() for c in re.split(r'(?<!\\)\|', line.strip().strip('|'))]
        if header is None:
            header = cells
        elif not all(set(c) <= set('-: ') for c in cells):
            rows.append(dict(zip(header, cells)))
    if not rows:
        raise BadInput(f'no table under "## {heading}" in '
                       f'{os.path.join(references, name)}')
    return rows


def approved_families(references):
    """Approved system name -> Contract family, SOW-BASELINES.md §3."""
    table = {}
    for row in section_table(references, SOW_BASELINES, '3)'):
        family = next((v for k, v in row.items()
                       if k.lower().startswith('contract family')), '')
        if row.get('Approved'):
            table[row['Approved']] = family
    return table


def rmr_names(references):
    """Normalised Schedule-line-item names of the MAPPING-APPENDIX.md §3 table."""
    return {_norm(r['Schedule line item'])
            for r in section_table(references, MAPPING, '3)')
            if r.get('Schedule line item')}


def field_authority(references):
    """FACTS-SCHEMA.md field path -> its Authority cell (a citation)."""
    out = {}
    for line in _read(references, FACTS_DOC).splitlines():
        m = re.match(r'\|\s*`([^`]+)`\s*\|', line)
        if not m:
            continue
        cells = [c.strip() for c in re.split(r'(?<!\\)\|', line.strip().strip('|'))]
        if len(cells) >= 4:
            out[m.group(1)] = cells[3].replace('`', '')
    return out


def _loc(path):
    """('sites', 0, 'price') -> 'sites[0].price'."""
    s = ''
    for p in path:
        s += f'[{p}]' if isinstance(p, int) else (f'.{p}' if s else str(p))
    return s


def _field(path):
    """('sites', 0, 'price') -> 'sites[].price', the FACTS-SCHEMA.md key."""
    return re.sub(r'\[\d+\]', '[]', _loc(path))


def _systems(record):
    """(site index, system index, site, system) for every well-formed System."""
    sites = record.get('sites')
    for i, site in enumerate(sites if isinstance(sites, list) else ()):
        systems = site.get('systems') if isinstance(site, dict) else None
        for j, sysrec in enumerate(systems if isinstance(systems, list) else ()):
            if isinstance(sysrec, dict):
                yield i, j, site, sysrec


def _system_name(record, path):
    """The System a schema path sits under, for the message, or None."""
    p = list(path)
    if len(p) >= 4 and p[0] == 'sites' and p[2] == 'systems':
        try:
            return record['sites'][p[1]]['systems'][p[3]].get('system')
        except (KeyError, IndexError, TypeError, AttributeError):
            return None
    return None


def _schema_findings(record, references, authority, out):
    try:
        import jsonschema
    except ImportError:
        out.append(('SKIP', 'Record matches the deal-record schema',
                    f'jsonschema is not installed, so {SCHEMA} was not applied'))
        return
    try:
        schema = json.loads(_read(references, SCHEMA))
    except ValueError as e:
        raise BadInput(f'{SCHEMA} is not valid JSON: {e}')
    validator = jsonschema.validators.validator_for(schema)(schema)
    for err in sorted(validator.iter_errors(record), key=lambda e: list(map(str, e.path))):
        path = tuple(err.path)
        if err.validator == 'required':
            m = re.match(r"'([^']+)' is a required property", err.message)
            prop = m.group(1) if m else '?'
            if path == ('deal',) and prop == 'package_situation':
                continue  # its own refusal below names the situation rows
            path, what = path + (prop,), 'is missing'
        elif err.validator in ('maxContains', 'maxItems'):
            kind = (err.schema.get('contains', {}).get('properties', {})
                    .get('kind', {}).get('const'))
            items = err.instance if isinstance(err.instance, list) else []
            n = (sum(1 for x in items if isinstance(x, dict) and x.get('kind') == kind)
                 if kind else len(items))
            cap = err.schema.get(err.validator)
            noun = (f'{kind} service' if kind else
                    'service' if path and path[-1] == 'services' else 'equipment')
            out.append(('REFUSE', 'Record matches the deal-record schema',
                        f'{_loc(path)}: {n} {noun} lines for System '
                        f'{_system_name(record, path)!r} exceed the {cap}-line cap in '
                        f'{SCHEMA} ({err.validator}); split the schedule ({FACTS_DOC}, '
                        f'{_field(path)}; authority: '
                        f'{authority.get(_field(path), "see " + FACTS_DOC)})'))
            continue
        elif err.validator == 'enum':
            what = (f'is {err.instance!r}, not one of the schema\'s enum values '
                    f'{err.validator_value}')
        else:
            what = (f'is {err.instance!r}, which fails the schema\'s '
                    f'"{err.validator}" keyword')
        field = _field(path)
        out.append(('REFUSE', 'Record matches the deal-record schema',
                    f'{_loc(path)} {what} ({SCHEMA}; {FACTS_DOC}, {field}; '
                    f'authority: {authority.get(field, "see " + FACTS_DOC)})'))


def gate(record, job_dir=None, references=None):
    """Findings for one record: a list of (status, item, detail)."""
    references = references or aac_paths.REFERENCES
    authority = field_authority(references)
    families = approved_families(references)
    rmr = rmr_names(references)
    out = []

    _schema_findings(record, references, authority, out)
    if not isinstance(record, dict):
        return out

    deal = record.get('deal') if isinstance(record.get('deal'), dict) else {}
    customer = record.get('customer') if isinstance(record.get('customer'), dict) else {}
    commercial = deal.get('commercial') is True

    if commercial and deal.get('package_situation') is None:
        out.append(('REFUSE', 'Package situation set on a commercial record',
                    'deal.package_situation is missing while deal.commercial is '
                    f'true; the situation rows are {PACKAGE_RULES} §2.2 and §2.3 '
                    f'({FACTS_DOC}, deal.package_situation)'))

    by_family, fsi_lines = {}, []
    for i, j, site, sysrec in _systems(record):
        name = str(sysrec.get('system', '')).strip()
        where = f'sites[{i}].systems[{j}]'
        if name not in families:
            out.append(('REFUSE', 'System name approved',
                        f'{where}.system {name!r} is not in the Approved column '
                        f'of {SOW_BASELINES} §3 (Approved system type names)'))
        else:
            by_family.setdefault(families[name], []).append(name)

        services = sysrec.get('services')
        for k, svc in enumerate(services if isinstance(services, list) else ()):
            if not isinstance(svc, dict):
                continue
            desc = str(svc.get('description', ''))
            n = _norm(desc)
            line = f'{where}.services[{k}]'
            trigger = next((t for t in CATEGORY_TRIGGERS if t in n), None)
            base = n[:-len(_norm(RS_START_SUFFIX))].strip() \
                if n.endswith(_norm(RS_START_SUFFIX)) else n
            if trigger and base not in rmr:
                out.append(('REFUSE', 'Service name is a canonical RMR name',
                            f'{line} {desc!r} reads as a "{trigger}" line but is '
                            f'not in the Schedule line item column of {MAPPING} '
                            '§3 (Mapping table)'))
            if 'kind' not in svc:
                out.append(('WARN', 'Service kind tag present',
                            f'{line} {desc!r} carries no kind; it defaults to '
                            f'new ({FACTS_DOC}, sites[].systems[].services)'))
            if (svc.get('kind') or 'new') != 'existing' and any(t in n for t in FSI_TRIGGERS):
                fsi_lines.append(f'{line} {desc!r}')

    if commercial and len(by_family) > 1:
        listing = '\n'.join(f'  {fam}: {", ".join(names)}'
                            for fam, names in by_family.items())
        out.append(('REFUSE', 'Systems within one Contract family',
                    f'the Systems span {len(by_family)} Contract families in '
                    f'{SOW_BASELINES} §3 (see {PACKAGE_RULES} §2.8 for a '
                    'combination fire-and-burglar panel); split the packet into '
                    'one Project per family:\n' + listing))

    if fsi_lines:
        found = find_files(job_dir, FSI_PATTERNS) if job_dir and os.path.isdir(job_dir) else []
        if not found:
            out.append(('REFUSE', 'FSI worksheet on file',
                        f'no FSI worksheet in {job_dir or "the job folder"} while '
                        f'this Project sells {"; ".join(fsi_lines)} '
                        f'({MAPPING} §3a; {FACTS_DOC} Q10)'))

    if customer.get('entity_verified') is not True:
        out.append(('WARN', 'Legal entity verified',
                    'customer.entity_verified is not true '
                    '(DRAFTER-PRESEND-CHECKLIST.md A.1)'))
    for i, site in enumerate(record.get('sites') if isinstance(record.get('sites'), list) else ()):
        if isinstance(site, dict) and not str(site.get('price_source') or '').strip():
            out.append(('WARN', 'Price source recorded',
                        f'sites[{i}].price_source is absent '
                        '(SCHEDULE-GENERATION-PROCEDURE.md §1)'))
    email = customer.get('email')
    if isinstance(email, str) and email.strip() and not EMAIL.fullmatch(email.strip()):
        out.append(('WARN', 'Email well formed',
                    f'customer.email {email!r} does not read as an address '
                    f'({FACTS_DOC} Q1)'))

    for item in ('Record matches the deal-record schema',
                 'Package situation set on a commercial record', 'System name approved',
                 'Service name is a canonical RMR name', 'Systems within one Contract family',
                 'FSI worksheet on file'):
        if not any(f[1] == item for f in out):
            out.append(('PASS', item, ''))
    return out


def run(target, references=None):
    """(exit code, findings) for a job folder or a record file path."""
    path = target.rstrip('\\/')
    if os.path.isdir(path):
        job_dir, record_path = path, os.path.join(path, '_facts.json')
        if not os.path.exists(record_path):
            return 2, [('BAD', 'Record readable',
                        f'no _facts.json in {path}\nRun with --facts to write a starter.')]
    else:
        job_dir, record_path = os.path.dirname(os.path.abspath(path)), path
    try:
        with open(record_path, encoding='utf8') as fh:
            record = json.load(fh)
        findings = gate(record, job_dir, references)
    except (OSError, ValueError) as e:
        return 2, [('BAD', 'Record readable', f'{record_path}: {e}')]
    except BadInput as e:
        return 2, [('BAD', 'Governing files readable', str(e))]
    return (1 if any(f[0] == 'REFUSE' for f in findings) else 0), findings


def report(findings, quiet=False):
    for st in ('BAD',) + STATUSES:
        if quiet and st in ('PASS', 'SKIP'):
            continue
        rows = [f for f in findings if f[0] == st]
        if not rows:
            continue
        print(f'\n{st}  ({len(rows)})')
        for _, item, detail in rows:
            print(f'   {item}' + (f'  —  {detail}' if detail else ''))


def main(argv=None):
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('target', nargs='?')
    ap.add_argument('--quiet', action='store_true')
    ap.add_argument('--references')
    a = ap.parse_args(argv)
    if not a.target:
        print(__doc__)
        sys.exit(2)
    if not os.path.exists(a.target):
        print('not found:', a.target)
        sys.exit(2)
    print('=' * 78)
    print('PRE-BUILD GATE —', os.path.basename(a.target.rstrip('\\/')))
    print('=' * 78)
    code, findings = run(a.target, a.references)
    report(findings, a.quiet)
    n = {st: sum(1 for f in findings if f[0] == st) for st in STATUSES}
    print('\n' + '-' * 78)
    print(f"{n['REFUSE']} refuse, {n['WARN']} warn, {n['PASS']} pass, {n['SKIP']} skipped")
    sys.exit(code)


if __name__ == '__main__':
    main()
