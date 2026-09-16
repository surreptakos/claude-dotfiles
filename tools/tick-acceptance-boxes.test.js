#!/usr/bin/env node
/**
 * node --test tools/tick-acceptance-boxes.test.js
 *
 * Tests for tools/tick-acceptance-boxes.js (issue 438). The pure halves — which closing
 * keywords name an issue in THIS repo, and which boxes are in the acceptance scope — are
 * exercised directly, including the parity assertion that matters: after a tick,
 * `untickedBoxes(body).hard` from tools/tracker-audit.js is empty, so the audit finding this
 * script exists to stop really is gone. `tickForPr` runs end to end against an in-process fake
 * `gh`, so the read path, the body PATCH and the comment POST are all under test.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { closingRefs, tickAcceptanceBoxes, tickForPr, repoSlug } = require('./tick-acceptance-boxes.js');
const { untickedBoxes } = require('./tracker-audit.js');

const TICKET = [
  '## What happens',
  '',
  'A delivered ticket closes with its boxes unticked.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] `node tools/tracker-audit.js` reaches a verdict',
  '- [x] already done earlier',
  '- [ ] the workflow exists',
  '',
  '## Blocked by',
  '',
  '- [ ] not an acceptance box at all',
  '',
].join('\n');

function makeFakeGh(canned) {
  const calls = [];
  function runGh(args, input) {
    calls.push({ args: args.slice(), input });
    const key = JSON.stringify(args);
    if (!(key in canned)) throw new Error('fake gh: unexpected call ' + key);
    const val = canned[key];
    if (typeof val === 'function') return val(args, input);
    return val;
  }
  runGh.calls = calls;
  return runGh;
}

// ---- closingRefs: only what GitHub itself would close, and only in this repo ---------------

test('closingRefs takes closing keywords and ignores Refs and cross-repo refs', () => {
  const body = 'Closes #438. Fixes #12, resolved #7.\nRefs #99.\nCloses surreptakos/aac-routines#264.';
  assert.deepEqual(closingRefs(body), [438, 12, 7]);
});

// ---- tickAcceptanceBoxes: the audit's scope, and nothing wider ----------------------------

test('only unticked boxes under the acceptance heading are ticked, each naming the PR', () => {
  const { body, ticked } = tickAcceptanceBoxes(TICKET, 'verified in PR #451');
  assert.deepEqual(ticked, ['`node tools/tracker-audit.js` reaches a verdict', 'the workflow exists']);
  assert.ok(body.includes('- [x] `node tools/tracker-audit.js` reaches a verdict — verified in PR #451'));
  assert.ok(body.includes('- [x] the workflow exists — verified in PR #451'));
  // Untouched: the already-ticked box keeps its text, and the box under `## Blocked by` is
  // outside the acceptance scope, so the audit never reported it and this must not claim it.
  assert.ok(body.includes('- [x] already done earlier\n'));
  assert.ok(body.includes('- [ ] not an acceptance box at all'));
  // Parity with the check this exists to clear.
  assert.deepEqual(untickedBoxes(body).hard, []);
});

test('a body with nothing left to tick is returned byte-identical (idempotent replay)', () => {
  const once = tickAcceptanceBoxes(TICKET, 'verified in PR #451').body;
  const twice = tickAcceptanceBoxes(once, 'verified in PR #451');
  assert.deepEqual(twice.ticked, []);
  assert.equal(twice.body, once);
});

test('a CRLF body stays CRLF', () => {
  const crlf = TICKET.replace(/\n/g, '\r\n');
  const { body, ticked } = tickAcceptanceBoxes(crlf, 'verified in PR #451');
  assert.equal(ticked.length, 2);
  assert.ok(body.includes('- [x] the workflow exists — verified in PR #451\r\n'));
  assert.ok(!/[^\r]\n/.test(body));
});

// ---- tickForPr: read, PATCH, comment, against a fake gh -----------------------------------

const SLUG = 'surreptakos/claude-dotfiles';
const MERGED_PR = { number: 451, merged: true, html_url: 'https://github.com/' + SLUG + '/pull/451', title: 'fix: something (#438)', body: 'What changed.\n\nCloses #438' };

function fakeForTick(prPayload) {
  const writes = [];
  const comments = [];
  const canned = {};
  canned[JSON.stringify(['api', 'repos/' + SLUG + '/pulls/451'])] = JSON.stringify(prPayload);
  canned[JSON.stringify(['api', 'repos/' + SLUG + '/issues/438'])] = JSON.stringify({ number: 438, state: 'closed', body: TICKET });
  canned[JSON.stringify(['api', '--method', 'PATCH', 'repos/' + SLUG + '/issues/438', '--input', '-'])] = (args, input) => { writes.push(JSON.parse(input).body); return '{}'; };
  canned[JSON.stringify(['api', '--method', 'POST', 'repos/' + SLUG + '/issues/438/comments', '--input', '-'])] = (args, input) => { comments.push(JSON.parse(input).body); return '{}'; };
  return { gh: makeFakeGh(canned), writes, comments };
}

test('a merged PR patches the issue body and records the tick in a comment', () => {
  const { gh, writes, comments } = fakeForTick(MERGED_PR);
  const res = tickForPr(451, { slug: SLUG, apply: true, runGh: gh });
  assert.deepEqual(res.results.map((r) => [r.issue, r.wrote, r.ticked.length]), [[438, true, 2]]);
  assert.equal(writes.length, 1);
  assert.deepEqual(untickedBoxes(writes[0]).hard, []);
  assert.equal(comments.length, 1);
  assert.ok(comments[0].includes('PR #451'));
  assert.ok(comments[0].includes('- the workflow exists'));
});

test('opts.issues back-fills a ticket whose verifying PR wrote Refs, not Closes', () => {
  // Issue 364's shape: closed by hand as already-fixed, and the PR that carried the fix (#372)
  // referenced it without a closing keyword, so there is nothing for closingRefs to find.
  const refsOnly = Object.assign({}, MERGED_PR, { title: 'fix: something', body: 'Refs #438' });
  const plain = fakeForTick(refsOnly);
  assert.deepEqual(tickForPr(451, { slug: SLUG, apply: true, runGh: plain.gh }).results, []);
  assert.equal(plain.writes.length, 0);

  const forced = fakeForTick(refsOnly);
  const res = tickForPr(451, { slug: SLUG, apply: true, runGh: forced.gh, issues: [438] });
  assert.deepEqual(res.results.map((r) => [r.issue, r.wrote]), [[438, true]]);
  assert.equal(forced.writes.length, 1);
});

// ---- repoSlug: the by-hand back-fill has no GITHUB_REPOSITORY to read ----------------------

test('repoSlug falls back to the origin remote, whose trailing newline must not defeat it', () => {
  assert.equal(repoSlug({ GITHUB_REPOSITORY: 'surreptakos/claude-dotfiles' }), 'surreptakos/claude-dotfiles');
  // No env: read this checkout's own remote. `parseGithubSlug` is `$`-anchored with no `m` flag,
  // so an untrimmed remote parses as nothing and every by-hand `--pr` run dies on it.
  assert.match(repoSlug({}), /^[^/\s]+\/[^/\s]+$/);
});

test('without --apply nothing is written, and an unmerged PR claims nothing', () => {
  const dry = fakeForTick(MERGED_PR);
  const res = tickForPr(451, { slug: SLUG, runGh: dry.gh });
  assert.equal(res.results[0].ticked.length, 2);
  assert.equal(dry.writes.length, 0);
  assert.equal(dry.comments.length, 0);

  const open = fakeForTick(Object.assign({}, MERGED_PR, { merged: false, merged_at: null }));
  const res2 = tickForPr(451, { slug: SLUG, apply: true, runGh: open.gh });
  assert.match(res2.skipped, /not merged/);
  assert.deepEqual(res2.results, []);
  assert.equal(open.writes.length, 0);
});
