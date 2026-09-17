#!/usr/bin/env node
/**
 * node --test tools/issue-metadata-audit.test.js
 *
 * Tests for tools/issue-metadata-audit.js (issue 472) — the three cases the workflow exists for,
 * each end to end through `auditTracker` against an in-process fake `gh`, so the read path, the
 * body PATCH, the milestone PATCH and the comment POST are all under test:
 *
 *   1. a prose-bullet acceptance section becomes `- [ ]` boxes, with one comment;
 *   2. an un-milestoned issue is assigned the single open milestone — and with several open
 *      milestones gets one comment naming them and no other write;
 *   3. a fully-ticked open ledger gets exactly one comment and is not closed.
 *
 * Plus the invariant that makes an every-issue-edit workflow safe: a second run over the tracker
 * the first run left behind writes nothing at all.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  MARKERS, ledgerState, convertProseBullets, milestonePlan, auditTracker,
} = require('./issue-metadata-audit.js');

const SLUG = 'surreptakos/claude-dotfiles';

const PROSE = [
  '## What to build',
  '',
  'Something.',
  '',
  '## Acceptance criteria',
  '',
  '- the workflow exists',
  '- the script has tests',
  '  - a nested note, which is not a criterion',
  '',
  '## Non-goals',
  '',
  '- not this',
  '',
].join('\n');

const TICKED = [
  '## Acceptance criteria',
  '',
  '- [x] shipped',
  '- [x] verified in PR #451',
  '',
].join('\n');

const OPEN_LEDGER = [
  '## Acceptance criteria',
  '',
  '- [x] shipped',
  '- [ ] still to do',
  '',
].join('\n');

/**
 * A fake tracker: milestones, issues (number -> {body, milestone}) and the comments each issue
 * already carries. Serves the same `gh api` argv the script builds, and records every write, so
 * "makes no edits and posts no comments" is an assertion about the recorded writes rather than
 * about stdout.
 */
function fakeTracker(state) {
  const patches = [];
  const comments = [];
  function runGh(args, input) {
    const a = args.join(' ');
    if (a === 'api repos/' + SLUG + '/milestones?state=open&per_page=100') {
      return JSON.stringify(state.milestones);
    }
    let m = /^api repos\/[^ ]+\/issues\?state=open&per_page=100&page=(\d+)$/.exec(a);
    if (m) {
      return Number(m[1]) === 1
        ? JSON.stringify(Object.keys(state.issues).map((n) => Object.assign({ number: Number(n) }, state.issues[n])))
        : '[]';
    }
    m = /^api repos\/[^ ]+\/issues\/(\d+)\/comments\?per_page=100$/.exec(a);
    if (m) return JSON.stringify((state.comments[m[1]] || []).map((body) => ({ body })));
    m = /^api --method PATCH repos\/[^ ]+\/issues\/(\d+) --input -$/.exec(a);
    if (m) {
      const patch = JSON.parse(input);
      patches.push({ issue: Number(m[1]), patch });
      Object.assign(state.issues[m[1]], patch);
      return '{}';
    }
    m = /^api --method POST repos\/[^ ]+\/issues\/(\d+)\/comments --input -$/.exec(a);
    if (m) {
      const body = JSON.parse(input).body;
      comments.push({ issue: Number(m[1]), body });
      (state.comments[m[1]] = state.comments[m[1]] || []).push(body);
      return '{}';
    }
    throw new Error('fake gh: unexpected call ' + a);
  }
  return { runGh, patches, comments, state };
}

// ---- 1. prose bullets under an acceptance heading become unchecked boxes -------------------

test('prose bullets under the acceptance heading become `- [ ]`, and only those', () => {
  const t = fakeTracker({
    milestones: [{ number: 4, title: 'Milestone 4 — Harness', state: 'open' }],
    issues: { 500: { body: PROSE, milestone: { number: 4 } } },
    comments: {},
  });
  const res = auditTracker({ slug: SLUG, apply: true, runGh: t.runGh });
  assert.deepEqual(res.issues.map((r) => r.number), [500]);
  const body = t.patches[0].patch.body;
  assert.ok(body.includes('- [ ] the workflow exists'));
  assert.ok(body.includes('- [ ] the script has tests'));
  // An indented bullet is the box above it explaining itself, and `## Non-goals` is prose by
  // design — inventing acceptance criteria out of either is the expensive mistake here.
  assert.ok(body.includes('  - a nested note, which is not a criterion'));
  assert.ok(body.includes('\n- not this'));
  assert.equal(ledgerState(body), 'open');
  assert.equal(t.comments.length, 1);
  assert.ok(t.comments[0].body.includes(MARKERS.converted));
});

