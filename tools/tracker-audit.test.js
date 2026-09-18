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
  proseBlockers,
  paginate,
  parseLinkHeader,
  pageFromUrl,
  stalePremiseFindings,
  stalePremiseIgnores,
  isExampleCitation,
  boxPathCandidates,
  deletedPathIndex,
  matchDeletedPath,
  deletedSubjectFindings,
  duplicateTitleFindings,
  commentDatesByNumber,
  fetchCommentDates,
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

// ---- proseBlockers: which `## Blocked by` lines are gates (issue 390) ------------
// ---- `merge after #N` is sequencing, so it must not raise ungated-dependency. ----

test('proseBlockers: a `merge after #N` line is sequencing, not a gate', () => {
  const body = '## Blocked by\n\n- Merge after #14 (not a gate): both rewrite the same function\n';
  assert.deepStrictEqual(proseBlockers(body), []);
});

test('proseBlockers: a section mixing a real blocker and `merge after` reports the blocker only', () => {
  const body = '## Blocked by\n\n- #12\n- merge after #14\n\n## Done when\n\n- [ ] x\n';
  assert.deepStrictEqual(proseBlockers(body), [12]);
});

// ---- proseBlockers: where the `## Blocked by` section ENDS (issue 364) ----------
// ---- The heading is the last one the issue template writes, so a provenance -----
// ---- footer below it used to be read as part of the section. -------------------

test('proseBlockers: a provenance footer below the section is not a blocker', () => {
  // Before: [335, 338, 358] — the footer's own citation went red as `ungated-dependency`.
  const body = [
    '## Blocked by',
    '',
    '- #335',
    '- #338',
    '',
    'Filed from the run `6aa9c56e` discovery triage (#358).',
    '',
    '---',
    '_Generated by [Claude Code](https://claude.ai/code)_',
  ].join('\n');
  assert.deepStrictEqual(proseBlockers(body), [335, 338]);
});

test('proseBlockers: `- None.` plus a footer is still no blockers', () => {
  // The `None` short-circuit is judged on the claim alone, so the footer can neither add a
  // blocker nor (below) zero a real one.
  const body = '## Blocked by\n\n- None.\n\nFiled from the run discovery triage (#358).\n';
  assert.deepStrictEqual(proseBlockers(body), []);
});

test('proseBlockers: a bulletless prose section still names its blockers', () => {
  // The template's Blocked-by field asks for issue numbers, not bullets, so a bare sentence is a
  // real answer. Reading only list items would drop these two and the audit would call the ticket
  // startable — the opposite failure to the one above, and worse.
  const body = '## Blocked by\n\n#316, #320 need to land first.\n\nFiled from the run discovery triage (#358).\n';
  assert.deepStrictEqual(proseBlockers(body), [316, 320]);
});

test('citedIssueNumbers: #N inside inline code or a fenced block is quoted, not cited', () => {
  // Issue 274: a bug report quoting a fleet journal — `impl:#205.2` — read as a citation of #205.
  const body = [
    'Journal shows `verify:#203.2` and a plain `#207` in a span.',
    '',
    '```',
    'impl:#205.2 rebuilt #209',
    '```',
    '',
    'Only #12 is a real citation.',
  ].join('\n');
  const got = citedIssueNumbers(body);
  assert.deepStrictEqual(Array.from(got.keys()), [12]);
  // Masking preserves offsets, so the wording check still reads the text around the citation.
  assert.strictEqual(got.get(12), body.indexOf('#12'));
});

