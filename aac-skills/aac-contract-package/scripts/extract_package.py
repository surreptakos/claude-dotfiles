"""One read-only pass over a job folder: plain-text extracts plus a digest.

Usage:  python extract_package.py "<job folder>" [--clean] [--quiet]
Exit:   0 = extracted, 1 = at least one file would not read, 2 = bad input.

Why this exists. Reading workbooks and PDFs through repeated tool calls is the
most expensive part of a review. This script does that read once, in Python,
and leaves cheap text behind:

    <job>/_extract/<name>.txt      one per source document
    <job>/_extract/_digest.json    the map: every file, its hash, where its
                                   extract landed, quick facts, hidden tabs,
                                   and anything that would not open

The reviewer then reads the digest and the extracts instead of paging through
binaries. The end-to-end reading rule in PROMPT.md still applies — an extract
is the document's text, read it whole. Formatting does not survive extraction
(PROMPT.md, File Reading Rules), so strikethrough and color still need the
source file when presentation matters.

Hashes make re-runs cheap: a file whose sha256 is unchanged since the last run
keeps its existing extract untouched. After a fact change, only what changed
gets re-extracted, and the digest says which files moved.

`_extract/` is an interim artifact. The export pass cleanup
(SCHEDULE-GENERATION-PROCEDURE.md section 11a step 5) deletes it;
`--clean` does the same by hand. It never ships.

Reads only. Never writes to any source document and never saves a workbook.
"""
import sys, os, re, json, hashlib, subprocess, warnings
warnings.filterwarnings('ignore')

EXTRACT_DIR = '_extract'
DIGEST = '_digest.json'
SKIP_DIRS = {'_extract', '_to_delete', '__pycache__'}
SKIP_FILES = {DIGEST, '_facts.json'}
NOTE_ONLY = ('.dwg', '.jpg', '.jpeg', '.png', '.gif', '.tif', '.tiff', '.msg',
             '.zip', '.vsd', '.vsdx', '.bmp', '.heic')

ROLE_PATTERNS = [
    ('schedule',  r'equip\s*&\s*(svc|services)', '.xlsx'),
    ('workup',    r'work[\s._-]*up|(?<![a-z])wu(?![a-z])', '.xlsx'),
    ('fsi',       r'fsi|fire repair|repair\s*&\s*inspection', '.xlsx'),
    ('proposal',  r'proposal', '.pdf'),
    ('master',    r'master agreement|all in one|agreements', '.pdf'),
    ('rider',     r'rider', '.pdf'),
    ('checklist', r'checklist', ''),
    ('quote',     r'quote|quotation', ''),
]


def role_of(name):
    low = name.lower()
    ext = os.path.splitext(low)[1]
    for role, pat, need_ext in ROLE_PATTERNS:
        if re.search(pat, low) and (not need_ext or ext == need_ext):
            return role
    return 'other'


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def cell_str(c):
    v = c.value
    if v is None:
        return None
    if isinstance(v, str):
        v = v.replace('\r\n', '\\n').replace('\n', '\\n')
        return v
    return str(v)


def extract_xlsx(path, out):
    """Visible tabs only, per the File Reading Rules. Formula cells show the
    formula and the cached value side by side. Returns (hidden_tab_names,
    visible_tab_names)."""
    import openpyxl
    wbf = openpyxl.load_workbook(path, data_only=False, read_only=False)
    wbv = openpyxl.load_workbook(path, data_only=True, read_only=False)
    hidden, visible, lines = [], [], []
    for ws in wbf.worksheets:
        if ws.sheet_state != 'visible':
            hidden.append(ws.title)
            continue
        visible.append(ws.title)
        wsv = wbv[ws.title]
        lines.append(f'===== TAB: {ws.title} =====')
        for row in ws.iter_rows():
            cells = []
            for c in row:
                s = cell_str(c)
                if s is None:
                    continue
                if isinstance(c.value, str) and c.value.startswith('='):
                    cached = wsv[c.coordinate].value
                    s = f'{s} [cached {cached}]'
                cells.append(f'{c.coordinate}: {s}')
            if cells:
                lines.append(' | '.join(cells))
        lines.append('')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    return hidden, visible


