#!/usr/bin/env node
/**
 * node tools/closure-guard.js --issue <n> [--apply]
 *
 * Reopens an issue that a COMMIT closed while an acceptance box was still unticked, leaving one
 * comment naming the unticked boxes and the closing PR or commit.
 *
 * WHY (issue 475). `Fixes #N` / `Closes #N` closes the issue the moment it reaches the default
 * branch — including an issue deliberately held open because a box still needs a deploy, a live
 * run or an owner's ruling. `/session-end` step 5 asked the assistant to re-verify every closure
 * by hand after each push, and the session-end skill itself records that this has been missed
 * more than once ("Two things the script cannot check"). A close event is the exact moment the
 * check is cheap, so the check lives on the event: `.github/workflows/closure-guard.yml`, on
 * `issues: closed`, with `issues: write` and the built-in GITHUB_TOKEN. The tracker audit's
 * `closed-with-open-boxes` class stays as a backstop instead of being the only catch.
 *
 * A PERSON'S CLOSE IS A DECISION AND IS LEFT ALONE. The guard reopens only what a commit closed:
 * the last `closed` event of the issue's timeline carries a `commit_id` exactly when the close
 * came from the default branch, and nothing else is touched. A `wontfix` label, or a close as
 * `not_planned`/`duplicate`, is left alone whoever made it — the same exemption
 * `tools/tracker-audit.js` gives those issues, so the two agree about which closures are honest.
 *
 * WHICH BOXES COUNT: `untickedBoxes(body).hard` from `tools/tracker-audit.js`, so the guard
 * reopens exactly what the audit would report and nothing wider. Boxes with no acceptance heading
 * above them, and boxes the audit reads as consciously dropped (`superseded by #N`), are not
 * acceptance and are not grounds to reopen.
 *
 * THE SETTLE WINDOW, AND THE TICK IT DEFERS TO. `.github/workflows/tick-acceptance-boxes.yml`
 * (issue 438) fires on the same merge and ticks the boxes of every issue a merged PR closes, on
 * the strength of the verifier evidence quoted in that PR's body. Both jobs therefore wake up on
 * one merge, and a guard that read the body first would reopen a ticket the tick is about to tick
 * — leaving an OPEN issue with a full ledger, which is worse drift than the one it set out to
 * stop. So when a PR closed the issue, the guard re-reads the body for up to SETTLE_MS and
 * reopens only if the boxes are STILL unticked when that window ends. The tick wins the merges it
 * covers; the guard keeps the cases it does not — a bare `Fixes #N` pushed straight to the
 * default branch (no PR, so no tick ever runs: issue 475's own evidence), and a merge whose tick
 * job failed or was never installed. A commit with no pull request skips the window entirely.
 *
 * Idempotent: an issue that is already open is left alone, so a `workflow_dispatch` replay writes
 * nothing. Dry run unless `--apply`.
 *
 * The network-touching half takes an injectable `runGh` (and an injectable clock and sleep), so
 * the whole flow is unit-testable in-process against a fake. See tools/closure-guard.test.js.
 */
'use strict';

const { execFileSync } = require('child_process');
const { untickedBoxes, parseGithubSlug } = require('./tracker-audit.js');
const { closingRefs } = require('./tick-acceptance-boxes.js');

/** How long to let a merge's acceptance-box tick land before judging the body, and the poll gap. */
const SETTLE_MS = 3 * 60 * 1000;
const POLL_MS = 15 * 1000;
/** Closures the guard never second-guesses, whoever or whatever made them. */
const EXEMPT_STATE_REASONS = ['not_planned', 'duplicate'];
const EXEMPT_LABEL = 'wontfix';

/** Block this thread. Everything else here is synchronous (`execFileSync`), so the sleep is too. */
function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Default `gh` runner: argv array, optional stdin. Returns stdout. Throws on non-zero exit. */
function defaultRunGh(args, input) {
  const opts = { encoding: 'utf8', stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] };
  if (input !== undefined) opts.input = input;
  return execFileSync('gh', args, opts);
}

/** owner/repo for the run: GITHUB_REPOSITORY when a runner set it, else origin's remote. */
function repoSlug(env) {
  const e = env || process.env;
  if (e.GITHUB_REPOSITORY && /\S+\/\S+/.test(e.GITHUB_REPOSITORY)) return e.GITHUB_REPOSITORY;
  // `.trim()` is load-bearing: `parseGithubSlug`'s regex is `$`-anchored with no `m` flag, so the
  // newline `git remote get-url` prints makes every remote unparseable.
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const slug = parseGithubSlug(remote);
  if (!slug) throw new Error('cannot read owner/repo from `git remote get-url origin`: ' + String(remote).trim());
  return slug.owner + '/' + slug.name;
}

