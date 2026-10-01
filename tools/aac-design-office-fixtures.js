// The made-up room-booking fixtures the aac-design document, deck and PDF audits run on (issues 1088
// and 1089), each with one planted fault. They name no customer, deal or rep.
'use strict';
const zlib = require('node:zlib');

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

module.exports = { docx, pptx, pdf };
