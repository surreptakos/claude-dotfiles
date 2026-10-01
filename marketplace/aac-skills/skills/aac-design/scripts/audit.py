#!/usr/bin/env python3
"""aac-design audit mode: turn one surface into one evidence bundle (PRD issue 1079).

    python3 audit.py TARGET [--out DIR] [--signin STEPS.json] [--commit SHA] [--no-axe]
    python3 audit.py --check-bundle DIR/bundle.json

TARGET is an .html file or an http(s) URL (web adapter, web_adapter.js in headless Chromium),
a .docx (document), a .pptx (deck) or a .pdf. Every adapter writes the same shape, so reviewers
and score.py never special-case a surface:

    DIR/bundle.json        the manifest: surface, stamp key, evidence paths, measures, faults
    DIR/evidence/          what the isolated reviewers read: page images, structure, text.txt
    DIR/detector/          what the detector found; it reaches a reviewer only after its rows are in

The default DIR is render/audit-<name>/ beside the file (the design gate treats render/ as scratch),
or ./render/audit-<host>/ for a URL. Standard library only, like the linter and the gate.
Exit 0 bundle written, 3 the target could not be audited or the bundle is invalid.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, zipfile, zlib
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import designlint  # noqa: E402

SCHEMA = 'aac-design-evidence/1'
SURFACES = {'web': 'web', 'document': 'document', 'deck': 'deck', 'pdf': 'document'}
CATALOG_SURFACES = ('web', 'document', 'deck', 'form', 'dashboard')
W = designlint.W
A = designlint.A


class Invalid(Exception):
    pass


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def surface_of(target):
    if re.match(r'https?://', target, re.I):
        return 'web'
    ext = os.path.splitext(target)[1].lower()
    return {'.html': 'web', '.htm': 'web', '.docx': 'document', '.pptx': 'deck', '.pdf': 'pdf'}.get(ext)


def default_out(target):
    if re.match(r'https?://', target, re.I):
        return os.path.join(os.getcwd(), 'render', 'audit-' + re.sub(r'[^A-Za-z0-9.-]+', '-', urlparse(target).netloc or 'url'))
    return os.path.join(os.path.dirname(os.path.abspath(target)), 'render', 'audit-' + os.path.basename(target))


def write_json(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, indent=1)
        f.write('\n')


def base_bundle(target, surface, adapter):
    return {'schema': SCHEMA, 'surface': surface, 'catalog_surface': SURFACES[surface],
            'target': os.path.abspath(target), 'adapter': adapter,
            'stamp_key': {'kind': 'file', 'path': os.path.abspath(target), 'sha256': sha256(target)},
            'evidence': {'images': [], 'structure': None, 'text': 'evidence/text.txt'},
            'detector': {}, 'measures': [], 'faults': [], 'unavailable': []}


def lint_faults(bundle, path, out, measure):
    found = designlint.lint(path)
    write_json(os.path.join(out, 'detector', 'designlint.json'), {'file': path, 'findings': found})
    bundle['detector']['designlint'] = 'detector/designlint.json'
    bundle['measures'].append(measure)
    for x in found:
        if x['severity'] in ('error', 'warn'):
            bundle['faults'].append({'measure': measure, 'kind': x['rule'], 'where': x['where'],
                                     'detail': f"{x['what']} ({x['why']}) {x['detail']}".strip()})


# ----------------------------------------------------------------------------- documents and decks
def office_text(z, surface):
    lines = []
    if surface == 'document':
        root = ET.fromstring(z.read('word/document.xml'))
        for p in root.iter(f'{{{W}}}p'):
            lines.append(''.join(t.text or '' for t in p.iter(f'{{{W}}}t')))
    else:
        for name in slide_names(z):
            lines.append(f'--- {name.rsplit("/", 1)[-1]} ---')
            root = ET.fromstring(z.read(name))
            for p in root.iter(f'{{{A}}}p'):
                lines.append(''.join(t.text or '' for t in p.iter(f'{{{A}}}t')))
    return '\n'.join(lines) + '\n'


def slide_names(z):
    return sorted((n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)),
                  key=lambda n: int(re.search(r'(\d+)\.xml$', n).group(1)))


def render_office(bundle, path, out):
    """The draft's renderer, under both stand-in fonts, when LibreOffice is on this machine."""
    import render
    if not render.soffice_bin():
        bundle['unavailable'].append({'what': 'office.render', 'why': 'LibreOffice (soffice) not found; run the audit in the Linux sandbox for page images and page counts'})
        return
    pages = {}
    imgdir = os.path.join(out, 'evidence', 'images')
    for kind, font in render.STAND_INS.items():
        try:
            r = render.render_once(path, font, imgdir)
        except (OSError, subprocess.CalledProcessError, IndexError, ValueError) as e:
            r, err = None, str(e)
        else:
            err = 'conversion failed'
        if r is None:
            bundle['unavailable'].append({'what': 'office.render', 'why': f'rendering under {font}: {err}'})
            continue
        pages[kind] = r['pages']
        for png in r['png']:
            bundle['evidence']['images'].append({'path': os.path.relpath(png, out).replace(os.sep, '/'), 'label': f'{os.path.basename(png)} under {font} ({kind} stand-in)'})
    if pages:
        bundle['pages'] = pages
        bundle['measures'].append('office.render')
        write_json(os.path.join(out, 'detector', 'render.json'), {'pages': pages, 'stand_ins': render.STAND_INS})
        bundle['detector']['render'] = 'detector/render.json'


