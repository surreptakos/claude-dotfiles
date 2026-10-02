// aac-design audit mode, the ledger step as one command (issue 1087): ledger_run.py runs one isolated
// reviewer process per catalogued skill, rows first, detector set after. A stub stands in for claude -p
// (AAC_DESIGN_REVIEWER) and records what each process could see. The bundle is made up; it names no
// customer, deal or rep.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SKILL = path.join(__dirname, '..', 'aac-skills', 'aac-design');
const RUNNER = path.join(SKILL, 'scripts', 'ledger_run.py');
const SCORER = path.join(SKILL, 'scripts', 'score.py');
const CATALOG = JSON.parse(fs.readFileSync(path.join(SKILL, 'catalog', 'CATALOG.json'), 'utf8'));
const WEB = CATALOG.rows.filter((r) => r.surfaces.includes('web'));
const CONTRAST = WEB.find((r) => r.checks.some((c) => c.adapter === 'web.contrast'));

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aac-design-ledger-run-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));

// The bundle: one screenshot, the DOM, the text; one contrast fault in the detector set.
const bundleDir = path.join(root, 'evidence');
fs.mkdirSync(bundleDir);
const page = path.join(root, 'page.html');
fs.writeFileSync(page, '<!doctype html><title>Fixture</title><p>Hello</p>');
fs.writeFileSync(path.join(bundleDir, 'shot-1440.png'), Buffer.from('89504e470d0a1a0a0000', 'hex'));
fs.writeFileSync(path.join(bundleDir, 'dom.json'), '{"elements": []}');
fs.writeFileSync(path.join(bundleDir, 'text.txt'), 'Hello');
fs.writeFileSync(path.join(bundleDir, 'axe.json'), '{"violations": []}');
fs.writeFileSync(path.join(bundleDir, 'findings.json'), JSON.stringify({ target: page, faults: [
  { measure: 'web.contrast', catalog_ids: [CONTRAST.id], kind: 'contrast', what: '2.1:1', where: 'p' }] }));
fs.writeFileSync(path.join(bundleDir, 'bundle.json'), JSON.stringify({
  schema: 'aac-design/evidence@1', adapter: 'web', surface: 'web', target: page,
  subject: { kind: 'file', path: page, sha256: crypto.createHash('sha256').update(fs.readFileSync(page)).digest('hex') },
  captured: '2026-10-01T10:00:00Z', images: ['shot-1440.png'], structure: ['dom.json'], text: 'text.txt',
  review_set: ['shot-1440.png', 'dom.json', 'text.txt'], detector_set: ['findings.json', 'axe.json'],
  measures: { 'web.contrast': { status: 'ok' } }, fault_count: 1 }));

// The stand-in reviewer: logs the files it could reach, answers every row PASS (dropping STUB_DROP),
// and in the detector pass marks each fault real and turns the contrast row into a FAIL.
const stub = path.join(root, 'stub.js');
fs.writeFileSync(stub, `
const fs = require('fs'), path = require('path');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const seen = walk('.').filter((f) => f.startsWith('evidence')).map((f) => path.basename(f));
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ folder: path.basename(process.cwd()), seen, at: new Date().toISOString() }) + '\\n');
let reply;
if (fs.existsSync('rows.json')) {
  const rows = JSON.parse(fs.readFileSync('rows.json', 'utf8')).filter((r) => r.id !== process.env.STUB_DROP);
  reply = { rows: rows.map((r) => ({ id: r.id, verdict: 'PASS', evidence: 'shot-1440.png', note: 'looked' })) };
} else {
  const faults = JSON.parse(fs.readFileSync('my-faults.json', 'utf8'));
  const ids = new Set(JSON.parse(fs.readFileSync('my-rows.json', 'utf8')).map((r) => r.id));
  reply = { marks: faults.map((f) => ({ fault: f.fault, mark: 'real', reason: 'measured' })),
    rows: ${JSON.stringify(CONTRAST.id)} && ids.has(${JSON.stringify(CONTRAST.id)}) ? [{ id: ${JSON.stringify(CONTRAST.id)}, verdict: 'FAIL',
      evidence: 'findings.json#/faults/0', note: 'too faint', owner: 'Code', file: 'page.html', fix: 'Darken it', priority: 'P2', wcag: '1.4.3' }] : [] };
}
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, session_id: 'sess-' + path.basename(process.cwd()),
  result: 'Done.\\n\\x60\\x60\\x60json\\n' + JSON.stringify(reply) + '\\n\\x60\\x60\\x60' }));
`);

function run(name, env = {}) {
  const log = path.join(root, `${name}.log`);
  const out = path.join(root, `${name}.json`);
  const r = spawnSync('python3', [RUNNER, bundleDir, '--out', out, '--batch', '400', '--jobs', '4'], {
    encoding: 'utf8',
    env: { ...process.env, AAC_DESIGN_REVIEWER: JSON.stringify([process.execPath, stub]), STUB_LOG: log, ...env },
  });
  const seen = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  return { r, out, seen, ledger: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null };
}

test('every reviewer judges blind in its own process, sees the detector only after its rows, and score.py accepts the ledger', () => {
  const { r, out, seen, ledger } = run('full');
  assert.equal(r.status, 0, r.stderr);
  const blind = seen.filter((s) => !s.folder.endsWith('-detector'));
  assert.ok(blind.length >= 8, 'one process per skill at least');
  for (const s of blind) assert.deepEqual(s.seen.sort(), ['dom.json', 'shot-1440.png', 'text.txt'], s.folder);
  const det = seen.find((s) => s.folder.endsWith('-detector'));
  assert.ok(det && det.seen.includes('findings.json'), 'a detector pass sees the detector set');
  assert.match(ledger.method, /^dual-agent/);
  assert.equal(ledger.rows.length, WEB.length);
  for (const v of ledger.reviewers) {
    if (v.detector_shown) assert.ok(new Date(v.detector_shown) > new Date(v.rows_in), v.skill);
  }
  const amended = ledger.rows.find((x) => x.id === CONTRAST.id);
  assert.equal(amended.verdict, 'FAIL');
  assert.equal(amended.blind_verdict, 'PASS');
  assert.equal(amended.after_detector, true);

  const s = spawnSync('python3', [SCORER, out, '--markdown'], { encoding: 'utf8' });
  assert.equal(s.status, 0, s.stderr + s.stdout);
  assert.match(s.stdout, /PASS not_degraded/);
  assert.match(s.stdout, new RegExp(`PASS coverage_complete \\(${WEB.length}/${WEB.length}`));
});

test('a row the reviewer leaves out is asked for once more, then named and the run exits 1', () => {
  const drop = WEB[5].id;
  const { r, seen, ledger } = run('drop', { STUB_DROP: drop });
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`1 id\\(s\\) still missing: ${drop}`));
  assert.ok(seen.some((s) => /-retry1$/.test(s.folder)), 'the missing row went out again');
  assert.equal(ledger.rows.length, WEB.length - 1);
  assert.deepEqual(ledger.run.missing, [drop]);
});
