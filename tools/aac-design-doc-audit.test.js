// aac-design audit mode on documents, decks and PDFs (issue 1088): the doc_audit.py adapters' evidence
// bundles, checked against the shape the web bundle validates against (evidence.py), and the scorer's
// stamp on each fixture. The three fixtures are made-up room-booking notes, each with one planted
// fault; they name no customer, deal or rep.
// The adapter cases need LibreOffice and poppler-utils on PATH (the Linux sandbox has both; on Windows
// a LibreOffice and a poppler build serve) and skip without them, unless AAC_DESIGN_REQUIRE_RENDERER=1
// (the design-adapters CI job) turns a skip into a failure.
// Every ledger case drives the real score.py.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const SKILL = path.join(__dirname, '..', 'aac-skills', 'aac-design');
const ADAPTER = path.join(SKILL, 'scripts', 'doc_audit.py');
const EVIDENCE = path.join(SKILL, 'scripts', 'evidence.py');
const SCORER = path.join(SKILL, 'scripts', 'score.py');
const CATALOG = JSON.parse(fs.readFileSync(path.join(SKILL, 'catalog', 'CATALOG.json'), 'utf8'));
const REQUIRE = process.env.AAC_DESIGN_REQUIRE_RENDERER === '1';

// ------------------------------------------------------------------ fixtures
// A stored (uncompressed) zip: enough for an Office package, with no dependency.
function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const fname = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(fname.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(fname.length, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(head, fname, data);
    central.push(dir, fname);
    offset += head.length + fname.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const OD = 'application/vnd.openxmlformats-officedocument';
const rels = (...r) => `${XML}<Relationships xmlns="${PKG}">${r.map(([id, type, target]) =>
  `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const para = (text, ppr = '', rpr = '') => `<w:p><w:pPr>${ppr}</w:pPr><w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

// The fault: a justified paragraph (designlint D01, AAC-WR-001 Rule 79).
function docx(edited = false) {
  return zip({
    '[Content_Types].xml': `${XML}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/word/document.xml" ContentType="${OD}.wordprocessingml.document.main+xml"/>`
      + `<Override PartName="/word/styles.xml" ContentType="${OD}.wordprocessingml.styles+xml"/></Types>`,
    '_rels/.rels': rels(['rId1', 'officeDocument', 'word/document.xml']),
    'word/_rels/document.xml.rels': rels(['rId1', 'styles', 'styles.xml']),
    'word/styles.xml': `${XML}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Aptos" w:cs="Aptos"/>`
      + '<w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults></w:styles>',
    'word/document.xml': `${XML}<w:document ${W}><w:body>`
      + para('Room booking guide', '<w:spacing w:after="120"/>', '<w:b/><w:sz w:val="32"/>')
      + para(edited ? 'Book a room two days ahead.' : 'Book a room at least one day ahead.')
      + para('Each room holds up to eight people. Leave the room as you found it, switch off the screen and close the '
        + 'blinds, and tell the front desk when a booking is cancelled so the next team can take the slot.', '<w:jc w:val="both"/>')
      + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
      + '</w:body></w:document>',
  });
}