def adapt_office(path, out, surface):
    bundle = base_bundle(path, surface, 'audit.py office')
    sdir = os.path.join(out, 'evidence', 'structure')
    os.makedirs(sdir, exist_ok=True)
    with zipfile.ZipFile(path) as z:
        parts = ['word/document.xml', 'word/styles.xml'] if surface == 'document' else slide_names(z)
        for name in parts:
            if name in z.namelist():
                with open(os.path.join(sdir, name.replace('/', '_')), 'wb') as f:
                    f.write(z.read(name))
        with open(os.path.join(out, 'evidence', 'text.txt'), 'w', encoding='utf-8') as f:
            f.write(office_text(z, surface))
    bundle['evidence']['structure'] = 'evidence/structure'
    lint_faults(bundle, path, out, 'office.designlint')
    render_office(bundle, path, out)
    return bundle


# ----------------------------------------------------------------------------- PDF
def pdf_string(data, i):
    """A literal string starting at data[i] == '('; returns (text, next index)."""
    out, depth, i = [], 1, i + 1
    esc = {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f'}
    while i < len(data) and depth:
        c = data[i]
        if c == '\\':
            n = data[i + 1] if i + 1 < len(data) else ''
            if n in esc:
                out.append(esc[n]); i += 2
            elif n.isdigit():
                m = re.match(r'[0-7]{1,3}', data[i + 1:])
                out.append(chr(int(m.group(0), 8))); i += 1 + len(m.group(0))
            else:
                out.append(n); i += 2
            continue
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if not depth:
                break
        out.append(c)
        i += 1
    return ''.join(out), i + 1


def pdf_runs(content):
    """Text runs of one content stream with the font size and fill colour they were shown in."""
    runs, stack, size, fill = [], [], None, (0.0, 0.0, 0.0)
    i, n = 0, len(content)
    while i < n:
        c = content[i]
        if c.isspace():
            i += 1; continue
        if c == '%':
            j = content.find('\n', i); i = n if j < 0 else j; continue
        if c == '(':
            s, i = pdf_string(content, i); stack.append(s); continue
        if c == '[':
            j, parts = i + 1, []
            while j < n and content[j] != ']':
                if content[j] == '(':
                    s, j = pdf_string(content, j); parts.append(s)
                else:
                    j += 1
            stack.append(''.join(parts)); i = j + 1; continue
        if c == '<' and content[i:i + 2] != '<<':
            j = content.find('>', i); stack.append(''); i = j + 1; continue
        m = re.match(r'[^\s()\[\]<>/%]+|/[^\s()\[\]<>/%]*|<<|>>', content[i:])
        tok = m.group(0) if m else content[i]
        i += len(tok)
        if tok == 'Tf' and len(stack) >= 1:
            try: size = float(stack[-1])
            except ValueError: pass
        elif tok == 'rg' and len(stack) >= 3:
            try: fill = tuple(float(x) for x in stack[-3:])
            except ValueError: pass
        elif tok == 'g' and stack:
            try: fill = (float(stack[-1]),) * 3
            except ValueError: pass
        elif tok == 'k' and len(stack) >= 4:
            try:
                cc, mm, yy, kk = (float(x) for x in stack[-4:])
                fill = ((1 - cc) * (1 - kk), (1 - mm) * (1 - kk), (1 - yy) * (1 - kk))
            except ValueError: pass
        elif tok in ('Tj', 'TJ', "'", '"') and stack and stack[-1].strip():
            runs.append({'text': stack[-1], 'size': size, 'fill': '%02X%02X%02X' % tuple(round(v * 255) for v in fill)})
        if re.fullmatch(r'[A-Za-z*\'"]+', tok):
            stack = []
        elif tok not in ('<<', '>>'):
            stack.append(tok)
    return runs


def adapt_pdf(path, out):
    bundle = base_bundle(path, 'pdf', 'audit.py pdf')
    data = open(path, 'rb').read()
    pages = len(re.findall(rb'/Type\s*/Page(?![a-zA-Z])', data))
    tagged = b'/StructTreeRoot' in data and re.search(rb'/Marked\s+true', data) is not None
    lang = re.search(rb'/Lang\s*\(([^)]*)\)', data)
    runs = []
    for m in re.finditer(rb'<<(.*?)>>\s*stream\r?\n', data, re.S):
        end = data.find(b'endstream', m.end())
        raw = data[m.end():end]
        if b'/FlateDecode' in m.group(1):
            try: raw = zlib.decompress(raw)
            except zlib.error: continue
        elif b'/Filter' in m.group(1):
            continue
        text = raw.decode('latin-1')
        if 'BT' in text and ('Tj' in text or 'TJ' in text):
            runs += pdf_runs(text)
    struct = {'pages': pages, 'tagged': tagged, 'lang': lang.group(1).decode('latin-1') if lang else None, 'text_runs': runs}
    write_json(os.path.join(out, 'evidence', 'structure.json'), struct)
    bundle['evidence']['structure'] = 'evidence/structure.json'
    bundle['pages'] = {'pdf': pages}
    text = None
    if shutil.which('pdftotext'):
        r = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True)
        text = r.stdout.decode('utf-8', 'replace') if r.returncode == 0 else None
    with open(os.path.join(out, 'evidence', 'text.txt'), 'w', encoding='utf-8') as f:
        f.write(text if text is not None else '\n'.join(r['text'] for r in runs) + '\n')
    if shutil.which('pdftoppm'):
        subprocess.run(['pdftoppm', '-png', '-r', '90', path, os.path.join(out, 'evidence', 'images', 'page')], check=False)
        for png in sorted(p for p in os.listdir(os.path.join(out, 'evidence', 'images')) if p.startswith('page')):
            bundle['evidence']['images'].append({'path': f'evidence/images/{png}', 'label': png})
    else:
        bundle['unavailable'].append({'what': 'pdf.render', 'why': 'pdftoppm (poppler) not found; page images need it'})

    bundle['measures'] += ['pdf.structure', 'pdf.text']
    fault = lambda measure, kind, where, detail: bundle['faults'].append({'measure': measure, 'kind': kind, 'where': where[:160], 'detail': detail})
    if not tagged:
        fault('pdf.structure', 'untagged-pdf', os.path.basename(path), 'no structure tree: a screen reader gets no headings, lists or reading order')
    if not lang:
        fault('pdf.structure', 'no-document-language', os.path.basename(path), 'the catalog names no /Lang')
    for r in runs:
        if r['size'] is not None and r['size'] < 9:
            fault('pdf.text', 'text-below-floor', r['text'], f"{r['size']:g} pt, under the 9 pt print floor (AAC-WR-001 Rule 77)")
        ratio = designlint.contrast(r['fill'], 'FFFFFF')
        need = 3.0 if (r['size'] or 0) >= 18 else 4.5
        if ratio < need:
            fault('pdf.text', 'low-contrast-text', r['text'], f"#{r['fill']} on a white page = {ratio:.2f}:1, needs {need:g}:1")
    write_json(os.path.join(out, 'detector', 'measures.json'), {'tagged': tagged, 'lang': struct['lang'], 'runs': len(runs)})
    bundle['detector']['measures'] = 'detector/measures.json'
    return bundle


