#!/usr/bin/env node
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

// Test-only export of the pure predicates. The rest of the file is a script and only runs when this
// module is invoked directly, so `require('./tracker-audit.js')` from a test does not shell out to
// gh or exit the process.
if (require.main !== module) {
  module.exports = { isFollowUpAcknowledgment, isNotPlanned, NOT_PLANNED_PATTERNS };
  return;
}

/** execSync runs through cmd.exe on Windows, which does not understand `2>/dev/null` — an inline
 *  redirect there produces "The system cannot find the path specified." on stdout and makes every
 *  call look like it failed. So stderr is suppressed via stdio, never in the command string. */
function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
                         stdio: ['ignore', 'pipe', 'ignore'] });
}

/** git, with NO shell between us and it. The log format below is built out of `%` placeholders, and
 *  cmd.exe eats `%NAME%` on the way past — so this one command is spawned directly rather than through
 *  `sh`, which would otherwise mangle the separators on Windows and leave the parse silently empty. */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
                                     stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Bail with exit 2 rather than reporting a clean run we cannot stand behind. */
function cannotAudit(why, detail) {
  console.error('CANNOT AUDIT: ' + why);
  if (detail) console.error(String(detail).trim().split('\n').slice(0, 4).join('\n'));
  console.error('\nThis is not a pass. Fix the above and re-run.');
  process.exit(2);
}

let REPO, DEFAULT_BRANCH;
try {
  const repoInfo = JSON.parse(sh('gh repo view --json nameWithOwner,defaultBranchRef'));
  REPO = repoInfo.nameWithOwner;
  // The branch work has to REACH before "it already landed" is true. Read, never assumed: a repo whose
  // trunk is not `main` would otherwise be audited against a branch that does not exist.
  DEFAULT_BRANCH = (repoInfo.defaultBranchRef && repoInfo.defaultBranchRef.name) || '';
} catch (e) {
  cannotAudit('`gh repo view` failed — not a GitHub clone, or gh is not authenticated.', e.message);
}

/** Every issue, open and closed. Closed ones are needed for the unticked-box check and to tell a
 *  released blocker from a dangling reference; `closedByPullRequestsReferences` feeds the follow-up
 *  acknowledgment in the stale-premise check. */
let issues;
try {
  issues = JSON.parse(sh(
    'gh issue list --state all --limit 1000 --json number,title,state,body,labels,url,projectItems,closedByPullRequestsReferences,milestone'
  ));
} catch (e) {
  cannotAudit('`gh issue list` failed.', e.message);
}
if (!Array.isArray(issues)) cannotAudit('`gh issue list` did not return an array.');
if (issues.length === 0) {
  // The false-zero guard. A tracker with zero issues is possible but is far more often an auth
  // problem, a wrong repo, or a phantom working directory — all of which previously read as success.
  cannotAudit('the tracker reports ZERO issues. A filter that returns nothing looks exactly like ' +
              'nothing being wrong. Confirm the repo and `gh auth status` before believing this.');
}

const byNumber = new Map(issues.map((i) => [i.number, i]));
const open = issues.filter((i) => i.state === 'OPEN');

/** GitHub shares ONE number space across issues and pull requests, and `gh issue list` returns only
 *  issues. So a `#43` pointing at a perfectly good merged PR looks like a pointer to nothing. Caught
 *  the first time this ran against a repo that actually uses PRs: all seven "dangling" references
 *  were merged PRs. Fetched once rather than probed per number.
 *
 *  Comments are fetched alongside the numbers because a PR's thread is where measurements land, and
 *  the blocker-may-be-answered check below needs their dates. */
