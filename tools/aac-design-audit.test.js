// aac-design audit mode, end to end (PRD issue 1079, testing seam 1): a surface goes in through
// audit.py, an evidence bundle comes out, a ledger is scored against the catalog, and a passing
// ledger stamps the target. Every case drives the real scripts from the outside; none asserts how
// an adapter walks the page. The web cases need a Chromium on the machine (CI's ubuntu runner has
// google-chrome) and skip, saying so, where there is none.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const SKILL = path.join(__dirname, '..', 'aac-skills', 'aac-design');
const AUDIT = path.join(SKILL, 'scripts', 'audit.py');
const SCORE = path.join(SKILL, 'scripts', 'score.py');
const FIXTURES = path.join(__dirname, '..', 'tests', 'fixtures', 'aac-design-audit');
const CATALOG = JSON.parse(fs.readFileSync(path.join(SKILL, 'catalog', 'CATALOG.json'), 'utf8'));

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aac-design-audit-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const env = { ...process.env, AAC_DESIGN_CACHE: path.join(root, 'cache') };
const py = (args, opts = {}) => spawnSync('python3', args, { encoding: 'utf8', env, ...opts });

fs.copyFileSync(path.join(FIXTURES, 'faults.html'), path.join(root, 'faults.html'));
assert.equal(py([path.join(FIXTURES, 'build_fixtures.py'), root]).status, 0);

const bundles = {};
function audit(name) {
  if (bundles[name]) return bundles[name];
  const r = py([AUDIT, path.join(root, name), '--no-axe']);
  if (r.status !== 0) return { error: r.stderr };
  const file = r.stdout.trim().split(/\r?\n/).pop();
  bundles[name] = { file, dir: path.dirname(file), json: JSON.parse(fs.readFileSync(file, 'utf8')) };
  return bundles[name];
}
const noBrowser = (b) => b.error && /no Chromium found/.test(b.error);

