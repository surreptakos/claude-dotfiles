#!/usr/bin/env node
// GENERATED — do not hand-edit. Built from the claude-dotfiles repo's own tools/tracker-audit.js
// by tools/build-harness-tracker-audit.js (claude-dotfiles issue 336). Edit that file and re-run
// the generator; tools/tracker-audit-template.test.js fails while this copy is stale.
//
// In a harnessed repo this file IS tools/tracker-audit.js, and the next harness re-copy
// overwrites it — send a fix upstream to claude-dotfiles rather than editing it in place.
// Audits LIVE issue-tracker state for drift. Run: node tools/tracker-audit.js
//
// Companion to tools/tracker.test.js, which checks conventions in the FILES. This checks the state
// on GitHub, which no unit test can reach — so it is a command, not a test (it needs the network and
// an authenticated `gh`).
//
// Why it exists: on 2026-07-29 the owner said "I don't understand why I keep having to double check
// your admin work." The honest answer was that the code path had a pre-commit gate, 300+ tests and
// two adversarial review passes, while the tracker had an agent remembering to update things. Every
// class below is drift that actually shipped on a harnessed repo, not a hypothetical:
//
//   * Nine blocking edges existed only as prose. The documented frontier query reads GitHub's native
//     dependencies, so it answered "everything is startable" for the tracker's entire life —
//     including issues four and five deep in a documented chain.
//   * `Fixes #N` in a commit auto-closed three issues whose live-verification boxes were unticked.
//     Closed is this repo's only terminal state, so a closed issue with open boxes is a lie.
//   * An issue sat asserting a fact that a newly-filed bug had just disproved, because filing the bug
//     never prompted the question "what else believed the old story?"
//   * 24 of 27 open issues had an implementing commit already merged on the default branch, found
//     only by grepping the git log by hand — every tracker-only check reads the tracker against
//     itself and cannot see the repository (aac-cockpit #220, 2026-08-04).
//
// EXIT CODES — 0 clean, 1 drift found, 2 could not audit. The 2 matters: this repo has been bitten
// three times by a listing tool returning zero, which is indistinguishable from "nothing is wrong".
// An audit that cannot see the tracker must never look like a pass.
'use strict';

const { execSync, execFileSync } = require('child_process');

/** Child env with the five GIT_* overrides stripped. Issue 28.
 *
 *  `git -C <path>` does NOT override GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE / GIT_COMMON_DIR /
 *  GIT_OBJECT_DIRECTORY: git honours those env vars first, so a leaked GIT_DIR silently redirects
 *  every git call in this process to whatever repo the parent named — including the `gh` shells and
 *  the `git log/fetch/rev-parse` probes below. This tool is meant to audit the repo it is invoked
 *  from, and a leaked GIT_DIR would make it audit somebody else's; worse, the `git fetch` inside
 *  check 9 would fetch into the parent's repo instead. Precomputed once and reused, rather than
 *  cleared-and-restored per call, because this script never uses those env vars for itself.
 *
 *  The same guard already lives in tools/dotfiles-freshness.ps1's Invoke-Git and now in sync.ps1's
 *  -Commit path (via lib/manifest.ps1's Clear-GitEnv). Keep the three in step.
 */
const CHILD_ENV = (() => {
  const env = Object.assign({}, process.env);
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE',
                   'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) {
    delete env[k];
  }
  return env;
})();

/** Acceptance boxes a closed issue is allowed to leave unticked, by exact text fragment. Deliberately
 *  empty: an exemption here is a claim that a box did not need to be true, which deserves a comment
 *  on the issue rather than a line in this file. */
const CLOSED_BOX_EXEMPT = [];

/** An acceptance bullet can legitimately ship un-done when the work was consciously dropped rather
 *  than skipped — superseded by another ticket, retired, or ruled out of scope. The canonical form
 *  is `[x] item — superseded by #N` (ticked, explicit reference), but reviewers writing from memory
 *  sometimes use `[ ] item (not built — superseded)` instead. The audit accepts both, and a matching
 *  prose fragment is enough on its own to treat the box as a legitimate closure — the tick is not
 *  required.
 *
 *  Kept narrow on purpose: a pattern like /done/ or /skip/ would swallow open work by accident.
 *  (Ported from aac-routines, where a question-list of unticked boxes was the audit's only finding.) */
const NOT_PLANNED_PATTERNS = [
  /\bsuperseded\b/i,
  /\bnot built\b/i,
  /\bnot planned\b/i,
  /\bwon'?t build\b/i,
  /\bwon'?t fix\b/i,
  /\bwontfix\b/i,
  /\bout of scope\b/i,
  /\babandoned\b/i,
  /\bobsolete[d]?\b/i,
  /\bretired\b/i,
  /\bdeferred\b/i,
  /\bmoved to #\d+\b/i,
  /\btracked in #\d+\b/i,
];

function isNotPlanned(text) {
  return NOT_PLANNED_PATTERNS.some((rx) => rx.test(text));
}

/** Blank out every code region in a body, keeping its length, so text quoted verbatim inside code is
 *  not read as prose. Fenced blocks (``` or ~~~, three or more, closed by a fence of the same
 *  character and at least the same length, or by end of body) go first; inline spans go second, on
 *  what the fence pass left, so backticks inside a fenced block cannot open one. Every masked
 *  character becomes a space and line breaks survive, so an offset into the result is still an offset
 *  into the input — the stale-premise? check reports the wording AROUND a citation. */
function maskCodeRegions(text) {
  const out = text.split('');
  const blank = (start, end) => {
    for (let i = start; i < end && i < out.length; i++) {
      if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
    }
  };
  const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*/gm;
  let open = null;
  let m;
  while ((m = FENCE.exec(text)) !== null) {
    const marker = m[1];
    if (!open) { open = { start: m.index, char: marker[0], len: marker.length }; continue; }
    if (marker[0] === open.char && marker.length >= open.len) {
      blank(open.start, m.index + m[0].length);
      open = null;
    }
  }
  if (open) blank(open.start, text.length);
  // Inline spans: a run of N backticks is closed by the next run of exactly N (CommonMark). An
  // unmatched run masks nothing, so a stray backtick in prose cannot swallow the rest of the body.
  const runs = [];
  const TICKS = /`+/g;
  let t;
  while ((t = TICKS.exec(out.join('')))) runs.push({ index: t.index, len: t[0].length });
  let i = 0;
  while (i < runs.length) {
    let j = i + 1;
    while (j < runs.length && runs[j].len !== runs[i].len) j++;
    if (j >= runs.length) { i++; continue; }
    blank(runs[i].index, runs[j].index + runs[j].len);
    i = j + 1;
  }
  return out.join('');
}

/** Same-repo issue citations in a body: `#N` as its own token, in prose. Returns a Map of issue
 *  number to the offset of its FIRST such citation, so a caller can look at the wording around it.
 *
 *  A bare `#(\d+)` scan is wrong in four ways. Three are shapes that are not this repo's issue at
 *  all: the tail of a qualified cross-repo reference (`surreptakos/aac-contract-builder#157`) read as
 *  #157, the leading digits of a hex colour (`#9a690f`, `#1f7a43`) read as #9 and #1 — together 16 of
 *  29 stale-premise? advisories here on 2026-09-14 — and a fleet agent label (`impl:#205.2`,
 *  `verify:#203.2`), whose number belongs to whichever repo that run was clearing. So: no word
 *  character or `/` directly before the `#`, no `word:` directly before it, and no word character
 *  directly after the digits. The fourth is context, not shape: a `#N` inside inline code or a fenced
 *  block is quoted material — a journal line, a log, a command — and quoting is not asserting, so
 *  code is masked out before the scan (issue 274, where a bug report quoting a fleet journal could
 *  not be written without tripping the check). Exported for the test suite. */
function citedIssueNumbers(body) {
  const text = String(body || '');
  const prose = maskCodeRegions(text);
  const rx = /(?<![\w/])(?<!\w:)#(\d+)(?![\w])/g;
  const first = new Map();
  let m;
  while ((m = rx.exec(prose))) {
    const n = Number(m[1]);
    if (!first.has(n)) first.set(n, m.index);
  }
  return first;
}

/** Is the follow-up-ticket premise already acknowledged?
 *
 *  A ticket that exists BECAUSE a closed issue shipped is a follow-up, not a stale premise. Two
 *  wordings count as acknowledgment for closed issue #closedNumber:
 *
 *    1. A "Follow-up to closed #N" (or "Follow-up from #N", "Follow-up: #N", "Follows #N") line.
 *    2. A reference by number to any PR that closed #closedNumber (`closerPrNumbers`).
 *
 *  Exported so a test suite can pin the wording without shelling out through the whole audit.
 *  (Ported from aac-routines issue 97, where every follow-up ticket tripped stale-premise?.) */
function isFollowUpAcknowledgment(body, closedNumber, closerPrNumbers) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const ackPattern = new RegExp(
    '\\bfollow(?:[-\\s]?ups?|s)\\b[^\\n#]{0,40}#' + closedNumber + '\\b',
    'i'
  );
  if (ackPattern.test(text)) return true;
  for (const pr of (closerPrNumbers || [])) {
    if (!Number.isInteger(pr)) continue;
    const prPattern = new RegExp(
      '(?:\\bPR\\s*#?' + pr + '\\b|(?:^|[\\s(])#' + pr + '\\b)',
      'i'
    );
    if (prPattern.test(text)) return true;
  }
  return false;
}

/** Wording that presents a cited issue as an EXAMPLE rather than as this ticket's own premise.
 *
 *  A discovery-triage chore names a settled duplicate pair so the next agent does not refile it
 *  ("this run has already produced one duplicate pair (#281 / #285)"). That citation is ABOUT the
 *  closed pair; the chore asserts nothing the closed issue could have falsified. Without this,
 *  every chore written to the triage template tripped stale-premise?, so the template and the
 *  advisory were in permanent tension — which is how a class trains its readers to scroll past it
 *  (issue 374).
 *
 *  Kept to wordings that name the citation's ROLE — example, duplicate, precedent — rather than
 *  anything that merely sits near one; a looser list would swallow the real finding this check
 *  exists for. Exported for the test suite. */