# Poppler pdftotext (poppler-utils on Linux, poppler-windows on Windows) is a
# runtime prerequisite for PDF text extraction. When it is missing on PATH,
# subprocess.run raises FileNotFoundError from execvp — we swallow that so the
# extract pass keeps running against workbooks and form-field data, but we
# surface a stderr WARN (once per run) so a degraded extract does not read as
# clean. Aligned with verify_package.pdf_text (issue 180).
_pdftotext_missing_warned = False


def _warn_pdftotext_missing():
    global _pdftotext_missing_warned
    if _pdftotext_missing_warned:
        return
    _pdftotext_missing_warned = True
    sys.stderr.write(
        "WARN  pdftotext binary on PATH — poppler pdftotext not on PATH; "
        "PDF text extraction disabled (form fields still captured). Install "
        "poppler-utils on Linux / poppler-windows on Windows.\n"
    )


def extract_pdf(path, out):
    """pdftotext -layout, plus a form-field dump when the PDF carries one.

    Missing pdftotext is caught (FileNotFoundError from execvp) and reported
    once on stderr — behaviour aligned with verify_package.pdf_text (issue 180)
    so a poppler-less runner degrades visibly rather than crashing here and
    silently skipping there. Form-field extraction still runs against the PDF
    directly; a returned False (no text, no fields) tells the caller to record
    the file as unreadable.
    """
    try:
        r = subprocess.run(['pdftotext', '-layout', path, '-'],
                           capture_output=True, text=True, timeout=120)
        text = r.stdout
    except FileNotFoundError:
        _warn_pdftotext_missing()
        text = ''
    except Exception:
        text = ''
    fields = {}
    try:
        from pypdf import PdfReader
        fields = {k: ('' if v.get('/V') is None else str(v.get('/V')))
                  for k, v in (PdfReader(path).get_fields() or {}).items()}
    except Exception:
        pass
    with open(out, 'w', encoding='utf-8') as f:
        f.write(text)
        if fields:
            f.write('\n===== FORM FIELDS =====\n')
            for k in sorted(fields):
                f.write(f'{k} = {fields[k]}\n')
    return bool(text.strip()) or bool(fields)


def extract_docx(path, out):
    import docx
    d = docx.Document(path)
    parts = [p.text for p in d.paragraphs]
    for t in d.tables:
        for row in t.rows:
            parts.append(' | '.join(c.text for c in row.cells))
    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(parts))
    return True


def proposal_totals(txt_path):
    try:
        pt = open(txt_path, encoding='utf-8').read()
    except OSError:
        return []
    return sorted(set(float(x.replace(',', '')) for x in
                      re.findall(r'Total\s+(?:Investment|Price)[^\d$]{0,12}\$?([\d,]+\.?\d*)', pt)))


def walk(job):
    for base, dirs, files in os.walk(job):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]
        for f in files:
            if f.startswith('~$') or f in SKIP_FILES:
                continue
            yield os.path.join(base, f)


