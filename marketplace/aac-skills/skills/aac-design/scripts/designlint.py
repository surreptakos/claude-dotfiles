#!/usr/bin/env python3
"""Deterministic design linter for AAC deliverables: .docx, .pptx, .html/.htm.

    python3 designlint.py FILE [--json]
    python3 designlint.py --contrast FG BG

Standard library only, so the design gate hook runs it on any host (Windows `py -3`,
macOS, the Linux sandbox). Rule IDs and sources are in RULES; TELLS.md explains each.
Form-only rules (D16, D14) apply when the document is a form: it has signature or
fill-in cells.
Exit 0 clean, 2 errors found, 3 unreadable input.
"""
import argparse, colorsys, json, re, sys, zipfile
import xml.etree.ElementTree as ET

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
q = lambda t: f'{{{W}}}{t}'
qa = lambda t: f'{{{A}}}{t}'

RULES = {
    'D01': ('error', 'justified text', 'AAC-WR-001 Rule 79'),
    'D02': ('error', 'repeated spaces used for alignment', 'AAC-WR-001 Rule 81'),
    'D03': ('error', 'all-caps or tracked-caps label (eyebrow)', 'TELLS: eyebrow / all-caps label'),
    'D04': ('error', 'text glyph standing in for a checkbox or icon', 'TELLS: glyph controls'),
    'D05': ('error', 'more than one accent hue', 'TELLS: one accent'),
    'D06': ('error', 'text contrast below WCAG AA', 'WCAG 1.4.3'),
    'D07': ('error', 'text below the size floor', 'AAC-WR-001 Rule 77: 9 pt print floor, 12 pt slides'),
    'D08': ('error', 'colored side stripe wider than 1 pt', 'TELLS: side-stripe border'),
    'D09': ('warn', 'more than one numbered sequence', 'TELLS: numbering collision'),
    'D10': ('error', 'heading with no more space above than below', 'AAC-WR-001 Rule 82'),
    'D11': ('warn', 'stacked empty paragraphs used as spacing', 'AAC-WR-001 Rule 80'),
    'D12': ('warn', 'more than two font families', 'AAC-WR-001 Rule 77'),
    'D13': ('error', 'underscore fill line', 'AAC-WR-001 Rule 81'),
    'D14': ('warn', 'signature field with no date field', 'forms: a signature needs its date'),
    'D15': ('warn', 'text color outside black, gray and the accent', 'TOKENS: palette drift'),
    'D16': ('error', 'form field cell missing borders', 'forms: joined grid, every field boxed'),
    'D18': ('error', 'font resolves only through the theme', 'previews without theme support fall back to Times New Roman; name the font'),
    'D19': ('error', 'body text in gray', 'AAC-WR-001 Rule 78'),
    'D17': ('warn', 'decorative accent stripe (card top border or heading rule)', 'TELLS: stripes read as a web template'),
    'H01': ('error', 'transition: all', 'web-interface-guidelines'),
    'H02': ('error', 'focus outline removed with no focus-visible replacement', 'web-interface-guidelines'),
    'H03': ('error', 'zoom disabled (user-scalable=no or maximum-scale=1)', 'web-interface-guidelines'),
    'H04': ('error', 'image without alt', 'WCAG 1.1.1'),
    'H05': ('error', 'click handler on a div or span', 'web-interface-guidelines: use <button>'),
    'H06': ('error', 'gradient text', 'impeccable craft floor'),
    'H07': ('warn', 'three periods instead of an ellipsis', 'web-interface-guidelines'),
    'H08': ('warn', 'emoji in a heading or button', 'TELLS: glyph icons'),
    'H09': ('warn', 'form input without a label', 'WCAG 3.3.2'),
}
NEUTRALS = {'000000', 'AUTO', 'FFFFFF', '595959', '7F7F7F', '808080', '404040', '262626', 'D9D9D9', 'BFBFBF', '000000'}
GLYPHS = '[☐☑☒□▢◻◽✓✔✘]'


