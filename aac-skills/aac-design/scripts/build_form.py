#!/usr/bin/env python3
"""Build an AAC paper form (.docx) from a JSON spec on the AAC letterhead template.

    python3 build_form.py spec.json out.docx [--template ../assets/aac-letterhead.docx]

The spec schema and every component are documented in ../DESIGN-SYSTEM.md.
Exit 0 on success, 1 on a spec error (message names the bad key).
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, zipfile
from xml.sax.saxutils import escape as E

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TEMPLATE = os.path.join(HERE, '..', 'assets', 'aac-letterhead.docx')

# ---- tokens ----
PT = 20  # twips per point
# ---- BEGIN GENERATED TOKENS: tools/build-design-tokens.js writes this block from assets/aac-tokens.json. Never hand-edit. ----
# The executable copy of DESIGN-SYSTEM.md "Tokens": change assets/aac-tokens.json, then run the generator.
T = {
    # color
    'accent': '1161A0', 'tint': 'E8F0F8', 'caption': '595959', 'border': '7F7F7F', 'text': '000000',
    'border_sz': 4,     # 0.5 pt cell border, in eighths of a point (Word's unit)
    'font': 'Aptos',
    # type, in half-points (Word's unit): AAC-WR-001 Rule 77, including its fill-in form clause (v0.11)
    'sz_heading': 22,   # 11 pt, bold, accent: Section heading (Rule 77, third level)
    'sz_role': 20,      # 10 pt, bold, black; step number in accent: Signer and HR card heading
    'sz_value': 21,     # 10.5 pt, regular, black: Prefilled values, choice text
    'sz_body': 20,      # 10 pt, regular, black: Intro, terms
    'sz_caption': 18,   # 9 pt, regular, caption gray: Field labels, signer statements
    # grid
    'page_w': 10800, 'grid': 12, 'hr_label_span': 4,
}
# spacing scale, in points; every vertical or inner space the builder uses comes from here
S = {
    'hair': 1,              # Space around a written value
    'tight': 2,             # Gap between a card heading and its statement or choices
    'snug': 3,              # Heading after (Rule 82), term item after, cell top padding
    'base': 4,              # Card top padding, gap after an acknowledgment line
    'loose': 6,             # Cell and card side padding; spacer before the HR row
    'open': 8,              # Card bottom padding, space before the intro
    'heading_before': 9,    # Space above a section heading (Rule 82)
    'value_row': 27,        # Minimum height of a field row (0.375 in)
    'hr_row': 28,           # Minimum height of the HR row
    'signature_row': 34,    # Minimum height of a signature row (0.47 in)
    'indent': 18,           # Bullet hanging indent
}
LINE_TERMS = 252  # 1.05 line spacing for multi-line terms (240 = single)
CHOICE_GAP = '\u2003\u2003'  # two em spaces between checkbox options
STEP_SEP = '\u2002'  # an en space between a step number and its role
CELL_PAD = ('snug', 'loose', 'tight')  # top, sides, bottom
CARD_PAD = ('base', 'loose', 'open')  # top, sides, bottom
# ---- END GENERATED TOKENS ----
sp = lambda k: S[k] * PT
COLW = T['page_w'] // T['grid']  # 900 twips per grid column


class SpecError(Exception):
    pass


# ---------------------------------------------------------------- primitives
FONT = f'<w:rFonts w:ascii="{T["font"]}" w:hAnsi="{T["font"]}" w:eastAsia="{T["font"]}" w:cs="{T["font"]}"/>'


def rpr(b=False, sz=None, color=None, i=False):
    # Name the font on every run: previews that ignore theme fonts fall back to Times New Roman.
    x = FONT
    if b: x += '<w:b/><w:bCs/>'
    if i: x += '<w:i/><w:iCs/>'
    if color: x += f'<w:color w:val="{color}"/>'
    if sz: x += f'<w:sz w:val="{sz}"/><w:szCs w:val="{sz}"/>'
    return f'<w:rPr>{x}</w:rPr>'


def run(text, **k):
    """Text run. '\t' becomes a real tab; '**x**' spans are bold."""
    out = ''
    for part in re.split(r'(\*\*.*?\*\*)', text):
        if not part:
            continue
        kk = dict(k)
        if part.startswith('**') and part.endswith('**'):
            part = part[2:-2]; kk['b'] = True
        for seg in re.split(r'(\t)', part):
            if seg == '\t':
                out += f'<w:r>{rpr(**kk)}<w:tab/></w:r>'
            elif seg:
                out += f'<w:r>{rpr(**kk)}<w:t xml:space="preserve">{E(seg)}</w:t></w:r>'
    return out


_cb = [0]
def checkbox(sz):
    """Legacy FORMCHECKBOX: a drawn box that prints and can be ticked in Word."""
    _cb[0] += 1
    r = rpr(sz=sz)
    return (f'<w:r>{r}<w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Check{_cb[0]}"/>'
            f'<w:enabled/><w:calcOnExit w:val="0"/><w:checkBox><w:sizeAuto/><w:default w:val="0"/>'
            f'</w:checkBox></w:ffData></w:fldChar></w:r>'
            f'<w:r>{r}<w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r>'
            f'<w:r>{r}<w:fldChar w:fldCharType="end"/></w:r>')


def choices(opts, sz, other=False):
    NBSP, GAP = '\u00a0', CHOICE_GAP  # one fixed gap everywhere, so a tick cannot read as the neighbour's
    x = ''
    for n, o in enumerate(opts):
        if n: x += run(GAP, sz=sz)
        x += checkbox(sz) + run(NBSP + o, sz=sz)
    if other:
        x += run(GAP, sz=sz) + checkbox(sz) + run(NBSP + 'Other', sz=sz)
    return x


def para(runs, before=0, after=0, keep=False, rule=None, jc='left', line=240, ind=None, num=None, tabs=None):
    p = ''
    if keep: p += '<w:keepNext/>'
    if num is not None: p += f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num}"/></w:numPr>'
    if rule: p += f'<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="{rule}"/></w:pBdr>'
    if tabs: p += '<w:tabs>' + ''.join(f'<w:tab w:val="left" w:pos="{t}"/>' for t in tabs) + '</w:tabs>'
    p += f'<w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto"/>'
    if ind: p += ind
    p += f'<w:jc w:val="{jc}"/>'
    return f'<w:p><w:pPr>{p}</w:pPr>{runs}</w:p>'


def spacer(sz=2 * S['loose']):
    return f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr><w:sz w:val="{sz}"/></w:rPr></w:pPr></w:p>'


def cell(w, content, fill=None, span=1, pad=CELL_PAD):
    # Full borders on every cell: a label inside the cell floats without its box (Dan, 2026-09-30).
    mar = tuple(sp(k) for k in pad)
    b = ''.join(f'<w:{s} w:val="single" w:sz="{T["border_sz"]}" w:space="0" w:color="{T["border"]}"/>'
                for s in ('top', 'left', 'bottom', 'right'))
    g = f'<w:gridSpan w:val="{span}"/>' if span > 1 else ''
    f = f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>' if fill else ''
    m = (f'<w:tcMar><w:top w:w="{mar[0]}" w:type="dxa"/><w:left w:w="{mar[1]}" w:type="dxa"/>'
         f'<w:bottom w:w="{mar[2]}" w:type="dxa"/><w:right w:w="{mar[1]}" w:type="dxa"/></w:tcMar>')
    return f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>{g}<w:tcBorders>{b}</w:tcBorders>{f}{m}<w:vAlign w:val="top"/></w:tcPr>{content}</w:tc>'


def row(cells, h):
    return f'<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="{h}"/></w:trPr>{"".join(cells)}</w:tr>'


def table(rows, ncols=T['grid'], colw=COLW):
    nb = ''.join(f'<w:{k} w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                 for k in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
    return (f'<w:tbl><w:tblPr><w:tblW w:w="{ncols*colw}" w:type="dxa"/><w:tblBorders>{nb}</w:tblBorders>'
            f'<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>'
            f'</w:tblCellMar></w:tblPr><w:tblGrid>' + ''.join(f'<w:gridCol w:w="{colw}"/>' for _ in range(ncols))
            + '</w:tblGrid>' + ''.join(rows) + '</w:tbl>')


FORMATS = {'date': ' (MM/DD/YYYY)', 'money': ' ($)'}


def label(t, fmt=None):
    if fmt and fmt not in FORMATS:
        raise SpecError(f'unknown format "{fmt}" (use {sorted(FORMATS)})')
    suffix = FORMATS[fmt] if fmt else ''
    if fmt == 'money' and '$' in t:
        suffix = ''  # the label already states the unit
    return para(run(t + (suffix if suffix not in t else ''), sz=T['sz_caption'], color=T['caption']))


def value(t='', sz=None):
    return para(run(t, sz=sz or T['sz_value']) if t else '', before=sp('hair'), after=sp('hair'))


def heading(t):
    # Rule 82, third level: 9 pt before, 3 pt after. No rule under it: it doubled the box's top border.
    return para(run(t, b=True, sz=T['sz_heading'], color=T['accent']), before=sp('heading_before'), after=sp('snug'), keep=True)


# ---------------------------------------------------------------- components
def field_cell(f, span):
    if 'label' not in f:
        raise SpecError(f'field without "label": {f}')
    w = span * COLW
    if 'choices' in f:
        body = label(f['label'], f.get('format')) + para(choices(f['choices'], T['sz_value'], f.get('other', False)),
                                        before=sp('hair'), after=sp('hair'))
        if f.get('write'):  # a write line under the boxes, for "describe" or "Other"
            body += value()
    else:
        body = label(f['label'], f.get('format')) + value(f.get('prefill', ''))
    return cell(w, body, span=span)


# Custom tab stops plus FORMCHECKBOX fields hang LibreOffice's PDF export, so choices are
# spaced with CHOICE_GAP instead of tabs.


def section(b):
    rows = []
    for r in b['rows']:
        spans = [c.get('span') for c in r]
        if any(s is None for s in spans):
            if len(r) not in (1, 2, 3, 4, 6, 12):
                raise SpecError(f'row of {len(r)} cells needs explicit "span" values (grid is 12)')
            spans = [T['grid'] // len(r)] * len(r)
        if sum(spans) != T['grid']:
            raise SpecError(f'row spans sum to {sum(spans)}, must be 12: {[c.get("label") for c in r]}')
        h = max([b.get('row_height', sp('value_row'))] + [c.get('height', 0) for c in r])
        rows.append(row([field_cell(c, s) for c, s in zip(r, spans)], h=h))
    return heading(b['heading']) + table(rows)


def bullets(b):
    x = heading(b['heading']) if b.get('heading') else ''
    for t in b['items']:
        x += para(run(t, sz=T['sz_body']), after=sp('snug'), line=LINE_TERMS, num=20,
                  ind=f'<w:ind w:left="{sp("indent")}" w:hanging="{sp("indent")}"/>')
    return x


def signatures(b):
    cols = b['columns']
    if len(cols) not in (2, 3, 4):
        raise SpecError('signatures need 2 to 4 columns')
    span = T['grid'] // len(cols)
    w = span * COLW
    head = []
    for c in cols:
        role = run(f"{c['step']}{STEP_SEP}", b=True, sz=T['sz_role'], color=T['accent']) + run(c['role'], b=True, sz=T['sz_role'])
        body = para(role)
        if c.get('choices'):
            body += para(choices(c['choices'], T['sz_value']), before=sp('tight'))
        if c.get('statement'):
            body += para(run(c['statement'], sz=T['sz_caption'], color=T['caption']), before=sp('tight'))
        head.append(cell(w, body, fill=T['tint'], span=span, pad=CARD_PAD))
    rows = [row(head, h=0)]
    for rl in b.get('rows', ['Signature', 'Printed name', 'Date']):
        cells = []
        for c in cols:
            pre = c.get('prefill', {}).get(rl, 'X' if rl == 'Signature' else '')
            lab = c.get('labels', {}).get(rl, rl)
            cells.append(cell(w, label(lab) + value(pre, sz=T['sz_body']), span=span))
        rows.append(row(cells, h=sp('signature_row') if rl == 'Signature' else sp('value_row')))
    for fr in b.get('full_rows', []):
        labs = fr if isinstance(fr, list) else [fr]
        n = T['grid'] // len(labs)
        rows.append(row([cell(n * COLW, label(l) + value(), span=n) for l in labs], h=sp('value_row')))
    x = heading(b['heading']) if b.get('heading') else ''
    if b.get('acknowledgment'):
        x += para(run(b['acknowledgment'], sz=T['sz_body']), after=sp('base'), keep=True)
    return x + keep_together(table(rows))


def keep_together(tbl):
    """Keep a table on one page (Rule 85: a signature block never strands on a continuation page):
    every paragraph except those in the last row keeps with the next."""
    last = tbl.rfind('<w:tr>')
    head, tail = tbl[:last], tbl[last:]
    return head.replace('<w:p><w:pPr>', '<w:p><w:pPr><w:keepNext/>') + tail


def hr_use(b):
    fields = [f if isinstance(f, dict) else {'label': f} for f in b['fields']]
    lab_span = T['hr_label_span']
    rest = T['grid'] - lab_span
    if all('span' in f for f in fields):
        spans = [f['span'] for f in fields]
        if sum(spans) != rest:
            raise SpecError(f'hr_use field spans must sum to {rest}')
    else:
        spans = [rest // len(fields)] * len(fields)
        spans[-1] += rest - sum(spans)
    role = run(f"{b['step']}{STEP_SEP}", b=True, sz=T['sz_role'], color=T['accent']) + run(b['label'], b=True, sz=T['sz_role']) \
        if b.get('step') else run(b['label'], b=True, sz=T['sz_role'])
    card = para(role) + (para(run(b['statement'], sz=T['sz_caption'], color=T['caption']), before=sp('tight')) if b.get('statement') else '')
    cells = [cell(lab_span * COLW, card, fill=T['tint'], span=lab_span, pad=CARD_PAD)]
    cells += [cell(n * COLW, label(f['label'], f.get('format')) + value(), span=n) for f, n in zip(fields, spans)]
    return spacer(4) + table([row(cells, h=sp('hr_row'))])


def intro(b):
    # Rule 78: body text is black. Gray is for field labels only.
    return para(run(b['text'], sz=T['sz_body'], color=T['text']), before=sp('open'), after=0)


def page_break(b):
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


BUILDERS = {'intro': intro, 'section': section, 'bullets': bullets, 'signatures': signatures,
            'hr_use': hr_use, 'office': hr_use, 'page_break': page_break}


# ---------------------------------------------------------------- assembly
def build(spec, out, template):
    for k in ('title', 'footer', 'blocks'):
        if k not in spec:
            raise SpecError(f'spec missing "{k}"')
    work = tempfile.mkdtemp(prefix='afd_build_')
    with zipfile.ZipFile(template) as z:
        z.extractall(work)
    W = os.path.join(work, 'word')
    body = []
    for n, b in enumerate(spec['blocks']):
        t = b.get('type')
        if t not in BUILDERS:
            raise SpecError(f'block {n}: unknown type "{t}" (use {sorted(BUILDERS)})')
        body.append(BUILDERS[t](b))
    body.append('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>'
                '<w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>')
    d = open(os.path.join(W, 'document.xml'), encoding='utf-8').read()
    d = d.replace('FORM TITLE', E(spec['title']))
    d = d.replace('<w:p/><w:sectPr', ''.join(body) + '<w:sectPr', 1)
    open(os.path.join(W, 'document.xml'), 'w', encoding='utf-8').write(d)
    for fn in ('footer1.xml', 'footer2.xml'):
        p = os.path.join(W, fn)
        if os.path.exists(p):
            f = open(p, encoding='utf-8').read().replace('{{FOOTER}}', E(spec['footer']))
            open(p, 'w', encoding='utf-8').write(f)
    core = os.path.join(work, 'docProps', 'core.xml')
    c = open(core, encoding='utf-8').read().replace('FORM TITLE', E(spec['title']))
    open(core, 'w', encoding='utf-8').write(c)
    sty = os.path.join(W, 'styles.xml')
    st = open(sty, encoding='utf-8').read()
    st = re.sub(r'(<w:docDefaults><w:rPrDefault><w:rPr>)<w:rFonts [^>]*/>', r'\1' + FONT, st, count=1)
    open(sty, 'w', encoding='utf-8').write(st)
    num = os.path.join(W, 'numbering.xml')
    n = open(num, encoding='utf-8').read()
    if 'w:abstractNumId="20"' not in n:
        ab = ('<w:abstractNum w:abstractNumId="20"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0">'
              '<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/>'
              f'<w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr><w:rPr><w:color w:val="{T["accent"]}"/></w:rPr></w:lvl></w:abstractNum>')
        k = n.find('<w:num ')
        n = n[:k] + ab + n[k:]
        n = n.replace('</w:numbering>', '<w:num w:numId="20"><w:abstractNumId w:val="20"/></w:num></w:numbering>')
        open(num, 'w', encoding='utf-8').write(n)
    if spec.get('continuation'):
        add_continuation_header(work, spec)
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(work):
            for fn in files:
                full = os.path.join(root, fn)
                arc = os.path.relpath(full, work)
                z.write(full, arc)
    shutil.rmtree(work, ignore_errors=True)


HDR_NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')


def add_continuation_header(work, spec):
    """Pages 2 and on carry the form name and the identity fields, so a separated page can be
    matched to its first page (Rules 85 and 86). Page 1 keeps the letterhead and no header."""
    ids = spec['continuation'].get('identify', [])
    if not ids:
        raise SpecError('continuation needs "identify": the fields that tie a page to its form')
    W = os.path.join(work, 'word')
    n = T['grid'] // len(ids)
    title = spec['continuation'].get('label', spec['title'].capitalize() + ', continued')  # Rule 37: sentence case
    cells = [cell(n * COLW, label(f) + value(), span=n) for f in ids]
    body = (para(run(title, b=True, sz=T['sz_role'], color=T['accent']), after=sp('snug'))
            + table([row(cells, h=sp('value_row'))]) + spacer())
    open(os.path.join(W, 'header_cont.xml'), 'w', encoding='utf-8').write(
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr {HDR_NS}>{body}</w:hdr>')
    open(os.path.join(W, 'header_first.xml'), 'w', encoding='utf-8').write(
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr {HDR_NS}><w:p/></w:hdr>')
    rels = os.path.join(W, '_rels', 'document.xml.rels')
    r = open(rels, encoding='utf-8').read()
    ht = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header'
    r = r.replace('</Relationships>', f'<Relationship Id="rIdHdrCont" Type="{ht}" Target="header_cont.xml"/>'
                  f'<Relationship Id="rIdHdrFirst" Type="{ht}" Target="header_first.xml"/></Relationships>')
    open(rels, 'w', encoding='utf-8').write(r)
    ctp = os.path.join(work, '[Content_Types].xml')
    ct = open(ctp, encoding='utf-8').read()
    hc = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
    ct = ct.replace('</Types>', f'<Override PartName="/word/header_cont.xml" ContentType="{hc}"/>'
                    f'<Override PartName="/word/header_first.xml" ContentType="{hc}"/></Types>')
    open(ctp, 'w', encoding='utf-8').write(ct)
    dp = os.path.join(W, 'document.xml')
    d = open(dp, encoding='utf-8').read()
    d = re.sub(r'(<w:sectPr\b[^>]*>)', r'\1<w:headerReference w:type="default" r:id="rIdHdrCont"/>'
               r'<w:headerReference w:type="first" r:id="rIdHdrFirst"/>', d, count=1)
    if '<w:titlePg/>' not in d:
        d = re.sub(r'(<w:docGrid\b)', r'<w:titlePg/>\1', d, count=1)
    open(dp, 'w', encoding='utf-8').write(d)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('spec'); ap.add_argument('out')
    ap.add_argument('--template', default=DEFAULT_TEMPLATE)
    a = ap.parse_args()
    try:
        build(json.load(open(a.spec, encoding='utf-8')), a.out, a.template)
    except SpecError as e:
        print(f'spec error: {e}', file=sys.stderr); sys.exit(1)
    print(a.out)


if __name__ == '__main__':
    main()
