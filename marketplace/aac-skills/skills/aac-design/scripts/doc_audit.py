#!/usr/bin/env python3
"""Document, deck and PDF adapters for aac-design audit mode (issue 1088): one run, one evidence bundle.

    python3 doc_audit.py <file.docx | file.pptx | file.pdf> --out DIR [--surface S] [--max-pages N]

The bundle has the web adapter's shape (evidence.py): rendered page images, a structure dump, the
plain text and the adapter's measures, with the detector output (findings.json) withheld from
reviewers until their ledger rows are in.

- .docx and .pptx reuse the build mode's renderer and linter. render.py renders the file under both
  Aptos stand-ins (Carlito, narrower; Liberation Sans, wider), so a page budget that holds under both
  holds in Word; the render measure records both page counts, and the fonts each rendering embedded
  to show the stand-in was used. designlint.py runs on the file. The
  structure dump is the document XML (word/*.xml, or ppt/presentation.xml and every slide).
- .pdf is judged as printed: its page images (pdftoppm) and its text layer (pdftotext -bbox-layout,
  the structure dump), with the linter's text rules run on the text layer and its fonts listed.

Surfaces default to document (.docx, .pdf) and deck (.pptx); --surface names another catalog surface
(a PDF of slides is a deck, a fill-in PDF a form). --max-pages records a page budget fault when a
rendering runs over it.

Needs LibreOffice (Office files) and poppler-utils (pdfinfo, pdftoppm, pdftotext, pdffonts) on PATH.
The Linux sandbox has both; on Windows, LibreOffice (which ships both stand-in fonts) and a poppler
build do the same job. Exit 0 = bundle written (faults or not), 2 = usage, 3 = no renderer, or the
file did not render or read.
"""
import argparse, os, re, shutil, subprocess, sys, zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import designlint  # noqa: E402
import evidence  # noqa: E402
import render  # noqa: E402

KINDS = {'.docx': ('docx', 'document'), '.pptx': ('pptx', 'deck'), '.pdf': ('pdf', 'document')}
POPPLER = ('pdfinfo', 'pdftoppm', 'pdffonts')


class Refused(Exception):
    pass


def lint_fault(catalog, surface, x, where=None):
    return {'measure': 'lint', 'catalog_ids': evidence.ids_for(catalog, surface, detector=x['rule']),
            'kind': f'designlint:{x["rule"]}', 'what': x['what'], 'where': where or x['where'],
            'severity': x['severity'], 'why': x['why'], 'detail': x['detail']}


def slide_no(name):
    return int(re.search(r'(\d+)\.xml$', name).group(1))


