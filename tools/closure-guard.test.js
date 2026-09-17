#!/usr/bin/env node
/**
 * node --test tools/closure-guard.test.js
 *
 * Tests for tools/closure-guard.js (issue 475). The three cases the ticket's acceptance names are
 * each one test against a stubbed `gh` — an issue with an unticked box closed by a merged PR
 * carrying `Closes #N` is reopened with a comment naming the box and the PR; the same issue closed
 * by a person with a comment is not; an issue whose boxes are all ticked is not. The settle window
 * that keeps the guard from fighting the acceptance-box tick of issue 438, and the replay that
 * must write nothing, are the other two.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { closerOf, guardClose, reopenComment } = require('./closure-guard.js');

const SLUG = 'surreptakos/claude-dotfiles';
const ISSUE = 700;
const SHA = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c';

const OPEN_BOX = [
  '## What to build',
  '',
  'Something that needs a live run before anyone can claim it.',
  '',
  '## Acceptance criteria',
  '',
  '- [x] the script exists',
  '- [ ] the deploy is verified against the live board',
  '',
  '## Blocked by',
  '',
  '- [ ] not an acceptance box at all',
  '',
].join('\n');

const ALL_TICKED = OPEN_BOX.replace('- [ ] the deploy is verified', '- [x] the deploy is verified');

const PR = {
  number: 812,
  merged_at: '2026-09-16T10:00:00Z',
  html_url: 'https://github.com/' + SLUG + '/pull/812',
  title: 'feat: the thing',
  body: 'What changed.\n\nCloses #' + ISSUE,
};

const CLOSED_BY_COMMIT = [
  { event: 'labeled', label: { name: 'ready-for-agent' } },
  { event: 'closed', commit_id: SHA, actor: { login: 'surreptakos' }, created_at: '2026-09-16T10:00:03Z' },
];

const CLOSED_BY_PERSON = [
  { event: 'commented', actor: { login: 'surreptakos' } },
  { event: 'closed', commit_id: null, actor: { login: 'surreptakos' }, state_reason: 'completed', created_at: '2026-09-16T10:00:03Z' },
];

/**
 * A fake `gh`. `issueBodies` is read one entry per issue GET, the last entry repeating, so a body
 * the merge tick edits mid-settle can be handed back on the second read.
 */
function fakeGh(opts) {
  const state = { patches: [], comments: [], calls: [], reads: 0 };
  const bodies = opts.issueBodies;
  const issueState = opts.issueState || 'closed';
  function gh(args, input) {
    state.calls.push(args.join(' '));
    const key = args.join(' ');
    if (key === 'api repos/' + SLUG + '/issues/' + ISSUE) {
      const body = bodies[Math.min(state.reads, bodies.length - 1)];
      state.reads += 1;
      return JSON.stringify({ number: ISSUE, state: issueState, state_reason: opts.stateReason || null, labels: opts.labels || [], body });
    }
    if (key === 'api repos/' + SLUG + '/issues/' + ISSUE + '/timeline?per_page=100&page=1') {
      return JSON.stringify(opts.events);
    }
    if (key === 'api repos/' + SLUG + '/commits/' + SHA + '/pulls?per_page=20') {
      return JSON.stringify(opts.pulls == null ? [PR] : opts.pulls);
    }
    if (key === 'api --method PATCH repos/' + SLUG + '/issues/' + ISSUE + ' --input -') {
      state.patches.push(JSON.parse(input));
      return '{}';
    }
    if (key === 'api --method POST repos/' + SLUG + '/issues/' + ISSUE + '/comments --input -') {
      state.comments.push(JSON.parse(input).body);
      return '{}';
    }
    throw new Error('fake gh: unexpected call ' + key);
  }
  return { gh, state };
}

/** A clock the settle window can run out on without the test taking three real minutes. */
function fakeClock() {
  const c = { t: 0 };
  return { now: () => c.t, sleep: (ms) => { c.t += ms; } };
}

function run(fake, extra) {
  const clock = fakeClock();
  return guardClose(ISSUE, Object.assign({
    slug: SLUG, apply: true, runGh: fake.gh, now: clock.now, sleep: clock.sleep, settleMs: 25, pollMs: 10,
  }, extra || {}));
}

// ---- case 1: unticked box + closed by a merged PR carrying `Closes #N` -> reopened -------------

test('an unticked acceptance box closed by a merged PR is reopened, naming the box and the PR', () => {
  const fake = fakeGh({ issueBodies: [OPEN_BOX], events: CLOSED_BY_COMMIT });
  const res = run(fake);
  assert.equal(res.action, 'reopened');
  assert.deepEqual(res.boxes, ['the deploy is verified against the live board']);
  assert.equal(res.pr.number, 812);
  // The reopen itself, and nothing else patched.
  assert.deepEqual(fake.state.patches, [{ state: 'open', state_reason: 'reopened' }]);
  // One comment, naming the box and the PR.
  assert.equal(fake.state.comments.length, 1);
  assert.ok(fake.state.comments[0].includes('the deploy is verified against the live board'));
  assert.ok(fake.state.comments[0].includes('PR #812'));
  assert.ok(fake.state.comments[0].includes('https://github.com/' + SLUG + '/pull/812'));
  // The box under `## Blocked by` is outside the acceptance scope, so it is not grounds to reopen
  // and must not be quoted as one.
  assert.ok(!fake.state.comments[0].includes('not an acceptance box at all'));
});