const EXAMPLE_CITATION_PATTERNS = [
  /\bfor example\b/i,
  /\bexamples?\b/i,
  /\be\.g\.\b/i,
  /\bsuch as\b/i,
  /\bduplicat\w*\b/i,
  /\bdedupe\b/i,
  /\bcautionary\b/i,
  /\bprecedent\b/i,
  /\billustrat\w*\b/i,
];

function isExampleCitation(around) {
  return EXAMPLE_CITATION_PATTERNS.some((rx) => rx.test(String(around || '')));
}

/** The explicit opt-out, for a body whose citation is deliberate in a wording no list will predict.
 *
 *  `<!-- tracker-audit-ignore: stale-premise -->` anywhere in a body silences the class for that
 *  body; `<!-- tracker-audit-ignore: stale-premise #281 #285 -->` silences only those citations.
 *  Same shape as the `claude-md-lint-ignore` marker this repo already uses, and it sits on the
 *  issue, where a reader can see it and argue with it. Returns { all, numbers }. Pure. */
function stalePremiseIgnores(body) {
  const rx = /tracker-audit-ignore:\s*stale-premise\??([ \t]*(?:#\d+[ \t,]*)*)/gi;
  const numbers = new Set();
  let all = false;
  let m;
  while ((m = rx.exec(String(body || '')))) {
    const nums = (m[1].match(/\d+/g) || []).map(Number);
    if (!nums.length) all = true;
    nums.forEach((n) => numbers.add(n));
  }
  return { all, numbers };
}

/** Normalize one REST /issues item into the shape the checks below already read.
 *
 *  REST returns lowercase `state`, `html_url`, `labels` as either strings or objects, `milestone`
 *  as an object with `title`, and NO `projectItems` / `closedByPullRequestsReferences` (both are
 *  GraphQL-only). The GraphQL-only fields are filled in later: projectItems from a supplemental
 *  GraphQL call if the environment allows it, closedByPullRequestsReferences from a scan of PR
 *  bodies for closing keywords (Fixes / Closes / Resolves #N) — GitHub's own "linked issues"
 *  panel is built from exactly those keywords, so the derived set matches the GraphQL field.
 *
 *  Kept pure — no `gh`, no env — so tests can drive it with fixture rows. */
function normalizeIssue(raw) {
  return {
    number: raw.number,
    title: raw.title || '',
    state: (raw.state || '').toUpperCase(),
    body: raw.body || '',
    labels: (raw.labels || []).map((l) => ({ name: typeof l === 'string' ? l : l.name })),
    url: raw.html_url,
    milestone: raw.milestone && raw.milestone.title ? { title: raw.milestone.title } : null,
    projectItems: [],
    closedByPullRequestsReferences: [],
  };
}

/** REST's /issues endpoint returns pull requests too (they carry `pull_request` on the row); the
 *  old `gh issue list` did not. Filter to match the previous contract exactly. Pure. */
function issuesOnly(rows) {
  return (rows || []).filter((r) => r && !r.pull_request);
}

/** Normalize one REST /pulls item into the same shape the PR-side checks read. `comments` is a
 *  list of {createdAt} objects rather than a count so the caller can compute lastComment the same
 *  way it did against GraphQL. Pure. */
function normalizePr(raw) {
  return {
    number: raw.number,
    title: raw.title || '',
    state: (raw.state || '').toUpperCase(),
    body: raw.body || '',
    url: raw.html_url,
    comments: [],
  };
}

/** For each issue number, the list of PR numbers whose title-or-body declares them closed
 *  via a GitHub closing keyword (Fixes / Closes / Resolves #N — case-insensitive; the
 *  bare-`#N` form only, matching the GraphQL `closingIssuesReferences` semantics on the same
 *  repo).
 *
 *  Rebuilds the GraphQL `closedByPullRequestsReferences` link from data REST returns — the
 *  reverse direction of what GitHub's own linked-issues panel shows. Needed for the follow-up
 *  acknowledgment path in the stale-premise? check (that check crossed from 19 findings to 38
 *  on a live repo when this map was empty, because every follow-up ticket that named its
 *  closer PR then read as an unacknowledged assertion about the original ticket).
 *
 *  Same regex the commit-message scan uses further down, so a PR's body and a commit reaching
 *  the default branch read the same claim. Pure. */
function closerPrsByIssue(prs) {
  const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
  const map = new Map();
  for (const pr of (prs || [])) {
    const text = (pr.title || '') + '\n' + (pr.body || '');
    let m;
    CLOSING.lastIndex = 0;
    while ((m = CLOSING.exec(text)) !== null) {
      const n = Number(m[1]);
      if (!map.has(n)) map.set(n, new Set());
      map.get(n).add(pr.number);
    }
  }
  const out = new Map();
  for (const [issueNum, prNums] of map) {
    out.set(issueNum, Array.from(prNums).sort((a, b) => a - b).map((number) => ({ number })));
  }
  return out;
}

/** Group /issues/comments rows (every comment in the repo — a PR is an issue, so PR threads are
 *  here too) by issue/PR number, each value a sorted list of created_at dates. Pure. */
function commentDatesByNumber(rows) {
  const out = new Map();
  for (const c of (rows || [])) {
    const m = /\/issues\/(\d+)$/.exec(c && c.issue_url || '');
    if (!m) continue;
    const n = Number(m[1]);
    if (!out.has(n)) out.set(n, []);
    if (c.created_at) out.get(n).push(c.created_at);
  }
  for (const dates of out.values()) dates.sort();
  return out;
}

/** Run the comments fetch and group it. A comments-less repo, a 403 from a token without issue
 *  read, or a network blip degrades to an empty map — the blocker-may-be-answered check then
 *  stays silent for every PR, which is safer than firing on stale data.
 *
 *  A SHORT-FETCH is not that case, and issue 285 is that this catch swallowed it too: paginate
 *  has partial rows while the Link header still says more pages exist, so some PRs' real comments
 *  are simply missing and those PRs read as never-answered — a silent wrong answer dressed as a
 *  comment-less degrade. Rethrown so the caller exits 2 with the fetched/expected counts the
 *  short-fetch message carries. Pure apart from the injected fetcher. */
function fetchCommentDates(fetchComments) {
  let raw = [];
  try {
    raw = fetchComments();
  } catch (e) {
    if (/^short-fetch:/.test(String(e && e.message))) throw e;
  }
  return commentDatesByNumber(raw);
}

/** Extract owner/repo from a `git remote get-url origin` string. Accepts `https://…`, `git@…`,
 *  and the trailing `.git` optional. Returns null if the shape does not match. Pure. */
function parseGithubSlug(remote) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(remote || ''));
  return m ? { owner: m[1], name: m[2] } : null;
}

/** Stop words and qualifiers that do not change what a ticket is ABOUT. Two open tickets whose
 *  titles differ only by these are the same finding filed twice — the shape issue 319 was filed
 *  for: two discovery-triage chores ran in one fleet wave and each filed the `tools/tracker-audit.js`
 *  short-fetch as its own ticket (#281 and #285), two minutes apart. */
const TITLE_STOPWORDS = new Set(['a', 'an', 'the', 'still', 'again', 'also', 'yet', 'now', 'just', 'once', 'another', 'more']);

/** Lowercase a title, drop punctuation, then drop the stop words above. Pure. Deliberately
 *  conservative: it removes nothing that carries meaning, so a match is a strong signal rather
 *  than a fuzzy one. */
function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !TITLE_STOPWORDS.has(w))
    .join(' ');
}

/** Group open issues by normalized title and return one entry per later member of each group:
 *  `{ issue, duplicateOf, normalized }`, the lowest-numbered issue of the group being the one
 *  the others duplicate. Pure — the caller decides how loudly to report it. */
function duplicateTitleFindings(openIssues) {
  const groups = new Map();
  for (const i of Array.isArray(openIssues) ? openIssues : []) {
    const key = normalizeTitle(i && i.title);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const out = [];
  for (const [normalized, members] of groups) {
    if (members.length < 2) continue;
    const sorted = members.slice().sort((a, b) => a.number - b.number);
    for (const later of sorted.slice(1)) out.push({ issue: later, duplicateOf: sorted[0], normalized });
  }
  return out;
}

// Test-only export of the pure predicates and REST normalizers. The rest of the file is a script
// and only runs when this module is invoked directly, so `require('./tracker-audit.js')` from a
// test does not shell out to gh or exit the process.
if (require.main !== module) {
  module.exports = {
    citedIssueNumbers,
    isFollowUpAcknowledgment,
    isNotPlanned,
    NOT_PLANNED_PATTERNS,
    normalizeIssue,
    normalizePr,
    issuesOnly,
    closerPrsByIssue,
    commentDatesByNumber,
    fetchCommentDates,
    parseGithubSlug,
    proseBlockers,
    normalizeTitle,
    duplicateTitleFindings,
    landedCommits,
    landedFindings,
    stalePremiseFindings,
    isExampleCitation,
    EXAMPLE_CITATION_PATTERNS,
    stalePremiseIgnores,
    untickedBoxes,
    boxQuotesAnotherIssue,
    boxPathCandidates,
    deletedPathIndex,
    matchDeletedPath,
    deletedSubjectFindings,
    paginate,
    parseLinkHeader,
    pageFromUrl,
  };
  return;
}

/** execSync runs through cmd.exe on Windows, which does not understand `2>/dev/null` — an inline
 *  redirect there produces "The system cannot find the path specified." on stdout and makes every
 *  call look like it failed. So stderr is suppressed via stdio, never in the command string. */
function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
                         stdio: ['ignore', 'pipe', 'ignore'], env: CHILD_ENV });
}