test('citedIssueNumbers: a label:#N / label:#N.k agent label is not this repo\'s issue', () => {
  // The fleet writes these to its journal for whichever repo the run was clearing.
  const body = 'Cache keys: impl:#205.2 hit, verify:#203.2 missed, impl:#205 replayed; see #12.';
  assert.deepStrictEqual(Array.from(citedIssueNumbers(body).keys()), [12]);
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

// ---- issue 285: the comments fetch must not swallow a short-fetch either -----------------
// /pulls already exits 2 on a short page; /issues/comments sat behind a bare `catch {}` whose
// comment said "comments-less PRs are fine". A short page there is not a comments-less repo:
// paginate has partial rows while Link still says rel="next", so the PRs in the dropped tail
// read as never-answered and blocker-may-be-answered goes quiet on live threads. The counts
// live in the short-fetch message, which the caller hands to cannotAudit.

test('fetchCommentDates rethrows a short-fetch (with its counts) instead of degrading to zero comments', () => {
  const fetchComments = () => {
    throw new Error('short-fetch: page 2 returned 12 rows (< 100) but the Link header still ' +
                    'names rel="next". Fetched 112 rows total; expected ~400+ rows in 5 pages.');
  };
  assert.throws(() => fetchCommentDates(fetchComments), (err) => {
    assert.match(err.message, /^short-fetch:/);
    assert.match(err.message, /112 rows/);     // fetched count reaches the exit-2 message
    assert.match(err.message, /5 pages/);      // ground truth alongside it
    return true;
  });
});

test('fetchCommentDates degrades to an empty map on a non-short-fetch failure, and on a comment-less repo', () => {
  // The negative control for the criterion: a 403 from a token without issue read, or a repo
  // with genuinely no comments, must still let the audit reach a verdict.
  const denied = () => { throw new Error('HTTP 403: Resource not accessible by integration'); };
  assert.deepStrictEqual(fetchCommentDates(denied), new Map());
  assert.deepStrictEqual(fetchCommentDates(() => []), new Map());
});

test('commentDatesByNumber groups by issue/PR number with dates sorted oldest-first', () => {
  const rows = [
    { issue_url: 'https://api.github.com/repos/o/r/issues/12', created_at: '2026-09-02T00:00:00Z' },
    { issue_url: 'https://api.github.com/repos/o/r/issues/12', created_at: '2026-09-01T00:00:00Z' },
    { issue_url: 'https://api.github.com/repos/o/r/issues/13', created_at: null },
    { issue_url: '', created_at: '2026-09-03T00:00:00Z' },
  ];
  const map = commentDatesByNumber(rows);
  assert.deepStrictEqual(map.get(12), ['2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z']);
  assert.deepStrictEqual(map.get(13), []);   // a row with no date is not a comment date
  assert.strictEqual(map.size, 2);           // the unparseable issue_url is dropped
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

// ---- deleted-subject?: an acceptance box whose subject another ticket deleted ------------

// The pinned case is claude-dotfiles #120 (issue 361). Its acceptance list carries a `writing`
// box; commit 518e63a (issue 178, 2026-09-14) deleted `aac-skills/writing/` and its packaged
// copies on the owner's instruction. #120 predates #178 and neither cites the other, so the
// stale-premise? check could never link them and two fleet attempts spent a cycle discovering
// the box could not be ticked by doing the work.
const DELETED_LISTING = [
  'aac-skills/writing/SKILL.md',
  'aac-skills/writing/references/audience.md',
  'aac-skills/writing/scripts/refresh_vercel.js',
  'marketplace/aac-skills/skills/writing/SKILL.md',
  'aac-skills/project-harness/templates/ticket-fleet.js',
  'docs/adr/0003-old-note.md',
].join('\n');
const LIVE_LISTING = [
  'aac-skills/writing-great-skills/SKILL.md',
  'aac-skills/ticket-fleet/ticket-fleet.js',
  'aac-skills/project-harness/SKILL.md',
  'docs/adr/0004-kept.md',
  'tools/tracker-audit.js',
].join('\n');
const ISSUE_120 = {
  number: 120, state: 'OPEN', title: 'writing-great-skills pass over every Dan-authored skill (15)',
  url: 'https://github.com/o/r/issues/120',
  body: [
    '## Acceptance criteria', '',
    '- [ ] `project-harness`',
    '- [ ] `aac-sop`',
    '- [ ] `writing`',
    '- [ ] Each box above is ticked with the commit hash of that skill\'s rewrite',
  ].join('\n'),
};

test('deletedSubjectFindings pins #120: the `writing` box names a directory another ticket deleted', () => {
  const index = deletedPathIndex(DELETED_LISTING, LIVE_LISTING);
  const found = deletedSubjectFindings([ISSUE_120], index);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, 'deleted-subject?');
  assert.strictEqual(found[0].issue.number, 120);
  assert.match(found[0].detail, /`writing`/);
  assert.match(found[0].detail, /aac-skills\/writing\//);
  // The surviving boxes name live skills, and `ticket-fleet.js` moved rather than vanished — a
  // name the live tree still uses anywhere is never read as deleted.
  assert.strictEqual(matchDeletedPath('project-harness', index), null);
  assert.strictEqual(matchDeletedPath('ticket-fleet.js', index), null);
  // A CLOSED issue carrying the same body is the tracker doing its job, not drift.
  assert.deepStrictEqual(
    deletedSubjectFindings([Object.assign({}, ISSUE_120, { state: 'CLOSED' })], index), []);
});

test('deletedSubjectFindings stays silent on a box naming a path the ticket will create', () => {
  const index = deletedPathIndex(DELETED_LISTING, LIVE_LISTING);
  const willCreate = {
    number: 361, state: 'OPEN', title: 'tracker-audit: deleted acceptance subjects',
    url: 'https://github.com/o/r/issues/361',
    body: ['## Acceptance criteria', '',
           '- [ ] `tools/deleted-subject.js` reports the advisory',
           '- [ ] a new `docs/adr/0009-deleted-subjects.md` records the ruling'].join('\n'),
  };
  assert.deepStrictEqual(deletedSubjectFindings([willCreate], index), []);
  // Absent from the tree is not the same as deleted from it: only history makes the finding.
  assert.strictEqual(matchDeletedPath('tools/deleted-subject.js', index), null);
  assert.strictEqual(matchDeletedPath('aac-skills/writing/SKILL.md', index), 'aac-skills/writing/SKILL.md');
});

test('boxPathCandidates reads backticked names and slashed paths, never a bare prose word', () => {
  assert.deepStrictEqual(boxPathCandidates('- `writing`'), ['writing']);
  assert.deepStrictEqual(boxPathCandidates('Delete aac-skills/writing/ from the tree.'),
                         ['aac-skills/writing']);
  // "writing" here is prose, and `gh issue close 120` is a command, not a path.
  assert.deepStrictEqual(boxPathCandidates('the writing pass is done (`gh issue close 120`)'), []);
});

// ---- issue 374: the two narrowings that keep a meta-ticket from reporting as drift -------

// A discovery-triage chore names a settled duplicate pair so the next agent does not refile it.
// The citation is ABOUT #281; the chore asserts nothing #281 could have falsified. Before the
// narrowing every chore written to the triage template tripped stale-premise?, so the template and
// the advisory were in permanent tension (measured on this repo: 4 findings, one of them #358's
// example, now 3).
const CLOSED_281 = { number: 281, state: 'CLOSED', labels: [], title: 'the comments fetch swallowed a page',
                     url: 'https://github.com/o/r/issues/281', closedByPullRequestsReferences: [] };
const CLOSED_282 = { number: 282, state: 'CLOSED', labels: [], title: 'the packager stamped twice',
                     url: 'https://github.com/o/r/issues/282', closedByPullRequestsReferences: [] };
const byNumberOf = (list) => new Map(list.map((i) => [i.number, i]));

test('stalePremiseFindings: a chore citing a closed issue as an example is silent, a real premise is not', () => {
  const chore = {
    number: 358, state: 'OPEN', labels: [], title: 'triage the wave 4/5 fleet discoveries',
    url: 'https://github.com/o/r/issues/358',
    body: ['## What to build', '',
           'Dedupe first, every time: search open tickets for the same file before creating one.',
           'This run has already produced one duplicate pair (#281 / #285).'].join('\n'),
  };
  const genuine = {
    number: 359, state: 'OPEN', labels: [], title: 'the packager stamps on pull as well as push',
    url: 'https://github.com/o/r/issues/359',
    body: 'The packager stamps every skill on pull as well as push, which #281 changed to push only.',
  };
  const all = [chore, genuine, CLOSED_281];
  const found = stalePremiseFindings(all, byNumberOf(all));
  assert.deepStrictEqual(found.map((f) => f.issue.number), [359]);
  assert.strictEqual(found[0].kind, 'stale-premise?');
  assert.ok(isExampleCitation('one duplicate pair (#281 / #285)'));
  assert.ok(!isExampleCitation('which #281 changed to push only'));
});

test('stalePremiseIgnores: the marker opts a whole body out, or one cited issue at a time', () => {
  const bare = {
    number: 360, state: 'OPEN', labels: [], title: 'deliberate citation',
    url: 'https://github.com/o/r/issues/360',
    body: '<!-- tracker-audit-ignore: stale-premise -->\nThe hook still writes what #281 changed.',
  };
  assert.deepStrictEqual(stalePremiseFindings([bare, CLOSED_281], byNumberOf([bare, CLOSED_281])), []);
  const scoped = {
    number: 362, state: 'OPEN', labels: [], title: 'one deliberate citation, one not',
    url: 'https://github.com/o/r/issues/362',
    body: ['<!-- tracker-audit-ignore: stale-premise #281 -->',
           'The hook still writes what #281 changed.',
           'The packager still stamps the way #282 changed.'].join('\n'),
  };
  const all = [scoped, CLOSED_281, CLOSED_282];
  const found = stalePremiseFindings(all, byNumberOf(all));
  assert.deepStrictEqual(found.map((f) => f.detail.slice(0, 17)), ['cites closed #282']);
  assert.deepStrictEqual(stalePremiseIgnores('nothing here'), { all: false, numbers: new Set() });
});

test('deletedSubjectFindings: a box quoting another issue box is about that issue, not this one', () => {
  const index = deletedPathIndex(DELETED_LISTING, LIVE_LISTING);
  const meta = {
    number: 361, state: 'OPEN', title: 'tracker-audit: deleted acceptance subjects',
    url: 'https://github.com/o/r/issues/361',
    body: ['## Acceptance criteria', '',
           '- [ ] #120\'s `writing` box is the pinned example in `tools/tracker-audit.test.js`'].join('\n'),
  };
  const closed120 = Object.assign({}, ISSUE_120, { state: 'CLOSED' });
  assert.deepStrictEqual(deletedSubjectFindings([meta, closed120], index), []);
  // A PR number is not an issue number: #173 cites PR #168 while telling the owner to copy a path
  // another ticket deleted, which is a claim about this issue's own work and still reports.
  const ownerChore = {
    number: 173, state: 'OPEN', title: 'owner steps left over from the probe session',
    url: 'https://github.com/o/r/issues/173',
    body: ['- [ ] **Sync the template from the PC.** PR #168 changed',
           '`aac-skills/writing/SKILL.md`, so copy it across.'].join(' '),
  };
  const found = deletedSubjectFindings([ownerChore, closed120], index);
  assert.deepStrictEqual(found.map((f) => f.issue.number), [173]);
  assert.match(found[0].detail, /aac-skills\/writing\/SKILL\.md/);
});

test('duplicateTitleFindings pairs open tickets whose titles differ only by a stop word or qualifier', () => {
  const open = [
    { number: 285, title: "tracker-audit's comments fetch still swallows a short page" },
    { number: 281, title: "The tracker-audit's comments fetch swallows a short page again" },
    { number: 290, title: 'Dashboard build drops the triage column' },
  ];
  const found = duplicateTitleFindings(open);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].issue.number, 285);
  assert.strictEqual(found[0].duplicateOf.number, 281);
  assert.strictEqual(found[0].normalized, 'tracker audit s comments fetch swallows short page');
  // A title that differs by a real word is a different ticket, not a duplicate.
  assert.deepStrictEqual(duplicateTitleFindings([
    { number: 1, title: 'Fetch swallows a short page' },
    { number: 2, title: 'Fetch swallows a long page' },
  ]), []);
});
