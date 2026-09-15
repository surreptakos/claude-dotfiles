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
  paginate,
  parseLinkHeader,
  pageFromUrl,
  isShortFetch,
  fetchCommentRows,
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

// ---- paginate: the page loop replacing `gh api --paginate` (issue 171) -----

test('paginate concatenates a full first page and a short second page, then stops', () => {
  // The realistic case in a cloud container: a repo passed 100 issues, page 1 is exactly 100 rows
  // and page 2 is the tail. `gh api --paginate` used to follow GitHub's Link header, which points
  // at /repositories/{id}/... — the cloud egress proxy 403s that form. This loop pages by hand
  // against repos/{owner}/{repo}, so paging must not depend on any Link header. Two pages, in a
  // spy: fetch is called with 1 then 2, and the loop stops without a call for 3.
  const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
  const page2 = [{ number: 101 }, { number: 102 }, { number: 103 }];
  const calls = [];
  const fetchPage = (page) => {
    calls.push(page);
    if (page === 1) return page1;
    if (page === 2) return page2;
    throw new Error('paginate walked past the short page: called for page ' + page);
  };
  const all = paginate(fetchPage);
  assert.deepStrictEqual(calls, [1, 2]);
  assert.strictEqual(all.length, 103);
  assert.strictEqual(all[0].number, 1);
  assert.strictEqual(all[99].number, 100);
  assert.strictEqual(all[102].number, 103);
});

test('paginate stops on an empty page (exact multiple of 100)', () => {
  // The other end of the short-page rule: an endpoint whose row count is a clean multiple of 100
  // returns [] on the next page. The loop must treat that as the end, not a "throw non-array".
  const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
  const calls = [];
  const fetchPage = (page) => {
    calls.push(page);
    if (page === 1) return page1;
    if (page === 2) return [];
    throw new Error('paginate walked past the empty page: called for page ' + page);
  };
  const all = paginate(fetchPage);
  assert.deepStrictEqual(calls, [1, 2]);
  assert.strictEqual(all.length, 100);
});

test('paginate throws when a fetcher returns a non-array', () => {
  // GitHub returns an object with `message` on an error rather than an array — the audit must
  // exit 2 (via cannotAudit) rather than silently accept a page of zero rows.
  const fetchPage = () => ({ message: 'Not Found' });
  assert.throws(() => paginate(fetchPage), /non-array page 1/);
});

// ---- issue 230: short page with rel="next" is a silent-drop, not the end ---------------
// Reproduces the 2026-09-15 15:06 run that reported #45/#85/#106/#109/#114/#88/#121/#44/
// #74–#77 as dangling references when every one of those numbers existed. The root cause
// was a page returning fewer than 100 rows while the Link header still carried rel="next"
// — paginate's row-count end-of-stream heuristic swallowed the short page, and the tail
// (dominated by CLOSED issues on this repo) never reached the known-number set that the
// dangling-reference check reads. With Link info exposed, paginate now throws
// short-fetch: and ghPaginate turns that into cannotAudit (exit 2) rather than a false
// dangling-reference finding.

test('paginate throws short-fetch when page 2 is short AND Link header carries rel="next"', () => {
  // Simulates the observed failure: repo has more than 100 issues, page 1 returns a full
  // 100 rows with rel="next", page 2 returns 47 rows (short) but STILL carries rel="next"
  // — GitHub is telling us more pages exist. Paginate must not treat the short page as
  // end-of-stream; the closed-issue tail past this page is what produced the false
  // dangling references. Ground truth is open + closed count, which rel="next" proves is
  // strictly greater than what we fetched.
  const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
  const page2 = Array.from({ length: 47 }, (_, i) => ({ number: 101 + i }));
  const calls = [];
  const fetchPage = (page) => {
    calls.push(page);
    if (page === 1) return { rows: page1, hasNext: true, lastPage: null };
    if (page === 2) return { rows: page2, hasNext: true, lastPage: null };
    throw new Error('paginate walked past the short-fetch trap: called for page ' + page);
  };
  assert.throws(() => paginate(fetchPage), (err) => {
    assert.match(err.message, /^short-fetch:/);
    assert.match(err.message, /page 2/);
    assert.match(err.message, /147/);          // fetched count
    assert.match(err.message, /rel="next"/);
    return true;
  });
  assert.deepStrictEqual(calls, [1, 2]);
});

test('paginate short page WITHOUT rel="next" is a genuine end-of-stream, no throw', () => {
  // The negative control: 103 issues total, page 1 is 100 with rel="next", page 2 is 3
  // rows and Link carries no rel="next" — the walk is over. Paginate must return cleanly.
  const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
  const page2 = [{ number: 101 }, { number: 102 }, { number: 103 }];
  const fetchPage = (page) => {
    if (page === 1) return { rows: page1, hasNext: true, lastPage: null };
    if (page === 2) return { rows: page2, hasNext: false, lastPage: null };
    throw new Error('should have stopped');
  };
  const all = paginate(fetchPage);
  assert.strictEqual(all.length, 103);
});

