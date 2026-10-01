#!/usr/bin/env python3
"""Write the aac-design audit fixtures (issue 1079) into OUTDIR, standard library only.

    python3 build_fixtures.py OUTDIR

Each file carries one known fault, and invented content only (this repository is public):
  fixture.docx  a justified paragraph (designlint D01, AAC-WR-001 Rule 79)
  fixture.pptx  body text at 10 pt on a slide (designlint D07, the 12 pt slide floor)
  fixture.pdf   7 pt light-gray text on an untagged page (under the 9 pt floor, 1.8:1 contrast)
Built at test time rather than committed, so the fixtures stay readable in a diff.
"""
import os, sys, zipfile, zlib

STAMP = (2026, 9, 30, 0, 0, 0)  # fixed zip timestamps: the same bytes on every build


def write_zip(path, parts):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, text in parts.items():
            z.writestr(zipfile.ZipInfo(name, STAMP), text)


W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
P_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def docx(path):
    para = lambda text, jc='': (f'<w:p><w:pPr>{jc}</w:pPr><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>')
    write_zip(path, {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            '</Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{REL}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{REL}/styles" Target="styles.xml"/></Relationships>',
        'word/styles.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {W_NS}>'
            '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:cs="Aptos"/>'
            '<w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
        'word/document.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W_NS} {R_NS}><w:body>'
            + para('Workshop checklist')
            + para('Bring the signed checklist to the front desk before the workshop starts, and keep a copy for your own records.', '<w:jc w:val="both"/>')
            + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>',
    })


def pptx(path):
    run = lambda text, sz: f'<a:p><a:r><a:rPr lang="en-US" sz="{sz}"/><a:t>{text}</a:t></a:r></a:p>'
    shape = lambda sid, name, body: (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
                                     '<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>' + body + '</p:txBody></p:sp>')
    write_zip(path, {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
            '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
            '</Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
        'ppt/_rels/presentation.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId2" Type="{REL}/slide" Target="slides/slide1.xml"/></Relationships>',
        'ppt/presentation.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation {A_NS} {R_NS} {P_NS}>'
            '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/>'
            '<p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
        'ppt/slides/slide1.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld {A_NS} {R_NS} {P_NS}>'
            '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
            + shape(2, 'Title', run('Workshop schedule', 3200))
            + shape(3, 'Body', run('Doors open at nine and the first session starts at half past.', 1000))
            + '</p:spTree></p:cSld></p:sld>',
    })


def pdf(path):
    content = zlib.compress(
        b'BT /F1 18 Tf 0 0 0 rg 72 720 Td (Workshop checklist) Tj ET\n'
        b'BT /F1 7 Tf 0.75 0.75 0.75 rg 72 700 Td (Bring the signed checklist to the front desk.) Tj ET\n')
    objs = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length %d /Filter /FlateDecode >>\nstream\n' % len(content) + content + b'\nendstream',
    ]
    out, offsets = bytearray(b'%PDF-1.4\n'), []
    for n, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % n + body + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)
    out += b''.join(b'%010d 00000 n \n' % o for o in offsets)
    out += b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xref)
    with open(path, 'wb') as f:
        f.write(out)


def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    docx(os.path.join(outdir, 'fixture.docx'))
    pptx(os.path.join(outdir, 'fixture.pptx'))
    pdf(os.path.join(outdir, 'fixture.pdf'))


if __name__ == '__main__':
    main(sys.argv[1])
