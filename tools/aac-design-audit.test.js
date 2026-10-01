// aac-design audit mode, end to end on the web surface (issue 1084): the web adapter's evidence
// bundle, the ledger's rejections, the scorer's gate and stamp, and the findings page. The fixture
// is a made-up sign-up form with four planted faults; it names no customer, deal or rep.
// The adapter case needs a local Chromium, Chrome or Edge (nothing is downloaded) and skips without
// one; every ledger case drives the real score.py.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SKILL = path.join(__dirname, '..', 'aac-skills', 'aac-design');
const ADAPTER = path.join(SKILL, 'scripts', 'web_audit.js');
const SCORER = path.join(SKILL, 'scripts', 'score.py');
const CATALOG = JSON.parse(fs.readFileSync(path.join(SKILL, 'catalog', 'CATALOG.json'), 'utf8'));
const { findChrome } = require(ADAPTER);

const FIXTURE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixture sign-up</title>
<style>
body { font-family: sans-serif; color: #1a1a1a; background: #ffffff; margin: 24px; }
.faint { color: #bbbbbb; }
.gone { display: inline-block; width: 0; overflow: hidden; white-space: nowrap; }
</style></head>
<body>
<main>
<h1>Sign up</h1>
<p class="faint">Fields marked with a star are required.</p>
<p>Name</p>
<input type="text" id="name">
<select id="plan"><option>Basic</option><option>Plus</option></select>
<a class="gone" href="#top">Back to top</a>
<button type="submit">Send</button>
</main>
</body>
</html>
`;

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aac-design-audit-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const page = path.join(root, 'signup.html');
fs.writeFileSync(page, FIXTURE);
const sha = (p) => require('node:crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function score(ledger, args = [], cwd = root) {
  const f = path.join(root, `ledger-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify(ledger));
  return spawnSync('python3', [SCORER, f, ...args], { encoding: 'utf8', cwd });
}
const checkStamp = (target, extra = [], cwd = root) =>
  spawnSync('python3', [SCORER, '--check-stamp', target, ...extra], { encoding: 'utf8', cwd });

// One isolated reviewer per catalogued skill on the web surface, accessibility-review first so the
// detector-order case below can move its time.
const WEB_SKILLS = [...new Set(CATALOG.rows.filter((r) => r.surfaces.includes('web')).map((r) => r.skill))]
  .sort((a, b) => (a === 'accessibility-review' ? -1 : b === 'accessibility-review' ? 1 : a.localeCompare(b)));

// A complete web ledger: every applicable id, two open findings owned by Code, none by the auditor.
function ledger(overrides = {}) {
  const rows = CATALOG.rows.filter((r) => r.surfaces.includes('web')).map((r) => ({
    id: r.id, verdict: 'PASS', evidence: 'shot-1440.png',
  }));
  rows[2] = { id: rows[2].id, verdict: 'FAIL', evidence: 'findings.json#/faults/0', owner: 'Code', file: 'signup.html',
    fix: 'Darken the hint text to #595959', priority: 'P1' };
  rows[10] = { id: rows[10].id, verdict: 'FAIL', evidence: 'a11y-tree.json', owner: 'Code', file: 'signup.html',
    fix: 'Give the name field a label', priority: 'P2' };
  rows[25] = { id: rows[25].id, verdict: 'N/A', reason: 'No Figma file exists for this page.' };
  return {
    method: 'dual-agent (reviewers: accessibility-review=agent-a · detector: agent-b)',
    surface: 'web',
    subject: { kind: 'file', path: page, sha256: sha(page) },
    auditor: 'Design',
    reviewers: WEB_SKILLS.map((skill, i) => ({ skill, agent: `agent-a${i}`, rows_in: '2026-09-30T10:00:00Z', detector_shown: '2026-09-30T10:05:00Z' })),
    rows,
    ...overrides,
  };
}

