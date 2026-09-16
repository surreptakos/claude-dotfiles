#!/usr/bin/env node
/**
 * node tools/tick-acceptance-boxes.js --pr <n> [--issue <n>] [--apply]
 * node tools/tick-acceptance-boxes.js --event <github-event-payload.json> [--apply]
 *
 * Ticks the acceptance boxes of every issue a MERGED pull request closes, appending to each box
 * the PR it was verified in, and records what it did in a comment on that issue.
 *
 * WHY (issue 438). Closing is this tracker's only terminal state, so `tools/tracker-audit.js`
 * reports a closed issue with unticked acceptance boxes as drift — `[closed-with-open-boxes]`.
 * The ticket fleet closes its tickets with `Closes #N` in the PR body and deliberately does not
 * tick the boxes itself (aac-routines issue 264: a box ticked while the PR is still open claims
 * the work shipped when the default branch carries none of it). The fleet's deliver prompt hands
 * that job to "a tick-acceptance-boxes merge workflow" in the served repo — and this repo had
 * none, so every delivered ticket landed as a fresh audit finding. Run 6aaacc32 produced eleven
 * of them in one wave, which is a verdict nobody reads. This script, driven by
 * `.github/workflows/tick-acceptance-boxes.yml` on the `pull_request_target` closed+merged
 * event, is the missing half.
 *
 * WHAT IT CLAIMS, AND WHAT IT DOES NOT. A tick here means: the PR named below closed this issue,
 * it merged to the default branch, and that PR's body quotes the independent verifier's evidence
 * for the acceptance criteria. It is not a fresh verification — the script re-runs nothing. That
 * is why each box names the PR rather than saying "verified": the reader follows the link. If a
 * box is not in fact satisfied, the answer is to reopen the issue, which is exactly what the
 * audit finding used to ask for.
 *
 * Scope parity with the audit is not approximate: the set of boxes ticked is
 * `untickedBoxes(body).hard` from `tools/tracker-audit.js` itself, so a box this script leaves
 * alone is a box the audit does not report, and vice versa. Boxes with no acceptance heading
 * above them (`soft`) are left alone — they are open questions or sub-issue lists, and the audit
 * only advises on them.
 *
 * Idempotent: a ticked box matches nothing, so a replay writes no body and posts no comment.
 * Dry run unless `--apply`.
 *
 * The network-touching half takes an injectable `runGh`, so the read/patch/comment flow is
 * unit-testable in-process against a fake. See tools/tick-acceptance-boxes.test.js.
 */
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { untickedBoxes, parseGithubSlug } = require('./tracker-audit.js');

/** The acceptance heading, and the scope under it, exactly as tools/tracker-audit.js reads them. */
const ACCEPT_HEADING = /^##+\s*(Done when|Acceptance criteria|Acceptance)\s*$/im;
const BOX_PREFIX = /^(\s*[-*]\s*)\[ \](\s+)(.*)$/;

/**
 * Issue numbers a PR body/title closes through GitHub's own closing keywords. Bare `#N` only:
 * `owner/repo#N` closes an issue in another repo and is not ours to edit, and a bare `#N` with no
 * keyword ("Refs #N", the fleet's keep-open form) closes nothing. Pure.
 */