test('paginate throws short-fetch on the 200-page cap when rel="next" is still set', () => {
  // The safety cap is a bound on the loop, not on the tracker. If we walk 200 full pages
  // and GitHub still says there are more, the cap has silently truncated the fetch — same
  // shape of drift as a short page mid-stream, same fix.
  const fullPage = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
  const fetchPage = () => ({ rows: fullPage, hasNext: true, lastPage: 250 });
  assert.throws(() => paginate(fetchPage), /200-page safety cap.*rel="next"/);
});

test('paginate short-fetch names the open+closed count when Link carries rel="last"', () => {
  // Offset-paginated endpoints (e.g. /pulls) return rel="last" too — that gives a concrete
  // total, which the reviewer wants named in the exit-2 message alongside what was fetched.
  const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
  const page2 = Array.from({ length: 10 }, (_, i) => ({ number: 101 + i }));
  const fetchPage = (page) => {
    if (page === 1) return { rows: page1, hasNext: true, lastPage: 5 };
    if (page === 2) return { rows: page2, hasNext: true, lastPage: 5 };
    throw new Error('should have stopped at the short-fetch trap');
  };
  try {
    paginate(fetchPage);
    assert.fail('expected paginate to throw');
  } catch (e) {
    assert.match(e.message, /^short-fetch:/);
    assert.match(e.message, /5 pages/);        // ground truth from rel="last"
    assert.match(e.message, /110/);            // fetched count
  }
});

// ---- issue 281: the /issues/comments fetch must not swallow a short-fetch -------------
// #230 fixed the swallow on /issues and /pulls but left `catch (e) { /* comments-less PRs are
// fine */ }` around the comments walk, so a partial page degraded to zero comments and the
// blocker-may-be-answered check under-reported while the run still exited 0 or 1.

test('fetchCommentRows bails (exit 2 path) with the counts when the comments walk short-fetches', () => {
  const err = new Error('short-fetch: page 2 returned 47 rows (< 100) but the Link header still ' +
                        'names rel="next" — GitHub says more pages exist. Fetched 147 rows total; ' +
                        'expected ~400+ rows in 5 pages (repo open + closed).');
  const bailed = [];
  // cannotAudit exits the process live, so the stub records and returns.
  const rows = fetchCommentRows(() => { throw err; }, (e) => bailed.push(e.message));
  assert.strictEqual(bailed.length, 1);
  assert.match(bailed[0], /^short-fetch:/);
  assert.match(bailed[0], /147/);            // fetched count
  assert.match(bailed[0], /5 pages/);        // expected count
  assert.deepStrictEqual(rows, []);
});

test('fetchCommentRows treats a repo with no comments as a clean empty set, not a bail', () => {
  const bailed = [];
  assert.deepStrictEqual(fetchCommentRows(() => [], (e) => bailed.push(e)), []);
  // A non-short-fetch failure (auth 403, 404) still degrades to zero comments as before.
  assert.deepStrictEqual(
    fetchCommentRows(() => { throw new Error('HTTP 403: Resource not accessible'); },
                     (e) => bailed.push(e)), []);
  assert.deepStrictEqual(bailed, []);
});

test('isShortFetch separates a partial page from any other fetch failure', () => {
  assert.strictEqual(isShortFetch(new Error('short-fetch: page 2 returned 47 rows')), true);
  assert.strictEqual(isShortFetch(new Error('HTTP 403')), false);
  assert.strictEqual(isShortFetch(null), false);
});

// ---- parseLinkHeader / pageFromUrl: the pure helpers behind ghPaginate's Link parse -----

test('parseLinkHeader picks out rel targets from a real GitHub Link header', () => {
  const header = '<https://api.github.com/repositories/1/pulls?page=2>; rel="next", ' +
                 '<https://api.github.com/repositories/1/pulls?page=97>; rel="last"';
  const rels = parseLinkHeader(header);
  assert.strictEqual(rels.next, 'https://api.github.com/repositories/1/pulls?page=2');
  assert.strictEqual(rels.last, 'https://api.github.com/repositories/1/pulls?page=97');
});

test('parseLinkHeader tolerates empty / missing input', () => {
  assert.deepStrictEqual(parseLinkHeader(''), {});
  assert.deepStrictEqual(parseLinkHeader(null), {});
  assert.deepStrictEqual(parseLinkHeader(undefined), {});
});

test('pageFromUrl extracts page=N from any query position; null when absent', () => {
  assert.strictEqual(pageFromUrl('https://x/y?state=all&per_page=100&page=7'), 7);
  assert.strictEqual(pageFromUrl('https://x/y?page=3&other=1'), 3);
  assert.strictEqual(pageFromUrl('https://x/y?state=all'), null);
  assert.strictEqual(pageFromUrl(null), null);
});