/** git, with NO shell between us and it. The log format below is built out of `%` placeholders, and
 *  cmd.exe eats `%NAME%` on the way past — so this one command is spawned directly rather than through
 *  `sh`, which would otherwise mangle the separators on Windows and leave the parse silently empty. */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
                                     stdio: ['ignore', 'pipe', 'ignore'], env: CHILD_ENV });
}

/** gh, via cmd.exe (same as `sh` above). This exists because `sh(...)` takes a command string,
 *  not an argv, and REST URLs carrying `&` between query params would look like `cmd1 & cmd2` to
 *  a shell — but cmd.exe leaves `&` alone inside `"..."`. Wrap URL args explicitly, escape any
 *  literal `"` in an arg, and every call is safe.
 *
 *  A cmd-shell path was chosen deliberately over `execFileSync('gh', ...)` for two reasons: on
 *  Windows a gh installed as `gh.cmd` cannot be spawned by execFile without `shell: true` (EINVAL
 *  since Node 20.12), and the test suite's gh shim IS a `.cmd`. With shell:true, args become
 *  string-concatenated for a shell round trip — same escaping burden either way. Keep gh calls
 *  going through `sh(...)` and this thin wrapper: one place to look at, no argv/shell mismatch.
 *  Same env-strip and buffer limits as the two above. */
