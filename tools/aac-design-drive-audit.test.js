// aac-design audit mode on a Google Doc, Slides deck or Sheet by its Drive link (issue 1089): doc_audit.py
// exports the file through the Drive API and hands the export to the .docx, .pptx or .pdf adapter, and
// score.py stamps it by file id plus revision id.
// Every Drive call goes to a local stand-in for the Drive API (AAC_DESIGN_DRIVE_API on every spawn), which
// serves made-up file ids holding the room-booking fixtures of aac-design-doc-audit.test.js: no fixture
// points at a real Drive file, let alone one holding customer, deal or rep data.
// The adapter half needs LibreOffice and poppler-utils and skips without them, as in that suite, unless
// AAC_DESIGN_REQUIRE_RENDERER=1; the export, the refusal and the stamp run everywhere.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { docx, pptx, pdf } = require('./aac-design-office-fixtures');

const SKILL = path.join(__dirname, '..', 'aac-skills', 'aac-design');
const ADAPTER = path.join(SKILL, 'scripts', 'doc_audit.py');
const EVIDENCE = path.join(SKILL, 'scripts', 'evidence.py');
const SCORER = path.join(SKILL, 'scripts', 'score.py');
const CATALOG = JSON.parse(fs.readFileSync(path.join(SKILL, 'catalog', 'CATALOG.json'), 'utf8'));
const REQUIRE = process.env.AAC_DESIGN_REQUIRE_RENDERER === '1';
const OD = 'application/vnd.openxmlformats-officedocument';

// The Sheet's account is a Viewer: Drive refuses it the revision list, so its revision is the version.
const FILES = {
  roomBookingGuideDoc01: {
    label: 'Doc', mime: 'application/vnd.google-apps.document', ext: 'docx', exportMime: `${OD}.wordprocessingml.document`,
    build: docx, surface: 'document', rule: 'D01', catalog: 'AAC-WR-079', revisions: true,
    link: (id) => `https://docs.google.com/document/d/${id}/edit`,
  },
  roomBookingStepsDeck01: {
    label: 'Slides deck', mime: 'application/vnd.google-apps.presentation', ext: 'pptx', exportMime: `${OD}.presentationml.presentation`,
    build: pptx, surface: 'deck', rule: 'D07', catalog: 'AAC-WR-077', revisions: true,
    link: (id) => `https://docs.google.com/presentation/d/${id}/edit#slide=id.p`,
  },
  roomBookingRequestSheet: {
    label: 'Sheet', mime: 'application/vnd.google-apps.spreadsheet', ext: 'pdf', exportMime: 'application/pdf',
    build: pdf, surface: 'document', rule: 'D13', catalog: 'AAC-WR-081', revisions: false,
    link: (id) => `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`,
  },
};
const edits = Object.fromEntries(Object.keys(FILES).map((id) => [id, 0]));
const revisionOf = (id) => (FILES[id].revisions ? String(1 + edits[id]) : `v${10 + edits[id]}`);

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://drive.test');
  const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)(\/revisions|\/export)?$/);
  const id = m && m[1];
  const f = id && Object.hasOwn(FILES, id) && FILES[id];
  if (!f) return json(res, 404, { error: { code: 404, message: `File not found: ${id}.` } });
  if (!m[2]) return json(res, 200, { id, name: `Room booking ${f.label}`, mimeType: f.mime, version: String(10 + edits[id]) });
  if (m[2] === '/revisions') {
    return f.revisions
      ? json(res, 200, { revisions: Array.from({ length: 1 + edits[id] }, (_, i) => ({ id: String(i + 1) })) })
      : json(res, 403, { error: { code: 403, message: 'The user does not have sufficient permissions for this file.' } });
  }
  if (u.searchParams.get('mimeType') !== f.exportMime) return json(res, 400, { error: { code: 400, message: 'bad export type' } });
  res.writeHead(200, { 'content-type': f.exportMime });
  return res.end(f.build(edits[id] > 0));
});

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aac-design-drive-audit-')));
let api;
before(() => new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
  api = `http://127.0.0.1:${server.address().port}/drive/v3`;
  resolve();
})));
after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