/** A ledger with one row per catalog id that applies to the bundle's surface, all PASS. */
function ledgerFor(b, { method = 'dual-agent (reviewers: accessibility-review=test; detector after rows)', owns = ['Design'], edit } = {}) {
  const rows = CATALOG.rows.filter((r) => r.surfaces.includes(b.json.catalog_surface))
    .map((r) => ({ id: r.id, verdict: 'PASS', evidence: 'evidence/text.txt', owner: 'Design', fix: '', priority: 'P3' }));
  const ledger = { method, bundle: 'bundle.json', auditor_owns: owns, rows };
  if (edit) edit(ledger);
  const file = path.join(b.dir, `ledger-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(ledger));
  return file;
}
const fail = (ledger, id, extra) => Object.assign(ledger.rows.find((r) => r.id === id), { verdict: 'FAIL', fix: 'fix it', priority: 'P1', ...extra });

test('web: the fixture page produces a bundle listing each of its four known faults', (t) => {
  const b = audit('faults.html');
  if (noBrowser(b)) return t.skip('no Chromium on this machine');
  assert.ok(!b.error, b.error);
  const has = (kind, re) => b.json.faults.some((f) => f.kind === kind && re.test(`${f.where} ${f.detail}`));
  assert.ok(has('unnamed-textbox', /#room/), 'the unlabelled input');
  assert.ok(has('low-contrast-text', /Requests are reviewed/), 'the low-contrast note');
  assert.ok(has('zero-size-focusable', /focusable at 0x/), 'the zero-width focusable link');
  assert.ok(has('unnamed-combobox', /#priority/), 'the unlabelled select');
  for (const v of ['desktop-1440', 'tablet-768', 'phone-390', 'zoom-200', 'reduced-motion', 'forced-colors', 'offline']) {
    assert.ok(fs.existsSync(path.join(b.dir, 'evidence', 'images', `${v}.png`)), `${v} image`);
  }
  assert.equal(py([AUDIT, '--check-bundle', b.file]).status, 0);
});

test('documents, decks and PDFs: each fixture bundle lists its fault and validates against the web bundle schema', () => {
  const expect = { 'fixture.docx': ['D01'], 'fixture.pptx': ['D07'], 'fixture.pdf': ['text-below-floor', 'low-contrast-text', 'untagged-pdf'] };
  for (const [name, kinds] of Object.entries(expect)) {
    const b = audit(name);
    assert.ok(!b.error, `${name}: ${b.error}`);
    for (const k of kinds) assert.ok(b.json.faults.some((f) => f.kind === k), `${name} lists ${k}`);
    const r = py([AUDIT, '--check-bundle', b.file]);
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    assert.deepEqual(Object.keys(b.json.evidence).sort(), ['images', 'structure', 'text']);
    if (!b.json.evidence.images.length) assert.ok(b.json.unavailable.some((u) => /render/.test(u.what)), `${name} says why it has no images`);
  }
});

test('a bundle missing its reason for having no page images fails the shared schema', () => {
  const b = audit('fixture.docx');
  const broken = path.join(b.dir, 'broken-bundle.json');
  fs.writeFileSync(broken, JSON.stringify({ ...b.json, evidence: { ...b.json.evidence, images: [] }, unavailable: [] }));
  const r = py([AUDIT, '--check-bundle', broken]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /no page images and no unavailable entry/);
});

test('a ledger missing one applicable catalog id is rejected, naming it', () => {
  const b = audit('fixture.docx');
  const r = py([SCORE, '--ledger', ledgerFor(b, { edit: (l) => l.rows.splice(2, 1) })]);
  assert.equal(r.status, 3, r.stdout);
  assert.match(r.stderr, /ledger rejected: 1 applicable catalog ids have no row: A11Y-003/);
});

test('N/A without a reason, and a row without an owner, are rejected', () => {
  const b = audit('fixture.docx');
  let r = py([SCORE, '--ledger', ledgerFor(b, { edit: (l) => { Object.assign(l.rows[0], { verdict: 'N/A' }); } })]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /A11Y-001: N\/A needs a reason/);
  r = py([SCORE, '--ledger', ledgerFor(b, { edit: (l) => { l.rows[0].verdict = 'N/A'; l.rows[0].reason = 'the page has no images'; delete l.rows[1].owner; } })]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /A11Y-002: every row needs an owner/);
});

test('a complete ledger scores and stamps; editing the fixture makes the stamp stale', (t) => {
  fs.mkdirSync(path.join(root, 'stamped'));
  for (const file of ['fixture.docx', 'fixture.pptx', 'fixture.pdf', 'faults.html']) {
    // A copy of its own, so the edit below leaves the other cases' fixtures alone.
    const name = path.join('stamped', file);
    const target = path.join(root, name);
    fs.copyFileSync(path.join(root, file), target);
    const b = audit(name);
    if (noBrowser(b)) { t.diagnostic(`${name}: skipped, no Chromium`); continue; }
    // An open P1 in files someone else owns does not block the auditor's stamp.
    const ledger = ledgerFor(b, { edit: (l) => fail(l, 'A11Y-003', { owner: 'Code' }) });
    const r = py([SCORE, '--ledger', ledger, '--stamp']);
    assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /stamp: .*\.design/);
    assert.equal(py([SCORE, '--verify', target]).status, 0, `${name}: fresh stamp`);
    fs.appendFileSync(target, name.endsWith('.html') ? '<!-- edited -->\n' : '\n');
    const stale = py([SCORE, '--verify', target]);
    assert.equal(stale.status, 1, `${name}: stamp after an edit`);
    assert.match(stale.stdout, /^stale: /);
    const again = py([SCORE, '--ledger', ledger]);
    assert.equal(again.status, 3);
    assert.match(again.stderr, /bundle is for an earlier version/);
  }
});

test("an open P1 in the auditor's own files fails the gate; the report opens with the method line and splits by owner", () => {
  const b = audit('fixture.pptx');
  const method = 'dual-agent (reviewers: accessibility-review=a1; detector after rows)';
  const ledger = ledgerFor(b, { method, edit: (l) => { fail(l, 'A11Y-003'); fail(l, 'A11Y-013', { owner: 'Code', priority: 'P2' }); } });
  const r = py([SCORE, '--ledger', ledger, '--markdown', '--stamp']);
  assert.equal(r.status, 1);
  const lines = r.stdout.split(/\r?\n/);
  assert.equal(lines[0], method);
  assert.match(r.stdout, /- \*\*Design\*\* \(auditor\): P1 A11Y-003/);
  assert.match(r.stdout, /- \*\*Code\*\*: P2 A11Y-013/);
  assert.match(r.stdout, /FAIL no_open_P0_or_P1_in_auditor_files/);
  assert.match(r.stderr, /stamp: not written/);
  const tickets = JSON.parse(py([SCORE, '--ledger', ledger, '--tickets']).stdout);
  assert.deepEqual(tickets.map((x) => [x.wcag, x.severity]), [['1.4.3', 'P1'], [null, 'P2']]);

  const degraded = py([SCORE, '--ledger', ledgerFor(b, { method: 'DEGRADED: single-context (no Agent tool)' }), '--markdown']);
  assert.equal(degraded.status, 1);
  assert.equal(degraded.stdout.split(/\r?\n/)[0], '⚠️ DEGRADED: single-context (no Agent tool)');
});

test('a URL is stamped by its address plus deployed commit, and a new commit makes it stale', async (t) => {
  const page = fs.readFileSync(path.join(FIXTURES, 'faults.html'), 'utf8').replace('<head>', '<head>\n<meta name="aac-commit" content="abc1234">');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/board`;
  const out = path.join(root, 'url-audit');
  const run = (args) => new Promise((res) => {
    const p = spawn('python3', args, { env, cwd: root });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => res({ status, stdout, stderr }));
  });
  const r = await run([AUDIT, url, '--out', out, '--no-axe']);
  if (/no Chromium found/.test(r.stderr)) return t.skip('no Chromium on this machine');
  assert.equal(r.status, 0, r.stderr);
  const bundle = JSON.parse(fs.readFileSync(path.join(out, 'bundle.json'), 'utf8'));
  assert.deepEqual(bundle.stamp_key, { kind: 'url', url, commit: 'abc1234' });
  const ledger = ledgerFor({ dir: out, json: bundle });
  const s = await run([SCORE, '--ledger', ledger, '--stamp', '--stamp-dir', path.join(root, 'url-stamps')]);
  assert.equal(s.status, 0, s.stdout + s.stderr);
  assert.equal((await run([SCORE, '--verify', url, '--commit', 'abc1234', '--stamp-dir', path.join(root, 'url-stamps')])).status, 0);
  const stale = await run([SCORE, '--verify', url, '--commit', 'def5678', '--stamp-dir', path.join(root, 'url-stamps')]);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /stale: stamped at commit abc1234/);
});
