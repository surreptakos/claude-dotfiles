#!/usr/bin/env node
/**
 * node tools/issue-metadata-audit.js [--issue <n>] [--apply]
 *
 * The two tracker-only checks that used to be `/session-end` step 9, run by
 * `.github/workflows/issue-metadata-audit.yml` instead of by every session:
 *
 *   a. An open issue with no milestone, while the repo uses milestones, is assigned the single
 *      open milestone when there is exactly one. With several, one comment names them and
 *      nothing else changes — no milestone guessed, no label touched.
 *   b. An acceptance section listing PROSE bullets (`- foo`, never converted to `- [ ] foo`)
 *      has its bullets converted in place, and one comment names the change.
 *   c. An open issue whose real acceptance ledger is fully ticked gets one comment asking
 *      close-or-add-box. It is never closed here — only a reader knows which of the two it is.
 *
 * WHY A WORKFLOW (issue 472). Both checks scale with the size of the tracker, not with what a
 * session touched, so every `/session-end` paid two paged tracker queries plus an edit per hit
 * for housekeeping that has nothing to do with the session's own branch. An `issues` event is
 * the earliest moment either condition can appear, and a daily tick covers bodies edited by a
 * path that fires no event. Step 9 now reads this job's latest run, the way step 6 reads Board
 * sweep.
 *
 * IDEMPOTENT, and that is a hard requirement rather than a nicety: this job runs on every issue
 * edit, so a second run on an unchanged tracker must write nothing. Two mechanisms —
 *   * the body rewrite matches nothing once the bullets are boxes, so no PATCH is sent; and
 *   * every comment carries an HTML marker (`<!-- issue-metadata-audit:<kind> -->`) which is
 *     looked for in the issue's existing comments before one is posted.
 * A run that reads the tracker and finds nothing to do makes zero writes.
 *
 * EXIT CODES. 0 = swept (with or without writes). 1 = the tracker could not be read, or a write
 * failed. A token-less run must never look like a clean sweep, which is why a read failure is
 * loud rather than an empty list.
 *
 * The network-touching half takes an injectable `runGh`, so the whole read/patch/comment flow is
 * unit-testable in-process against a fake. See tools/issue-metadata-audit.test.js.
 */
'use strict';

const { execFileSync } = require('child_process');
const { parseGithubSlug } = require('./tracker-audit.js');

/** The acceptance heading, and the scope under it, exactly as tools/tracker-audit.js reads them. */
const ACCEPT_HEADING = /^##+\s*(Done when|Acceptance criteria|Acceptance)\s*$/im;
/** Any checkbox line, ticked or not — what tells a real ledger from a prose list. */
const BOX_LINE = /^\s*[-*]\s*\[[ xX]\]\s*/;
const UNTICKED_LINE = /^\s*[-*]\s*\[ \]\s*/;
/**
 * A bullet at column 0 only. An INDENTED bullet under a box is that box's explanation, not a
 * criterion of its own, and converting it would invent acceptance criteria nobody wrote.
 */
const TOP_BULLET = /^([-*])(\s+)(\S.*)$/;

const MARKERS = {
  converted: '<!-- issue-metadata-audit:boxes-converted -->',
  ambiguous: '<!-- issue-metadata-audit:milestone-ambiguous -->',
  delivered: '<!-- issue-metadata-audit:delivered-but-open -->',
};

/** The acceptance section's byte range in `text` (LF-normalized), or null when there is none. Pure. */
function acceptanceScope(text) {
  const m = ACCEPT_HEADING.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^##\s/m);
  return { start, end: next === -1 ? text.length : start + next };
}

/** Split the scope into lines, marking the ones inside a fenced code block. Pure. */
function scopeLines(text, scope) {
  let fenced = false;
  return text.slice(scope.start, scope.end).split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return { line, fenced: true }; }
    return { line, fenced };
  });
}

/**
 * What the issue's acceptance ledger is:
 *   'none'     - no acceptance heading at all.
 *   'prose'    - a heading whose scope holds no checkbox: what check (b) converts.
 *   'open'     - at least one unticked box: nothing to do.
 *   'complete' - boxes, all of them ticked: what check (c) comments on.
 * Pure.
 */