const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + `xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const box = (id, y, cy, runs) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
  + `<p:spPr><a:xfrm><a:off x="609600" y="${y}"/><a:ext cx="10972800" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`
  + `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${runs.map(([sz, t]) =>
    `<a:p><a:r><a:rPr lang="en-US" sz="${sz}"><a:latin typeface="Aptos"/></a:rPr><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const scheme = ['dk1', '000000', 'lt1', 'FFFFFF', 'dk2', '1F1F1F', 'lt2', 'F2F2F2', 'accent1', '1F4E79', 'accent2', '595959',
  'accent3', '7F7F7F', 'accent4', '404040', 'accent5', '262626', 'accent6', 'BFBFBF', 'hlink', '1F4E79', 'folHlink', '595959'];
const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture"><a:themeElements>`
  + `<a:clrScheme name="Fixture">${Array.from({ length: 12 }, (_, i) => `<a:${scheme[2 * i]}><a:srgbClr val="${scheme[2 * i + 1]}"/></a:${scheme[2 * i]}>`).join('')}</a:clrScheme>`
  + '<a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
  + '<a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + `<a:fmtScheme name="Fixture"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst>`
  + `<a:lnStyleLst>${`<a:ln w="9525">${fill}</a:ln>`.repeat(3)}</a:lnStyleLst>`
  + `<a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst>`
  + `<a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

// The fault: 10 pt text on a slide (designlint D07, under the 12 pt slide floor of AAC-WR-001 Rule 77).
function pptx(edited = false) {
  return zip({
    '[Content_Types].xml': `${XML}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/ppt/presentation.xml" ContentType="${OD}.presentationml.presentation.main+xml"/>`
      + `<Override PartName="/ppt/slides/slide1.xml" ContentType="${OD}.presentationml.slide+xml"/>`
      + `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${OD}.presentationml.slideLayout+xml"/>`
      + `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${OD}.presentationml.slideMaster+xml"/>`
      + `<Override PartName="/ppt/theme/theme1.xml" ContentType="${OD}.theme+xml"/></Types>`,
    '_rels/.rels': rels(['rId1', 'officeDocument', 'ppt/presentation.xml']),
    'ppt/presentation.xml': `${XML}<p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
      + '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels(['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'slide', 'slides/slide1.xml'], ['rId3', 'theme', 'theme/theme1.xml']),
    'ppt/slideMasters/slideMaster1.xml': `${XML}<p:sldMaster ${P}><p:cSld><p:spTree>${GROUP}</p:spTree></p:cSld>`
      + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
      + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels(['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']),
    'ppt/slideLayouts/slideLayout1.xml': `${XML}<p:sldLayout ${P} type="blank"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld>`
      + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels(['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']),
    'ppt/theme/theme1.xml': THEME,
    'ppt/slides/slide1.xml': `${XML}<p:sld ${P}><p:cSld><p:spTree>${GROUP}`
      + box(2, 457200, 1143000, [[3600, 'Room booking steps']])
      + box(3, 1828800, 3200400, [[2400, 'Pick a room from the list.'], [2400, edited ? 'Book it two days ahead.' : 'Book it one day ahead.'],
        [1000, 'Rooms close at six in the evening.']])
      + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>',
    'ppt/slides/_rels/slide1.xml.rels': rels(['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']),
  });
}

// The fault: an underscore fill line (designlint D13, AAC-WR-001 Rule 81), found on the text layer.
function pdf(edited = false) {
  const lines = [[18, 720, 'Room booking request'], [11, 690, edited ? 'Book a room two days ahead.' : 'Book a room at least one day ahead.'],
    [11, 660, 'Approved by ____________________']];
  const stream = lines.map(([sz, y, t]) => `BT /F1 ${sz} Tf 72 ${y} Td (${t}) Tj ET`).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  let out = '%PDF-1.4\n';
  const at = objs.map((o, i) => { const n = Buffer.byteLength(out); out += `${i + 1} 0 obj\n${o}\nendobj\n`; return n; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const FIXTURES = {
  docx: { build: docx, surface: 'document', rule: 'D01', catalog: 'AAC-WR-079' },
  pptx: { build: pptx, surface: 'deck', rule: 'D07', catalog: 'AAC-WR-077' },
  pdf: { build: pdf, surface: 'document', rule: 'D13', catalog: 'AAC-WR-081' },
};

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aac-design-doc-audit-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const file = (ext) => path.join(root, `room-booking.${ext}`);
for (const [ext, f] of Object.entries(FIXTURES)) fs.writeFileSync(file(ext), f.build());

// ------------------------------------------------------------------ the adapters
const runs = {};
before(() => {
  for (const ext of Object.keys(FIXTURES)) {
    const out = path.join(root, `evidence-${ext}`);
    runs[ext] = { out, ...spawnSync('python3', [ADAPTER, file(ext), '--out', out, '--max-pages', '1'], { encoding: 'utf8', timeout: 600000 }) };
  }
});

function bundleOf(t, ext) {
  const r = runs[ext];
  if (r.status === 3 && /needed/.test(r.stderr) && !REQUIRE) {
    t.skip(`no renderer here: ${r.stderr.trim()}`);
    return null;
  }
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  const v = spawnSync('python3', [EVIDENCE, 'validate', r.out], { encoding: 'utf8' });
  assert.equal(v.status, 0, `the ${ext} bundle breaks the evidence shape:\n${v.stdout}${v.stderr}`);
  const bundle = JSON.parse(fs.readFileSync(path.join(r.out, 'bundle.json'), 'utf8'));
  assert.deepEqual(bundle.subject, { kind: 'file', path: file(ext), sha256: sha(file(ext)) });
  assert.equal(bundle.adapter, ext);
  assert.equal(bundle.surface, FIXTURES[ext].surface);
  assert.ok(!bundle.review_set.includes('findings.json'), 'detector output is withheld from reviewers');
  const { faults } = JSON.parse(fs.readFileSync(path.join(r.out, 'findings.json'), 'utf8'));
  const planted = faults.find((f) => f.kind === `designlint:${FIXTURES[ext].rule}`);
  assert.ok(planted, `the planted ${FIXTURES[ext].rule} fault is listed: ${JSON.stringify(faults)}`);
  assert.ok(planted.catalog_ids.includes(FIXTURES[ext].catalog), `${FIXTURES[ext].rule} maps to ${FIXTURES[ext].catalog}`);
  return bundle;
}

test('the .docx fixture yields a bundle listing its justified paragraph, rendered under both stand-in fonts', (t) => {
  const b = bundleOf(t, 'docx');
  if (!b) return;
  const r = b.measures.render;
  assert.deepEqual(r.stand_ins.map((s) => [s.stand_in, s.font]), [['narrow', 'Carlito'], ['wide', 'Liberation Sans']]);
  assert.ok(Number.isInteger(r.pages.narrow) && r.pages.narrow >= 1, 'the narrow page count is recorded');
  assert.ok(Number.isInteger(r.pages.wide) && r.pages.wide >= 1, 'the wide page count is recorded');
  for (const s of r.stand_ins) {
    assert.equal(s.images.length, s.pages, `one image per page under ${s.font}`);
    assert.ok(s.embedded_fonts.includes(s.font.replace(' ', '')), `the ${s.stand_in} rendering used ${s.font}: ${s.embedded_fonts}`);
  }
  assert.ok(b.structure.includes('structure/word/document.xml'), 'the structure dump is the document XML');
  assert.match(fs.readFileSync(path.join(runs.docx.out, 'text.txt'), 'utf8'), /Room booking guide/);
});

test('the .pptx fixture yields a bundle listing its 10 pt slide text', (t) => {
  const b = bundleOf(t, 'pptx');
  if (!b) return;
  assert.ok(b.structure.includes('structure/ppt/slides/slide1.xml'), 'the structure dump holds every slide');
  assert.equal(b.measures.render.stand_ins.length, 2);
  assert.match(fs.readFileSync(path.join(runs.pptx.out, 'text.txt'), 'utf8'), /Rooms close at six/);
});

test('the .pdf fixture is judged from its page images and text layer, listing its underscore fill line', (t) => {
  const b = bundleOf(t, 'pdf');
  if (!b) return;
  assert.equal(b.measures.render.pages, 1);
  assert.equal(b.images.length, 1);
  assert.deepEqual(b.structure, ['structure/text-layer.html']);
  assert.deepEqual(b.measures['pdf.text-layer'].pages_without_text, []);
  assert.match(fs.readFileSync(path.join(runs.pdf.out, 'text.txt'), 'utf8'), /Approved by/);
});

// ------------------------------------------------------------------ ledger, score, stamp
// A complete ledger on the fixture's surface: every applicable id, the planted fault open for Code.
function ledger(ext) {
  const { surface, catalog: failing } = FIXTURES[ext];
  const applicable = CATALOG.rows.filter((r) => r.surfaces.includes(surface));
  const skills = [...new Set(applicable.map((r) => r.skill))];
  return {
    method: 'dual-agent (reviewers: one per skill · detector: agent-b)',
    surface,
    subject: { kind: 'file', path: file(ext), sha256: sha(file(ext)) },
    auditor: 'Design',
    reviewers: skills.map((skill, i) => ({ skill, agent: `agent-a${i}`, rows_in: '2026-09-30T10:00:00Z', detector_shown: '2026-09-30T10:05:00Z' })),
    rows: applicable.map((r) => (r.id === failing
      ? { id: r.id, verdict: 'FAIL', evidence: 'findings.json#/faults/0', owner: 'Code', file: path.basename(file(ext)), fix: 'Clear the planted fault', priority: 'P2' }
      : { id: r.id, verdict: 'PASS', evidence: 'text.txt' })),
  };
}

for (const ext of Object.keys(FIXTURES)) {
  test(`a complete ledger on the .${ext} fixture scores and stamps; editing the fixture makes the stamp stale`, () => {
    const l = path.join(root, `ledger-${ext}.json`);
    fs.writeFileSync(l, JSON.stringify(ledger(ext)));
    const r = spawnSync('python3', [SCORER, l, '--stamp', file(ext)], { encoding: 'utf8', cwd: root });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const stamp = JSON.parse(fs.readFileSync(path.join(root, '.design', `room-booking.${ext}.json`), 'utf8'));
    assert.equal(stamp.sha256, sha(file(ext)));
    assert.equal(stamp.surface, FIXTURES[ext].surface);
    const check = () => spawnSync('python3', [SCORER, '--check-stamp', file(ext)], { encoding: 'utf8', cwd: root });
    assert.equal(check().status, 0);

    fs.writeFileSync(file(ext), FIXTURES[ext].build(true));
    const stale = check();
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /stale/);
    fs.writeFileSync(file(ext), FIXTURES[ext].build());
  });
}