// ---- case 2: the same issue, closed by a person with a comment -> left alone --------------------

test('the same issue closed by a person with a comment is not reopened', () => {
  const fake = fakeGh({ issueBodies: [OPEN_BOX], events: CLOSED_BY_PERSON });
  const res = run(fake);
  assert.equal(res.action, 'left-alone');
  assert.match(res.reason, /closed by @surreptakos, not by a commit/);
  assert.deepEqual(fake.state.patches, []);
  assert.deepEqual(fake.state.comments, []);
});

// ---- case 3: every box ticked, closed by a PR -> left alone ------------------------------------

test('an issue with all boxes ticked, closed by a PR, is not reopened', () => {
  const fake = fakeGh({ issueBodies: [ALL_TICKED], events: CLOSED_BY_COMMIT });
  const res = run(fake);
  assert.equal(res.action, 'left-alone');
  assert.match(res.reason, /no unticked acceptance box/);
  assert.deepEqual(fake.state.patches, []);
  assert.deepEqual(fake.state.comments, []);
});

// ---- the settle window: the merge's own acceptance-box tick (issue 438) wins its merges --------

test('a tick landing inside the settle window stands the guard down', () => {
  // First read: still unticked, the way the body looks the instant the merge closed the issue.
  // Second read: `tools/tick-acceptance-boxes.js` has ticked it from the same merge.
  const fake = fakeGh({ issueBodies: [OPEN_BOX, ALL_TICKED], events: CLOSED_BY_COMMIT });
  const res = run(fake);
  assert.equal(res.action, 'left-alone');
  assert.match(res.reason, /ticked by the merge tick/);
  assert.deepEqual(fake.state.patches, []);
  assert.deepEqual(fake.state.comments, []);
});

test('a commit with no pull request is judged at once — no tick can be coming', () => {
  const fake = fakeGh({ issueBodies: [OPEN_BOX], events: CLOSED_BY_COMMIT, pulls: [] });
  const res = run(fake);
  assert.equal(res.action, 'reopened');
  assert.equal(res.pr, null);
  assert.equal(fake.state.reads, 1, 'the settle window must be skipped when no PR closed the issue');
  assert.ok(fake.state.comments[0].includes('commit ' + SHA.slice(0, 12)));
});

// ---- replay, exemptions, and the dry run -------------------------------------------------------

test('an already-open issue, a wontfix and a not_planned close are all left alone, and --apply is required to write', () => {
  const open = fakeGh({ issueBodies: [OPEN_BOX], events: CLOSED_BY_COMMIT, issueState: 'open' });
  assert.match(run(open).reason, /is open — nothing to reopen/);
  assert.deepEqual(open.state.patches, []);

  const wontfix = fakeGh({ issueBodies: [OPEN_BOX], events: CLOSED_BY_COMMIT, labels: [{ name: 'wontfix' }] });
  assert.match(run(wontfix).reason, /wontfix/);

  const dropped = fakeGh({ issueBodies: [OPEN_BOX], events: CLOSED_BY_COMMIT, stateReason: 'not_planned' });
  assert.match(run(dropped).reason, /closed as not_planned/);

  const dry = fakeGh({ issueBodies: [OPEN_BOX], events: CLOSED_BY_COMMIT });
  const res = run(dry, { apply: false });
  assert.equal(res.action, 'would-reopen');
  assert.deepEqual(dry.state.patches, []);
  assert.deepEqual(dry.state.comments, []);
});

// ---- the pure halves ---------------------------------------------------------------------------

test('closerOf reads the LAST close, and tells a commit close from a person one', () => {
  assert.equal(closerOf([]), null);
  assert.equal(closerOf(CLOSED_BY_PERSON).byCommit, false);
  assert.equal(closerOf(CLOSED_BY_COMMIT).commit, SHA);
  // Closed by a person, reopened, then closed by a commit: the close that stands is the commit's.
  const twice = CLOSED_BY_PERSON.concat([{ event: 'reopened' }], CLOSED_BY_COMMIT);
  assert.equal(closerOf(twice).commit, SHA);
});

test('reopenComment names a bare commit when there is no PR, and never un-ticks anything', () => {
  const c = reopenComment({ boxes: ['a live run'], pr: null, commit: SHA });
  assert.ok(c.includes('commit ' + SHA.slice(0, 12)));
  assert.ok(c.includes('- [ ] a live run'));
  assert.ok(/nothing was un-ticked/i.test(c));
});
