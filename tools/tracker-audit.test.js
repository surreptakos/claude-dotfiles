#!/usr/bin/env node
/**
 * node --test tools/tracker-audit.test.js
 *
 * Pin the REST-parsing normalizers (issue 130). The audit used to shell out to `gh issue list
 * --json` and `gh pr list --json`, which sit on GraphQL and 403 in a Claude-Code cloud
 * container. It now walks REST `/issues`, `/pulls` and `/issues/comments`, and the pure
 * helpers below turn those payloads into the same shape the checks read.
 *
 * The REST /issues endpoint returns pull requests too (each row carries a `pull_request`
 * object); GraphQL's issue list did not. `issuesOnly` filters PRs out — a regression there
 * would silently double-count every PR as an open issue and every check downstream would
 * shift. `closerPrsByIssue` rebuilds the GraphQL `closedByPullRequestsReferences` link by
 * scanning PR titles/bodies for closing keywords (Fixes/Closes/Resolves #N), the same way
 * GitHub populates its own "linked issues" panel. Without that map the follow-up
 * acknowledgment path in the stale-premise? check crosses from 19 findings to 38 on a live
 * repo (measured on surreptakos/claude-dotfiles, 2026-09-12), because every follow-up ticket
 * that names its closer PR reads as an unacknowledged assertion.
 *
 * All pure — no `gh`, no network, no process exits — so a change to a normalizer fails a
 * test rather than a live run.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  normalizeIssue,
  normalizePr,
  issuesOnly,
  closerPrsByIssue,
  parseGithubSlug,
  isFollowUpAcknowledgment,
  citedIssueNumbers,
} = require('./tracker-audit.js');

// ---- issuesOnly: the PR-vs-issue filter -----------------------------------

test('issuesOnly drops rows carrying pull_request (a REST /issues quirk that GraphQL never had)', () => {
  const rows = [
    { number: 1, title: 'a real issue', state: 'open' },
    { number: 2, title: 'a PR', state: 'open', pull_request: { url: 'https://api.github.com/pulls/2' } },
    { number: 3, title: 'another issue', state: 'closed' },
  ];
  const kept = issuesOnly(rows);
  assert.deepStrictEqual(kept.map((r) => r.number), [1, 3]);
});

test('issuesOnly tolerates null / non-array input', () => {
  assert.deepStrictEqual(issuesOnly(null), []);
  assert.deepStrictEqual(issuesOnly(undefined), []);
  assert.deepStrictEqual(issuesOnly([null, { number: 4 }]), [{ number: 4 }]);
});

// ---- normalizeIssue: REST -> internal shape -------------------------------

test('normalizeIssue upcases state, maps html_url, wraps milestone, and zeroes the GraphQL-only fields', () => {
  const raw = {
    number: 42,
    title: 'live one',
    state: 'open',
    body: 'body text',
    labels: [{ name: 'bug' }, 'ready-for-agent'],
    html_url: 'https://github.com/o/r/issues/42',
    milestone: { title: 'M1', number: 3 },
    pull_request: undefined,
  };
  const i = normalizeIssue(raw);
  assert.strictEqual(i.number, 42);
  assert.strictEqual(i.title, 'live one');
  assert.strictEqual(i.state, 'OPEN');
  assert.strictEqual(i.body, 'body text');
  assert.deepStrictEqual(i.labels, [{ name: 'bug' }, { name: 'ready-for-agent' }]);
  assert.strictEqual(i.url, 'https://github.com/o/r/issues/42');
  assert.deepStrictEqual(i.milestone, { title: 'M1' });
  assert.deepStrictEqual(i.projectItems, []);
  assert.deepStrictEqual(i.closedByPullRequestsReferences, []);
});

test('normalizeIssue: empty milestone becomes null; missing body becomes empty string', () => {
  const i = normalizeIssue({ number: 5, title: 't', state: 'closed', labels: [], html_url: 'u', milestone: null });
  assert.strictEqual(i.state, 'CLOSED');
  assert.strictEqual(i.milestone, null);
  assert.strictEqual(i.body, '');
});

// ---- normalizePr: REST -> internal shape ----------------------------------

test('normalizePr upcases state and preserves body for closer-scanning', () => {
  const p = normalizePr({
    number: 77,
    title: 'fix: something',
    state: 'closed',
    body: 'Fixes #12 and part of #33',
    html_url: 'https://github.com/o/r/pull/77',
  });
  assert.deepStrictEqual(p, {
    number: 77,
    title: 'fix: something',
    state: 'CLOSED',
    body: 'Fixes #12 and part of #33',
    url: 'https://github.com/o/r/pull/77',
    comments: [],
  });
});

// ---- closerPrsByIssue: rebuild closedByPullRequestsReferences from PR text ----

test('closerPrsByIssue picks up Fixes/Closes/Resolves in body and title, ignores bare mentions', () => {
  const prs = [
    { number: 10, title: 'Fix crash', body: 'Fixes #100\nRelated: #99' },
    { number: 11, title: 'closes #100 too', body: '' },
    { number: 12, title: 'unrelated', body: 'refs #100 without a keyword' },
    { number: 13, title: 't', body: 'resolves #200' },
  ];
  const m = closerPrsByIssue(prs);
  assert.deepStrictEqual(m.get(100), [{ number: 10 }, { number: 11 }]);
  assert.deepStrictEqual(m.get(200), [{ number: 13 }]);
  assert.ok(!m.has(99), 'bare "Related: #99" is not a closer');
});

test('closerPrsByIssue is case-insensitive and handles multiple closes in one PR', () => {
  const prs = [{ number: 20, title: 'CLOSES #1, fix #2, Resolved #3', body: '' }];
  const m = closerPrsByIssue(prs);
  assert.deepStrictEqual(m.get(1), [{ number: 20 }]);
  assert.deepStrictEqual(m.get(2), [{ number: 20 }]);
  assert.deepStrictEqual(m.get(3), [{ number: 20 }]);
});

test('closerPrsByIssue sorts PR numbers and dedupes', () => {
  const prs = [
    { number: 30, title: '', body: 'Fixes #7' },
    { number: 5, title: '', body: 'closes #7' },
    { number: 5, title: '', body: 'closes #7 fixes #7' },  // same PR, same issue
  ];
  const refs = closerPrsByIssue(prs).get(7);
  assert.deepStrictEqual(refs, [{ number: 5 }, { number: 30 }]);
});

test('closerPrsByIssue returns an empty map for empty / null input', () => {
  assert.strictEqual(closerPrsByIssue([]).size, 0);
  assert.strictEqual(closerPrsByIssue(null).size, 0);
});

// ---- parseGithubSlug: origin -> owner/name --------------------------------

test('parseGithubSlug handles https, git@, .git suffix, trailing slash', () => {
  const cases = [
    ['https://github.com/foo/bar.git', { owner: 'foo', name: 'bar' }],
    ['https://github.com/foo/bar/',    { owner: 'foo', name: 'bar' }],
    ['git@github.com:foo/bar.git',     { owner: 'foo', name: 'bar' }],
    ['ssh://git@github.com/foo/bar',   { owner: 'foo', name: 'bar' }],
  ];
  for (const [url, want] of cases) assert.deepStrictEqual(parseGithubSlug(url), want, url);
});

test('parseGithubSlug returns null for non-github or garbage', () => {
  assert.strictEqual(parseGithubSlug(''), null);
  assert.strictEqual(parseGithubSlug('https://gitlab.com/x/y'), null);
  assert.strictEqual(parseGithubSlug(null), null);
});

// ---- isFollowUpAcknowledgment: unchanged by the port, pinned here so the shape ----
// ---- the REST path feeds it (numeric PR list) still counts. ---------------

test('isFollowUpAcknowledgment: PR number list is accepted from REST-derived closerPrsByIssue', () => {
  // A body that references the closer PR by number is an acknowledgment. REST derives closer PR
  // numbers via closerPrsByIssue above, so the shape passed in is [{number: N}, ...] mapped to
  // [N, ...] by the audit before calling this — the same integer list the GraphQL path used.
  const body = 'Follow-up to work in PR #77.';
  assert.strictEqual(isFollowUpAcknowledgment(body, 42, [77]), true);
  assert.strictEqual(isFollowUpAcknowledgment(body, 42, [999]), false);
});

// ---- citedIssueNumbers: what the stale-premise? check counts as a citation --------
// ---- of THIS repo's issue. Measured 2026-09-14: 16 of 29 advisories on this ------
// ---- repo came from cross-repo tails and hex colours read as bare #N. -----------

test('citedIssueNumbers: bare #N tokens only, first offset kept', () => {
  const body = 'See #12 and then #12 again; also #7.';
  const got = citedIssueNumbers(body);
  assert.deepStrictEqual(Array.from(got.keys()), [12, 7]);
  assert.strictEqual(got.get(12), body.indexOf('#12'));
  assert.strictEqual(got.get(7), body.indexOf('#7'));
});

test('citedIssueNumbers: a qualified cross-repo reference is not this repo\'s issue', () => {
  const body = 'Blocked on surreptakos/aac-contract-builder#157 and `surreptakos/aac-sales-cockpit#60`.';
  assert.deepStrictEqual(Array.from(citedIssueNumbers(body).keys()), []);
});

test('citedIssueNumbers: hex colours and longer numbers are not citations', () => {
  // `#9a690f` used to read as #9, `#1f7a43` as #1, and `#730` as #73 via indexOf.
  const body = 'Contrast on `#9a690f` and `#1f7a43`; see #730 for the real one.';
  assert.deepStrictEqual(Array.from(citedIssueNumbers(body).keys()), [730]);
});