function ledgerState(body) {
  const text = String(body == null ? '' : body).replace(/\r\n/g, '\n');
  const scope = acceptanceScope(text);
  if (!scope) return 'none';
  const lines = scopeLines(text, scope).filter((l) => !l.fenced).map((l) => l.line);
  const boxes = lines.filter((l) => BOX_LINE.test(l));
  if (boxes.length === 0) return 'prose';
  return lines.some((l) => UNTICKED_LINE.test(l)) ? 'open' : 'complete';
}

/**
 * Convert the prose bullets of the acceptance section to unchecked boxes, in place.
 * Returns { body, converted } — `converted` is the text of each line changed, in body order, and
 * `body` is byte-identical to the input (CRLF included) when nothing was converted.
 *
 * Deliberately narrow, because the cost of a wrong conversion is an invented acceptance
 * criterion on somebody's ticket:
 *   * only under `## Done when` / `## Acceptance criteria` / `## Acceptance` — `## Non-goals`,
 *     `## Evidence` and `## References` are prose lists by design and are outside every scope;
 *   * only when the scope holds NO checkbox at all. A ledger with boxes plus a trailing prose
 *     note is a ledger somebody wrote on purpose, and the failure mode this exists for is the
 *     acceptance section that has no boxes whatsoever;
 *   * only bullets at column 0, and never inside a fenced code block.
 * Pure.
 */
function convertProseBullets(body) {
  const src = String(body == null ? '' : body);
  const crlf = /\r\n/.test(src);
  const text = src.replace(/\r\n/g, '\n');
  if (ledgerState(text) !== 'prose') return { body: src, converted: [] };
  const scope = acceptanceScope(text);
  const converted = [];
  const lines = scopeLines(text, scope).map(({ line, fenced }) => {
    if (fenced) return line;
    const b = TOP_BULLET.exec(line);
    if (!b) return line;
    converted.push(b[3].trim());
    return b[1] + ' [ ]' + b[2] + b[3];
  });
  if (converted.length === 0) return { body: src, converted: [] };
  const out = text.slice(0, scope.start) + lines.join('\n') + text.slice(scope.end);
  return { body: crlf ? out.replace(/\n/g, '\r\n') : out, converted };
}

/**
 * What to do about an open issue's missing milestone, given the repo's OPEN milestones.
 *   { action: 'assign', milestone }   - exactly one open milestone: it is the only answer.
 *   { action: 'comment', milestones } - several: name them and change nothing.
 *   { action: 'none', why }           - the issue has one already, or the repo has no open
 *                                       milestone to assign (a repo that does not use milestones,
 *                                       or one whose milestones are all closed — there is nothing
 *                                       to list and nothing to pick, so no comment either).
 * Pure.
 */
function milestonePlan(issue, openMilestones) {
  if (issue && issue.milestone) return { action: 'none', why: 'already in a milestone' };
  const open = (openMilestones || []).filter((m) => m && m.state !== 'closed');
  if (open.length === 0) return { action: 'none', why: 'repo has no open milestone' };
  if (open.length === 1) return { action: 'assign', milestone: open[0] };
  return { action: 'comment', milestones: open };
}

/** The comment that records a prose-to-box conversion. Pure. */
function convertedComment(converted) {
  return [
    MARKERS.converted,
    'The acceptance section of this issue listed prose bullets, not checkboxes, so every tracker',
    'check that counts unticked boxes read it as a finished ledger. ' + converted.length
      + ' bullet(s) converted to `- [ ]`:',
    '',
    converted.map((t) => '- ' + t).join('\n'),
    '',
    'Nothing else changed: only bullets at the start of a line directly under the acceptance',
    'heading were touched, and `## Non-goals`, `## Evidence` and `## References` were left alone.',
    'Written by `tools/issue-metadata-audit.js` (claude-dotfiles issue 472).',
  ].join('\n');
}

