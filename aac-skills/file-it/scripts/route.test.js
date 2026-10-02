'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateDestinations, validateParts, buildRequest, readAnswers, route } = require('./route.js');

const DEST = {
  homes: [{ id: 'aac-nexus', means: 'company policy' }, { id: 'aac-legal', means: 'legal work' }],
  forms: [{ id: 'file', means: 'a document' }, { id: 'ruling', means: 'a decision' }],
};
const PARTS = [{ id: 'rulings', text: 'Dan locked the attendance rulings' }, { id: 'legal-risk', text: 'open PLAWA question for counsel' }];

test('a valid table and parts pass validation', () => {
  assert.deepStrictEqual(validateDestinations(DEST), []);
  assert.deepStrictEqual(validateParts(PARTS), []);
});

test('every validation error is listed, not just the first', () => {
  const errs = validateDestinations({ homes: [{ id: 'A b', means: '' }, { id: 'x', means: 'y' }, { id: 'x', means: 'z' }], forms: [] });
  assert.ok(errs.some((e) => /not kebab-case/.test(e)));
  assert.ok(errs.some((e) => /means missing/.test(e)));
  assert.ok(errs.some((e) => /duplicate id x/.test(e)));
  assert.ok(errs.some((e) => /forms: missing or empty/.test(e)));
  assert.ok(validateParts([{ id: 'a', text: '' }, { id: 'a', text: 'b' }]).length === 2);
});

test('one request carries a home and a form Choice per part, over the table text', () => {
  const { state, questions } = buildRequest(DEST, PARTS);
  assert.deepStrictEqual(Object.keys(state), ['part_rulings', 'part_legal_risk']);
  assert.deepStrictEqual(Object.keys(questions).sort(), ['form.legal-risk', 'form.rulings', 'home.legal-risk', 'home.rulings']);
  assert.strictEqual(questions['home.rulings'].type, 'choice');
  assert.deepStrictEqual(questions['home.rulings'].criteria, { 'aac-nexus': 'company policy', 'aac-legal': 'legal work' });
  assert.match(questions['home.legal-risk'].instructions, /`part_legal_risk`/);
});

test('answers become one route per part with probabilities', () => {
  const answers = {
    'home.rulings': { choice: 'aac-nexus', probabilities: { 'aac-nexus': 0.9, 'aac-legal': 0.1 } },
    'form.rulings': { choice: 'ruling', probabilities: { ruling: 0.8, file: 0.2 } },
    'home.legal-risk': { choice: 'aac-legal', probabilities: { 'aac-legal': 0.7 } },
    'form.legal-risk': { choice: 'file' },
  };
  const r = readAnswers(DEST, PARTS, answers);
  assert.strictEqual(r.jev, 'answered');
  assert.deepStrictEqual(r.parts[0], { id: 'rulings', home: 'aac-nexus', form: 'ruling', home_p: 0.9, form_p: 0.8 });
  assert.strictEqual(r.parts[1].form_p, null);
});

test('a missing answer or an option the table lacks makes the whole route unavailable', () => {
  const partial = { 'home.rulings': { choice: 'aac-nexus' }, 'form.rulings': { choice: 'ruling' }, 'home.legal-risk': { choice: 'somewhere-else' }, 'form.legal-risk': { choice: 'file' } };
  const r = readAnswers(DEST, PARTS, partial);
  assert.strictEqual(r.jev, 'unavailable');
  assert.ok(r.parts.every((p) => p.home === null && p.form === null));
  assert.strictEqual(readAnswers(DEST, PARTS, null).jev, 'unavailable');
});

test('a client that throws or returns null falls back to unavailable', async () => {
  assert.strictEqual((await route(DEST, PARTS, async () => { throw new Error('down'); })).jev, 'unavailable');
  assert.strictEqual((await route(DEST, PARTS, async () => null)).jev, 'unavailable');
});

test('CLI: bad arguments exit 2; a bad table exits 1 listing errors; no credential prints unavailable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-it-'));
  const d = path.join(dir, 'd.json');
  const p = path.join(dir, 'p.json');
  fs.writeFileSync(d, JSON.stringify(DEST));
  fs.writeFileSync(p, JSON.stringify(PARTS));
  const script = path.join(__dirname, 'route.js');
  const env = Object.assign({}, process.env);
  for (const k of ['TYPESAFE_API_KEY', 'HTTPS_PROXY', 'https_proxy']) delete env[k];
  assert.strictEqual(spawnSync(process.execPath, [script], { env }).status, 2);
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ homes: [], forms: [] }));
  const bad = spawnSync(process.execPath, [script, '--destinations', path.join(dir, 'bad.json'), '--parts', p], { env, encoding: 'utf8' });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /homes: missing or empty/);
  const ok = spawnSync(process.execPath, [script, '--destinations', d, '--parts', p], { env, encoding: 'utf8' });
  assert.strictEqual(ok.status, 0);
  assert.strictEqual(JSON.parse(ok.stdout).jev, 'unavailable');
});

test('the live nexus table, when present beside this checkout, validates', () => {
  const live = process.env.FILE_IT_DESTINATIONS;
  if (!live || !fs.existsSync(live)) return;
  assert.deepStrictEqual(validateDestinations(JSON.parse(fs.readFileSync(live, 'utf8'))), []);
});