const chrome = findChrome();
let bundleDir;
let adapterRun;
before(() => {
  if (!chrome) return;
  bundleDir = path.join(root, 'evidence');
  adapterRun = spawnSync(process.execPath, [ADAPTER, page, '--out', bundleDir], { encoding: 'utf8', timeout: 180000 });
});

test('the four-fault fixture yields an evidence bundle listing each fault', { skip: !chrome && 'no local Chromium, Chrome or Edge' }, () => {
  assert.equal(adapterRun.status, 0, adapterRun.stderr);
  const bundle = JSON.parse(fs.readFileSync(path.join(bundleDir, 'bundle.json'), 'utf8'));
  assert.deepEqual(bundle.subject, { kind: 'file', path: page, sha256: sha(page) });
  for (const f of [...bundle.review_set, ...bundle.detector_set]) assert.ok(fs.existsSync(path.join(bundleDir, f)), f);
  for (const shot of ['shot-1440.png', 'shot-768.png', 'shot-390.png', 'shot-zoom200.png', 'shot-reduced-motion.png', 'shot-forced-colors.png', 'shot-offline.png']) {
    assert.ok(bundle.review_set.includes(shot), shot);
  }
  assert.ok(!bundle.review_set.includes('findings.json') && !bundle.review_set.includes('axe.json'), 'detector output is withheld from reviewers');

  const { faults } = JSON.parse(fs.readFileSync(path.join(bundleDir, 'findings.json'), 'utf8'));
  const has = (kind, where, role) => faults.some((f) => f.kind === kind && f.where.includes(where) && (!role || f.role === role));
  assert.ok(has('unnamed-control', '#name', 'textbox'), 'missing label');
  assert.ok(has('unnamed-control', '#plan', 'combobox'), 'unlabelled select');
  assert.ok(faults.some((f) => f.kind === 'low-contrast' && f.text.startsWith('Fields marked')), 'low-contrast text');
  assert.ok(has('zero-size-focus', 'main > a') && has('zero-size-focusable', 'main > a'), 'zero-width focusable element');
  for (const f of faults) assert.ok(f.catalog_ids.length > 0, `${f.kind} maps to catalog rows`);
  if (bundle.measures['web.axe'].status === 'ok') {
    for (const id of ['axe:label', 'axe:select-name', 'axe:color-contrast']) assert.ok(faults.some((f) => f.kind === id), id);
  }
});

test('a ledger missing one applicable catalog id is rejected', () => {
  const l = ledger();
  const dropped = l.rows.splice(7, 1)[0].id;
  const r = score(l);
  assert.equal(r.status, 3, r.stdout);
  assert.match(r.stderr, new RegExp(`misses 1 applicable catalog id\\(s\\): ${dropped}`));
});

test('N/A without a reason is rejected', () => {
  const l = ledger();
  l.rows[25] = { id: l.rows[25].id, verdict: 'N/A' };
  const r = score(l);
  assert.equal(r.status, 3, r.stdout);
  assert.match(r.stderr, /N\/A needs a reason/);
});

test('detector output shown to a reviewer before its rows were in is rejected', () => {
  const l = ledger();
  l.reviewers[0].detector_shown = '2026-09-30T09:59:00Z';
  const r = score(l);
  assert.equal(r.status, 3, r.stdout);
  assert.match(r.stderr, /detector output reached the accessibility-review reviewer before its rows were in/);
});

test('an open P1 owned by the auditor fails the gate; the same finding owned by another passes', () => {
  assert.equal(score(ledger()).status, 0);
  const r = score(ledger({ auditor: 'Code' }));
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /"no_open_P0_or_P1_owned_by_Code": false/);
});

