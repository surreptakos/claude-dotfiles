#!/usr/bin/env node
/**
 * node --test tools/ensure-milestones.test.js
 *
 * Tests for tools/ensure-milestones.js: the pure plan (create, reopen, update, none), the
 * end-to-end run against an in-process fake `gh` (POST and PATCH bodies under test), the
 * idempotency invariant that makes a push-triggered job safe (a second run writes nothing), the
 * token refusal, and the file validation.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { plan, readWanted, ensureMilestones, MISSING_TOKEN } = require('./ensure-milestones.js');

const SLUG = 'surreptakos/claude-dotfiles';

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-milestones-'));
  const file = path.join(dir, 'milestones.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

/** A fake `gh api` over an in-memory milestone table. Records every write. */
function fakeGh(seed) {
  const rows = seed.map((m, i) => ({ number: m.number || i + 1, title: m.title, description: m.description || '', state: m.state || 'open' }));
  const writes = [];
  const gh = (args, input) => {
    const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
    // The path is the one argument after `api` that is neither a flag nor a flag's value.
    const url = args.slice(1).find((a, i, all) => !a.startsWith('-') && (i === 0 || !['--method', '--input'].includes(all[i - 1])));
    if (method === 'GET') {
      // `[?&]` keeps `per_page=100` from reading as page 100.
      const page = Number((url.match(/[?&]page=(\d+)/) || [])[1] || 1);
      return JSON.stringify(page === 1 ? rows : []);
    }
    const body = JSON.parse(input);
    writes.push({ method, url, body });
    if (method === 'POST') {
      const made = { number: rows.length + 1, title: body.title, description: body.description || '', state: 'open' };
      rows.push(made);
      return JSON.stringify(made);
    }
    const number = Number(url.split('/').pop());
    const row = rows.find((r) => r.number === number);
    Object.assign(row, body);
    return JSON.stringify(row);
  };
  return { gh, rows, writes };
}

const WANTED = [
  { title: 'M1 cloud parity: claude-dotfiles', description: 'first' },
  { title: 'M2 cloud parity: all repos', description: 'second' },
];

test('plan: absent creates, closed reopens, drift updates, match is none', () => {
  const existing = [
    { number: 3, title: 'M2 cloud parity: all repos', description: 'stale', state: 'open' },
    { number: 4, title: 'Backlog', description: 'b', state: 'closed' },
    { number: 5, title: 'Untouched', description: 'u', state: 'open' },
  ];
  const wanted = WANTED.concat([{ title: 'Backlog', description: 'b' }]);
  const steps = plan(wanted, existing);
  assert.deepEqual(steps.map((s) => s.action), ['create', 'update', 'reopen']);
  assert.equal(steps[1].number, 3);
  assert.equal(steps[2].number, 4);
  // The repo's extra milestone is not in the plan at all: the file lists what must exist.
  assert.ok(!steps.some((s) => s.title === 'Untouched'));
  assert.deepEqual(plan(wanted, existing.map((m) => (m.title === 'M2 cloud parity: all repos' ? { ...m, description: 'second' } : m)))[1].action, 'none');
});

test('end to end: creates the missing ones with the right POST body, then a second run writes nothing', () => {
  const { gh, writes } = fakeGh([]);
  const file = tmpFile(WANTED);
  const lines = [];
  const code = ensureMilestones({ apply: true, runGh: gh, slug: SLUG, file, log: (l) => lines.push(l) });
  assert.equal(code, 0);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].method, 'POST');
  assert.equal(writes[0].url, 'repos/' + SLUG + '/milestones');
  assert.deepEqual(writes[0].body, { title: WANTED[0].title, description: 'first' });
  assert.ok(lines.some((l) => l.includes('created "M1 cloud parity: claude-dotfiles" (milestone 1)')));

  writes.length = 0;
  ensureMilestones({ apply: true, runGh: gh, slug: SLUG, file, log: () => {} });
  assert.equal(writes.length, 0, 'second run over a matched repo must write nothing');
});

test('end to end: a closed twin is reopened with its description refreshed, by PATCH', () => {
  const { gh, writes, rows } = fakeGh([{ number: 7, title: WANTED[0].title, description: 'old', state: 'closed' }]);
  const file = tmpFile([WANTED[0]]);
  ensureMilestones({ apply: true, runGh: gh, slug: SLUG, file, log: () => {} });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PATCH');
  assert.equal(writes[0].url, 'repos/' + SLUG + '/milestones/7');
  assert.deepEqual(writes[0].body, { state: 'open', description: 'first' });
  assert.equal(rows[0].state, 'open');
});

test('dry run reads but never writes', () => {
  const { gh, writes } = fakeGh([]);
  const lines = [];
  ensureMilestones({ apply: false, runGh: gh, slug: SLUG, file: tmpFile(WANTED), log: (l) => lines.push(l) });
  assert.equal(writes.length, 0);
  assert.ok(lines.some((l) => l.startsWith('would create')));
  assert.ok(lines.some((l) => l.startsWith('Dry run')));
});

test('no token and no injected gh: refuses with the named cause, exit 1', () => {
  const lines = [];
  const code = ensureMilestones({ apply: true, env: {}, file: tmpFile(WANTED), log: (l) => lines.push(l) });
  assert.equal(code, 1);
  assert.deepEqual(lines, [MISSING_TOKEN]);
});

test('readWanted: rejects a non-array, a missing title and a duplicate title', () => {
  assert.throws(() => readWanted(tmpFile({ title: 'x' })), /expected a JSON array/);
  assert.throws(() => readWanted(tmpFile([{ description: 'no title' }])), /entry 0 has no title/);
  assert.throws(() => readWanted(tmpFile([{ title: 'A' }, { title: 'A' }])), /duplicate title "A"/);
  assert.deepEqual(readWanted(tmpFile([{ title: ' A ' }])), [{ title: 'A', description: '' }]);
});

test('the committed file parses and names the two parity milestones', () => {
  const wanted = readWanted(path.join(__dirname, '..', 'docs', 'agents', 'milestones.json'));
  const titles = wanted.map((w) => w.title);
  assert.ok(titles.includes('M1 cloud parity: claude-dotfiles'));
  assert.ok(titles.includes('M2 cloud parity: all repos'));
});
