// The review `meaning` command, end to end at the CLI (issue 1242): one seam, a docx in and fix
// lines and an exit code out, with Jev stubbed through TYPESAFE_JEV_STUB so nothing calls the
// network. Fixtures are built from the approved template by tools/review-meaning-fixtures.py and
// hold only the Manager Tools Bob examples and invented defects: no real review text.
// Needs python3 with python-docx; skips without it, unless REVIEW_MEANING_REQUIRE_DOCX=1 (CI).
'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SELF = path.join(ROOT, 'aac-skills', 'aac-review-self-check');
const AUDIT = path.join(ROOT, 'aac-skills', 'aac-performance-review-audit');
const SELF_PY = path.join(SELF, 'review_format_check.py');
const AUDIT_PY = path.join(AUDIT, 'review_gate_tools.py');
const FIXTURES = path.join(__dirname, 'review-meaning-fixtures.py');
const PY = process.env.PYTHON || 'python3';

const HAVE_DOCX = spawnSync(PY, ['-c', 'import docx'], { encoding: 'utf8' }).status === 0;
if (!HAVE_DOCX && process.env.REVIEW_MEANING_REQUIRE_DOCX === '1') {
  test('python3 with python-docx is installed', () => assert.fail(`${PY} cannot import docx`));
}

// The fixture meets the SEER minimum (30% rounded down, never fewer than one; Dan, October 2, 2026), so Gate 1 passes it as a whole review.
const BOB = {
  direct: 'Bob', start: '7/24/2025', end: '7/23/2026',
  core: "Bob's results have met expectations since his last review. I am recommending he is ready for vertical growth in his role, in the areas of quality control and reporting.",
  strengths: [
    'Bob is my best customer service rep. He consistently exceeds every standard. He recently saved a difficult call after three other reps had failed. He is the rep the rest of the team learns from on hard calls.',
    'Bob documents every escalation. Recently he wrote up a billing dispute so clearly that finance closed it the same day.',
    'Bob keeps the call queue moving at the end of a shift. He takes the last open calls himself before he logs off. During a storm this spring he cleared eleven waiting calls after his shift ended. He leaves the queue empty for the next shift.',
  ],
  weaknesses: [
    'Bob turns in his weekly call reports late. Three of the last five reports arrived after the Friday deadline. He sent the March 6 report on the following Tuesday. His reports are often late.',
    'Bob skips the notes field on short calls. Most calls under two minutes close with the notes field blank. On one short call last month he left no note and the customer had to explain the problem twice. His short calls often close with no notes.',
  ],
  guidance: ['Submit each weekly call report by noon on Friday.', 'Write a note on every call before closing it.', 'Lead two training sessions on difficult calls for the team.'],
};

// Python starts slowly on Windows, so every case runs at once (each in its own directory: a run
// writes a gate record beside its docx) and the plain Bob fixture is built once and copied.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-meaning-'));
let n = 0;
let bobFile = null;
let bobStub = null;
const bobCopies = new Set();

function py(script, args, stub) {
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', TYPESAFE_API_KEY: '' };
  env.TYPESAFE_JEV_STUB = stub === undefined ? 'off' : typeof stub === 'string' ? stub : JSON.stringify(stub);
  return new Promise((resolve) => {
    execFile(PY, [script, ...args], { encoding: 'utf8', env, cwd: path.dirname(script) }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: stdout + stderr });
    });
  });
}

function freshDir() {
  const dir = path.join(tmp, String(++n));
  fs.mkdirSync(dir);
  return dir;
}

async function docx(changes) {
  const dir = freshDir();
  const out = path.join(dir, 'review.docx');
  if (!changes && bobFile) {
    fs.copyFileSync(bobFile, out);
    bobCopies.add(out);
    return out;
  }
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify({ ...BOB, ...changes }));
  const r = await py(FIXTURES, [path.join(dir, 'spec.json'), out]);
  assert.equal(r.code, 0, r.out);
  return out;
}

// Every question the draft asks, answered the way that passes it, then the overrides.
async function stubFor(file, overrides = {}) {
  let stub = bobCopies.has(file) ? bobStub : null;
  if (!stub) {
    const r = await py(AUDIT_PY, ['meaning', file, '--direct', 'Bob', '--questions']);
    assert.equal(r.code, 0, r.out);
    stub = JSON.parse(r.out);
  }
  for (const k of Object.keys(overrides)) assert.ok(k in stub, `no question ${k}: ${Object.keys(stub)}`);
  return { ...stub, ...overrides };
}

const meaning = (script, file, stub) => py(script, ['meaning', file, '--direct', 'Bob'], stub);
const check = (file) => py(AUDIT_PY, ['check', file, '--end', '7/23/2026', '--start', '7/24/2025', '--direct', 'Bob', '--no-render']);