// Asynchronous on purpose: the stand-in answers from this process's event loop.
function py(...args) {
  return new Promise((resolve) => {
    const c = spawn('python3', args, { cwd: root, env: { ...process.env, AAC_DESIGN_DRIVE_API: api } });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

for (const [id, f] of Object.entries(FILES)) {
  test(`a Google ${f.label} by its Drive link is exported to .${f.ext} and audited through the ${f.ext} adapter`, async (t) => {
    const out = path.join(root, `evidence-${id}`);
    const r = await py(ADAPTER, f.link(id), '--out', out, '--max-pages', '1');
    const exported = path.join(out, 'export', `Room-booking-${f.label.replace(' ', '-')}.${f.ext}`);
    assert.ok(fs.existsSync(exported), `the export landed at ${exported}: ${r.stderr}`);
    assert.deepEqual(fs.readFileSync(exported), f.build(), 'the export holds the bytes Drive served');
    if (r.status === 3 && /needed/.test(r.stderr) && !REQUIRE) return t.skip(`no renderer here: ${r.stderr.trim()}`);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const v = await py(EVIDENCE, 'validate', out);
    assert.equal(v.status, 0, v.stdout + v.stderr);
    const b = JSON.parse(fs.readFileSync(path.join(out, 'bundle.json'), 'utf8'));
    assert.equal(b.adapter, f.ext);
    assert.equal(b.surface, f.surface);
    assert.equal(b.target, f.link(id));
    assert.deepEqual([b.subject.kind, b.subject.file_id, b.subject.revision], ['drive', id, revisionOf(id)]);
    assert.ok(b.review_set.includes(`export/${path.basename(exported)}`), 'the export is in the review set');
    const { faults } = JSON.parse(fs.readFileSync(path.join(out, 'findings.json'), 'utf8'));
    const planted = faults.find((x) => x.kind === `designlint:${f.rule}`);
    assert.ok(planted, `the planted ${f.rule} fault is listed: ${JSON.stringify(faults)}`);
    assert.ok(planted.catalog_ids.includes(f.catalog));
  });
}

test('a Drive link the account cannot open fails naming the file id, and writes no bundle', async () => {
  const out = path.join(root, 'evidence-refused');
  const r = await py(ADAPTER, 'https://docs.google.com/document/d/notSharedWithUs0001/edit', '--out', out);
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.match(r.stderr, /Drive file notSharedWithUs0001 cannot be opened .*HTTP 404 File not found/);
  assert.ok(!fs.existsSync(path.join(out, 'bundle.json')), 'no bundle is written');
});

// A complete ledger on the file's surface, its subject the bundle's: file id plus revision id.
function ledger(id) {
  const f = FILES[id];
  const applicable = CATALOG.rows.filter((r) => r.surfaces.includes(f.surface));
  const skills = [...new Set(applicable.map((r) => r.skill))];
  return {
    method: 'dual-agent (reviewers: one per skill · detector: agent-b)',
    surface: f.surface,
    subject: { kind: 'drive', url: f.link(id), file_id: id, revision: revisionOf(id) },
    auditor: 'Design',
    reviewers: skills.map((skill, i) => ({ skill, agent: `agent-a${i}`, rows_in: '2026-09-30T10:00:00Z', detector_shown: '2026-09-30T10:05:00Z' })),
    rows: applicable.map((r) => (r.id === f.catalog
      ? { id: r.id, verdict: 'FAIL', evidence: 'findings.json#/faults/0', owner: 'Code', file: id, fix: 'Clear the planted fault', priority: 'P2' }
      : { id: r.id, verdict: 'PASS', evidence: 'text.txt' })),
  };
}

for (const id of ['roomBookingGuideDoc01', 'roomBookingRequestSheet']) {
  const how = FILES[id].revisions ? 'its last listed revision' : 'its version, the account being a Viewer';
  test(`a Drive ${FILES[id].label} is stamped by file id and revision id (${how}); an edit makes the stamp stale`, async () => {
    const link = FILES[id].link(id);
    const l = path.join(root, `ledger-${id}.json`);
    fs.writeFileSync(l, JSON.stringify(ledger(id)));
    try {
      const r = await py(SCORER, l, '--stamp', link);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const stamp = JSON.parse(fs.readFileSync(path.join(root, '.design', `drive-${id}.json`), 'utf8'));
      assert.deepEqual([stamp.drive, stamp.revision, stamp.passes], [id, revisionOf(id), true]);
      assert.equal((await py(SCORER, '--check-stamp', link)).status, 0);

      edits[id] += 1;
      const stale = await py(SCORER, '--check-stamp', link);
      assert.equal(stale.status, 1, stale.stderr + stale.stdout);
      assert.match(stale.stderr, new RegExp(`stale: Drive file ${id} stamped at revision ${stamp.revision}, now at ${revisionOf(id)}`));
      const again = await py(SCORER, l, '--stamp', link);
      assert.equal(again.status, 1, 'the old ledger cannot stamp the edited file');
      assert.match(again.stderr, /changed since the audit/);
    } finally {
      edits[id] = 0;
    }
  });
}