let prNumbers = new Set();
let prByNumber = new Map();
let prsUnavailable = false;
try {
  const prs = JSON.parse(sh('gh pr list --state all --limit 1000 --json number,title,state,url,comments'));
  prNumbers = new Set(prs.map((p) => p.number));
  prByNumber = new Map(prs.map((p) => {
    const dates = (p.comments || []).map((c) => c.createdAt).filter(Boolean).sort();
    return [p.number, Object.assign({}, p, {
      commentCount: (p.comments || []).length,
      lastComment: dates[dates.length - 1] || null
    })];
  }));
} catch (e) {
  // "Only risks a visible false positive" was wrong twice over on aac-bill-intake, where this catch
  // made the audit run red four times a day for two weeks: an issue cited a perfectly good PR the run
  // could not see, and the finding named the issue rather than the blindness. In Actions the cause is
  // the token — a `permissions:` block sets every scope it does not name to `none`, so a missing
  // `pull-requests: read` 403s `gh pr list` here while it works from a laptop. The failure is
  // recorded rather than swallowed: the dangling-reference check drops to advisory, because without
  // PRs it genuinely cannot tell a merged PR from a pointer to nothing, and blocker-may-be-answered
  // goes silent on its own (empty prByNumber) — which the NOTE at the bottom then says out loud.
  prsUnavailable = true;
}
const knownNumber = (n) => byNumber.has(n) || prNumbers.has(n);

/** Native blocked_by edges (open blockers only — GitHub releases a child when its blocker closes,
 *  which is the whole reason to use these rather than prose). Returns null if the endpoint is
 *  unavailable on this repo, so the caller can say "unknown" instead of "none". */