test('a complete ledger scores and stamps; editing the fixture makes the stamp stale', () => {
  const r = score(ledger(), ['--stamp', page]);
  assert.equal(r.status, 0, r.stderr);
  const stamp = JSON.parse(fs.readFileSync(path.join(root, '.design', 'signup.html.json'), 'utf8'));
  assert.equal(stamp.sha256, sha(page));
  assert.equal(stamp.mode, 'audit');
  assert.equal(checkStamp(page).status, 0);

  fs.appendFileSync(page, '<!-- edited -->\n');
  const stale = checkStamp(page);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /stale/);
  const again = score(ledger({ subject: { kind: 'file', path: page, sha256: 'a'.repeat(64) } }), ['--stamp', page]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /changed since the audit/);
  fs.writeFileSync(page, FIXTURE);
});

test('a URL is stamped by its address plus deployed commit', () => {
  const url = 'http://localhost:8080/signup';
  const r = score(ledger({ subject: { kind: 'url', url, commit: 'abc1234' } }), ['--stamp', url]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(checkStamp(url, ['--commit', 'abc1234']).status, 0);
  assert.equal(checkStamp(url, ['--commit', 'def5678']).status, 1);
  assert.equal(score(ledger({ subject: { kind: 'url', url } })).status, 3, 'a URL without its commit is rejected');
});

test('the findings page opens with the method line, dual-agent or degraded', () => {
  for (const method of ['dual-agent (reviewers: accessibility-review=agent-a · detector: agent-b)', 'DEGRADED: single-context (no Agent tool)']) {
    const out = path.join(root, 'findings.html');
    const r = score(ledger({ method }), ['--report', out, '--markdown']);
    assert.equal(r.status, method.startsWith('DEGRADED') ? 1 : 0, r.stderr);
    const body = fs.readFileSync(out, 'utf8').split('<body>')[1];
    const first = body.match(/^<p[^>]*>([^<]*)<\/p>/)[1];
    assert.equal(first, method.startsWith('DEGRADED') ? `⚠️ ${method}` : `Method: ${method}`);
    assert.equal(r.stdout.split('\n')[0], first);
  }
});

// The last two outputs (issue 1086): the handoff split by owner, and one ticket per open accessibility FAIL.
const webRows = CATALOG.rows.filter((r) => r.surfaces.includes('web'));
const at = (id) => webRows.findIndex((r) => r.id === id);
function twoOwners() {
  const l = ledger();
  l.rows[at('A11Y-003')] = { id: 'A11Y-003', verdict: 'FAIL', evidence: 'findings.json#/faults/2', owner: 'Design', file: 'signup.html',
    fix: 'Darken the hint text to #595959', priority: 'P2' };
  l.rows[at('A11Y-013')] = { id: 'A11Y-013', verdict: 'FAIL', evidence: 'shot-1440.png', owner: 'Design', file: 'signup.html',
    fix: 'Use the token ink colour for hints', priority: 'P3', wcag: '1.4.3' };
  return l;
}

test('a ledger with findings for two owners gives two handoff lists and nothing unassigned', () => {
  const dir = path.join(root, 'handoff-two');
  const r = score(twoOwners(), ['--handoff', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['code.md', 'design.md']);
  const listed = (f) => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^\| P\d \| ([A-Z0-9-]+):/gm)].map((m) => m[1]);
  const fails = twoOwners().rows.filter((x) => x.verdict === 'FAIL');
  assert.deepEqual(listed('design.md').sort(), fails.filter((x) => x.owner === 'Design').map((x) => x.id).sort());
  assert.deepEqual(listed('code.md').sort(), fails.filter((x) => x.owner === 'Code').map((x) => x.id).sort());
  assert.equal(listed('design.md').length + listed('code.md').length, fails.length, 'every open finding is in one list');
  assert.match(fs.readFileSync(path.join(dir, 'code.md'), 'utf8'), /\| P1 \| .*\| Darken the hint text to #595959 \|/);
});

test('a FAIL with no owner fails the run instead of landing in a list', () => {
  for (const owner of [undefined, '  ']) {
    const l = twoOwners();
    l.rows[at('A11Y-003')].owner = owner;
    const dir = path.join(root, `handoff-none-${owner === undefined ? 'missing' : 'blank'}`);
    const r = score(l, ['--handoff', dir]);
    assert.equal(r.status, 3, r.stdout);
    assert.match(r.stderr, /A11Y-003: FAIL has no owner/);
    assert.ok(!fs.existsSync(dir), 'no handoff list is written');
  }
});

test('each open accessibility FAIL gives one ticket draft with WCAG criterion and severity; PASS and N/A none', () => {
  const drafts = path.join(root, 'tickets.json');
  const r = score(twoOwners(), ['--tickets', drafts, '--markdown']);
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(fs.readFileSync(drafts, 'utf8')).drafts;
  // Not the tokens FAIL, no PASS row, and not A11Y-020, which is N/A.
  assert.deepEqual(got.map((d) => [d.id, d.wcag, d.severity]).sort(),
    [['A11Y-003', '1.4.3', 'P2'], ['A11Y-005', '2.1.1', 'P2'], ['A11Y-013', '1.4.3', 'P3']]);
  for (const d of got) {
    assert.ok(d.title.includes(`WCAG ${d.wcag} (${d.severity})`), d.title);
    assert.ok(d.body.includes(`**WCAG criterion:** ${d.wcag}`) && d.body.includes(`**Severity:** ${d.severity}`), d.body);
    assert.ok(r.stdout.includes(`Title: ${d.title}`), 'the draft is shown');
  }
  assert.match(r.stderr, /not filed/);

  const l = twoOwners();
  delete l.rows[at('A11Y-013')].wcag;
  const bad = score(l, ['--tickets', path.join(root, 'tickets-bad.json')]);
  assert.equal(bad.status, 3, bad.stdout);
  assert.match(bad.stderr, /A11Y-013: an accessibility FAIL needs its WCAG criterion/);
});

test('filing shows the drafts and needs the target repository named', () => {
  const drafts = path.join(root, 'tickets-file.json');
  assert.equal(score(twoOwners(), ['--tickets', drafts]).status, 0);
  const calls = path.join(root, 'gh-calls.log');
  const stub = path.join(root, 'gh-stub.js');
  fs.writeFileSync(stub, `const fs = require('fs'); let s = '';
process.stdin.on('data', (d) => { s += d; }).on('end', () => {
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');
  const n = fs.readFileSync(${JSON.stringify(calls)}, 'utf8').trim().split('\\n').length;
  process.stdout.write(JSON.stringify({ html_url: 'https://example.test/issues/' + n, title: JSON.parse(s).title }));
});`);
  const env = { ...process.env, AAC_DESIGN_GH: JSON.stringify([process.execPath, stub]) };
  const file = (extra) => spawnSync('python3', [SCORER, '--file-tickets', drafts, ...extra], { encoding: 'utf8', cwd: root, env });

  const unnamed = file([]);
  assert.equal(unnamed.status, 2, unnamed.stderr);
  assert.match(unnamed.stdout, /Ticket drafts: 3[\s\S]*Title: /);
  assert.match(unnamed.stderr, /name the target repository with --repo OWNER\/NAME/);
  assert.ok(!fs.existsSync(calls), 'nothing is filed without a repository');

  const named = file(['--repo', 'example-org/example-site']);
  assert.equal(named.status, 0, named.stderr);
  assert.match(named.stdout, /Ticket drafts: 3[\s\S]*Title: /);
  const made = fs.readFileSync(calls, 'utf8').trim().split('\n').map((x) => JSON.parse(x));
  assert.equal(made.length, 3);
  for (const argv of made) assert.deepEqual(argv, ['api', 'repos/example-org/example-site/issues', '--method', 'POST', '--input', '-']);
  assert.ok(JSON.parse(fs.readFileSync(drafts, 'utf8')).drafts.every((d) => d.filed));
  assert.equal(file(['--repo', 'example-org/example-site']).status, 0);
  assert.equal(fs.readFileSync(calls, 'utf8').trim().split('\n').length, 3, 'a rerun files nothing twice');
});