/**
 * The issue timeline, page by page. No `--paginate`: gh concatenates one JSON array per page and
 * the result does not parse (issue 171 is the same lesson in tools/tracker-audit.js).
 */
function readTimeline(gh, slug, issueNumber, maxPages) {
  const cap = maxPages == null ? 10 : maxPages;
  const out = [];
  for (let page = 1; page <= cap; page += 1) {
    const batch = JSON.parse(gh(['api', 'repos/' + slug + '/issues/' + issueNumber + '/timeline?per_page=100&page=' + page]));
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push.apply(out, batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * How the issue was closed, read off the LAST `closed` event of its timeline — an issue closed,
 * reopened and closed again is judged on the close that stands. `commit` is set exactly when a
 * commit on the default branch did the closing; a person's close through the UI or the API
 * carries none. A close GitHub attributes to no commit is therefore read as a person's — the guard
 * fails conservative, leaving the audit's `closed-with-open-boxes` backstop to catch it. Returns
 * null when the timeline holds no close at all. Pure.
 */
function closerOf(events) {
  const closes = (events || []).filter((e) => e && e.event === 'closed');
  if (closes.length === 0) return null;
  const e = closes[closes.length - 1];
  return {
    commit: e.commit_id || null,
    byCommit: Boolean(e.commit_id),
    actor: (e.actor && e.actor.login) || null,
    stateReason: e.state_reason || null,
    closedAt: e.created_at || null,
  };
}

/**
 * The pull request a closing commit came from, preferring a MERGED one whose own body closes this
 * issue. Returns null for a commit pushed straight to the default branch — there is no PR to name
 * and no acceptance-box tick to wait for.
 */
function prForCommit(gh, slug, sha, issueNumber) {
  let prs;
  try {
    prs = JSON.parse(gh(['api', 'repos/' + slug + '/commits/' + sha + '/pulls?per_page=20']));
  } catch (e) {
    return null; // no `pull-requests: read`, or a commit GitHub associates with nothing
  }
  if (!Array.isArray(prs) || prs.length === 0) return null;
  const merged = prs.filter((p) => p && p.merged_at);
  const list = merged.length ? merged : prs;
  const n = Number(issueNumber);
  return list.find((p) => closingRefs(String(p.title || '') + '\n' + String(p.body || '')).includes(n)) || list[0];
}

/**
 * Re-read the issue until its acceptance boxes are ticked or the settle window ends, so the
 * merge's own tick (issue 438) is what the guard judges rather than what it races. Returns the
 * last issue read, the boxes still unticked, and the notes to print. See the header.
 */
function settleBoxes(gh, slug, issueNumber, opts) {
  const now = opts.now || (() => Date.now());
  const sleep = opts.sleep || sleepSync;
  const pollMs = opts.pollMs == null ? POLL_MS : opts.pollMs;
  const deadline = now() + (opts.settleMs == null ? SETTLE_MS : opts.settleMs);
  const notes = [];
  let issue = opts.issue;
  let boxes = untickedBoxes(issue.body).hard;
  while (boxes.length > 0 && now() < deadline) {
    sleep(pollMs);
    issue = JSON.parse(gh(['api', 'repos/' + slug + '/issues/' + issueNumber]));
    boxes = untickedBoxes(issue.body).hard;
    notes.push(boxes.length === 0
      ? 'the boxes were ticked inside the settle window — the merge tick got there, standing down'
      : boxes.length + ' box(es) still unticked after a settle poll');
  }
  return { issue, boxes, notes };
}

/** The comment the guard leaves when it reopens, naming the boxes and the closing PR or commit. */
function reopenComment(o) {
  const by = o.pr
    ? 'PR #' + o.pr.number + (o.pr.html_url ? ' (' + o.pr.html_url + ')' : '')
    : 'commit ' + String(o.commit || '').slice(0, 12);
  return [
    'Reopened by the closure guard: ' + by + ' closed this issue while ' + o.boxes.length +
      ' acceptance box(es) were still unticked.',
    '',
    o.boxes.map((b) => '- [ ] ' + b).join('\n'),
    '',
    'A closing keyword closes an issue the moment it reaches the default branch, whether or not',
    'the boxes above are true — and a box waiting on a deploy, a live run or an owner ruling is',
    'exactly the kind this happens to. Nothing was re-verified here and nothing was un-ticked:',
    'either tick each box above where it was verified and close this again, or say on the ticket',
    'what it is waiting for. Written by `tools/closure-guard.js` on the `issues: closed` event',
    '(claude-dotfiles issue 475). A close made by a person is read as a decision and left alone;',
    'this one came from a commit.',
  ].join('\n');
}

/**
 * Guard one close.
 *   opts.slug    - owner/repo (default: repoSlug()).
 *   opts.apply   - write; otherwise report only.
 *   opts.runGh   - injectable gh runner.
 *   opts.now / opts.sleep / opts.settleMs / opts.pollMs - the settle window (see settleBoxes).
 * Returns { action: 'reopened' | 'would-reopen' | 'left-alone', reason, issue, boxes, pr, commit,
 * notes }.
 */
function guardClose(issueNumber, opts) {
  opts = opts || {};
  const gh = opts.runGh || defaultRunGh;
  const slug = opts.slug || repoSlug();
  const n = Number(issueNumber);
  const notes = [];
  const done = (action, reason, extra) => Object.assign(
    { action, reason, issue: n, boxes: [], pr: null, commit: null, notes }, extra || {});

  let issue = JSON.parse(gh(['api', 'repos/' + slug + '/issues/' + n]));
  // Idempotency, and the answer to a replay: an open issue has nothing to reopen.
  if (issue.state !== 'closed') return done('left-alone', '#' + n + ' is open — nothing to reopen');
  if ((issue.labels || []).some((l) => (l && l.name ? l.name : l) === EXEMPT_LABEL)) {
    return done('left-alone', '#' + n + ' carries `' + EXEMPT_LABEL + '` — a dropped ticket keeps its unticked boxes');
  }
  if (EXEMPT_STATE_REASONS.includes(issue.state_reason)) {
    return done('left-alone', '#' + n + ' was closed as ' + issue.state_reason + ' — not a claim that the work shipped');
  }

  const closer = closerOf(readTimeline(gh, slug, n));
  if (!closer) return done('left-alone', '#' + n + ' has no close event in its timeline — nothing to judge');
  if (!closer.byCommit) {
    return done('left-alone', '#' + n + ' was closed by ' + (closer.actor ? '@' + closer.actor : 'a person') +
      ', not by a commit — a person closing an issue is making a decision, and the guard leaves it alone');
  }

  const pr = prForCommit(gh, slug, closer.commit, n);
  let boxes = untickedBoxes(issue.body).hard;
  if (boxes.length === 0) {
    return done('left-alone', '#' + n + ' has no unticked acceptance box — closing it claimed nothing untrue',
      { pr, commit: closer.commit });
  }
  if (pr) {
    // The merge that closed this issue also woke the acceptance-box tick. Let it land first.
    notes.push('closed by merged PR #' + pr.number + ' — letting the acceptance-box tick (issue 438) land before judging');
    const settled = settleBoxes(gh, slug, n, Object.assign({}, opts, { issue }));
    issue = settled.issue;
    boxes = settled.boxes;
    notes.push.apply(notes, settled.notes);
    if (issue.state !== 'closed') {
      return done('left-alone', '#' + n + ' was reopened while the guard waited — nothing left to do', { pr, commit: closer.commit });
    }
    if (boxes.length === 0) {
      return done('left-alone', '#' + n + "'s boxes were ticked by the merge tick — closing it claims nothing untrue now",
        { pr, commit: closer.commit });
    }
  }

  const found = { boxes, pr, commit: closer.commit };
  if (!opts.apply) return done('would-reopen', 'DRY RUN', found);
  gh(['api', '--method', 'PATCH', 'repos/' + slug + '/issues/' + n, '--input', '-'],
     JSON.stringify({ state: 'open', state_reason: 'reopened' }));
  gh(['api', '--method', 'POST', 'repos/' + slug + '/issues/' + n + '/comments', '--input', '-'],
     JSON.stringify({ body: reopenComment({ boxes, pr, commit: closer.commit }) }));
  return done('reopened', 'reopened with ' + boxes.length + ' unticked acceptance box(es)', found);
}

module.exports = {
  closerOf, prForCommit, readTimeline, settleBoxes, reopenComment, guardClose, repoSlug,
  defaultRunGh, sleepSync, SETTLE_MS, POLL_MS,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const valueOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const issueNumber = valueOf('--issue');
  if (!issueNumber || !/^\d+$/.test(issueNumber)) {
    console.error('usage: node tools/closure-guard.js --issue <n> [--apply]');
    process.exit(2);
  }
  let res;
  try {
    res = guardClose(Number(issueNumber), { apply });
  } catch (e) {
    console.error('::error::could not guard the closure of #' + issueNumber + ': ' + e.message);
    process.exit(2);
  }
  for (const note of res.notes) console.log(note);
  if (res.action === 'left-alone') { console.log(res.reason + '.'); process.exit(0); }
  console.log((res.action === 'reopened' ? 'REOPENED #' : 'WOULD REOPEN #') + res.issue + ': ' +
    res.boxes.length + ' unticked acceptance box(es), closed by ' +
    (res.pr ? 'PR #' + res.pr.number : 'commit ' + String(res.commit).slice(0, 12)));
  for (const b of res.boxes) console.log('      - ' + b);
  if (!apply) console.log('DRY RUN — re-run with --apply to write.');
}