function nativeBlockers(n) {
  try {
    const out = sh('gh api repos/' + REPO + '/issues/' + n +
                   '/dependencies/blocked_by --jq ".[].number"').trim();
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
 *  audit. */
function proseBlockers(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const m = /^##+\s*Blocked by\s*$([\s\S]*?)(?=^##+\s|$(?![\s\S]))/im.exec(text);
  if (!m) return [];
  const section = m[1];
  if (/^\s*[-*]?\s*(None|N\/?A)\b/im.test(section)) return [];
  const nums = (section.match(/#(\d+)/g) || []).map((s) => Number(s.slice(1)));
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

const findings = [];
function report(kind, issue, detail) {
  findings.push({ kind, number: issue.number, title: issue.title, url: issue.url, detail });
}

const TRIAGE = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'];
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
  if (states.length === 0) report('untriaged', i, 'carries no triage label, so it is invisible to every triage query.');
  if (states.length > 1) report('conflicting-triage', i, 'carries ' + states.join(' AND ') + ' — pick one.');
});

// ---- 5. An open issue asserting something a closed issue settled -------------------------------
// The weakest check here, and deliberately advisory: it cannot read meaning, only proximity. It fires
// when an open issue cites a CLOSED issue in prose without any nearby hedge, because the drift that
// prompted this tool was #23 asserting a behaviour #25 had just disproved.
open.forEach((i) => {
  // A PRD is a container: it enumerates its own sub-issues, and those closing is the PRD working, not
  // the PRD going stale. Skipping the label entirely is right — on the first cross-repo run, ONE PRD
  // produced all ten advisories in a repo, which is how a useful check becomes one people scroll past.
  if (i.labels.some((l) => l.name === 'prd')) return;
  const body = String(i.body || '').replace(/\r\n/g, '\n');
  const citedNums = Array.from(new Set((body.match(/#(\d+)/g) || []).map((s) => Number(s.slice(1)))));
  const citedClosed = citedNums.filter((n) => {
    const o = byNumber.get(n);
    return o && o.state === 'CLOSED' && n !== i.number;
  });
  // A follow-up ticket exists BECAUSE work shipped. If the body carries either canonical
  // acknowledgment for ANY of its cited closed issues (see isFollowUpAcknowledgment above), the whole
  // body reads as a follow-up context — its other closed-issue citations are background, not stale
  // premises. The closer-PR union is the "any of these closers" set the predicate checks.
  const closerPrsUnion = Array.from(new Set(citedClosed.flatMap((n) =>
    (byNumber.get(n).closedByPullRequestsReferences || []).map((r) => r.number))));
  const bodyIsFollowUp = citedClosed.some((n) => isFollowUpAcknowledgment(body, n, closerPrsUnion));
  if (bodyIsFollowUp) return;
  citedClosed.forEach((n) => {
    const other = byNumber.get(n);
    const idx = body.indexOf('#' + n);
    // A citation on a checkbox line is a task list — a sub-issue roster, not an assertion about it.
    const lineStart = body.lastIndexOf('\n', idx) + 1;
    if (/^\s*[-*]\s*\[[ x]\]/.test(body.slice(lineStart, idx))) return;
    const around = body.slice(Math.max(0, idx - 220), idx + 220);
    if (/\b(closed|resolved|superseded|settled|confirmed|verified|per|see|split from|carried from|note from|update from|part of|tracked by|sub-issue|child)\b/i.test(around)) return;
    report('stale-premise?', i,
      'cites closed #' + n + ' (' + other.title.slice(0, 50) + ') with no wording that acknowledges ' +
      'it is settled. Check this issue still describes reality. Advisory only.');
  });
});

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
// Board status rides along on the SAME `gh issue list` call above — `--json projectItems` returns
// each card's Status. That replaced a GraphQL lookup that had to discover the project first, which
// was both fragile (nested quoting through cmd.exe failed intermittently) and wrong: it searched
// `repository.projectsV2`, which returns only projects LINKED to the repo, while this board is
// owner-level. It confidently reported "no board" for a board holding 26 cards.
//
// Whether a board is in use is inferred from the data rather than discovered: if no issue anywhere
// carries a card, there is no board to compare against.
const boardInUse = issues.some((i) => (i.projectItems || []).length > 0);
if (!boardInUse) {
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
             { stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000 });
  } catch (e) { /* offline, or no such remote. Scan what is here. */ }
  try {
    landedFindings(issues, landedCommits(git(['log', '--no-color', '--format=' + LOG_FORMAT, LOG_REF])),
                   LOG_REF).forEach((f) => report(f.kind, f.issue, f.detail));
  } catch (e) {
    logUnavailable = true;
  }
}

// ---- Output ------------------------------------------------------------------------------------
// Anything ending in '?' is advisory: reported, never fails the run. A check that cannot tell a
// real problem from a shape it misreads must not be able to block anyone. (blocker-may-be-answered
// is the one deliberate exception — see its header.)
const ORDER = ['ungated-dependency', 'landed-but-open', 'blocker-may-be-answered',
               'closed-with-open-boxes', 'dangling-reference', 'untriaged', 'conflicting-triage',
               'board-says-done', 'not-on-board', 'unmilestoned', 'landed-but-open?',
               'closed-with-open-boxes?', 'dangling-reference?', 'stale-premise?'];
findings.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.number - b.number);

console.log('Tracker audit — ' + REPO + ' (' + open.length + ' open, ' + issues.length + ' total)\n');

if (edgesUnavailable) {
  console.log('NOTE: the native issue-dependencies endpoint was unavailable for at least one issue,');
  console.log('so ungated dependencies could not be checked there. Treat as unknown, not clean.\n');
}

if (prsUnavailable) {
  console.log('NOTE: `gh pr list` failed, so no pull request is visible to this run. A `#N` naming a');
  console.log('PR cannot be told from a pointer to nothing, so the dangling-reference check is');
  console.log('advisory here, and blocker-may-be-answered could not run at all. Under Actions this');
  console.log('means the workflow grants no `pull-requests: read`. Treat as unknown, not clean.\n');
}

if (logUnavailable) {
  console.log('NOTE: the default branch\'s git log could not be read' +
              (DEFAULT_BRANCH ? ' (' + DEFAULT_BRANCH + ')' : '') + ', so no open issue was checked');
  console.log('against the work that already merged. Treat as unknown, not clean.\n');
}

/** Any blind spot means this run cannot stand behind a clean result — exit 2, never 0. */
const blind = edgesUnavailable || prsUnavailable || logUnavailable;

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