function closingRefs(text) {
  const s = String(text == null ? '' : text);
  const rx = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+(\S*?)#(\d+)\b/gi;
  const out = [];
  let m;
  while ((m = rx.exec(s)) !== null) {
    if (m[1]) continue; // owner/repo#N, or a URL fragment — another repo's issue
    const n = Number(m[2]);
    if (n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Tick every acceptance box the audit would report, appending ` — <evidence>` to each.
 * Returns { body, ticked } — `ticked` is the box text of each line changed, in body order.
 * `body` is byte-identical to the input when nothing was ticked, CRLF bodies included. Pure.
 */
function tickAcceptanceBoxes(body, evidence) {
  const src = String(body == null ? '' : body);
  const crlf = /\r\n/.test(src);
  const text = src.replace(/\r\n/g, '\n');
  const hard = new Set(untickedBoxes(text).hard);
  if (hard.size === 0) return { body: src, ticked: [] };
  const m = ACCEPT_HEADING.exec(text);
  if (!m) return { body: src, ticked: [] };
  const scopeStart = m.index + m[0].length;
  const rest = text.slice(scopeStart);
  const nextHeading = rest.search(/^##\s/m);
  const scopeEnd = nextHeading === -1 ? text.length : scopeStart + nextHeading;
  const suffix = String(evidence == null ? '' : evidence).trim();
  const ticked = [];
  const lines = text.slice(scopeStart, scopeEnd).split('\n').map((line) => {
    const b = BOX_PREFIX.exec(line);
    if (!b) return line;
    const label = b[3].trim();
    if (!hard.has(label)) return line;
    ticked.push(label);
    return b[1] + '[x]' + b[2] + b[3] + (suffix ? ' — ' + suffix : '');
  });
  if (ticked.length === 0) return { body: src, ticked: [] };
  const out = text.slice(0, scopeStart) + lines.join('\n') + text.slice(scopeEnd);
  return { body: crlf ? out.replace(/\n/g, '\r\n') : out, ticked };
}

/** The comment that records the tick on the issue, so the reasoning is on the ticket. Pure. */
function tickComment(pr, ticked) {
  return [
    'Acceptance boxes ticked on merge of PR #' + pr.number + (pr.html_url ? ' (' + pr.html_url + ')' : '') + ':',
    '',
    ticked.map((t) => '- ' + t).join('\n'),
    '',
    'Each box now names that PR as where it was verified. The PR body quotes the independent',
    "verifier's evidence for these criteria verbatim, and the branch merged to the default branch",
    'with the repository test command green. This comment and the ticks were written by',
    '`tools/tick-acceptance-boxes.js` (claude-dotfiles issue 438) — nothing was re-verified here.',
    'If a box is not in fact satisfied, reopen this issue.',
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
  // `.trim()` is load-bearing: `parseGithubSlug`'s regex is anchored with `$` and no `m` flag, so
  // the newline `git remote get-url` prints makes every remote unparseable. The workflow sets
  // GITHUB_REPOSITORY and never reaches here; the documented by-hand back-fill does.
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const slug = parseGithubSlug(remote);
  if (!slug) throw new Error('cannot read owner/repo from `git remote get-url origin`: ' + String(remote).trim());
  return slug.owner + '/' + slug.name;
}

/**
 * Tick one merged PR's issues.
 *   opts.slug    - owner/repo (default: repoSlug()).
 *   opts.apply   - write; otherwise report only.
 *   opts.runGh   - injectable gh runner.
 *   opts.pr      - the PR payload, when the caller already has it (the workflow event does).
 *   opts.issues  - tick THESE issues instead of the PR's closing keywords. Back-fill only: a
 *                  ticket closed by hand whose verifying PR wrote `Refs #N` (issue 364 is the
 *                  case this was added for) has real evidence and no closing keyword to find.
 * Returns { pr, skipped, results: [{ issue, ticked, wrote }] }.
 */
function tickForPr(prNumber, opts) {
  opts = opts || {};
  const gh = opts.runGh || defaultRunGh;
  const slug = opts.slug || repoSlug();
  const pr = opts.pr || JSON.parse(gh(['api', 'repos/' + slug + '/pulls/' + prNumber]));
  if (pr.merged !== true && !pr.merged_at) {
    return { pr, skipped: 'PR #' + pr.number + ' is not merged — nothing is claimed by an unmerged PR', results: [] };
  }
  const refs = (opts.issues && opts.issues.length)
    ? opts.issues.map(Number)
    : closingRefs(String(pr.title || '') + '\n' + String(pr.body || ''));
  const results = [];
  for (const n of refs) {
    const issue = JSON.parse(gh(['api', 'repos/' + slug + '/issues/' + n]));
    const evidence = 'verified in PR #' + pr.number;
    const { body, ticked } = tickAcceptanceBoxes(issue.body, evidence);
    if (ticked.length === 0) { results.push({ issue: n, ticked: [], wrote: false }); continue; }
    if (!opts.apply) { results.push({ issue: n, ticked, wrote: false, dryRun: true }); continue; }
    gh(['api', '--method', 'PATCH', 'repos/' + slug + '/issues/' + n, '--input', '-'], JSON.stringify({ body }));
    gh(['api', '--method', 'POST', 'repos/' + slug + '/issues/' + n + '/comments', '--input', '-'],
       JSON.stringify({ body: tickComment(pr, ticked) }));
    results.push({ issue: n, ticked, wrote: true });
  }
  return { pr, skipped: null, results };
}

module.exports = { closingRefs, tickAcceptanceBoxes, tickComment, tickForPr, repoSlug, defaultRunGh };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const valueOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  let pr = null;
  let prNumber = valueOf('--pr');
  const eventPath = valueOf('--event');
  if (eventPath) {
    try {
      const ev = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
      pr = ev.pull_request || null;
    } catch (e) {
      console.error('cannot read the event payload at ' + eventPath + ': ' + e.message);
      process.exit(2);
    }
    if (!pr) { console.log('event payload carries no pull_request — nothing to tick.'); process.exit(0); }
    prNumber = pr.number;
  }
  if (!prNumber) {
    console.error('usage: node tools/tick-acceptance-boxes.js (--pr <n> [--issue <n>] | --event <payload.json>) [--apply]');
    process.exit(2);
  }
  const issueOverride = valueOf('--issue');
  let res;
  try {
    res = tickForPr(Number(prNumber), { apply, pr, issues: issueOverride ? [Number(issueOverride)] : null });
  } catch (e) {
    console.error('could not tick acceptance boxes for PR #' + prNumber + ': ' + e.message);
    process.exit(2);
  }
  if (res.skipped) { console.log(res.skipped); process.exit(0); }
  if (res.results.length === 0) { console.log('PR #' + prNumber + ' closes no issue in this repo — nothing to tick.'); process.exit(0); }
  for (const r of res.results) {
    if (r.ticked.length === 0) { console.log('#' + r.issue + ': no unticked acceptance box — left alone.'); continue; }
    console.log('#' + r.issue + ': ' + (r.wrote ? 'ticked ' : 'would tick ') + r.ticked.length + ' acceptance box(es)');
    for (const t of r.ticked) console.log('      - ' + t);
  }
  if (!apply) console.log('DRY RUN — re-run with --apply to write.');
}