# ------------------------------------------------------------------ color helpers
def rel_lum(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    la, lb = sorted((rel_lum(a), rel_lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def is_accent(h):
    if h in NEUTRALS or not re.fullmatch(r'[0-9A-F]{6}', h):
        return False
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    _, l, s = colorsys.rgb_to_hls(r, g, b)
    return s > 0.25 and 0.08 < l < 0.92


def hue(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return round(colorsys.rgb_to_hls(r, g, b)[0] * 12) % 12


class Findings(list):
    def add(self, rule, where, detail=''):
        sev, what, why = RULES[rule]
        self.append({'rule': rule, 'severity': sev, 'what': what, 'why': why,
                     'where': (where or '')[:90], 'detail': detail})


def caps_label(t, caps_prop):
    letters = re.sub(r'[^A-Za-z]', '', t)
    if caps_prop and letters:
        return True
    # 4+ letters, all upper, not a short acronym (AAC, HR, OTE, FLSA)
    return len(letters) >= 4 and letters.isupper() and not re.fullmatch(r'[A-Z]{2,5}', t.strip())


# ------------------------------------------------------------------ docx
def lint_docx(z, f):
    root = ET.fromstring(z.read('word/document.xml'))
    parent = {c: p for p in root.iter() for c in p}
    body = root.find(q('body'))
    styles = ET.fromstring(z.read('word/styles.xml'))
    dsz = styles.find(f'.//{q("docDefaults")}//{q("sz")}')
    default_sz = int(dsz.get(q('val'))) if dsz is not None else 22
    rdef = styles.find(f'.//{q("docDefaults")}//{q("rFonts")}')
    theme_only = rdef is None or (rdef.get(q('ascii')) is None and rdef.get(q('asciiTheme')) is not None)
    blocks = [k for k in body if k.tag in (q('p'), q('tbl'))]
    # AAC templates own the first two blocks (letterhead table, title bar)
    if len(blocks) > 2 and blocks[0].tag == q('tbl') and 'ACTIVE ALARM' in text(blocks[0]).upper():
        blocks = blocks[2:]
    paras = []
    for b in blocks:
        paras += [b] if b.tag == q('p') else list(b.iter(q('p')))
    fonts, accents, seqs = set(), set(), set()
    empty = 0
    is_form = any(t in text(root) for t in ('Signature', 'Printed name', 'Initials'))
    for p in paras:
        t_all = text(p)
        ppr = p.find(q('pPr'))
        top = parent.get(p) is body
        if top and _prev_is_table(body, p):
            empty = 0
        jc = ppr.find(q('jc')) if ppr is not None else None
        if jc is not None and jc.get(q('val')) in ('both', 'distribute') and t_all.strip():
            f.add('D01', t_all)
        if ppr is not None and ppr.find(q('numPr')) is not None:
            nid = ppr.find(f'{q("numPr")}/{q("numId")}')
            if nid is not None and _is_decimal(z, nid.get(q('val'))):
                seqs.add(nid.get(q('val')))
        if re.match(r'^\s*\d+[.)]\s', t_all):
            seqs.add('typed')
        if '___' in t_all:
            f.add('D13', t_all)
        first = p.find(q('r'))
        frp = first.find(q('rPr')) if first is not None else None
        bold_accent = frp is not None and frp.find(q('b')) is not None and frp.find(q('color')) is not None and is_accent((frp.find(q('color')).get(q('val')) or '').upper())
        if ppr is not None and ppr.find(q('pBdr')) is not None and ppr.find(q('pBdr')).find(q('bottom')) is not None and bold_accent:
            f.add('D17', t_all, 'accent rule under a heading doubles the box border below it')
        in_cell = _ancestor(parent, p, q('tc')) is not None
        if not in_cell and ppr is not None and ppr.find(q('keepNext')) is not None and (ppr.find(q('pBdr')) is not None or _heading_style(ppr) or bold_accent):
            sp = ppr.find(q('spacing'))
            bef = int(sp.get(q('before'), '0')) if sp is not None else 0
            aft = int(sp.get(q('after'), '0')) if sp is not None else 0
            if bef <= aft:
                f.add('D10', t_all, f'before={bef} after={aft} twips')
        if top and not t_all.strip() and p.find(f'.//{q("fldChar")}') is None and p.find(f'.//{q("drawing")}') is None:
            empty += 1
            if empty == 2:
                f.add('D11', '(empty paragraphs)')
        elif top:
            empty = 0
        tc = _ancestor(parent, p, q('tc'))
        fill = 'FFFFFF'
        if tc is not None:
            shd = tc.find(f'{q("tcPr")}/{q("shd")}')
            if shd is not None and (shd.get(q('fill')) or 'auto').lower() != 'auto':
                fill = shd.get(q('fill')).upper()
        for r in p.iter(q('r')):
            t = ''.join(x.text or '' for x in r.iter(q('t')))
            if not t:
                continue
            rp = r.find(q('rPr'))
            val = lambda tag, attr='val': (rp.find(q(tag)).get(q(attr)) if rp is not None and rp.find(q(tag)) is not None else None)
            sz = int(val('sz') or default_sz)
            font = val('rFonts', 'ascii')
            bold = rp is not None and rp.find(q('b')) is not None and val('b') not in ('0', 'false')
            color = (val('color') or '000000').upper()
            if font and 'Symbol' not in font:
                fonts.add(font)
            if theme_only and not font:
                f.add('D18', t, 'run has no font and docDefaults names only a theme font')
            if re.search(r'\S {2,}\S', t) or t.startswith('  '):
                f.add('D02', t)
            if re.search(GLYPHS, t):
                f.add('D04', t)
            if caps_label(t, rp is not None and rp.find(q('caps')) is not None):
                f.add('D03', t)
            if sz < 18:
                f.add('D07', t, f'{sz / 2} pt')
            if re.fullmatch(r'[0-9A-F]{6}', color):
                if color == '595959' and tc is None and len(t.split()) > 6:
                    f.add('D19', t, 'Rule 78: body text is black; gray is for field labels')
                if is_accent(color):
                    accents.add(hue(color))
                elif color not in NEUTRALS:
                    f.add('D15', t, color)
                ratio = contrast(color, fill)
                if ratio < (3.0 if (sz >= 36 or (bold and sz >= 28)) else 4.5):
                    f.add('D06', t, f'{color} on {fill} = {ratio:.2f}:1')
    for shd in root.iter(q('shd')):
        fl = (shd.get(q('fill')) or 'auto').upper()
        if is_accent(fl) and rel_lum(fl) < 0.6:
            accents.add(hue(fl))
    if len(accents) > 1:
        f.add('D05', f'{len(accents)} hue families')
    if len(fonts) > 2:
        f.add('D12', ', '.join(sorted(fonts)))
    if len(seqs) > 1:
        f.add('D09', f'{len(seqs)} sequences')
    for tbl in [b for b in blocks if b.tag == q('tbl')]:
        tt = text(tbl)
        if is_form and 'Signature' in tt and 'Date' not in tt:
            f.add('D14', tt)
        for tc in tbl.iter(q('tc')):
            bd = tc.find(f'{q("tcPr")}/{q("tcBorders")}')
            ct = text(tc).strip()
            sides = {}
            if bd is not None:
                for s in ('top', 'left', 'bottom', 'right'):
                    e = bd.find(q(s))
                    if e is not None and e.get(q('val')) not in ('none', 'nil'):
                        sides[s] = (int(e.get(q('sz'), '4')), (e.get(q('color')) or 'auto').upper())
            for s in ('left', 'right'):
                if s in sides and sides[s][0] > 8 and sides[s][1] not in NEUTRALS:
                    f.add('D08', ct or '(cell)', f'{s} {sides[s][0] / 8} pt {sides[s][1]}')
            if 'top' in sides and sides['top'][0] > 8 and sides['top'][1] not in NEUTRALS:
                f.add('D17', ct or '(cell)', f'top {sides["top"][0] / 8} pt {sides["top"][1]}')
            if is_form and ct and len(sides) < 4:
                f.add('D16', ct, f'borders on {sorted(sides)}')


def text(el, tag=None):
    return ''.join(t.text or '' for t in el.iter(tag or q('t')))


def _prev_is_table(body, p):
    kids = list(body)
    i = kids.index(p)
    return i > 0 and kids[i - 1].tag == q('tbl')


def _ancestor(parent, el, tag):
    while el in parent:
        el = parent[el]
        if el.tag == tag:
            return el
    return None


def _heading_style(ppr):
    st = ppr.find(q('pStyle'))
    return st is not None and (st.get(q('val')) or '').lower().startswith('heading')


_numfmt = {}
def _is_decimal(z, numid):
    if not _numfmt:
        try:
            n = ET.fromstring(z.read('word/numbering.xml'))
        except KeyError:
            return False
        absfmt = {}
        for a in n.iter(q('abstractNum')):
            lvl = a.find(q('lvl'))
            fmt = lvl.find(q('numFmt')).get(q('val')) if lvl is not None and lvl.find(q('numFmt')) is not None else ''
            absfmt[a.get(q('abstractNumId'))] = fmt
        for m in n.iter(q('num')):
            ab = m.find(q('abstractNumId'))
            _numfmt[m.get(q('numId'))] = absfmt.get(ab.get(q('val')) if ab is not None else '', '')
    return _numfmt.get(numid) == 'decimal'


# ------------------------------------------------------------------ pptx
def lint_pptx(z, f):
    fonts, accents = set(), set()
    slides = sorted(n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n))
    for name in slides:
        root = ET.fromstring(z.read(name))
        sid = name.rsplit('/', 1)[-1]
        for r in root.iter(qa('r')):
            t = ''.join(x.text or '' for x in r.iter(qa('t')))
            if not t.strip():
                continue
            rp = r.find(qa('rPr'))
            sz = int(rp.get('sz')) if rp is not None and rp.get('sz') else None
            if sz is not None and sz < 1200:
                f.add('D07', f'{sid}: {t}', f'{sz / 100} pt')
            if caps_label(t, rp is not None and rp.get('cap') == 'all'):
                f.add('D03', f'{sid}: {t}')
            if re.search(GLYPHS, t):
                f.add('D04', f'{sid}: {t}')
            if re.search(r'\S {2,}\S', t):
                f.add('D02', f'{sid}: {t}')
            if '___' in t:
                f.add('D13', f'{sid}: {t}')
            if rp is not None:
                lat = rp.find(qa('latin'))
                if lat is not None and lat.get('typeface') and not lat.get('typeface').startswith('+'):
                    fonts.add(lat.get('typeface'))
                c = rp.find(f'{qa("solidFill")}/{qa("srgbClr")}')
                if c is not None and is_accent(c.get('val', '').upper()):
                    accents.add(hue(c.get('val').upper()))
        for p in root.iter(qa('pPr')):
            if p.get('algn') == 'just':
                f.add('D01', sid)
    if len(accents) > 1:
        f.add('D05', f'{len(accents)} hue families')
    if len(fonts) > 2:
        f.add('D12', ', '.join(sorted(fonts)))


# ------------------------------------------------------------------ html
def lint_html(src, f):
    css = src
    if re.search(r'transition\s*:\s*all\b', css, re.I):
        f.add('H01', 'transition: all')
    if re.search(r'outline\s*:\s*(none|0)\b|outline-none', css, re.I) and not re.search(r'focus-visible', css, re.I):
        f.add('H02', 'outline removed')
    if re.search(r'user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b', src, re.I):
        f.add('H03', 'viewport meta')
    for m in re.finditer(r'<img\b(?![^>]*\balt=)[^>]*>', src, re.I):
        f.add('H04', m.group(0))
    for m in re.finditer(r'<(div|span)\b[^>]*\bonclick=', src, re.I):
        f.add('H05', m.group(0))
    if re.search(r'background-clip\s*:\s*text|-webkit-background-clip\s*:\s*text', css, re.I):
        f.add('H06', 'background-clip: text')
    for m in re.finditer(r'>([^<]*\.\.\.[^<]*)<', src):
        f.add('H07', m.group(1).strip())
    for m in re.finditer(r'<(h[1-6]|button)\b[^>]*>([^<]*[\U0001F300-\U0001FAFF☀-➿][^<]*)</', src):
        f.add('H08', m.group(2).strip())
    if re.search(r'text-align\s*:\s*justify', css, re.I):
        f.add('D01', 'text-align: justify')
    for m in re.finditer(r'text-transform\s*:\s*uppercase[^}]*letter-spacing|letter-spacing[^}]*text-transform\s*:\s*uppercase', css, re.I):
        f.add('D03', 'uppercase + letter-spacing (eyebrow)')
    for m in re.finditer(r'border-(left|right)\s*:\s*(\d+)px[^;}]*', css, re.I):
        if int(m.group(2)) > 1:
            f.add('D08', m.group(0))
    ids_with_label = set(re.findall(r'<label\b[^>]*\bfor=["\']([^"\']+)', src, re.I))
    for m in re.finditer(r'<(input|select|textarea)\b[^>]*>', src, re.I):
        tag = m.group(0)
        if re.search(r'type=["\']?(hidden|submit|button)', tag, re.I):
            continue
        mid = re.search(r'\bid=["\']([^"\']+)', tag)
        if not re.search(r'aria-label', tag, re.I) and not (mid and mid.group(1) in ids_with_label):
            f.add('H09', tag)
    colors = {c.upper() for c in re.findall(r'#([0-9a-fA-F]{6})\b', css)}
    if len({hue(c) for c in colors if is_accent(c)}) > 1:
        f.add('D05', f'{len({hue(c) for c in colors if is_accent(c)})} hue families in CSS')


# ------------------------------------------------------------------ entry
def _is_legal(path):
    with zipfile.ZipFile(path) as z:
        t = text(ET.fromstring(z.read('word/document.xml')))
    marks = [len(re.findall(r'\bshall\b', t, re.I)) >= 2, 'WHEREAS' in t, bool(re.search(r'\bILCS\b|U\.S\.C\.', t)),
             bool(re.search(r'\b(Agreement|Acknowledgment)\b', t)), bool(re.search(r'hereby|herein|pursuant to', t, re.I))]
    return sum(marks) >= 3


def lint(path):
    f = Findings()
    low = path.lower()
    if low.endswith(('.html', '.htm')):
        lint_html(open(path, encoding='utf-8', errors='replace').read(), f)
    elif low.endswith('.docx'):
        _numfmt.clear()
        with zipfile.ZipFile(path) as z:
            lint_docx(z, f)
    elif low.endswith('.pptx'):
        with zipfile.ZipFile(path) as z:
            lint_pptx(z, f)
    else:
        raise ValueError('unsupported type (use .docx, .pptx, .html)')
    # AAC-WR-001 Rule 2 and 137: legal drafting keeps its layout (justified clauses, conspicuous
    # capitals). In a contract or acknowledgment those findings are reported, not blocking.
    if low.endswith('.docx') and _is_legal(path):
        for x in f:
            if x['rule'] in ('D01', 'D03'):
                x['severity'] = 'info'; x['detail'] += ' [legal text, Rule 2]'
    for x in f:
        if x['rule'] == 'D03' and re.fullmatch(r"[A-Z0-9 .,&'-]+\b(INC|LLC|CORP|LTD|CO)\.?", x['where'].strip()):
            x['severity'] = 'info'; x['detail'] += ' [legal entity name, Rule 31]'
    # one finding per rule and location
    seen, out = set(), []
    for x in f:
        k = (x['rule'], x['where'])
        if k not in seen:
            seen.add(k); out.append(x)
    return out


def fix_fonts(path, font='Aptos'):
    """Rewrite docDefaults so runs without a font name `font` instead of a theme slot."""
    import shutil, tempfile
    tmp = tempfile.mktemp(suffix='.docx')
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == 'word/styles.xml':
                s = data.decode('utf-8')
                named = f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}" w:eastAsia="{font}" w:cs="{font}"/>'
                s, n = re.subn(r'(<w:docDefaults>\s*<w:rPrDefault>\s*<w:rPr>)\s*<w:rFonts [^>]*/>', r'\g<1>' + named, s, count=1)
                if not n:
                    s = re.sub(r'(<w:docDefaults>\s*<w:rPrDefault>\s*<w:rPr>)', r'\g<1>' + named, s, count=1)
                data = s.encode('utf-8')
            zout.writestr(item, data)
    shutil.move(tmp, path)
    print(f'{path}: docDefaults now name {font}')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file', nargs='?')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--contrast', nargs=2, metavar=('FG', 'BG'))
    ap.add_argument('--fix-fonts', action='store_true', help='D18 fix: name the theme body font explicitly in docDefaults')
    a = ap.parse_args()
    if a.fix_fonts:
        return fix_fonts(a.file)
    if a.contrast:
        r = contrast(a.contrast[0].upper().lstrip('#'), a.contrast[1].upper().lstrip('#'))
        print(f'{r:.2f}:1  normal {"PASS" if r >= 4.5 else "FAIL"}  large {"PASS" if r >= 3 else "FAIL"}')
        return 0
    if not a.file:
        ap.error('file required')
    try:
        found = lint(a.file)
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError, ValueError) as e:
        print(f'designlint: cannot read {a.file}: {e}', file=sys.stderr)
        return 3
    errors = sum(1 for x in found if x['severity'] == 'error')
    if a.json:
        print(json.dumps({'file': a.file, 'errors': errors, 'findings': found}, indent=2))
    else:
        for x in found:
            print(f"{x['severity'].upper():5} {x['rule']} {x['what']}: \"{x['where']}\" {x['detail']} ({x['why']})")
        print(f'{a.file}: {errors} error, {sum(1 for x in found if x["severity"] == "warn")} warn')
    return 2 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
