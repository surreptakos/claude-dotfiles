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

const SKILL = path.join(__dirname, '..', 'aac-skills', 'aac-design');
const ADAPTER = path.join(SKILL, 'scripts', 'doc_audit.py');
const EVIDENCE = path.join(SKILL, 'scripts', 'evidence.py');
const SCORER = path.join(SKILL, 'scripts', 'score.py');
const CATALOG = JSON.parse(fs.readFileSync(path.join(SKILL, 'catalog', 'CATALOG.json'), 'utf8'));
const REQUIRE = process.env.AAC_DESIGN_REQUIRE_RENDERER === '1';

// ------------------------------------------------------------------ fixtures
const { docx, pptx, pdf } = require('./aac-design-office-fixtures');

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