function gh(args) {
  const parts = args.map((a) => {
    const s = String(a);
    // A URL query string, or any arg carrying whitespace, needs quoting. A literal `"` inside is
    // escaped as `""` for cmd.exe's parser (the copyfile-style rule cmd uses in `for /f`).
    if (/[\s"?&|<>^]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  });
  return sh('gh ' + parts.join(' '));
}

/** Parse a GitHub Link response header into a map of rel -> URL.
 *
 *  The header looks like `<url1>; rel="next", <url2>; rel="last"`. Pure. Exported for tests. */
function parseLinkHeader(value) {
  const out = {};
  const s = String(value || '');
  const rx = /<([^>]+)>\s*;\s*rel="([^"]+)"/g;
  let m;
  while ((m = rx.exec(s))) out[m[2]] = m[1];
  return out;
}

/** Pull the `page=N` query param out of a paginated URL. Returns null when absent. Pure. */
function pageFromUrl(url) {
  const m = /[?&]page=(\d+)/.exec(String(url || ''));
  return m ? Number(m[1]) : null;
}

/** Walk a paged endpoint and return every row as one array. `fetchPage(pageNumber)` returns
 *  either an array (rows for that 1-indexed page) OR an object `{rows, hasNext, lastPage}` when
 *  the fetcher can also see the Link header GitHub sent back. A page shorter than 100 rows
 *  ends the walk; 200 is the safety cap in case an endpoint never returns a short page.
 *
 *  When the fetcher exposes Link info, paginate detects the short-page-with-more-available
 *  shape that produced issue 230: a page returning <100 rows but with `rel="next"` set means
 *  the tail was silently dropped and every downstream check that treats the fetched set as
 *  complete (dangling-reference, blocker-may-be-answered, ...) will misread real numbers as
 *  unknown. Same for reaching the 200-page cap with `rel="next"` still set. In either case
 *  paginate throws a `short-fetch:` error carrying the counts, which ghPaginate turns into
 *  cannotAudit — exit 2 rather than a false dangling-reference finding.
 *
 *  Split out from `ghPaginate` so a test can drive the loop with a stubbed fetcher and pin the
 *  page-count / early-exit / non-array / short-with-next behaviour without shelling out to gh.
 *  Pure — no gh, no network, no process exits. Issue 171, issue 230. */
function paginate(fetchPage) {
  const all = [];
  let lastMeta = null;
  for (let page = 1; page <= 200; page++) {
    const result = fetchPage(page);
    const rows = Array.isArray(result) ? result : (result && result.rows);
    if (!Array.isArray(rows)) throw new Error('non-array page ' + page);
    const hasNext = !Array.isArray(result) && !!(result && result.hasNext);
    const lastPage = Array.isArray(result) ? null : (result && result.lastPage) || null;
    lastMeta = { hasNext, lastPage };
    for (const r of rows) all.push(r);
    if (rows.length < 100) {
      if (hasNext) {
        // A page returned fewer than 100 rows but the Link header names a next page — GitHub
        // is telling us there are more rows and we would have to have fetched them to be
        // complete. Paginate's old row-count end-of-stream heuristic swallowed exactly this
        // and every check downstream misread the missing numbers as unknown (dangling
        // references, missed blockers). Bail; ghPaginate turns this into cannotAudit.
        const expected = lastPage
          ? '~' + ((lastPage - 1) * 100) + '+ rows in ' + lastPage + ' pages'
          : 'at least one more page (100+ additional rows)';
        throw new Error('short-fetch: page ' + page + ' returned ' + rows.length +
                        ' rows (< 100) but the Link header still names rel="next" — GitHub ' +
                        'says more pages exist. Fetched ' + all.length + ' rows total; ' +
                        'expected ' + expected + ' (repo open + closed). The tail was ' +
                        'silently dropped, so real numbers would read as dangling references.');
      }
      return all;
    }
  }
  // Ran the loop to the 200-page cap. If the last page still had rel="next", we did not reach
  // the end — treat as a short fetch (the cap is a bound on the loop, not on the tracker).
  if (lastMeta && lastMeta.hasNext) {
    throw new Error('short-fetch: reached the 200-page safety cap with rel="next" still set. ' +
                    'Fetched ' + all.length + ' rows; the tail past page 200 was not walked. ' +
                    'Raise the cap or narrow the query.');
  }
  return all;
}

/** Walk a list endpoint page by page and return every row as one array. `path` must already
 *  carry its query string with `per_page=100` (the API maximum); `&page=N` is appended here.
 *
 *  This replaces `gh api --paginate`, which follows the `Link: rel="next"` header GitHub sends
 *  back. That URL is the numeric-ID form, `/repositories/{id}/issues?page=2`, and the Claude-Code
 *  cloud egress proxy refuses it: "Numeric-ID repository paths (repositories/{id}/...) are not
 *  supported through this proxy. Use repos/{owner}/{repo}/... endpoints instead. (HTTP 403)". So
 *  in every cloud container page one came back and page two killed the audit with exit 2 — on a
 *  repo with more than 100 issues that is every run. Paging by hand keeps each request on the
 *  `repos/{owner}/{repo}` path.
 *
 *  Each `gh api --include` call returns the raw HTTP response so paginate can also read the Link
 *  header. That header carries `rel="next"` while more pages exist and `rel="last"` on offset-
 *  paginated endpoints (e.g. /pulls). Cursor-paginated endpoints (e.g. /issues, since GitHub
 *  moved them mid-2024) supply only `rel="next"`; a page count is not derivable there, but the
 *  short-page-with-next signal that issue 230 needs still works. */
function ghPaginate(path) {
  return paginate((page) => {
    const raw = gh(['api', path + '&page=' + page, '--include']);
    const sep = raw.match(/\r?\n\r?\n/);
    if (!sep) throw new Error('malformed HTTP response on page ' + page + ' from ' + path);
    const headers = raw.slice(0, sep.index);
    const body = raw.slice(sep.index + sep[0].length);
    const linkMatch = /^link:\s*(.*)$/im.exec(headers);
    const rels = linkMatch ? parseLinkHeader(linkMatch[1]) : {};
    const rows = JSON.parse(body);
    if (!Array.isArray(rows)) throw new Error('non-array page ' + page + ' from ' + path);
    return { rows, hasNext: !!rels.next, lastPage: pageFromUrl(rels.last) };
  });
}

/** Bail with exit 2 rather than reporting a clean run we cannot stand behind. */
function cannotAudit(why, detail) {
  console.error('CANNOT AUDIT: ' + why);
  if (detail) console.error(String(detail).trim().split('\n').slice(0, 4).join('\n'));
  console.error('\nThis is not a pass. Fix the above and re-run.');
  process.exit(2);
}

// Every gh call here goes through `gh api` REST. Historically `gh repo view --json`, `gh issue
// list --json`, and `gh pr list --json` all sat on top of gh's GraphQL client, which the
// Claude-Code cloud egress proxy returns HTTP 403 on ("GitHub GraphQL is not available from
// Claude Code sessions; use the REST API"). REST is proxied and authenticated, so the audit
// runs there without any code that only works locally. Issue 130.

/** Owner/repo. From `git remote get-url origin` — no gh call needed, so the caller cannot get a
 *  gh error out of the trivial identity question. */
let SLUG;
try {
  SLUG = parseGithubSlug(git(['remote', 'get-url', 'origin']).trim());
} catch (e) {
  cannotAudit('`git remote get-url origin` failed — not a git clone with an `origin`.', e.message);
}
if (!SLUG) cannotAudit('`origin` is not a github.com URL.');

let REPO, DEFAULT_BRANCH;
try {
  const repoInfo = JSON.parse(gh(['api', 'repos/' + SLUG.owner + '/' + SLUG.name]));
  REPO = repoInfo.full_name || (SLUG.owner + '/' + SLUG.name);
  // The branch work has to REACH before "it already landed" is true. Read, never assumed: a repo whose
  // trunk is not `main` would otherwise be audited against a branch that does not exist.
  DEFAULT_BRANCH = repoInfo.default_branch || '';
} catch (e) {
  cannotAudit('`gh api repos/' + SLUG.owner + '/' + SLUG.name + '` failed — network, or gh is not authenticated.', e.message);
}

/** Every issue, open and closed. Closed ones are needed for the unticked-box check and to tell a
 *  released blocker from a dangling reference. `closedByPullRequestsReferences` feeds the follow-up
 *  acknowledgment in the stale-premise check — the REST /issues endpoint has no field for it, so it
 *  is rebuilt below from a scan of PR bodies (see `closerPrsByIssue`), which matches how GitHub
 *  populates the GraphQL field on the same repo. */
let issuesRaw;
try {
  // per_page 100 is the API's max, so a 500-issue repo is five pages instead of fifty.
  issuesRaw = ghPaginate('repos/' + REPO + '/issues?state=all&per_page=100');
} catch (e) {
  cannotAudit('`gh api repos/' + REPO + '/issues` failed.', e.message);
}
if (!Array.isArray(issuesRaw)) cannotAudit('`gh api repos/' + REPO + '/issues` did not return an array.');
// The /issues endpoint returns pull requests as well — the pull_request field on the row is how
// GitHub says "this is really a PR". The old `gh issue list` did not include PRs; match the
// previous contract exactly here or every finding's counts would silently shift.
const issues = issuesOnly(issuesRaw).map(normalizeIssue);
if (issues.length === 0) {
  // The false-zero guard. A tracker with zero issues is possible but is far more often an auth
  // problem, a wrong repo, or a phantom working directory — all of which previously read as success.
  cannotAudit('the tracker reports ZERO issues. A filter that returns nothing looks exactly like ' +
              'nothing being wrong. Confirm the repo and `gh auth status` before believing this.');
}

const byNumber = new Map(issues.map((i) => [i.number, i]));
const open = issues.filter((i) => i.state === 'OPEN');

/** GitHub shares ONE number space across issues and pull requests, and the /issues endpoint above
 *  already dropped PRs. So a `#43` pointing at a perfectly good merged PR looks like a pointer to
 *  nothing. Caught the first time the audit ran against a repo that actually uses PRs: all seven
 *  "dangling" references were merged PRs. Fetched once rather than probed per number.
 *
 *  Comments live on their own endpoint (/issues/comments — a PR is an issue, so this covers both).
 *  Fetched in one paginated call and grouped by issue/PR number rather than one call per PR.
 *
 *  PR bodies drive closerPrsByIssue further down, which is how each issue's
 *  `closedByPullRequestsReferences` gets rebuilt without GraphQL. */
let prs = [];
let prNumbers = new Set();
let prByNumber = new Map();
let prsUnavailable = false;
try {
  const prsRaw = ghPaginate('repos/' + REPO + '/pulls?state=all&per_page=100');
  prs = prsRaw.map(normalizePr);
  prNumbers = new Set(prs.map((p) => p.number));
} catch (e) {
  // "Only risks a visible false positive" was wrong twice over on aac-bill-intake, where this catch
  // made the audit run red four times a day for two weeks: an issue cited a perfectly good PR the run
  // could not see, and the finding named the issue rather than the blindness. In Actions the cause is
  // the token — a `permissions:` block sets every scope it does not name to `none`, so a missing
  // `pull-requests: read` 403s `gh pr list` here while it works from a laptop. The failure is
  // recorded rather than swallowed: the dangling-reference check drops to advisory, because without
  // PRs it genuinely cannot tell a merged PR from a pointer to nothing, and blocker-may-be-answered
  // goes silent on its own (empty prByNumber) — which the NOTE at the bottom then says out loud.
  //
  // The short-fetch case is different from an auth 403: paginate has partial rows but Link says
  // more exist. Degrading to advisory here would leave dangling-reference misclassifying a real
  // (usually closed / merged) PR as unknown — exactly the bug issue 230 is about. Exit 2 in that
  // case so the run does not report a false dangling reference.
  if (/^short-fetch:/.test(String(e && e.message))) {
    cannotAudit('`gh api repos/' + REPO + '/pulls` returned a partial page.', e.message);
  }
  prsUnavailable = true;
}

if (!prsUnavailable) {
  // Attach comment dates. /issues/comments returns EVERY comment across the whole repo (a PR is an
  // issue, so its thread is here too), which is one call regardless of PR count. Best-effort for an
  // unavailable endpoint (see fetchCommentDates), but a short-fetch is a partial answer, not an
  // absent one, and exits 2 like the /pulls one above rather than degrading to zero comments.
  let commentsByNumber = new Map();
  try {
    commentsByNumber = fetchCommentDates(
      () => ghPaginate('repos/' + REPO + '/issues/comments?per_page=100'));
  } catch (e) {
    cannotAudit('`gh api repos/' + REPO + '/issues/comments` returned a partial page.', e.message);
  }
  prByNumber = new Map(prs.map((p) => {
    const dates = commentsByNumber.get(p.number) || [];
    return [p.number, Object.assign({}, p, {
      commentCount: dates.length,
      lastComment: dates[dates.length - 1] || null,
    })];
  }));

  // Reverse-map: for each issue, which PRs close it (Fixes/Closes/Resolves #N in title+body).
  // Fills in the GraphQL-only `closedByPullRequestsReferences` field from REST data, so the
  // stale-premise? check's follow-up acknowledgment path still sees closer PR numbers.
  const closerMap = closerPrsByIssue(prs);
  issues.forEach((i) => {
    if (closerMap.has(i.number)) i.closedByPullRequestsReferences = closerMap.get(i.number);
  });
}
const knownNumber = (n) => byNumber.has(n) || prNumbers.has(n);

/** Attach projectItems (per-issue board card status) via one supplemental GraphQL call. GraphQL is
 *  what powers the `--json projectItems` shape gh used to serve; there is no REST equivalent, so
 *  this path is genuinely unavailable on the Claude-Code cloud egress proxy — the check has to
 *  degrade rather than crash. When it succeeds (a local run on Windows with `gh auth login`), the
 *  board-says-done and not-on-board findings match exactly what the pre-port audit produced. */
let boardUnavailable = false;
try {
  const q =
    'query($owner:String!,$name:String!,$after:String){' +
    ' repository(owner:$owner,name:$name){' +
    '  issues(first:100,after:$after,states:[OPEN,CLOSED]){' +
    '   pageInfo{hasNextPage endCursor}' +
    '   nodes{number projectItems(first:5){nodes{status:fieldValueByName(name:"Status"){' +
    '    ... on ProjectV2ItemFieldSingleSelectValue{name}' +
    '   }}}' +
    '  }' +
    '  }' +
    ' }' +
    '}';
  // Write the query to a scratch file and pass it via `gh api graphql -F query=@<file>`. That
  // is gh's typed-field syntax for "read this field's value from a file"; the alternative
  // (inline `-f query=...`) would round-trip the GraphQL text through cmd.exe on Windows and
  // the embedded `"` around `"Status"` would confuse cmd's quote parser. Cleaned up on process
  // exit — tmp lives under os.tmpdir with a unique suffix, so concurrent runs do not collide.
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const qfile = path.join(os.tmpdir(), 'tracker-audit-gql-' + process.pid + '-' + Date.now() + '.txt');
  fs.writeFileSync(qfile, q, 'utf8');
  process.on('exit', () => { try { fs.unlinkSync(qfile); } catch (e) { /* ignore */ } });
  let after = null;
  for (let page = 0; page < 200; page++) {
    const args = [
      'api', 'graphql',
      '-F', 'query=@' + qfile,
      '-f', 'owner=' + SLUG.owner,
      '-f', 'name=' + SLUG.name,
    ];
    if (after) args.push('-f', 'after=' + after);
    const res = JSON.parse(gh(args));
    if (res.errors && res.errors.length) throw new Error(res.errors[0].message || 'graphql errors');
    const conn = res.data && res.data.repository && res.data.repository.issues;
    if (!conn) throw new Error('no issues connection');
    for (const node of (conn.nodes || [])) {
      const rec = byNumber.get(node.number);
      if (!rec) continue;
      rec.projectItems = (node.projectItems && node.projectItems.nodes || [])
        .map((it) => ({ status: it && it.status ? { name: it.status.name } : null }));
    }
    if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
} catch (e) {
  // Cloud egress proxy: GraphQL 403s. The two board checks skip themselves and the NOTE at the
  // bottom says so.
  boardUnavailable = true;
}

/** Native blocked_by edges (open blockers only — GitHub releases a child when its blocker closes,
 *  which is the whole reason to use these rather than prose). Returns null if the endpoint is
 *  unavailable on this repo, so the caller can say "unknown" instead of "none". */
function nativeBlockers(n) {
  try {
    const out = gh([
      'api', 'repos/' + REPO + '/issues/' + n + '/dependencies/blocked_by',
      '--jq', '.[].number',
    ]).trim();
    return out ? out.split('\n').map(Number) : [];
  } catch (e) {
    return null;
  }
}

/** Issue numbers named under a `## Blocked by` heading. Prose is documentation; the native edge is
 *  the gate — this exists to find the two disagreeing.
 *
 *  The section-end lookahead is `$(?![\s\S])`, not `\Z`. JavaScript has no `\Z`, so the old pattern
 *  matched a literal "Z" and the whole regex failed whenever `## Blocked by` was the LAST section —
 *  which the issue template makes it on nearly every ticket. The check therefore reported nothing for
 *  the tickets it was written for, the same silent all-clear this tool's header describes. Found
 *  2026-07-31 on aac-cockpit when three issues carried prose blockers, no native edge, and a clean
 *  audit.
 *
 *  The section is then bounded at its CLAIM, not at the next heading. `## Blocked by` is the last
 *  heading the issue template writes, so whatever a filer appends below it — a provenance footer, an
 *  attribution line, the harness's own `_Generated by Claude Code_` block — was swept into the
 *  section and every `#N` it cited read as a blocker. Two tickets filed by one discovery triage went
 *  red with `ungated-dependency` over nothing but their own footer (claude-dotfiles issue 364).
 *
 *  The claim is the section's first blank-line-separated block plus any block after it that is
 *  itself a list; the first non-list block ends it. That keeps BOTH shapes the field actually
 *  receives — a bullet list, and a bare sentence naming numbers ("#316, #320 need to land first.") —
 *  and drops the paragraph that follows either. Reading the list alone would be simpler and is
 *  wrong: the template's Blocked-by field asks for issue numbers, not bullets, so a prose answer is
 *  a real answer and dropping it would silently lose real blockers.
 *
 *  Within the claim a list wins over stray lines: once any line is a list item, only list items and
 *  their indented continuations are read, so a footer glued to the last bullet with no blank line
 *  between them still cannot add a blocker. The `None` short-circuit is judged on the claim alone,
 *  so a footer can neither add a blocker nor zero a real one. */
function proseBlockers(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const m = /^##+\s*Blocked by\s*$([\s\S]*?)(?=^##+\s|$(?![\s\S]))/im.exec(text);
  if (!m) return [];
  const LIST_LINE = /^[ \t]*(?:[-*+]|\d+[.)])\s/;
  const CONTINUATION = /^[ \t]+\S/;
  const strip = (b) => b.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
  const blocks = m[1].split(/\n[ \t]*\n/).map(strip).filter(Boolean);
  // The claim: the first block, plus any further block that is itself a list. The first non-list
  // block after it is the footer, and everything from there down is provenance, not a blocker.
  const claim = [];
  for (let i = 0; i < blocks.length; i += 1) {
    if (i > 0 && !LIST_LINE.test(blocks[i])) break;
    claim.push(blocks[i]);
  }
  let lines = claim.join('\n').split('\n');
  if (lines.some((l) => LIST_LINE.test(l))) {
    lines = lines.filter((l) => LIST_LINE.test(l) || CONTINUATION.test(l));
  }
  const section = lines.join('\n');
  if (/^\s*[-*]?\s*(None|N\/?A)\b/im.test(section)) return [];
  // `merge after #N` is the one non-gating relation this section can carry (issue 390). Before it,
  // the heading had a single vocabulary — every `#N` under it was a gate — so a ticket that only
  // meant "build it now, land it after #N" had two bad options: add a native edge, which stops the
  // frontier query on work that is genuinely startable, or leave the audit reporting
  // `ungated-dependency` on that ticket for ever, which is how a check stops being read. Matched per
  // LINE, and on the phrase anywhere in the line, so one section can mix both kinds and a real
  // blocker on its own line still gates.
  const NON_GATING = /\bmerge\s+after\b/i;
  const nums = section.split('\n')
    .filter((line) => !NON_GATING.test(line))
    .reduce((acc, line) => acc.concat((line.match(/#(\d+)/g) || []).map((s) => Number(s.slice(1)))), []);
  return Array.from(new Set(nums));
}

/** Unticked checkboxes, split by whether they sit under an ACCEPTANCE heading.
 *
 *  Not every checkbox is acceptance. A `needs-info` issue lists open questions as checkboxes, and a
 *  PRD lists sub-issues the same way — neither is a claim that work was verified, so flagging them on
 *  a closed issue is noise. Observed immediately: the first cross-repo run's only finding in one repo
 *  was a closed issue whose six "unticked" boxes were a question list.
 *
 *  So boxes under `## Done when` / `## Acceptance criteria` are a hard finding, and boxes with no
 *  acceptance heading above them are advisory — which keeps the signal for a repo that writes
 *  acceptance without a heading, without failing a build over a question list.
 *
 *  A bullet whose prose says the item was superseded / not-planned / out-of-scope is treated as a
 *  legitimate closure and dropped from both lists (see NOT_PLANNED_PATTERNS above). */
function untickedBoxes(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const ACCEPT_HEADING = /^##+\s*(Done when|Acceptance criteria|Acceptance)\s*$/im;
  const m = ACCEPT_HEADING.exec(text);
  const scope = m
    ? text.slice(m.index + m[0].length).split(/^##\s/m)[0]
    : null;
  const pick = (s) => (s.match(/^\s*[-*]\s*\[ \]\s+(.+)$/gm) || [])
    .map((l) => l.replace(/^\s*[-*]\s*\[ \]\s+/, '').trim())
    .filter((t) => !CLOSED_BOX_EXEMPT.some((ex) => t.includes(ex)))
    .filter((t) => !isNotPlanned(t));
  return scope === null
    ? { hard: [], soft: pick(text) }
    : { hard: pick(scope), soft: [] };
}

/** Path-like tokens named by one acceptance-box line.
 *
 *  Two shapes, and nothing else: anything holding a `/` (`aac-skills/writing/`, tools/x.js), and a
 *  BACKTICKED bare name (`writing`), which is how this repo's skill tickets name a directory. A bare
 *  word outside backticks stays prose — otherwise "the writing pass" reads as a path and every box
 *  becomes a candidate. Pure. */
function boxPathCandidates(text) {
  const s = String(text == null ? '' : text);
  const out = new Set();
  const add = (raw) => {
    const t = String(raw).trim().replace(/^\.\//, '').replace(/[.,;:)\]]+$/, '').replace(/\/+$/, '');
    if (!t || /\s/.test(t) || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(t)) return;
    if (!t.includes('/') && t.length < 3) return;
    out.add(t);
  };
  (s.match(/`[^`]+`/g) || []).forEach((m) => add(m.slice(1, -1)));
  // Backticked spans are removed before the bare scan so a path inside them is added once, by the
  // rule above, with its punctuation already trimmed.
  (s.replace(/`[^`]*`/g, ' ').match(/[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_./-]*/g) || []).forEach(add);
  return Array.from(out);
}

/** Does one acceptance-box line cite a DIFFERENT issue of this repo?
 *
 *  A meta-ticket's box quotes the box it is about: #361's acceptance list carries "#120's `writing`
 *  box is the pinned example", and `writing` is the directory another ticket deleted. The deleted
 *  subject belongs to #120 — it is the POINT of #361, not drift in it — so a box naming another
 *  issue is read as a quotation of that issue's box rather than a claim about this one (issue 374).
 *
 *  `issueNumbers` is the tracker's own issue set, and passing it is what keeps the narrowing from
 *  swallowing real findings: #173's box cites PR #168 while telling the owner to copy a path that
 *  ticket deleted, which is a claim about THIS issue's work and still reports. A PR number is not an
 *  issue number, so only a cited issue counts as a quotation. Omit it and any other number does.
 *
 *  Same `#N`-as-its-own-token rule as citedIssueNumbers, so `owner/repo#7` and `#9a690f` are not
 *  read as this repo's issues. Pure. */
function boxQuotesAnotherIssue(text, ownNumber, issueNumbers) {
  const rx = /(?<![\w/])#(\d+)(?![\w])/g;
  let m;
  while ((m = rx.exec(String(text == null ? '' : text)))) {
    const n = Number(m[1]);
    if (n === Number(ownNumber)) continue;
    if (!issueNumbers || issueNumbers.has(n)) return true;
  }
  return false;
}

/** What the default branch HAS, and what it once had and deleted.
 *
 *  `deletedListing` is the raw output of `git log --diff-filter=D --name-only --format= <ref>`;
 *  `liveListing` is `git ls-tree -r --name-only <ref>`. A path that was deleted and later re-added is
 *  live, not deleted — the live listing wins, which is what makes "deleted" mean "gone now" rather
 *  than "gone once". Directories are inferred from the files under them, because git deletes files;
 *  a directory the live tree still holds (one file swept, its siblings kept) is not a deleted
 *  directory. Pure, so the classification is testable without a repository. */
function deletedPathIndex(deletedListing, liveListing) {
  const lines = (t) => String(t == null ? '' : t).replace(/\r\n/g, '\n')
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const dirsOf = (p) => {
    const parts = p.split('/');
    const out = [];
    for (let i = parts.length - 1; i >= 1; i--) out.push(parts.slice(0, i).join('/'));
    return out;
  };
  const live = new Set(lines(liveListing));
  const liveNames = new Set();
  const liveDirs = new Set();
  live.forEach((p) => {
    p.split('/').forEach((seg) => liveNames.add(seg));
    dirsOf(p).forEach((d) => liveDirs.add(d));
  });
  const deletedFiles = new Set();
  const deletedDirs = new Set();
  lines(deletedListing).forEach((p) => {
    if (live.has(p)) return;
    deletedFiles.add(p);
    dirsOf(p).forEach((d) => { if (!liveDirs.has(d)) deletedDirs.add(d); });
  });
  return { live, liveNames, deletedFiles, deletedDirs };
}

/** The deleted path a candidate token names, or null. Pure.
 *
 *  A token carrying a `/` has to match a deleted path or deleted directory outright. A bare name is
 *  only read as a path when the tree once held a NESTED directory by exactly that name (a top-level
 *  name is too close to an ordinary English word to be worth the noise) or a file with an extension
 *  and that basename — and never when the live tree still uses the name anywhere, which is what stops
 *  `ticket-fleet.js` reading as deleted after it moved. */
function matchDeletedPath(candidate, index) {
  const c = String(candidate == null ? '' : candidate);
  if (!c || index.live.has(c)) return null;
  if (c.includes('/')) {
    if (index.deletedFiles.has(c)) return c;
    if (index.deletedDirs.has(c)) return c + '/';
    return null;
  }
  if (index.liveNames.has(c)) return null;
  const dir = Array.from(index.deletedDirs).sort()
    .find((d) => d.includes('/') && d.slice(d.lastIndexOf('/') + 1) === c);
  if (dir) return dir + '/';
  if (!/\.[A-Za-z0-9]+$/.test(c)) return null;
  return Array.from(index.deletedFiles).sort()
    .find((f) => f.slice(f.lastIndexOf('/') + 1) === c) || null;
}

/** OPEN issues whose unticked acceptance boxes name something the default branch deleted.
 *
 *  #120's acceptance list carries a `writing` box; commit 518e63a (issue 178) deleted
 *  `aac-skills/writing/` on the owner's instruction. The box cannot be ticked by doing the work, and
 *  two fleet attempts spent a cycle discovering that. The neighbouring `stale-premise?` check reads
 *  issue-to-issue citations, and #120 predates #178, so nothing linked them.
 *
 *  Advisory, and deliberately narrowed to paths git shows DELETED rather than merely absent: a box
 *  naming a path the ticket will create is the normal case and must stay silent. Takes all issues and
 *  filters to open itself, so "a closed issue produces no finding" is a property of this function. */
function deletedSubjectFindings(allIssues, index) {
  const out = [];
  // The tracker's own numbers, so a box citing a PR is not mistaken for one quoting an issue.
  const issueNumbers = new Set((allIssues || []).map((i) => i.number));
  (allIssues || []).filter((i) => i.state === 'OPEN').forEach((i) => {
    const boxes = untickedBoxes(i.body);
    const seen = new Set();
    boxes.hard.concat(boxes.soft).forEach((text) => {
      // A box that cites another issue is quoting THAT issue's box (see boxQuotesAnotherIssue).
      if (boxQuotesAnotherIssue(text, i.number, issueNumbers)) return;
      boxPathCandidates(text).forEach((c) => {
        if (seen.has(c)) return;
        const hit = matchDeletedPath(c, index);
        if (!hit) return;
        seen.add(c);
        out.push({ kind: 'deleted-subject?', issue: i, detail:
          'has an unticked acceptance box — "' + text.slice(0, 72) + '" — naming `' + c + '`, which ' +
          'the default branch no longer has: git history shows ' + hit + ' deleted. A box whose ' +
          'subject another ticket deleted cannot be ticked by doing the work, so every agent that ' +
          'picks this ticket up spends its cycle rediscovering that. Read the deleting commit ' +
          '(git log --diff-filter=D -- ' + hit.replace(/\/$/, '') + '), then drop the box or say on ' +
          'the issue what replaced it. A box may legitimately name a path the work will create, so ' +
          'this is a prompt to look. Advisory only.' });
      });
    });
  });
  return out;
}

/** One commit per record: short sha, NUL, subject, NUL, the WHOLE message, record separator. */
const LOG_FORMAT = '%h%x00%s%x00%B%x1e';

/** Commits that name an issue, split by how strongly they claim to have finished it.
 *
 *  Input is the raw output of `git log --no-color --format=<LOG_FORMAT> <ref>`.
 *
 *  THE TWO HALVES ARE READ FROM DIFFERENT PLACES, and that asymmetry is the whole design.
 *
 *  A bare `#N` is read from the SUBJECT ONLY. A commit body that explains itself by citing three earlier
 *  tickets would otherwise report all three as landed work, and the squash-merge convention puts the real
 *  reference in the subject as `(#N)`. That was aac-cockpit #220's decision and it stands.
 *
 *  A CLOSING KEYWORD is read from the WHOLE MESSAGE (aac-cockpit #244, 2026-08-05). Reading both from the
 *  subject made the strong signal unreachable: across the sixty commits before that change, `Closes #N`
 *  appeared seven times and not once in a subject — it is written in the body, which is where GitHub
 *  reads it from too. So the strongest claim a commit can make always degraded to the advisory weak case,
 *  and two close-out runs dispatched agents at tickets whose work had already merged. A closing keyword is
 *  a claim about a specific ticket wherever it is written; a bare number in a paragraph is not.
 *
 *  Returns Map<issueNumber, { closing: [{sha, subject}], mention: [{sha, subject}] }>. `closing` is one of
 *  GitHub's closing keywords (`Fixes #N`) — a claim the commit finished the ticket. `mention` is a bare
 *  `#N`, which may be a partial, a follow-up, or a passing reference. The caller weighs them differently. */
function landedCommits(logText) {
  const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
  const NAMED = /#(\d+)\b/g;
  const out = new Map();
  String(logText == null ? '' : logText).replace(/\r\n/g, '\n').split('\u001e').forEach((record) => {
    const parts = record.split('\u0000');
    if (parts.length < 3) return;
    const sha = parts[0].trim(), subject = parts[1], message = parts[2];
    if (!sha) return;
    const closing = new Set(), named = new Set();
    let m;
    CLOSING.lastIndex = 0;
    while ((m = CLOSING.exec(message)) !== null) closing.add(Number(m[1]));
    NAMED.lastIndex = 0;
    while ((m = NAMED.exec(subject)) !== null) named.add(Number(m[1]));
    // One entry per commit per number: a subject naming #5 twice is still one commit. A closing keyword
    // counts even when the subject never names the number — that is the case body-reading exists for.
    const numbers = new Set();
    named.forEach((n) => numbers.add(n));
    closing.forEach((n) => numbers.add(n));
    numbers.forEach((n) => {
      if (!out.has(n)) out.set(n, { closing: [], mention: [] });
      const rec = out.get(n);
      (closing.has(n) ? rec.closing : rec.mention).push({ sha: sha, subject: subject });
    });
  });
  return out;
}

/** OPEN issues whose implementing work is already on the default branch, as findings.
 *
 *  Takes ALL issues and filters to open itself, so "a closed issue produces no finding" is a property of
 *  this function rather than of whatever the caller happened to pass — the tracker doing its job must
 *  never read as drift. Pure: no `gh`, no git, nothing from module scope, so the classification is
 *  testable without the network. */
function landedFindings(allIssues, landed, ref) {
  const out = [];
  const show = (list) => list.slice(0, 4).map((c) => c.sha + ' "' + c.subject.slice(0, 72) + '"').join(', ') +
    (list.length > 4 ? ', and ' + (list.length - 4) + ' more' : '');
  (allIssues || []).filter((i) => i.state === 'OPEN').forEach((i) => {
    const hit = landed.get(i.number);
    if (!hit) return;
    // A closing keyword that reached the default branch without closing the issue is the strongest signal
    // there is, so it fails the run. Reported once: the reader must see the strong claim, not the weak one.
    if (hit.closing.length) {
      out.push({ kind: 'landed-but-open', issue: i, detail:
        'is OPEN, but ' + hit.closing.length + ' commit subject(s) on ' + ref + ' claim to close it: ' +
        show(hit.closing) + (hit.mention.length ? ' (plus ' + hit.mention.length + ' more naming it)' : '') +
        '. A squash-merge and a hand-pushed commit both reach the default branch without closing anything, ' +
        'so the work landed while the ticket stayed on the startable frontier — which is how merged work ' +
        'gets built a second time. Read the commit, walk the acceptance boxes, then either tick them and ' +
        'close it (gh issue close ' + i.number + ' --comment "Landed in <sha>; verified <how>"), or say on ' +
        'the issue which box the commit did not meet.' });
      return;
    }
    out.push({ kind: 'landed-but-open?', issue: i, detail:
      'is OPEN, but its number appears in ' + hit.mention.length + ' commit subject(s) on ' + ref + ': ' +
      show(hit.mention) + '. Squash-merges land under "(#N)", so the implementing work may already be on ' +
      'the default branch. A partial fix and a passing reference look identical from here, which is why ' +
      'this is advisory: read the commit BEFORE starting the ticket, then close it (gh issue close ' +
      i.number + ') or say on the issue what is left. Advisory only.' });
  });
  return out;
}

/** OPEN issues asserting something a closed issue settled, as findings.
 *
 *  The weakest check here, and deliberately advisory: it cannot read meaning, only proximity. It
 *  fires when an open issue cites a CLOSED issue in prose without any nearby hedge, because the
 *  drift that prompted this tool was #23 asserting a behaviour #25 had just disproved.
 *
 *  Pure — it takes all issues and the number index and filters to open itself, so each narrowing
 *  below is testable without the network, and "a closed issue produces no finding" is a property of
 *  this function rather than of whatever the caller passed. */
function stalePremiseFindings(allIssues, byNumber) {
  const out = [];
  (allIssues || []).filter((i) => i.state === 'OPEN').forEach((i) => {
    // A PRD is a container: it enumerates its own sub-issues, and those closing is the PRD working,
    // not the PRD going stale. Skipping the label entirely is right — on the first cross-repo run,
    // ONE PRD produced all ten advisories in a repo, which is how a useful check becomes one people
    // scroll past.
    if ((i.labels || []).some((l) => l.name === 'prd')) return;
    const body = String(i.body || '').replace(/\r\n/g, '\n');
    // An explicit opt-out outranks every heuristic below, and says on the issue that it is meant.
    const ignored = stalePremiseIgnores(body);
    if (ignored.all) return;
    // Own-repo citations only: `owner/repo#N` and hex colours are not this repo's issues (see
    // citedIssueNumbers). The map also gives the first citation's offset for the wording check below.
    const cited = citedIssueNumbers(body);
    const citedNums = Array.from(cited.keys());
    const citedClosed = citedNums.filter((n) => {
      const o = byNumber.get(n);
      return o && o.state === 'CLOSED' && n !== i.number;
    });
    // A follow-up ticket exists BECAUSE work shipped. If the body carries either canonical
    // acknowledgment for ANY of its cited closed issues (see isFollowUpAcknowledgment above), the
    // whole body reads as a follow-up context — its other closed-issue citations are background, not
    // stale premises. The closer-PR union is the "any of these closers" set the predicate checks.
    const closerPrsUnion = Array.from(new Set(citedClosed.flatMap((n) =>
      (byNumber.get(n).closedByPullRequestsReferences || []).map((r) => r.number))));
    const bodyIsFollowUp = citedClosed.some((n) => isFollowUpAcknowledgment(body, n, closerPrsUnion));
    if (bodyIsFollowUp) return;
    citedClosed.forEach((n) => {
      if (ignored.numbers.has(n)) return;
      const other = byNumber.get(n);
      // First citation as a token: `body.indexOf('#' + n)` would land on `#730` or `repo#73` first.
      const idx = cited.get(n);
      // A citation on a checkbox line is a task list — a sub-issue roster, not an assertion about it.
      const lineStart = body.lastIndexOf('\n', idx) + 1;
      if (/^\s*[-*]\s*\[[ x]\]/.test(body.slice(lineStart, idx))) return;
      const around = body.slice(Math.max(0, idx - 220), idx + 220);
      if (/\b(closed|resolved|superseded|settled|confirmed|verified|per|see|split from|carried from|note from|update from|part of|tracked by|sub-issue|child)\b/i.test(around)) return;
      // A citation the surrounding prose presents as an example is about that issue, not this one.
      if (isExampleCitation(around)) return;
      out.push({ kind: 'stale-premise?', issue: i, detail:
        'cites closed #' + n + ' (' + other.title.slice(0, 50) + ') with no wording that acknowledges ' +
        'it is settled. Check this issue still describes reality. If the citation is deliberate, ' +
        'say so in the body (`see #' + n + '`, "for example") or add ' +
        '`<!-- tracker-audit-ignore: stale-premise #' + n + ' -->`. Advisory only.' });
    });
  });
  return out;
}

const findings = [];
function report(kind, issue, detail) {
  findings.push({ kind, number: issue.number, title: issue.title, url: issue.url, detail });
}

const TRIAGE = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-local-agent', 'ready-for-human', 'wontfix'];
// A master-orchestrator state notebook carries `orchestrator` alone (a living document each master
// rewrites every heartbeat, no pending ruling), so `orchestrator` counts as a triage state for the
// untriaged check. It is a category, not a workflow state, so it does not participate in the
// conflicting-triage check — a decision brief legitimately carries `orchestrator` AND
// `ready-for-human`.
const TRIAGED = TRIAGE.concat(['orchestrator']);
let edgesUnavailable = false;

// ---- 1. A prose blocker with no native edge is an ungated dependency -----------------------------
open.forEach((i) => {
  const prose = proseBlockers(i.body);
  if (!prose.length) return;
  const native = nativeBlockers(i.number);
  if (native === null) { edgesUnavailable = true; return; }
  // Only OPEN prose blockers should have a live edge; a closed one is already released, and GitHub
  // stops counting it, so its absence is not drift.
  const missing = prose.filter((b) => {
    const blocker = byNumber.get(b);
    return blocker && blocker.state === 'OPEN' && !native.includes(b);
  });
  if (missing.length) {
    report('ungated-dependency', i,
      'body says blocked by ' + missing.map((n) => '#' + n).join(', ') +
      ' but there is no native dependency edge, so the frontier query treats this as startable. Add: ' +
      missing.map((n) => 'gh api --method POST repos/' + REPO + '/issues/' + i.number +
        '/dependencies/blocked_by -F issue_id=$(gh api repos/' + REPO + '/issues/' + n +
        ' --jq .id)').join(' ; '));
  }
});

// ---- 2. A closed issue with unticked boxes ------------------------------------------------------
// Closing IS the terminal state here (there is deliberately no `done` label), so it has to mean
// verified. `Fixes #N` on a push to the default branch closes an issue whether or not its acceptance
// was met, which is exactly how this drifted.
// A `wontfix` close is the one exception, and it is not a loophole: closing means VERIFIED only when
// the work was done. `wontfix` says it will not be, so its acceptance boxes stay unticked for ever and
// flagging them makes the audit cry wolf every run — which is how an audit stops being read. It has to
// be the LABEL, so the reason is on the issue where a person can see it and argue with it, rather than
// GitHub's `NOT_PLANNED` state, which is invisible in the list and can be set without saying why.
issues.filter((i) => i.state === 'CLOSED').forEach((i) => {
  if (i.labels.some((l) => l.name === 'wontfix')) return;
  const { hard, soft } = untickedBoxes(i.body);
  const show = (list) => list.slice(0, 6).join('\n      - ') +
    (list.length > 6 ? '\n      - ...and ' + (list.length - 6) + ' more' : '');
  if (hard.length) {
    report('closed-with-open-boxes', i,
      hard.length + ' unticked acceptance box(es) on a CLOSED issue — reopen it, or tick them and ' +
      'say where each was verified:\n      - ' + show(hard));
  }
  if (soft.length) {
    report('closed-with-open-boxes?', i,
      soft.length + ' unticked box(es) on a CLOSED issue, but with no acceptance heading above them, ' +
      'so they may be open questions or a sub-issue list rather than acceptance. Advisory:\n      - ' +
      show(soft));
  }
});

// ---- 3. A reference to an issue that does not exist ---------------------------------------------
open.forEach((i) => {
  const cited = Array.from(new Set((String(i.body || '').match(/(?:^|[\s(])#(\d+)\b/g) || [])
    .map((s) => Number(s.replace(/\D/g, '')))));
  const dangling = cited.filter((n) => n !== i.number && !knownNumber(n));
  if (dangling.length) {
    report(prsUnavailable ? 'dangling-reference?' : 'dangling-reference', i,
      'cites ' + dangling.map((n) => '#' + n).join(', ') + ', which is ' + (prsUnavailable
        ? 'not an issue in this repo. Pull requests could not be listed on this run, so it may be a ' +
          'perfectly good PR — advisory until `gh pr list` works.'
        : 'neither an issue nor a pull request in this repo. A pointer to nothing reads as "the ' +
          'reasoning is written down somewhere".'));
  }
});

// ---- 4. Triage labels: the intake guarantee -----------------------------------------------------
open.forEach((i) => {
  const names = i.labels.map((l) => l.name);
  const states = names.filter((n) => TRIAGE.includes(n));
  const triaged = names.filter((n) => TRIAGED.includes(n));
  if (triaged.length === 0) report('untriaged', i, 'carries no triage label, so it is invisible to every triage query.');
  if (states.length > 1) report('conflicting-triage', i, 'carries ' + states.join(' AND ') + ' — pick one.');
});

// ---- 5. An open issue asserting something a closed issue settled -------------------------------
// The classification lives in stalePremiseFindings above, pure, so its narrowings are pinned by the
// test suite rather than by a live run against whatever the tracker holds today.
stalePremiseFindings(issues, byNumber).forEach((f) => report(f.kind, f.issue, f.detail));

// ---- 6. The Projects board is a THIRD record of state, and it drifts ---------------------------
// This repo deliberately has no `done` label, because a second answer to "is this finished" always
// ends up disagreeing with the first. A Projects board is exactly that second answer, reintroduced
// structurally — and it drifted in both directions within a day:
//
//   * `Fixes #N` closed three issues, the board's built-in "item closed -> Done" workflow moved them
//     to Done, then reopening the issues did NOT move them back. The board read Done while the issues
//     were open with unmet acceptance, so there was no reason for anyone to look at them.
//   * Four newly-filed issues were not on the board at all. Auto-add is an owner-only project setting
//     and was off, so every new issue has to be added by hand — and four in a row were not.
//
// Skipped entirely, and said out loud, when the repo has no board.
// Board status is pulled from a supplemental GraphQL call above (REST has no `projectItems`
// field), on `repository.issues { projectItems { fieldValueByName(name:"Status") } }`. That
// replaced an earlier GraphQL lookup that discovered the project first, which was both fragile
// (nested quoting through cmd.exe failed intermittently) and wrong: it searched
// `repository.projectsV2`, which returns only projects LINKED to the repo, while this board is
// owner-level. It confidently reported "no board" for a board holding 26 cards.
//
// Whether a board is in use is inferred from the data rather than discovered: if no issue anywhere
// carries a card, there is no board to compare against.  When the supplemental GraphQL call
// itself is unavailable (Claude Code cloud egress proxy 403s GraphQL, issue 130) the check is
// skipped with a distinct NOTE — "unavailable" is not the same as "no board".
const boardInUse = issues.some((i) => (i.projectItems || []).length > 0);
if (boardUnavailable) {
  // In cloud the ProjectsV2 GraphQL endpoint 403s (issue 130). The check is skipped, and the NOTE
  // at the bottom flags this as blind rather than clean — treat as unknown, not "no board here".
  console.log('NOTE: the ProjectsV2 GraphQL endpoint was unavailable, so board/issue state was not compared.\n');
} else if (!boardInUse) {
  console.log('NOTE: no issue carries a Projects board card, so board/issue state was not compared.\n');
} else {
  open.forEach((i) => {
    const card = (i.projectItems || [])[0];
    if (!card) {
      report('not-on-board', i,
        'is open but not on the Projects board, so it is invisible to anyone working from the board. ' +
        'Add: gh project item-add <n> --owner <owner> --url ' + i.url);
      return;
    }
    if (/^done$/i.test((card.status && card.status.name) || '')) {
      report('board-says-done', i,
        'is OPEN but the board says Done — so nobody has a reason to look at it. This happens when ' +
        '`Fixes #N` closes an issue, the board\'s closed->Done workflow fires, and reopening the ' +
        'issue does not move the card back.');
    }
  });
}

// ---- 7. An issue blocked on a PR that has since posted its answer -------------------------------
// On aac-bill-intake, 2026-07-31, an issue said it was blocked on a PR's holdout report. The report
// had been posted to that PR the day before — an agent read the PR's `state` field, saw OPEN,
// believed the blocker, and spent a session re-deriving both numbers from the live API. Nothing here
// looked at PRs at all, so the audit exited 0 while the tracker asserted a blocker its own repo had
// already cleared.
//
// This is a HARD finding despite being a heuristic, a deliberate exception to the rule stated at the
// Output block. The remedy is correct whichever way the heuristic lands: read the thread, then
// restate the blocker in terms of what it says, or drop it. A false positive costs one
// `gh pr view --comments`.
//
// There is no prose escape hatch, and that is the point. The first version of this check exempted an
// issue whose body used reading words near the citation, and it went silent on the very issue it was
// written for: "Read the report first" is an instruction to a future reader, not evidence anyone read
// it. Wording cannot distinguish those. So the only way to silence this is an explicit marker naming
// the PR and the comment date the claim was checked against:
//
//     <!-- blocker-verified: #34 @2026-07-30 -->
//
// A later comment on that PR invalidates the marker and the finding returns, because the date moved.
const BLOCK_NEAR = /\b(blocked|blocker|waits? on|waiting on|gated on|depends on|until)\b/i;
open.forEach((i) => {
  const body = String(i.body || '').replace(/\r\n/g, '\n');
  const prose = new Set(proseBlockers(body));
  const cited = Array.from(new Set((body.match(/#(\d+)/g) || []).map((s) => Number(s.slice(1)))));
  cited.forEach((n) => {
    const pr = prByNumber.get(n);
    if (!pr || !pr.commentCount) return;
    const idx = body.indexOf('#' + n);
    if (!(prose.has(n) || BLOCK_NEAR.test(body.slice(Math.max(0, idx - 200), idx + 200)))) return;
    const marker = new RegExp('blocker-verified:\\s*#' + n + '\\s*@\\s*(\\d{4}-\\d{2}-\\d{2})', 'i')
      .exec(body);
    const last = pr.lastComment ? pr.lastComment.slice(0, 10) : null;
    if (marker && last && marker[1] >= last) return;
    report('blocker-may-be-answered', i,
      'says it is blocked on PR #' + n + ' (' + pr.title.slice(0, 50) + '), which carries ' +
      pr.commentCount + ' comment' + (pr.commentCount === 1 ? '' : 's') +
      (last ? ', the last dated ' + last : '') +
      (marker ? ', newer than this issue\'s blocker-verified marker (' + marker[1] + ')' : '') +
      '. A PR thread is where measurements land — the blocker may already be answered there. Read ' +
      'it (`gh pr view ' + n + ' --comments`), then restate or drop the claim and stamp ' +
      '`<!-- blocker-verified: #' + n + ' @' + (last || 'YYYY-MM-DD') + ' -->`.');
  });
});

// ---- 8. Milestones: once a repo sequences work, an unsequenced issue is invisible to planning ---
// Same infer-from-data posture as the board check: milestones are opt-in, and a repo that has never
// created one is not drifting by not using them. But once ANY issue carries a milestone, the repo has
// chosen milestones as its sequencing record, and an open issue outside every milestone is work no
// milestone view will ever show. Observed on aac-contract-builder 2026-08-21: 26 of 29 open issues
// unmilestoned because milestones were created mid-push — no tool noticed.
const milestonesInUse = issues.some((i) => i.milestone && i.milestone.title);
if (!milestonesInUse) {
  console.log('NOTE: no issue carries a milestone, so milestone coverage was not checked.\n');
} else {
  open.forEach((i) => {
    if (!(i.milestone && i.milestone.title)) {
      report('unmilestoned', i,
        'is open with no milestone while this repo sequences work with milestones, so no milestone ' +
        'view will ever surface it. Assign one: gh issue edit ' + i.number + ' --milestone "<title>"');
    }
  });
}

// ---- 9. An open issue whose work already merged -------------------------------------------------
// The blind spot aac-cockpit #220 was filed for: on 2026-08-04 this tool reported 0 drift while 24 of
// the 27 open issues had an implementing commit on `main` — found only by grepping the git log by
// hand. Every other check here reads the tracker against itself; none of them can see the repository.
//
// The cost is not bookkeeping. A close-out session, or any agent picking a "startable" frontier
// ticket, re-implements work that already merged.
//
// No new dependency: the audit already needs the network and `gh`, and the repository is on disk.
let logUnavailable = false;
const gitRefExists = (ref) => {
  try { sh('git rev-parse --verify --quiet ' + ref); return true; } catch (e) { return false; }
};
// The remote-tracking ref first: it is what actually REACHED the default branch. A local branch is the
// fallback, and HEAD deliberately is not one — in a worktree HEAD carries unmerged work, which would
// report a ticket as landed while its commits sit on a branch nobody has merged.
const LOG_REF = DEFAULT_BRANCH && gitRefExists('origin/' + DEFAULT_BRANCH) ? 'origin/' + DEFAULT_BRANCH
              : DEFAULT_BRANCH && gitRefExists(DEFAULT_BRANCH) ? DEFAULT_BRANCH
              : null;
if (!LOG_REF) {
  logUnavailable = true;
} else {
  // Best effort, and bounded: the issue list is read live from GitHub, so comparing it against a stale
  // origin/main misses exactly the commits that landed most recently. A failed or slow fetch is not fatal
  // — the scan still runs against whatever is on disk — but it must never hang the audit.
  try {
    execSync('git fetch --quiet origin ' + DEFAULT_BRANCH,
             { stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000, env: CHILD_ENV });
  } catch (e) { /* offline, or no such remote. Scan what is here. */ }
  try {
    landedFindings(issues, landedCommits(git(['log', '--no-color', '--format=' + LOG_FORMAT, LOG_REF])),
                   LOG_REF).forEach((f) => report(f.kind, f.issue, f.detail));
  } catch (e) {
    logUnavailable = true;
  }
}

// ---- 10. The same finding filed twice -----------------------------------------------------------
// Advisory, and title-only: it cannot read two bodies and tell one finding from two. What it can see
// is the shape issue 319 recorded — #281 and #285, filed two minutes apart by two discovery-triage
// chores running in the same fleet wave, for one `tools/tracker-audit.js` short-fetch. A second
// scout listed both as startable and two implementers built the same fix on two branches. Titles
// that survive stop-word and qualifier stripping identically ("still", "again", "the") are that
// collision, visible before the second implementer starts.
duplicateTitleFindings(open).forEach((d) => {
  report('duplicate-title?', d.issue,
    'normalizes to the same title as open #' + d.duplicateOf.number + ' ("' + String(d.duplicateOf.title).slice(0, 60) +
    '") once stop words and qualifiers (still, again, the) are stripped — both read as "' + d.normalized +
    '". Two open tickets for one finding: read both, keep the one carrying the evidence, close the other ' +
    'as a duplicate (gh issue close ' + d.issue.number + ' --reason "not planned"). Advisory only.');
});

// ---- 11. An acceptance box whose subject another ticket deleted ---------------------------------
// Check 9 reads the log for work that landed. This reads the same branch for work that was UNdone:
// a path an acceptance box still names, which a later ticket deleted. Observed on #120, whose
// `writing` box outlived `aac-skills/writing/` by a month (deleted 2026-09-14 by issue 178) — two
// fleet attempts started the ticket before discovering the subject was gone. The stale-premise?
// check next door only sees issue-to-issue citations, and #120 predates #178, so nothing linked them.
//
// Advisory, and narrowed to DELETED rather than merely absent: an acceptance box naming a path the
// ticket will create is the normal case, and a check that fires on it is one people scroll past.
let deletedScanUnavailable = false;
if (!LOG_REF) {
  deletedScanUnavailable = true;
} else {
  try {
    const index = deletedPathIndex(
      git(['log', '--no-color', '--diff-filter=D', '--name-only', '--format=', LOG_REF]),
      git(['ls-tree', '-r', '--name-only', LOG_REF]));
    deletedSubjectFindings(issues, index).forEach((f) => report(f.kind, f.issue, f.detail));
  } catch (e) {
    deletedScanUnavailable = true;
  }
}

// ---- Output ------------------------------------------------------------------------------------
// Anything ending in '?' is advisory: reported, never fails the run. A check that cannot tell a
// real problem from a shape it misreads must not be able to block anyone. (blocker-may-be-answered
// is the one deliberate exception — see its header.)
const ORDER = ['ungated-dependency', 'landed-but-open', 'blocker-may-be-answered',
               'closed-with-open-boxes', 'dangling-reference', 'untriaged', 'conflicting-triage',
               'board-says-done', 'not-on-board', 'unmilestoned', 'landed-but-open?',
               'closed-with-open-boxes?', 'dangling-reference?', 'stale-premise?',
               'duplicate-title?', 'deleted-subject?'];
findings.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.number - b.number);

console.log('Tracker audit — ' + REPO + ' (' + open.length + ' open, ' + issues.length + ' total)\n');

if (edgesUnavailable) {
  console.log('NOTE: the native issue-dependencies endpoint was unavailable for at least one issue,');
  console.log('so ungated dependencies could not be checked there. Treat as unknown, not clean.\n');
}

if (prsUnavailable) {
  console.log('NOTE: `gh api repos/.../pulls` failed, so no pull request is visible to this run. A');
  console.log('`#N` naming a PR cannot be told from a pointer to nothing, so the dangling-reference');
  console.log('check is advisory here, and blocker-may-be-answered could not run at all. Under');
  console.log('Actions this means the workflow grants no `pull-requests: read`. Treat as unknown,');
  console.log('not clean.\n');
}

if (logUnavailable) {
  console.log('NOTE: the default branch\'s git log could not be read' +
              (DEFAULT_BRANCH ? ' (' + DEFAULT_BRANCH + ')' : '') + ', so no open issue was checked');
  console.log('against the work that already merged. Treat as unknown, not clean.\n');
}

if (deletedScanUnavailable) {
  console.log('NOTE: the default branch\'s deleted-path history could not be read, so no acceptance');
  console.log('box was checked against a subject another ticket deleted. Treat as unknown, not clean.\n');
}

if (boardUnavailable) {
  console.log('NOTE: the ProjectsV2 GraphQL endpoint (which underlies `projectItems`) was not');
  console.log('available, so board-says-done and not-on-board could not run. The Claude Code');
  console.log('cloud egress proxy blocks GraphQL — run this locally to check the board.\n');
}

/** Any blind spot means this run cannot stand behind a clean result — exit 2, never 0.
 *  boardUnavailable is deliberately NOT in this list: GraphQL is genuinely unreachable in a
 *  Claude-Code cloud container (issue 130) and marking every cloud run blind would collapse
 *  every cloud audit to exit 2, which is the same "could not check reported as a pass" shape
 *  this tool exists to refuse. The NOTE above says the two board checks did not run, and the
 *  audit reports on everything the REST endpoints did cover. */
const blind = edgesUnavailable || prsUnavailable || logUnavailable || deletedScanUnavailable;

if (!findings.length) {
  console.log('No drift found across ' + ORDER.length + ' checks.');
  process.exit(blind ? 2 : 0);
}

const hard = findings.filter((f) => !f.kind.endsWith('?'));
findings.forEach((f) => {
  console.log('[' + f.kind + '] #' + f.number + ' ' + f.title);
  console.log('    ' + f.detail);
  console.log('    ' + f.url + '\n');
});
console.log(hard.length + ' drift finding(s)' +
            (findings.length - hard.length ? ', plus ' + (findings.length - hard.length) + ' advisory' : '') + '.');
// Advisory-only findings used to exit 0 even when a NOTE above said a check could not run, which is
// the "could not check reported as a pass" this tool exists to refuse. Drift still outranks it: 1.
process.exit(hard.length ? 1 : blind ? 2 : 0);