/** The comment for an un-milestoned issue with more than one open milestone. Pure. */
function ambiguousMilestoneComment(milestones) {
  return [
    MARKERS.ambiguous,
    'This open issue has no milestone, and this repo has ' + milestones.length + ' open milestones,',
    'so there is no single answer to assign. Pick the one whose scope decision most directly names',
    "this issue's subject:",
    '',
    milestones.map((m) => '- ' + m.title + ' (milestone ' + m.number + ')').join('\n'),
    '',
    'No milestone, label or state was changed by this comment. Written by',
    '`tools/issue-metadata-audit.js` (claude-dotfiles issue 472).',
  ].join('\n');
}

/** The comment for an open issue whose acceptance ledger is fully ticked. Pure. */
function deliveredButOpenComment() {
  return [
    MARKERS.delivered,
    "Every box in this issue's acceptance ledger is ticked while the issue is still open, so it is",
    'either finished-and-forgotten or held open on a signal that is not written down. Two honest',
    'endings, and no third:',
    '',
    '- **Close it** with a comment naming what proved the last box.',
    '- **Add the box that is actually missing** — a live run, a deploy, an owner sign-off — so the',
    '  ledger says why it is still open.',
    '',
    'This issue was NOT closed here: which of the two applies is a reading of the body, not something',
    'a workflow can decide. Written by `tools/issue-metadata-audit.js` (claude-dotfiles issue 472).',
  ].join('\n');
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
  // newline `git remote get-url` prints would make every remote unparseable.
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const slug = parseGithubSlug(remote);
  if (!slug) throw new Error('cannot read owner/repo from `git remote get-url origin`: ' + remote);
  return slug.owner + '/' + slug.name;
}

/** Every OPEN milestone of the repo. Throws when the tracker cannot be read. */
function openMilestones(slug, gh) {
  const raw = gh(['api', 'repos/' + slug + '/milestones?state=open&per_page=100']);
  return JSON.parse(raw).map((m) => ({ number: m.number, title: m.title, state: m.state || 'open' }));
}

/**
 * Every open ISSUE of the repo, pull requests excluded (the issues endpoint returns both).
 * Paged by hand rather than with `gh api --paginate`, whose concatenated pages are not one
 * parseable JSON document. Throws when the tracker cannot be read.
 */
function openIssues(slug, gh) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const raw = gh(['api', 'repos/' + slug + '/issues?state=open&per_page=100&page=' + page]);
    const rows = JSON.parse(raw);
    for (const row of rows) if (!row.pull_request) out.push(row);
    if (rows.length < 100) break;
  }
  return out;
}

/** Has this issue already been told this? The marker search that makes the job idempotent. */
function hasMarker(slug, number, marker, gh) {
  const raw = gh(['api', 'repos/' + slug + '/issues/' + number + '/comments?per_page=100']);
  return JSON.parse(raw).some((c) => String(c.body || '').includes(marker));
}

/**
 * Sweep one issue. Returns { number, actions: [{ kind, detail, wrote }] } — the actions taken,
 * or, without `ctx.apply`, the ones that would be.
 *
 * Order matters: the body conversion runs first, so the fully-ticked check below sees the
 * CONVERTED body and never asks a ticket whose bullets just became unticked boxes to close.
 */
