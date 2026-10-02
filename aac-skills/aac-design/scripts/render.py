#!/usr/bin/env python3
"""Render a .docx to PDF and PNG under two Aptos stand-in fonts and report page counts.

    python3 render.py form.docx [--max-pages N] [--out DIR]

Aptos is not installed in the Linux sandbox. Carlito renders narrower than Aptos and
Liberation Sans renders wider, so a form that fits under both fits in Word.
Writes DIR/<stem>.<font>.pdf and DIR/<stem>.<font>-<page>.png (90 dpi), and reports the fonts
each PDF embeds, so a rendering that missed its stand-in shows.
The stand-in is set twice: a fontconfig alias (Linux) and LibreOffice's own font replacement table
in the throwaway profile (any host, Windows included, where LibreOffice ships both fonts).
In a Linux container that lacks a piece (LibreOffice's Writer or Impress component, poppler, a
stand-in font) and can run apt-get as root or through passwordless sudo, the missing packages are
installed before the first render (issue 1310); AAC_DESIGN_NO_INSTALL=1 turns that off.
A failed conversion names its cause (a missing component, a blocked AF_UNIX socket, an unreadable
source, a timeout) beside LibreOffice's own last line.
Exit 0 when every rendering is within --max-pages, 1 when any exceeds it, 3 on a render failure.
"""
import argparse, glob, json, os, pathlib, shutil, socket, subprocess, sys, tempfile

STAND_INS = {'narrow': 'Carlito', 'wide': 'Liberation Sans'}
POPPLER = ('pdfinfo', 'pdftoppm', 'pdffonts')
# LibreOffice component library beside soffice, and the Debian package carrying it. The core
# package alone ships soffice but loads no document: every file then fails with the generic
# "Error: source file could not be loaded" (the cloud container, issue 1310).
COMPONENTS = {'Writer': ('swlo', 'libreoffice-writer'), 'Impress': ('sdlo', 'libreoffice-impress')}
FONT_PACKAGES = {'Carlito': 'fonts-crosextra-carlito', 'Liberation Sans': 'fonts-liberation'}
LAST_FAILURE = {}


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


def component_lib(name):
    stem = COMPONENTS[name][0]
    if os.name == 'nt':
        return stem + '.dll'
    return 'lib' + stem + ('.dylib' if sys.platform == 'darwin' else '.so')


def missing_components():
    p = soffice_bin()
    d = p and os.path.dirname(os.path.realpath(p))
    return [n for n in COMPONENTS if d and not os.path.exists(os.path.join(d, component_lib(n)))]


def missing_fonts():
    if not shutil.which('fc-list'):
        return list(STAND_INS.values())
    have = subprocess.run(['fc-list', ':', 'family'], capture_output=True, text=True).stdout.lower()
    return [f for f in STAND_INS.values() if f.lower() not in have]


def missing_packages():
    """Debian packages this host lacks for a render; [] off Linux, where nothing is installed."""
    if not sys.platform.startswith('linux'):
        return []
    names = missing_components() if soffice_bin() else list(COMPONENTS)
    pkgs = [COMPONENTS[n][1] for n in names]
    if not all(shutil.which(b) for b in POPPLER):
        pkgs.append('poppler-utils')
    return pkgs + [FONT_PACKAGES[f] for f in missing_fonts()]


def ensure_packages():
    """Install what missing_packages() names when apt-get can run unattended. Returns why it could
    not, or None when nothing was missing or the install succeeded."""
    pkgs = missing_packages()
    if not pkgs:
        return None
    want = ' '.join(pkgs)
    if os.environ.get('AAC_DESIGN_NO_INSTALL') == '1':
        return f'missing {want} (install skipped: AAC_DESIGN_NO_INSTALL=1)'
    if not shutil.which('apt-get'):
        return f'missing {want} and no apt-get to install them'
    if os.geteuid() == 0:
        sudo = []
    elif shutil.which('sudo') and subprocess.run(['sudo', '-n', 'true'], capture_output=True).returncode == 0:
        sudo = ['sudo', '-n']
    else:
        return f'missing {want} and apt-get needs root (no passwordless sudo)'
    print(f'render: installing {want} (missing on this host)', file=sys.stderr)
    env = dict(os.environ, DEBIAN_FRONTEND='noninteractive')
    for cmd in (['apt-get', 'update', '-qq'], ['apt-get', 'install', '-y', '-qq', '--no-install-recommends'] + pkgs):
        try:
            r = subprocess.run(sudo + cmd, env=env, capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            return f'`apt-get {cmd[1]}` did not finish within 600 s; still missing {want}'
        if r.returncode != 0:
            tail = ((r.stderr or r.stdout).strip().splitlines() or ['no output'])[-1]
            return f'`apt-get {cmd[1]}` exited {r.returncode} ({tail}); still missing {want}'
    return None


def af_unix_blocked():
    if not hasattr(socket, 'AF_UNIX'):
        return False
    try:
        socket.socket(socket.AF_UNIX, socket.SOCK_STREAM).close()
        return False
    except OSError:
        return True


def diagnose(docx, rc, env):
    """The cause of a conversion that wrote no PDF, most specific first."""
    if rc == 'timeout':
        return 'soffice did not finish within 150 s (a hung first start, or another soffice holding the profile)'
    if not os.access(docx, os.R_OK):
        return f'the source file is not readable: {docx}'
    need = 'Impress' if docx.lower().endswith(('.pptx', '.ppt', '.odp')) else 'Writer'
    if need in missing_components():
        return (f"LibreOffice's {need} component ({component_lib(need)}) is not installed beside "
                f'{soffice_bin()}, so soffice loads no such file; install {COMPONENTS[need][1]}')
    if af_unix_blocked() and 'LD_PRELOAD' not in env:
        return ('this sandbox blocks AF_UNIX sockets, which soffice needs, and no LD_PRELOAD shim was found '
                "(the docx skill's office/soffice.py, or AFD_OFFICE_HELPER naming its scripts folder)")
    return f'soffice exited {rc} and wrote no PDF'


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
    log = os.path.join(profile, 'soffice.log')
    # A file, not a pipe: a lingering soffice.bin holding a pipe open would outlive the timeout.
    with open(log, 'w') as lf:
        try:
            rc = subprocess.run(cmd, env=env, stdout=lf, stderr=subprocess.STDOUT, timeout=150).returncode
        except subprocess.TimeoutExpired:
            rc = 'timeout'
    stem = os.path.splitext(os.path.basename(docx))[0]
    src = os.path.join(tmpout, stem + '.pdf')
    if not os.path.exists(src):
        said = open(log, errors='replace').read().strip().splitlines()
        LAST_FAILURE.clear()
        LAST_FAILURE.update(cause=diagnose(docx, rc, env), soffice_said=said[-1] if said else 'nothing')
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
    setup = ensure_packages()
    if setup:
        print(f'render: {setup}', file=sys.stderr)
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
            print(f'render: conversion failed under {font}: {LAST_FAILURE.get("cause")}; '
                  f'soffice said: {LAST_FAILURE.get("soffice_said")}', file=sys.stderr)
            sys.exit(3)
        r['stand_in'] = kind
        results.append(r)
    over = a.max_pages is not None and any(r['pages'] > a.max_pages for r in results)
    print(json.dumps({'docx': docx, 'max_pages': a.max_pages, 'renders': results, 'fits': not over}, indent=2))
    sys.exit(1 if over else 0)


if __name__ == '__main__':
    main()