# ------------------------------------------------------------------ Office: .docx and .pptx
def office(path, out, adapter, surface, max_pages, catalog):
    if not render.soffice_bin() or not all(shutil.which(b) for b in POPPLER):
        raise Refused('LibreOffice (soffice) and poppler-utils (pdfinfo, pdftoppm, pdffonts) are needed to '
                      'render; run in the Linux sandbox, or put both on PATH')
    faults, measures, structure, text = [], {}, [], []
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        if adapter == 'docx':
            parts = [n for n in ('word/document.xml', 'word/styles.xml', 'word/numbering.xml') if n in names]
            for p in ET.fromstring(z.read('word/document.xml')).iter(designlint.q('p')):
                text.append(''.join('\t' if e.tag == designlint.q('tab') else '\n' if e.tag == designlint.q('br')
                                    else (e.text or '') if e.tag == designlint.q('t') else '' for e in p.iter()))
        else:
            slides = sorted((n for n in names if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)), key=slide_no)
            parts = [n for n in ['ppt/presentation.xml'] + slides if n in names]
            for s in slides:
                text.append(f'--- slide {slide_no(s)} ---')
                for p in ET.fromstring(z.read(s)).iter(designlint.qa('p')):
                    text.append(''.join(t.text or '' for t in p.iter(designlint.qa('t'))))
        for n in parts:
            dest = os.path.join(out, 'structure', *n.split('/'))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, 'wb') as f:
                f.write(z.read(n))
            structure.append('structure/' + n)
    with open(os.path.join(out, 'text.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(text) + '\n')

    found = designlint.lint(path)
    faults += [lint_fault(catalog, surface, x) for x in found]
    measures['lint'] = {'status': 'ok', 'linter': 'designlint.py', 'findings': len(found),
                        'errors': sum(x['severity'] == 'error' for x in found),
                        'warnings': sum(x['severity'] == 'warn' for x in found)}

    pages_dir = os.path.join(out, 'pages')
    os.makedirs(pages_dir, exist_ok=True)
    renders, images, pdfs = [], [], []
    for stand_in, font in render.STAND_INS.items():
        try:
            r = render.render_once(path, font, pages_dir)
        except (OSError, subprocess.SubprocessError, IndexError, ValueError) as e:
            raise Refused(f'render under {font} failed: {e}')
        if r is None or not r['png']:
            raise Refused(f'LibreOffice could not convert the file under {font}')
        imgs = ['pages/' + os.path.basename(p) for p in r['png']]
        pdf = 'pages/' + os.path.basename(r['pdf'])
        renders.append({'stand_in': stand_in, 'font': font, 'pages': r['pages'], 'pdf': pdf, 'images': imgs,
                        'embedded_fonts': r['embedded_fonts']})
        images += imgs
        pdfs.append(pdf)
        if max_pages is not None and r['pages'] > max_pages:
            faults.append({'measure': 'render', 'catalog_ids': [], 'kind': 'over-page-budget',
                           'what': f'{r["pages"]} pages under {font}, over the budget of {max_pages}',
                           'where': f'{stand_in} stand-in ({font})'})
    measures['render'] = {'status': 'ok', 'renderer': 'LibreOffice', 'stand_ins': renders,
                          'pages': {r['stand_in']: r['pages'] for r in renders}, 'max_pages': max_pages,
                          'fits': max_pages is None or all(r['pages'] <= max_pages for r in renders)}
    return dict(images=images, structure=structure, measures=measures, faults=faults, extra_review=pdfs)


# ------------------------------------------------------------------ PDF: page images and text layer
WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', re.S)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=150)
    if r.returncode != 0:
        raise Refused(f'{os.path.basename(cmd[0])} failed: {r.stderr.strip()[:300]}')
    return r.stdout


def text_layer(xhtml):
    """Pages of lines from pdftotext -bbox-layout: [[{'text', 'box'}]] in reading order."""
    pages = []
    for page in re.findall(r'<page\b.*?</page>', xhtml, re.S):
        lines = []
        for line in re.findall(r'<line\b.*?</line>', page, re.S):
            words = WORD.findall(line)
            if words:
                unescape = lambda t: re.sub(r'&(amp|lt|gt|quot|apos);', lambda m: {'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'"}[m.group(1)], t)
                lines.append({'text': ' '.join(unescape(w[4]) for w in words),
                              'box': [round(float(min(w[0] for w in words)), 1), round(float(min(w[1] for w in words)), 1),
                                      round(float(max(w[2] for w in words)), 1), round(float(max(w[3] for w in words)), 1)]})
        pages.append(lines)
    return pages


def pdf(path, out, surface, max_pages, catalog):
    if not all(shutil.which(b) for b in POPPLER + ('pdftotext',)):
        raise Refused('poppler-utils (pdfinfo, pdftoppm, pdftotext, pdffonts) is needed; run in the Linux '
                      'sandbox, or put it on PATH')
    info = run(['pdfinfo', path])
    m = re.search(r'^Pages:\s+(\d+)', info, re.M)
    if not m:
        raise Refused('pdfinfo reports no page count')
    n = int(m.group(1))
    size = (re.search(r'^Page size:\s+(.+)$', info, re.M) or [None, ''])[1].strip()
    faults, measures = [], {}

    pages_dir = os.path.join(out, 'pages')
    os.makedirs(pages_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(path))[0]
    run(['pdftoppm', '-png', '-r', '90', path, os.path.join(pages_dir, stem)])
    images = sorted('pages/' + f for f in os.listdir(pages_dir) if f.startswith(stem + '-') and f.endswith('.png'))
    if not images:
        raise Refused('pdftoppm wrote no page images')
    measures['render'] = {'status': 'ok', 'renderer': 'pdftoppm', 'dpi': 90, 'pages': n, 'page_size': size,
                          'images': images, 'max_pages': max_pages, 'fits': max_pages is None or n <= max_pages}
    if max_pages is not None and n > max_pages:
        faults.append({'measure': 'render', 'catalog_ids': [], 'kind': 'over-page-budget',
                       'what': f'{n} pages, over the budget of {max_pages}', 'where': 'document'})

    os.makedirs(os.path.join(out, 'structure'), exist_ok=True)
    layer_file = os.path.join(out, 'structure', 'text-layer.html')
    run(['pdftotext', '-bbox-layout', path, layer_file])
    run(['pdftotext', '-layout', path, os.path.join(out, 'text.txt')])
    with open(layer_file, encoding='utf-8', errors='replace') as f:
        pages = text_layer(f.read())
    bare = [i + 1 for i, lines in enumerate(pages) if not lines]
    measures['pdf.text-layer'] = {'status': 'ok', 'pages': len(pages), 'lines': sum(len(p) for p in pages),
                                  'pages_without_text': bare}
    for p in bare:
        faults.append({'measure': 'pdf.text-layer', 'catalog_ids': [], 'kind': 'no-text-layer',
                       'what': 'page has no text layer, so a screen reader or search finds nothing on it',
                       'where': f'page {p}'})

    # The linter's text rules, on what the text layer says was printed.
    f = designlint.Findings()
    for i, lines in enumerate(pages):
        for ln in lines:
            t, where = ln['text'], f'page {i + 1}: {ln["text"]}'
            if '___' in t:
                f.add('D13', where)
            if re.search(designlint.GLYPHS, t):
                f.add('D04', where)
            if designlint.caps_label(t, False):
                f.add('D03', where)

    fonts = []
    for row in run(['pdffonts', path]).splitlines()[2:]:
        cols = row.split()
        if cols:
            emb = re.search(r'\s(yes|no)\s+(yes|no)\s+(yes|no)\s', row)
            fonts.append({'name': cols[0], 'embedded': bool(emb) and emb.group(1) == 'yes'})
    families = sorted({re.split(r'[-,]', x['name'].split('+')[-1])[0] for x in fonts})
    measures['pdf.fonts'] = {'status': 'ok', 'fonts': fonts, 'families': families}
    if len(families) > 2:
        f.add('D12', ', '.join(families))
    faults += [lint_fault(catalog, surface, x) for x in f]
    measures['lint'] = {'status': 'ok', 'linter': 'designlint.py text rules on the text layer',
                        'rules': ['D03', 'D04', 'D12', 'D13'], 'findings': len(f)}
    return dict(images=images, structure=['structure/text-layer.html'], measures=measures, faults=faults)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('file')
    ap.add_argument('--out', required=True)
    ap.add_argument('--surface')
    ap.add_argument('--max-pages', type=int)
    a = ap.parse_args()
    ext = os.path.splitext(a.file)[1].lower()
    if ext not in KINDS:
        ap.error(f'unsupported file type {ext or "(none)"}: use .docx, .pptx or .pdf')
    if not os.path.isfile(a.file):
        ap.error(f'no such file: {a.file}')
    catalog = evidence.load_catalog()
    adapter, surface = KINDS[ext][0], a.surface or KINDS[ext][1]
    if surface not in catalog['surfaces']:
        ap.error(f'--surface must be one of {catalog["surfaces"]}')
    path, out = os.path.abspath(a.file), os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    subject = evidence.file_subject(path)
    try:
        parts = (pdf(path, out, surface, a.max_pages, catalog) if adapter == 'pdf'
                 else office(path, out, adapter, surface, a.max_pages, catalog))
    except Refused as e:
        print(f'doc_audit: {e}', file=sys.stderr)
        return 3
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError, subprocess.SubprocessError) as e:
        print(f'doc_audit: cannot read {a.file}: {e}', file=sys.stderr)
        return 3
    evidence.write_bundle(out, adapter=adapter, surface=surface, target=a.file, subject=subject, **parts)
    problems = evidence.validate(out, catalog)
    if problems:
        print('doc_audit: the bundle breaks the evidence shape:\n  - ' + '\n  - '.join(problems), file=sys.stderr)
        return 3
    for x in parts['faults']:
        print(f'{x["measure"]}  {x["kind"]}  {x["where"]}  {x["what"]}')
    print(f'doc_audit: {len(parts["faults"])} fault(s); bundle {os.path.join(out, "bundle.json")}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