// ---- 2. the milestone half: one open milestone assigns, several only comment ----------------

test('an un-milestoned issue is assigned the single open milestone', () => {
  const t = fakeTracker({
    milestones: [{ number: 4, title: 'Milestone 4 — Harness', state: 'open' }],
    issues: { 501: { body: OPEN_LEDGER, milestone: null } },
    comments: {},
  });
  auditTracker({ slug: SLUG, apply: true, runGh: t.runGh });
  assert.deepEqual(t.patches, [{ issue: 501, patch: { milestone: 4 } }]);
  assert.equal(t.comments.length, 0);
});

test('with several open milestones: one comment naming them, and no other change', () => {
  const t = fakeTracker({
    milestones: [
      { number: 4, title: 'Milestone 4 — Harness', state: 'open' },
      { number: 5, title: 'Milestone 5 — Skills', state: 'open' },
    ],
    issues: { 502: { body: OPEN_LEDGER, milestone: null } },
    comments: {},
  });
  auditTracker({ slug: SLUG, apply: true, runGh: t.runGh });
  assert.deepEqual(t.patches, []);
  assert.equal(t.comments.length, 1);
  assert.ok(t.comments[0].body.includes(MARKERS.ambiguous));
  assert.ok(t.comments[0].body.includes('Milestone 4 — Harness (milestone 4)'));
  assert.ok(t.comments[0].body.includes('Milestone 5 — Skills (milestone 5)'));
  // A repo that does not use milestones at all is not nagged.
  assert.deepEqual(milestonePlan({ milestone: null }, []), { action: 'none', why: 'repo has no open milestone' });
});

// ---- 3. a fully-ticked open ledger: exactly one comment, and it stays open ------------------

test('a fully-ticked open ledger gets exactly one comment and is never closed', () => {
  const t = fakeTracker({
    milestones: [{ number: 4, title: 'Milestone 4 — Harness', state: 'open' }],
    issues: { 503: { body: TICKED, milestone: { number: 4 } } },
    comments: {},
  });
  auditTracker({ slug: SLUG, apply: true, runGh: t.runGh });
  assert.equal(t.comments.length, 1);
  assert.ok(t.comments[0].body.includes(MARKERS.delivered));
  // No PATCH at all: no state change, no body rewrite. Closing is a reader's call.
  assert.deepEqual(t.patches, []);
  assert.equal(t.state.issues[503].state, undefined);
});

// ---- the invariant behind running on every issue edit ---------------------------------------

test('a second run over the tracker the first left behind writes nothing', () => {
  const state = {
    milestones: [
      { number: 4, title: 'Milestone 4 — Harness', state: 'open' },
      { number: 5, title: 'Milestone 5 — Skills', state: 'open' },
    ],
    issues: {
      510: { body: PROSE, milestone: { number: 4 } },
      511: { body: TICKED, milestone: { number: 4 } },
      512: { body: OPEN_LEDGER, milestone: null },
    },
    comments: {},
  };
  const first = fakeTracker(state);
  auditTracker({ slug: SLUG, apply: true, runGh: first.runGh });
  assert.ok(first.patches.length > 0 && first.comments.length > 0);

  const second = fakeTracker(state);
  const res = auditTracker({ slug: SLUG, apply: true, runGh: second.runGh });
  assert.deepEqual(second.patches, []);
  assert.deepEqual(second.comments, []);
  assert.equal(res.writes, 0);
});

test('without --apply nothing is written, and a CRLF body stays CRLF when converted', () => {
  const t = fakeTracker({
    milestones: [{ number: 4, title: 'Milestone 4 — Harness', state: 'open' }],
    issues: { 520: { body: PROSE, milestone: null } },
    comments: {},
  });
  const res = auditTracker({ slug: SLUG, runGh: t.runGh });
  assert.equal(res.writes, 0);
  assert.deepEqual(t.patches, []);
  assert.deepEqual(t.comments, []);

  const { body, converted } = convertProseBullets(PROSE.replace(/\n/g, '\r\n'));
  assert.equal(converted.length, 2);
  assert.ok(!/[^\r]\n/.test(body));
});