const suite = HAVE_DOCX ? describe : describe.skip;

suite('review meaning', { concurrency: true }, () => {
  const t = test;

  before(async () => {
    bobFile = await docx({});
    bobStub = await stubFor(bobFile);
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  t('meaning runs from both skill folders on the Bob fixture and passes every item', async () => {
    const file = await docx();
    const stub = await stubFor(file);
    const a = await meaning(AUDIT_PY, file, stub);
    const s = await meaning(SELF_PY, file, stub);
    assert.equal(a.code, 0, a.out);
    assert.equal(s.code, 0, s.out);
    assert.equal(a.out, s.out);
    assert.match(a.out, /^MEANING CHECK: PASS$/m);
    assert.match(a.out, /^Passed: S1, S2, S3, W1, W2, Core Message, Guidance 1, Guidance 2, Guidance 3$/m);
    assert.match(a.out, /^Jev: ran/m);
  });

  t('a Guidance sentence opening on the direct, a pronoun or a reviewer promise fails; an instruction passes', async () => {
    const file = await docx({ guidance: [
      'Bob builds strong relationships with customers.',
      'Submit each weekly call report by noon on Friday. He has struggled with this.',
      "Coach the newer reps on difficult calls. I will meet with him monthly. I'll check in on Fridays.",
      'Lead two training sessions on difficult calls for the team.',
    ] });
    const r = await meaning(AUDIT_PY, file, await stubFor(file));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^  - Guidance 1: sentence 1 opens on "Bob"; it must be an instruction to Bob for next year\.$/m);
    assert.match(r.out, /^  - Guidance 2: sentence 2 opens on "He"; it must be an instruction to Bob for next year\.$/m);
    assert.match(r.out, /^  - Guidance 3: sentence 2 is a promise from the reviewer \("I will"\)/m);
    assert.match(r.out, /^  - Guidance 3: sentence 3 is a promise from the reviewer \("I'll"\)/m);
    assert.doesNotMatch(r.out, /Guidance 4:/);
    assert.match(r.out, /^Passed: .*Guidance 4$/m);
  });

  t('an example with two dated events fails one example; a date range, or a due date and its close date, is one and passes', async () => {
    const two = await docx({ strengths: [BOB.strengths[0], 'Bob documents every escalation. He wrote up a billing dispute on 3/4/2026 and a refund case on 5/6/2026.'] });
    let r = await meaning(AUDIT_PY, two, await stubFor(two));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^  - S2: sentence 2 holds 2 dated events \(3\/4\/2026, 5\/6\/2026\); it must be one example\.$/m);
    const range = await docx({ strengths: [BOB.strengths[0], 'Bob documents every escalation. He wrote up 140 billing disputes from 7/24/2025 through 7/23/2026.'] });
    r = await meaning(AUDIT_PY, range, await stubFor(range));
    assert.equal(r.code, 0, r.out);
    // One late report stated with its due date and the date it arrived is one example (issue 1247).
    const due = await docx({ weaknesses: ['Bob turns in his weekly call reports late. Three of the last five reports arrived after the Friday deadline. The March 6 report was due March 6, 2026 and did not arrive until March 10, 2026. His reports are often late.'] });
    r = await meaning(AUDIT_PY, due, await stubFor(due));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /dated events/);
  });

  t('comma counts are a note and never change the exit code', async () => {
    const file = await docx({ strengths: ['Bob, my best rep, is calm on hard calls. He listens, waits, and then answers. He recently saved a difficult call after three other reps had failed. He stays calm when a call turns hard.', BOB.strengths[1]] });
    const r = await meaning(AUDIT_PY, file, await stubFor(file));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^Note: Commas per item \(fewer is better\): S1 4, S2 0, W1 0, W2 0\.$/m);
    assert.doesNotMatch(r.out, /^  - .*comma/im);
  });

  t('Jev off, or an answer missing, is exit 2 and never a pass', async () => {
    const file = await docx();
    for (const stub of ['off', { 'S1.s1_pattern': 0.9 }]) {
      const r = await meaning(AUDIT_PY, file, stub);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /^MEANING CHECK: COULD NOT CHECK/m);
      assert.doesNotMatch(r.out, /PASS|^Passed:/m);
    }
  });

  // [question, the answer that fails it, an answer in the read band (Noul only), the fix line].
  const JEV = [
    ['S1.s1_behavior', 'trait', null, /^  - S1: sentence 1 names a trait, motive or attitude; it must name a behavior or work product\. \(Jev\)$/m],
    ['S1.s1_pattern', 0.1, 0.3, /^  - S1: sentence 1 is a one-off event; it must state a pattern, with the event as the example\. \(Jev\)$/m],
    ['S1.s2_elaborate', 'new_theme', null, /^  - S1: sentence 2 opens a new theme; it must add detail about the behavior in sentence 1 \(Elaborate\)\. \(Jev\)$/m],
    ['S1.example_one', 0.1, 0.4, /^  - S1: sentence 3 is not one specific thing that happened; it must be one event or figure\. \(Jev\)$/m],
    ['S2.example_demonstrates', 0.05, 0.45, /^  - S2: the example in sentence 2 is not an instance of sentence 1; the item must be about one of them\. \(Jev\)$/m],
    ['S1.s4_restate', 0.1, 0.3, /^  - S1: sentence 4 does not restate sentence 1; it must say the same thing again with no new theme\. \(Jev\)$/m],
    ['core.ramification', 0.95, 0.6, /^  - Core Message: the Ramification lists his Weaknesses or his current work; it must name what changes for him next year\. \(Jev\)$/m],
    ['W1.weakness_guidance', 'none', null, /^  - W1: has no Guidance point; every Weakness has at least one\. \(Jev\)$/m],
    ['Guidance 2.s1.instruction', 0.1, 0.4, /^  - Guidance 2: sentence 1 is not an instruction for next year; it must tell Bob what to do\. \(Jev\)$/m],
  ];

  for (const [qid, fail, band, line] of JEV) {
    t(`Jev ${qid}: a fix line tagged (Jev), the read list, and a pass`, async () => {
      const file = await docx();
      const fixed = await meaning(AUDIT_PY, file, await stubFor(file, { [qid]: fail }));
      assert.equal(fixed.code, 1, fixed.out);
      assert.match(fixed.out, line);
      if (band !== null) {
        const read = await meaning(AUDIT_PY, file, await stubFor(file, { [qid]: band }));
        assert.equal(read.code, 0, read.out);
        const label = qid.startsWith('core') ? 'Core Message' : qid.split('.')[0];
        assert.match(read.out, new RegExp(`^Read \\(Jev was unsure[^\\n]*\\n(  - .*\\n)*  - ${label}: .*\\(Jev 0\\.\\d\\d that it fails\\)$`, 'm'));
        assert.doesNotMatch(read.out, new RegExp(`^Passed: .*\\b${label}\\b`, 'm'));
      }
    });
  }

  t('a why-it-matters sentence 2 fails with a (Jev) fix line; the Bob example passes', async () => {
    const file = await docx({ strengths: ['Bob is my best customer service rep. His work keeps our renewal rate high and protects revenue for the company. He recently saved a difficult call after three other reps had failed. He is the strongest service rep on my team.', BOB.strengths[1]] });
    const r = await meaning(SELF_PY, file, await stubFor(file, { 'S1.s2_elaborate': 'why_it_matters' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^  - S1: sentence 2 says why the behavior matters; it must add detail about the behavior in sentence 1 \(Elaborate\)\. \(Jev\)$/m);
  });

  t('a list of accounts in the example: three named accounts fail, a doubtful third is read, none passes', async () => {
    const file = await docx({ strengths: [BOB.strengths[0], 'Bob keeps his largest accounts current. He visited Acme Foods, Corex Health and Delta Storage in one week.'] });
    const accounts = (a, b, c) => ({ 'S2.account.0': a, 'S2.account.1': b, 'S2.account.2': c });
    let r = await meaning(AUDIT_PY, file, await stubFor(file, accounts(0.95, 0.9, 0.92)));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^  - S2: sentence 2 names 3 accounts \(Acme Foods, Corex Health, Delta Storage\); it must be one example, not a list of accounts\. \(Jev\)$/m);
    r = await meaning(AUDIT_PY, file, await stubFor(file, accounts(0.95, 0.9, 0.6)));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^  - S2: sentence 2: one example, not a list of accounts \(Acme Foods, Corex Health, Delta Storage\)\?/m);
    r = await meaning(AUDIT_PY, file, await stubFor(file));
    assert.equal(r.code, 0, r.out);
  });

  t('a Weakness with no Guidance at all fails by rule', async () => {
    const file = await docx({ guidance: [] });
    const r = await meaning(AUDIT_PY, file, await stubFor(file));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^  - W1: has no Guidance point; every Weakness has at least one\.$/m);
  });

  t('the meaning module and the Jev client are one copy each, pinned byte for byte', async () => {
    const read = (...p) => fs.readFileSync(path.join(...p));
    assert.ok(read(SELF, 'review_meaning.py').equals(read(AUDIT, 'review_meaning.py')), 'review_meaning.py copies differ');
    const hooks = read(ROOT, 'profile', 'codex', 'hooks', 'jev.py');
    assert.ok(read(SELF, 'jev.py').equals(hooks), 'self-check jev.py differs from profile/codex/hooks/jev.py');
    assert.ok(read(AUDIT, 'jev.py').equals(hooks), 'audit jev.py differs from profile/codex/hooks/jev.py');
  });

  t('the hard-coded capital-word list is gone and Gate 1 still passes the Bob fixture', async () => {
    for (const f of [SELF_PY, AUDIT_PY]) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /^STOP = set\(|has_anchor/m);
    const r = await check(await docx());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^GATE 1: PASS$/m);
  });

  t('Gate 1 passes a five-item page with one SEER item (30% of five, rounded down, is one)', async () => {
    const r = await check(await docx({ strengths: [BOB.strengths[0], 'Bob documents every escalation. Recently he wrote up a billing dispute so clearly that finance closed it the same day.', 'Bob answers the phone on the first ring. Last Monday he picked up every call in the morning rush before the second ring.'],
      weaknesses: ['Bob turns in his weekly call reports late. He sent the March 6 report on the following Tuesday.',
        'Bob skips the notes field on short calls. On one short call last month he left no note and the customer had to explain the problem twice.'] }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^GATE 1: PASS$/m);
  });

  t('Gate 1 fails a seven-item page with one SEER item (30% of seven, rounded down, is two)', async () => {
    const sumex = (s) => `Bob ${s}. Last week he did it again on a customer call.`;
    const r = await check(await docx({ strengths: [BOB.strengths[0], sumex('answers on the first ring'), sumex('logs every callback'), sumex('closes tickets the same day')],
      weaknesses: [sumex('misses the Friday report deadline'), sumex('skips notes on short calls'), sumex('leaves voicemails unreturned overnight')] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /1 in SEER; at least 2 of 7 must be SEER/);
  });

  t('Gate 1 fails a page with no SEER item and names the floor', async () => {
    const r = await check(await docx({ strengths: ['Bob documents every escalation. Recently he wrote up a billing dispute so clearly that finance closed it the same day.', 'Bob answers the phone on the first ring. Last Monday he picked up every call in the morning rush before the second ring.'],
      weaknesses: ['Bob turns in his weekly call reports late. He sent the March 6 report on the following Tuesday.'] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /0 in SEER; at least 1 of 3 must be SEER/);
  });

  t('build refuses without both runs on the exact file, and builds when they match', async () => {
    const file = await docx();
    const body = path.join(path.dirname(file), 'body.py');
    fs.writeFileSync(body, 'body = [P("Hey Pat,"), P("Thanks,")]\n');
    const out = path.join(path.dirname(file), 'email.docx');
    const build = () => py(AUDIT_PY, ['build', body, out, '--review', file]);
    let r = await build();
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no gate record beside review\.docx/);
    await check(file);
    r = await build();
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no meaning run is recorded/);
    await meaning(AUDIT_PY, file, 'off');
    r = await build();
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /meaning could not check \(exit 2\); that is a stop, not a pass/);
    await meaning(AUDIT_PY, file, await stubFor(file));
    r = await build();
    assert.equal(r.code, 0, r.out);
    assert.ok(fs.existsSync(out));
    fs.appendFileSync(file, Buffer.from([0]));
    r = await build();
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /the gate record is stale/);
  });

  t('the release gate passes only when check and meaning both exited 0 on the file', async () => {
    const file = await docx();
    await check(file);
    await meaning(AUDIT_PY, file, await stubFor(file, { 'S1.s1_pattern': 0.1 }));
    let r = await py(AUDIT_PY, ['gate', file]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /meaning exited 1; review text ships only at exit 0/);
    await meaning(AUDIT_PY, file, await stubFor(file));
    r = await py(AUDIT_PY, ['gate', file]);
    assert.equal(r.code, 0, r.out);
  });

  t('the self-check stamp needs both runs and says whether Jev or a reader ran the meaning checks', async () => {
    const stampArgs = (f) => ['stamp', f, '--end', '7/23/2026', '--start', '7/24/2025', '--direct', 'Bob'];
    const fmt = (f) => py(SELF_PY, [f, '--end', '7/23/2026', '--start', '7/24/2025', '--direct', 'Bob', '--no-render']);
    let file = await docx();
    let r = await py(SELF_PY, stampArgs(file));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /^NOT STAMPED\./m);

    await fmt(file);
    await meaning(SELF_PY, file, await stubFor(file, { 'S1.s1_pattern': 0.1 }));
    r = await py(SELF_PY, stampArgs(file));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /the meaning run has 1 fix line/);

    await meaning(SELF_PY, file, await stubFor(file));
    r = await py(SELF_PY, stampArgs(file));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^aac-review-self-check PASS \S+ SC-[0-9A-F]{6} meaning: Jev$/m);

    file = await docx();
    await fmt(file);
    await meaning(SELF_PY, file, 'off');
    r = await py(SELF_PY, stampArgs(file));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^aac-review-self-check PASS \S+ SC-[0-9A-F]{6} meaning: read, not Jev$/m);
  });
});