# ----------------------------------------------------------------------------- the bundle contract
def validate_bundle(b, bundle_dir):
    """Raise Invalid unless b is an evidence bundle every reviewer and the scorer can read."""
    if b.get('schema') != SCHEMA:
        raise Invalid(f'schema must be "{SCHEMA}"')
    if b.get('surface') not in SURFACES:
        raise Invalid(f'surface must be one of {sorted(SURFACES)}')
    if b.get('catalog_surface') not in CATALOG_SURFACES:
        raise Invalid(f'catalog_surface must be one of {CATALOG_SURFACES}')
    if not isinstance(b.get('target'), str) or not b['target']:
        raise Invalid('target must name the audited file or URL')
    k = b.get('stamp_key') or {}
    if k.get('kind') == 'file':
        if not re.fullmatch(r'[0-9a-f]{64}', str(k.get('sha256'))) or not k.get('path'):
            raise Invalid('a file stamp key needs path and sha256')
    elif k.get('kind') == 'url':
        if not k.get('url') or 'commit' not in k:
            raise Invalid('a URL stamp key needs url and commit (null when unknown)')
    else:
        raise Invalid('stamp_key.kind must be "file" or "url"')
    ev = b.get('evidence') or {}
    if not isinstance(ev.get('images'), list):
        raise Invalid('evidence.images must be a list')
    for im in ev['images']:
        if not im.get('path') or not im.get('label'):
            raise Invalid(f'image needs path and label: {im}')
    if not ev['images'] and not any(u.get('what', '').endswith('render') for u in b.get('unavailable', [])):
        raise Invalid('no page images and no unavailable entry saying why')
    for key in ('structure', 'text'):
        if not isinstance(ev.get(key), str):
            raise Invalid(f'evidence.{key} must be a path')
    paths = [im['path'] for im in ev['images']] + [ev['structure'], ev['text']]
    for p in paths:
        if not os.path.exists(os.path.join(bundle_dir, p)):
            raise Invalid(f'evidence {p} does not exist beside the bundle')
    if not isinstance(b.get('detector'), dict):
        raise Invalid('detector must be an object of paths')
    if not isinstance(b.get('measures'), list) or not all(isinstance(m, str) for m in b['measures']):
        raise Invalid('measures must be a list of measure names')
    for f in b.get('faults', None) if isinstance(b.get('faults'), list) else [None]:
        if not isinstance(f, dict) or not all(isinstance(f.get(x), str) for x in ('measure', 'kind', 'where', 'detail')):
            raise Invalid(f'fault needs measure, kind, where and detail: {f}')
        if f['measure'] not in b['measures']:
            raise Invalid(f'fault names measure {f["measure"]}, which the bundle does not list')
    for u in b.get('unavailable', None) if isinstance(b.get('unavailable'), list) else [None]:
        if not isinstance(u, dict) or not u.get('what') or not u.get('why'):
            raise Invalid(f'unavailable entry needs what and why: {u}')
    return b