function auditIssue(issue, ctx) {
  const gh = ctx.runGh;
  const slug = ctx.slug;
  const apply = !!ctx.apply;
  const actions = [];
  const comment = (kind, marker, text) => {
    if (hasMarker(slug, issue.number, marker, gh)) {
      actions.push({ kind, detail: 'already commented', wrote: false });
      return;
    }
    if (!apply) { actions.push({ kind, detail: 'would comment', wrote: false }); return; }
    gh(['api', '--method', 'POST', 'repos/' + slug + '/issues/' + issue.number + '/comments', '--input', '-'],
       JSON.stringify({ body: text }));
    actions.push({ kind, detail: 'commented', wrote: true });
  };

  let body = issue.body;
  const { body: rewritten, converted } = convertProseBullets(body);
  if (converted.length > 0) {
    body = rewritten;
    if (apply) {
      gh(['api', '--method', 'PATCH', 'repos/' + slug + '/issues/' + issue.number, '--input', '-'],
         JSON.stringify({ body: rewritten }));
      actions.push({ kind: 'boxes-converted', detail: converted.length + ' prose bullet(s) -> `- [ ]`', wrote: true });
      comment('boxes-converted-comment', MARKERS.converted, convertedComment(converted));
    } else {
      actions.push({ kind: 'boxes-converted', detail: 'would convert ' + converted.length + ' prose bullet(s)', wrote: false });
    }
  }

  if (ledgerState(body) === 'complete') {
    comment('delivered-but-open', MARKERS.delivered, deliveredButOpenComment());
  }

  const plan = milestonePlan(issue, ctx.milestones);
  if (plan.action === 'assign') {
    if (apply) {
      gh(['api', '--method', 'PATCH', 'repos/' + slug + '/issues/' + issue.number, '--input', '-'],
         JSON.stringify({ milestone: plan.milestone.number }));
      actions.push({ kind: 'milestone-assigned', detail: plan.milestone.title, wrote: true });
    } else {
      actions.push({ kind: 'milestone-assigned', detail: 'would assign ' + plan.milestone.title, wrote: false });
    }
  } else if (plan.action === 'comment') {
    comment('milestone-ambiguous', MARKERS.ambiguous, ambiguousMilestoneComment(plan.milestones));
  }

  return { number: issue.number, actions };
}

/**
 * Sweep the tracker (or one issue, with `opts.issue`).
 *   opts.slug   - owner/repo (default: repoSlug()).
 *   opts.apply  - write; otherwise report only.
 *   opts.runGh  - injectable gh runner.
 * Returns { issues: [{ number, actions }], writes, milestones }. Throws when the tracker cannot
 * be read — the caller turns that into exit 1, never a clean-looking zero.
 */
function auditTracker(opts) {
  opts = opts || {};
  const gh = opts.runGh || defaultRunGh;
  const slug = opts.slug || repoSlug();
  const milestones = openMilestones(slug, gh);
  let subjects;
  if (opts.issue) {
    const one = JSON.parse(gh(['api', 'repos/' + slug + '/issues/' + opts.issue]));
    subjects = (one.state === 'open' && !one.pull_request) ? [one] : [];
  } else {
    subjects = openIssues(slug, gh);
  }
  const ctx = { slug, apply: !!opts.apply, runGh: gh, milestones };
  const issues = subjects.map((issue) => auditIssue(issue, ctx)).filter((r) => r.actions.length > 0);
  const writes = issues.reduce((n, r) => n + r.actions.filter((a) => a.wrote).length, 0);
  return { issues, writes, milestones };
}

/** Report lines for stdout and for the Actions job summary. Pure. */
function reportLines(res, apply) {
  const out = ['## Issue metadata audit', ''];
  if (res.issues.length === 0) {
    out.push('Clean: every open issue is in a milestone (or the repo has no open milestone to '
      + 'assign), no acceptance section is prose-only, and no fully-ticked ledger is still open.');
  } else {
    for (const r of res.issues) {
      out.push('- #' + r.number + ': ' + r.actions.map((a) => a.kind + ' (' + a.detail + ')').join(', '));
    }
  }
  out.push('');
  out.push((apply ? '' : 'DRY RUN — re-run with `--apply` to write. ') + 'writes: ' + res.writes);
  return out;
}

module.exports = {
  MARKERS, acceptanceScope, ledgerState, convertProseBullets, milestonePlan,
  convertedComment, ambiguousMilestoneComment, deliveredButOpenComment,
  openMilestones, openIssues, auditIssue, auditTracker, reportLines, repoSlug, defaultRunGh,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const valueOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const issue = valueOf('--issue');
  let res;
  try {
    res = auditTracker({ apply, issue: issue ? Number(issue) : null });
  } catch (e) {
    // Exit 1, never 0: a run that could not read the tracker has swept nothing, and a green check
    // on a token-less run is indistinguishable from a clean tracker.
    console.error('::error::could not audit issue metadata: ' + e.message);
    process.exit(1);
  }
  const lines = reportLines(res, apply);
  console.log(lines.join('\n'));
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    try { require('fs').appendFileSync(summary, lines.join('\n') + '\n'); }
    catch (e) { console.error('could not write the job summary: ' + e.message); }
  }
}
