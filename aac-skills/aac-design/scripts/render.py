#!/usr/bin/env python3
"""Render a .docx to PDF and PNG under two Aptos stand-in fonts and report page counts.

    python3 render.py form.docx [--max-pages N] [--out DIR]

Aptos is not installed in the Linux sandbox. Carlito renders narrower than Aptos and
Liberation Sans renders wider, so a form that fits under both fits in Word.
Writes DIR/<stem>.<font>.pdf and DIR/<stem>.<font>-<page>.png (90 dpi), and reports the fonts
each PDF embeds, so a rendering that missed its stand-in shows.
The stand-in is set twice: a fontconfig alias (Linux) and LibreOffice's own font replacement table
in the throwaway profile (any host, Windows included, where LibreOffice ships both fonts).
Exit 0 when every rendering is within --max-pages, 1 when any exceeds it, 3 on a render failure.
"""
import argparse, glob, json, os, pathlib, shutil, subprocess, sys, tempfile

STAND_INS = {'narrow': 'Carlito', 'wide': 'Liberation Sans'}


def soffice_bin():
    for b in ('soffice', 'libreoffice'):
        p = shutil.which(b)
        if p:
            return p
    for d in (os.environ.get('ProgramFiles'), os.environ.get('ProgramFiles(x86)')):
        p = d and os.path.join(d, 'LibreOffice', 'program', 'soffice.exe')
        if p and os.path.isfile(p):
            return p
    return None


def replacement_table(font):
    """registrymodifications.xcu for a fresh profile: Aptos always replaced by the stand-in."""
    pair = lambda i, src: (
        f'<item oor:path="/org.openoffice.Office.Common/Font/Substitution/FontPairs"><node oor:name="_{i}" oor:op="replace">'
        '<prop oor:name="Always" oor:op="fuse"><value>true</value></prop>'
        '<prop oor:name="OnScreenOnly" oor:op="fuse"><value>false</value></prop>'
        f'<prop oor:name="ReplaceFont" oor:op="fuse"><value>{src}</value></prop>'
        f'<prop oor:name="SubstituteFont" oor:op="fuse"><value>{font}</value></prop></node></item>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<oor:items xmlns:oor="http://openoffice.org/2001/registry" '
            'xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            '<item oor:path="/org.openoffice.Office.Common/Font/Substitution"><prop oor:name="Replacement" oor:op="fuse">'
            '<value>true</value></prop></item>' + pair(0, 'Aptos') + pair(1, 'Aptos Display') + '</oor:items>\n')


def embedded_fonts(pdf):
    """Font families the PDF embeds, from pdffonts (subset prefix and style dropped)."""
    out = subprocess.run(['pdffonts', pdf], capture_output=True, text=True).stdout
    names = [r.split()[0] for r in out.splitlines()[2:] if r.split()]
    return sorted({n.split('+')[-1].split('-')[0].split(',')[0] for n in names})


def office_env():
    """LibreOffice needs AF_UNIX sockets; sandboxes that block them need the docx skill's
    LD_PRELOAD shim. Reuse that helper when present instead of carrying a second copy."""
    roots = [os.environ.get('AFD_OFFICE_HELPER', '')]
    roots += glob.glob(os.path.expanduser('~/.claude/skills/docx/scripts'))
    roots += glob.glob('/sessions/*/mnt/.claude/skills/docx/scripts')
    for r in roots:
        if r and os.path.exists(os.path.join(r, 'office', 'soffice.py')):
            sys.path.insert(0, r)
            try:
                from office.soffice import get_soffice_env
                return get_soffice_env()
            except Exception:
                pass
    return dict(os.environ)


def render_once(docx, font, outdir):
    fc_dir = tempfile.mkdtemp(prefix='afd_fc_')
    conf = os.path.join(fc_dir, 'fonts.conf')
    open(conf, 'w').write(
        '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'
        '<include ignore_missing="yes">/etc/fonts/fonts.conf</include>'
        f'<alias binding="strong"><family>Aptos</family><prefer><family>{font}</family></prefer></alias>'
        f'<alias binding="strong"><family>Aptos Display</family><prefer><family>{font}</family></prefer></alias>'
        '</fontconfig>')
    profile = tempfile.mkdtemp(prefix='afd_lo_')
    os.makedirs(os.path.join(profile, 'user'))
    with open(os.path.join(profile, 'user', 'registrymodifications.xcu'), 'w', encoding='utf-8') as f:
        f.write(replacement_table(font))
    tmpout = tempfile.mkdtemp(prefix='afd_out_')
    env = dict(office_env(), FONTCONFIG_FILE=conf, SAL_USE_VCLPLUGIN='svp')
    cmd = [soffice_bin(), f'-env:UserInstallation={pathlib.Path(profile).as_uri()}', '--headless',
           '--convert-to', 'pdf', '--outdir', tmpout, docx]
    try:
        subprocess.run(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=150)
    except subprocess.TimeoutExpired:
        return None
    stem = os.path.splitext(os.path.basename(docx))[0]
    src = os.path.join(tmpout, stem + '.pdf')
    if not os.path.exists(src):
        return None
    tag = font.replace(' ', '')
    pdf = os.path.join(outdir, f'{stem}.{tag}.pdf')
    shutil.move(src, pdf)
    info = subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout
    pages = int([l for l in info.splitlines() if l.startswith('Pages:')][0].split()[1])
    subprocess.run(['pdftoppm', '-png', '-r', '90', pdf, os.path.join(outdir, f'{stem}.{tag}')], check=True)
    pngs = sorted(f for f in os.listdir(outdir) if f.startswith(f'{stem}.{tag}-') and f.endswith('.png'))
    return {'font': font, 'pages': pages, 'pdf': pdf, 'png': [os.path.join(outdir, p) for p in pngs],
            'embedded_fonts': embedded_fonts(pdf)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('docx')
    ap.add_argument('--max-pages', type=int, default=None)
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    if not soffice_bin():
        print('render: LibreOffice (soffice) not found; render in the Linux sandbox', file=sys.stderr)
        sys.exit(3)
    docx = os.path.abspath(a.docx)
    outdir = os.path.abspath(a.out or os.path.join(os.path.dirname(docx), 'render'))
    os.makedirs(outdir, exist_ok=True)
    results = []
    for kind, font in STAND_INS.items():
        r = render_once(docx, font, outdir)
        if r is None:
            print(f'render: conversion failed under {font}', file=sys.stderr)
            sys.exit(3)
        r['stand_in'] = kind
        results.append(r)
    over = a.max_pages is not None and any(r['pages'] > a.max_pages for r in results)
    print(json.dumps({'docx': docx, 'max_pages': a.max_pages, 'renders': results, 'fits': not over}, indent=2))
    sys.exit(1 if over else 0)


if __name__ == '__main__':
    main()