def load_bundle(path):
    with open(path, encoding='utf-8') as f:
        b = json.load(f)
    return validate_bundle(b, os.path.dirname(os.path.abspath(path)))


# ----------------------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description='aac-design audit: one surface in, one evidence bundle out')
    ap.add_argument('target', nargs='?')
    ap.add_argument('--out')
    ap.add_argument('--signin', help='web: a JSON list of steps run before the audit (goto, fill+value, click, waitFor, wait); ${env:NAME} in a value reads the environment')
    ap.add_argument('--commit', help='web: the deployed commit of the URL, for its stamp')
    ap.add_argument('--no-axe', action='store_true', help='web: skip the axe-core run')
    ap.add_argument('--check-bundle', metavar='BUNDLE')
    a = ap.parse_args()
    if a.check_bundle:
        try:
            b = load_bundle(a.check_bundle)
        except (OSError, ValueError, Invalid) as e:
            print(f'invalid bundle: {e}', file=sys.stderr); return 3
        print(f'{a.check_bundle}: valid {SCHEMA} bundle, surface {b["surface"]}, {len(b["faults"])} faults')
        return 0
    if not a.target:
        ap.error('TARGET required')
    surface = surface_of(a.target)
    if not surface:
        print(f'audit: cannot tell the surface of {a.target} (use .html, .docx, .pptx, .pdf or an http(s) URL)', file=sys.stderr)
        return 3
    if surface != 'web' and not os.path.isfile(a.target):
        print(f'audit: {a.target} does not exist', file=sys.stderr); return 3
    out = os.path.abspath(a.out or default_out(a.target))
    if os.path.isdir(out):
        shutil.rmtree(out)
    for d in ('evidence/images', 'detector'):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    try:
        if surface == 'web':
            cmd = ['node', os.path.join(HERE, 'web_adapter.js'), a.target, '--out', out]
            cmd += ['--signin', a.signin] if a.signin else []
            cmd += ['--commit', a.commit] if a.commit else []
            cmd += ['--no-axe'] if a.no_axe else []
            r = subprocess.run(cmd)
            if r.returncode != 0:
                return 3
            path = os.path.join(out, 'bundle.json')
        else:
            b = adapt_pdf(a.target, out) if surface == 'pdf' else adapt_office(a.target, out, surface)
            path = os.path.join(out, 'bundle.json')
            write_json(path, b)
        b = load_bundle(path)
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError, ValueError, Invalid) as e:
        print(f'audit: {a.target}: {e}', file=sys.stderr)
        return 3
    print(path)
    print(f'{b["surface"]}: {len(b["evidence"]["images"])} images, {len(b["faults"])} faults, '
          f'{len(b["unavailable"])} not measured', file=sys.stderr)
    for f in b['faults']:
        print(f'  [{f["measure"]}] {f["kind"]}: {f["where"]} {f["detail"]}', file=sys.stderr)
    for u in b['unavailable']:
        print(f'  not measured: {u["what"]}: {u["why"]}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