def main():
    global _pdftotext_missing_warned
    _pdftotext_missing_warned = False
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    quiet = '--quiet' in sys.argv
    if not args:
        print(__doc__); sys.exit(2)
    job = args[0].rstrip('\\/')
    if not os.path.isdir(job):
        print('not a folder:', job); sys.exit(2)
    exdir = os.path.join(job, EXTRACT_DIR)

    if '--clean' in sys.argv:
        import shutil
        if os.path.isdir(exdir):
            try:
                shutil.rmtree(exdir)
                print('removed', exdir)
            except OSError as e:
                print(f'could not remove {exdir}: {e}\n'
                      f'Delete it by hand, or move it to _to_delete per the cleanup rule.')
                sys.exit(1)
        sys.exit(0)

    os.makedirs(exdir, exist_ok=True)
    digest_path = os.path.join(exdir, DIGEST)
    prev = {}
    if os.path.isfile(digest_path):
        try:
            prev = {e['file']: e for e in json.load(open(digest_path, encoding='utf-8'))['files']}
        except Exception:
            prev = {}

    entries, failures = [], []
    for path in sorted(walk(job)):
        rel = os.path.relpath(path, job)
        ext = os.path.splitext(path)[1].lower()
        entry = {'file': rel, 'role': role_of(os.path.basename(path)),
                 'size': os.path.getsize(path),
                 'mtime': int(os.path.getmtime(path)),
                 'sha256': sha256(path)}
        if ext in NOTE_ONLY:
            entry['status'] = 'noted (no text extraction for this type)'
            entries.append(entry); continue

        out = os.path.join(exdir, re.sub(r'[\\/]', '__', rel) + '.txt')
        old = prev.get(rel)
        if old and old.get('sha256') == entry['sha256'] and os.path.isfile(out) \
                and old.get('status', '').startswith('extracted'):
            entry.update({'status': old['status'], 'extract': os.path.relpath(out, job)})
            if 'hidden_tabs' in old: entry['hidden_tabs'] = old['hidden_tabs']
            if 'visible_tabs' in old: entry['visible_tabs'] = old['visible_tabs']
            entry['status'] = entry['status'].replace('extracted', 'cached')
            entries.append(entry); continue

        try:
            if ext in ('.xlsx', '.xlsm', '.xltx'):
                hidden, visible = extract_xlsx(path, out)
                entry['hidden_tabs'], entry['visible_tabs'] = hidden, visible
                entry['status'] = 'extracted (visible tabs only)'
            elif ext == '.pdf':
                ok = extract_pdf(path, out)
                entry['status'] = 'extracted' if ok else 'extracted (no text layer — scanned?)'
            elif ext in ('.docx', '.dotx'):
                extract_docx(path, out)
                entry['status'] = 'extracted'
            elif ext in ('.txt', '.csv', '.md', '.json'):
                entry['status'] = 'plain text — read the file itself'
                entries.append(entry); continue
            else:
                entry['status'] = f'noted (no extractor for {ext or "no extension"})'
                entries.append(entry); continue
            entry['extract'] = os.path.relpath(out, job)
        except Exception as e:
            entry['status'] = f'FAILED to read: {type(e).__name__}: {e}'
            failures.append(rel)
        entries.append(entry)

    facts = {}
    props = [e for e in entries if e['role'] == 'proposal' and 'extract' in e]
    if props:
        newest = max(props, key=lambda e: e['mtime'])
        facts['proposal_totals'] = proposal_totals(os.path.join(job, newest['extract']))
        facts['proposal_used'] = newest['file']
    wus = [e for e in entries if e['role'] == 'workup']
    if len(wus) > 1:
        facts['multiple_workups'] = ('newest by mtime is ' +
                                     max(wus, key=lambda e: e['mtime'])['file'] +
                                     ' — source precedence section 1 applies')
    digest = {'job': os.path.basename(job), 'generated_by': 'extract_package.py',
              'note': ('_extract/ is an interim artifact; the export-pass cleanup '
                       'deletes it. Extracts lose formatting: strikethrough, color '
                       'and highlighting need the source file.'),
              'quick_facts': facts, 'unreadable': failures, 'files': entries}
    with open(digest_path, 'w', encoding='utf-8') as f:
        json.dump(digest, f, indent=1)

    if not quiet:
        for e in entries:
            print(f"{e['status']:<44} {e['file']}")
        print(f'\ndigest: {digest_path}')
    if failures:
        print('COULD NOT READ: ' + '; '.join(failures) +
              '\nPer PROMPT.md this is a hard stop: say which file and go no further.')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
