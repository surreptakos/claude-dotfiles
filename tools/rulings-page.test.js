#!/usr/bin/env node
/**
 * node --test tools/rulings-page.test.js
 *
 * The rulings page's three jobs: carry drafts over only while a ticket is unchanged, build a page
 * whose data reads back, and land a pick as the comment, labels and state the draft promised —
 * without reposting when a run is repeated.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readPageData, planQueue, buildPage, planLanding, executeLanding, fillBodies, marker } = require('./rulings-page.js');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'rulings-page-template.html'), 'utf8');
const REPO = 'surreptakos/aac-routines';

function ticket(n, over = {}) {
  return {
    n, title: `t${n}`, url: `https://github.com/${REPO}/issues/${n}`, plain: 'p', question: 'q',
    blockedBy: [], blocks: [], needsDanOnly: '', draftedAt: '2026-09-25T13:55:00Z',
    options: [
      { id: 'a', label: 'Hand to agent', detail: 'd', recommended: true,
        landing: { action: 'relabel', addLabels: ['ready-for-agent'], removeLabels: ['ready-for-human'], ruling: 'Build it.' } },
      { id: 'b', label: 'Drop it', detail: 'd', recommended: false,
        landing: { action: 'close-wontfix', addLabels: [], removeLabels: [], ruling: 'Not doing this.' } },
      { id: 'c', label: 'Done already', detail: 'd', recommended: false,
        landing: { action: 'close-completed', addLabels: [], removeLabels: ['ready-for-human'], ruling: 'Shipped.' } },
    ],
    ...over,
  };
}

function draftsDir(tickets) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rulings-'));
  fs.writeFileSync(path.join(d, 'aac-routines.json'), JSON.stringify({ repo: REPO, labels: [], tickets }));
  return d;
}

test('build embeds drafts the page and the lander both read back', () => {
  const { html } = buildPage(draftsDir([ticket(9), ticket(3)]), TEMPLATE);
  const data = readPageData(html);
  assert.deepEqual(data.repos[0].tickets.map(t => t.n), [3, 9]);
  assert.ok(!html.includes('/*DATA*/null/*END*/'));
});

test('build refuses a draft without exactly one recommended option', () => {
  const bad = ticket(1); bad.options[1].recommended = true;
  assert.throws(() => buildPage(draftsDir([bad]), TEMPLATE), /2 recommended/);
});

test('queue carries a draft over only while the ticket is unchanged since drafting', () => {
  const data = { repos: [{ repo: REPO, tickets: [ticket(1), ticket(2)] }] };
  const q = n => ({ repository: { nameWithOwner: REPO }, number: n });
  const plan = planQueue(data, [
    { ...q(1), updatedAt: '2026-09-25T13:00:00Z' },   // untouched: keep
    { ...q(2), updatedAt: '2026-09-25T15:00:00Z' },   // commented on since: redraft
    { ...q(3), updatedAt: '2026-09-20T00:00:00Z' },   // new to the queue: draft
  ]);
  assert.deepEqual(plan.keep[REPO].map(t => t.n), [1]);
  assert.deepEqual(plan.toDraft[REPO], [2, 3]);
  assert.equal(plan.total, 3);
});

test('a wontfix pick closes as not planned and adds wontfix', () => {
  const p = planLanding(REPO, ticket(5), { choice: 'b', note: '' }, 's1', '2026-09-25');
  assert.equal(p.close, 'not planned');
  assert.deepEqual(p.addLabels, ['wontfix']);
  assert.deepEqual(p.removeLabels, ['ready-for-human']);
  assert.match(p.comment, /Not doing this\./);
  assert.ok(p.comment.startsWith(marker('s1', 'aac-routines~5')));
});

test('an Other pick needs judgment and carries the note verbatim', () => {
  const p = planLanding(REPO, ticket(5), { choice: 'other', note: 'Ask Rob first' }, 's1', '2026-09-25');
  assert.equal(p.needsJudgment, true);
  assert.match(p.comment, /> Ask Rob first/);
});

function fakeGh(state) {
  const calls = [];
  const run = args => {
    calls.push(args.join(' '));
    if (args[1] === 'view') return JSON.stringify({ comments: state.comments, labels: state.labels.map(name => ({ name })), state: state.state });
    if (args[1] === 'comment') state.comments.push({ body: fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8') });
    if (args[1] === 'edit') {
      const a = args.indexOf('--add-label'), r = args.indexOf('--remove-label');
      if (a > 0) state.labels.push(...args[a + 1].split(','));
      if (r > 0) state.labels = state.labels.filter(l => !args[r + 1].split(',').includes(l));
    }
    if (args[1] === 'close') state.state = 'CLOSED';
    return '';
  };
  return { run, calls };
}

test('landing a relabel pick comments, swaps labels, and verifies', () => {
  const state = { comments: [], labels: ['ready-for-human', 'enhancement'], state: 'OPEN' };
  const { run } = fakeGh(state);
  const p = planLanding(REPO, ticket(7), { choice: 'a', note: 'soon' }, 's1', '2026-09-25');
  const r = executeLanding(p, 's1', run);
  assert.equal(r.ok, true);
  assert.deepEqual(state.labels.sort(), ['enhancement', 'ready-for-agent']);
  assert.equal(state.comments.length, 1);
  assert.match(state.comments[0].body, /Owner's note: soon/);
});

test('re-running a landing does not repost the comment', () => {
  const state = { comments: [], labels: ['ready-for-human'], state: 'OPEN' };
  const { run, calls } = fakeGh(state);
  const p = planLanding(REPO, ticket(8), { choice: 'c', note: '' }, 's1', '2026-09-25');
  executeLanding(p, 's1', run);
  const r = executeLanding(p, 's1', run);
  assert.equal(state.comments.length, 1);
  assert.equal(calls.filter(c => c.startsWith('issue close')).length, 1);
  assert.equal(r.ok, true);
  assert.equal(r.closed, true);
});

test('bodies puts each ticket\'s GitHub text in its draft, cutting a very long one', () => {
  const dir = draftsDir([ticket(1), ticket(2)]);
  const run = args => JSON.stringify({ body: args[2] === '1' ? 'Short **body**' : 'x'.repeat(20000) });
  assert.equal(fillBodies(dir, run), 2);
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'aac-routines.json'), 'utf8'));
  assert.equal(j.tickets[0].body, 'Short **body**');
  assert.ok(j.tickets[1].body.length < 12100 && j.tickets[1].body.endsWith('the rest is on GitHub)'));
  const data = readPageData(buildPage(dir, TEMPLATE).html);
  assert.equal(data.repos[0].tickets[0].body, 'Short **body**');
});
