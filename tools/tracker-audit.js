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
// class below is drift that actually shipped here, not a hypothetical:
//
//   * Nine blocking edges existed only as prose. The documented frontier query reads GitHub's native
//     dependencies, so it answered "everything is startable" for the tracker's entire life —
//     including issues four and five deep in a documented chain.
//   * `Fixes #N` in a commit auto-closed three issues whose live-verification boxes were unticked.
//     Closed is this repo's only terminal state, so a closed issue with open boxes is a lie.
//   * An issue sat asserting a fact that a newly-filed bug had just disproved, because filing the bug
//     never prompted the question "what else believed the old story?"
//
// EXIT CODES — 0 clean, 1 drift found, 2 could not audit. The 2 matters: this repo has been bitten
// three times by a listing tool returning zero, which is indistinguishable from "nothing is wrong".
// An audit that cannot see the tracker must never look like a pass.
'use strict';

const { execSync } = require('child_process');

/** Acceptance boxes a closed issue is allowed to leave unticked, by exact text fragment. Deliberately
 *  empty: an exemption here is a claim that a box did not need to be true, which deserves a comment
 *  on the issue rather than a line in this file. */
const CLOSED_BOX_EXEMPT = [];

/** execSync runs through cmd.exe on Windows, which does not understand `2>/dev/null` — an inline
 *  redirect there produces "The system cannot find the path specified." on stdout and makes every
 *  call look like it failed. So stderr is suppressed via stdio, never in the command string. */
function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
                         stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Bail with exit 2 rather than reporting a clean run we cannot stand behind. */
function cannotAudit(why, detail) {
  console.error('CANNOT AUDIT: ' + why);
  if (detail) console.error(String(detail).trim().split('\n').slice(0, 4).join('\n'));
  console.error('\nThis is not a pass. Fix the above and re-run.');
  process.exit(2);
}

let REPO;
try {
  REPO = JSON.parse(sh('gh repo view --json nameWithOwner')).nameWithOwner;
} catch (e) {
  cannotAudit('`gh repo view` failed — not a GitHub clone, or gh is not authenticated.', e.message);
}

/** Every issue, open and closed. Closed ones are needed for the unticked-box check and to tell a
 *  released blocker from a dangling reference. */
let issues;
try {
  issues = JSON.parse(sh(
    'gh issue list --state all --limit 1000 --json number,title,state,body,labels,url,projectItems,milestone'
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
 *  were merged PRs. Fetched once rather than probed per number. */
let prNumbers = new Set();
try {
  prNumbers = new Set(JSON.parse(sh('gh pr list --state all --limit 1000 --json number'))
    .map((p) => p.number));
} catch (e) {
  // A repo with PRs disabled, or an old gh. Leaving the set empty only risks reporting a PR
  // reference as dangling, which is a visible false positive rather than a silent miss.
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
 *  the gate — this exists to find the two disagreeing. */
function proseBlockers(body) {
  const text = String(body || '');
  const m = /^##+\s*Blocked by\s*$([\s\S]*?)(?=^##\s|\Z)/im.exec(text);
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
 *  acceptance without a heading, without failing a build over a question list. */
function untickedBoxes(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const ACCEPT_HEADING = /^##+\s*(Done when|Acceptance criteria|Acceptance)\s*$/im;
  const m = ACCEPT_HEADING.exec(text);
  const scope = m
    ? text.slice(m.index + m[0].length).split(/^##\s/m)[0]
    : null;
  const pick = (s) => (s.match(/^\s*[-*]\s*\[ \]\s+(.+)$/gm) || [])
    .map((l) => l.replace(/^\s*[-*]\s*\[ \]\s+/, '').trim())
    .filter((t) => !CLOSED_BOX_EXEMPT.some((ex) => t.includes(ex)));
  return scope === null
    ? { hard: [], soft: pick(text) }
    : { hard: pick(scope), soft: [] };
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
issues.filter((i) => i.state === 'CLOSED').forEach((i) => {
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
    report('dangling-reference', i,
      'cites ' + dangling.map((n) => '#' + n).join(', ') + ', which is neither an issue nor a pull ' +
      'request in this repo. A pointer to nothing reads as "the reasoning is written down somewhere".');
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
  (Array.from(new Set((body.match(/#(\d+)/g) || []).map((s) => Number(s.slice(1)))))).forEach((n) => {
    const other = byNumber.get(n);
    if (!other || other.state !== 'CLOSED' || n === i.number) return;
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

// ---- 7. Milestones: once a repo sequences work, an unsequenced issue is invisible to planning ---
// Same infer-from-data posture as the board check: milestones are opt-in, and a repo that has never
// created one is not drifting by not using them. But once ANY issue carries a milestone, the repo has
// chosen milestones as its sequencing record, and an open issue outside every milestone is work no
// milestone view will ever show. Observed 2026-08-21: 26 of 29 open issues unmilestoned because the
// milestones were created mid-push and only the critical path was assigned — no tool noticed.
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

// ---- 8. An open issue the commit log claims was delivered --------------------------------------
// `Closes #N` closes on merge; a merge subject saying `(issue N)` closes nothing, and the issue
// sits open looking like undone work. Observed 2026-08-21: four issues delivered by merged agent
// branches titled "Merge agent/issue-24-attempt1: ... (issue 24)" stayed open for a day — the
// closed-with-open-boxes check runs the OTHER direction and could not see them. Advisory, because a
// subject can mention an issue without delivering it; the git log may also be absent (shallow clone),
// in which case this check silently does not run rather than guessing.
try {
  const subjects = sh('git log --format=%s -500').split('\n');
  open.forEach((i) => {
    const re = new RegExp('\\bissue\\s+#?' + i.number + '\\b', 'i');
    const hit = subjects.find((s) => re.test(s));
    if (hit) {
      report('possibly-delivered?', i,
        'is OPEN but a commit on this branch says: "' + hit.slice(0, 100) + '". If that commit ' +
        'delivered it, verify the acceptance boxes and close; a closing keyword (`Closes #' +
        i.number + '`) in the PR body would have done this automatically. Advisory only.');
    }
  });
} catch (e) {
  // A check that silently did not run reads as a clean pass — say so instead. Non-fatal: the audit
  // may legitimately run outside a git checkout (CI job with tracker access only).
  console.log('NOTE: git log unavailable, so delivered-but-open could not be checked.\n');
}

// ---- Output ------------------------------------------------------------------------------------
// Anything ending in '?' is advisory: reported, never fails the run. A check that cannot tell a
// real problem from a shape it misreads must not be able to block anyone.
const ORDER = ['ungated-dependency', 'closed-with-open-boxes', 'dangling-reference', 'untriaged',
               'conflicting-triage', 'board-says-done', 'not-on-board', 'unmilestoned',
               'closed-with-open-boxes?', 'stale-premise?', 'possibly-delivered?'];
findings.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.number - b.number);

console.log('Tracker audit — ' + REPO + ' (' + open.length + ' open, ' + issues.length + ' total)\n');

if (edgesUnavailable) {
  console.log('NOTE: the native issue-dependencies endpoint was unavailable for at least one issue,');
  console.log('so ungated dependencies could not be checked there. Treat as unknown, not clean.\n');
}

if (!findings.length) {
  console.log('No drift found across ' + ORDER.length + ' checks.');
  process.exit(edgesUnavailable ? 2 : 0);
}

const hard = findings.filter((f) => !f.kind.endsWith('?'));
findings.forEach((f) => {
  console.log('[' + f.kind + '] #' + f.number + ' ' + f.title);
  console.log('    ' + f.detail);
  console.log('    ' + f.url + '\n');
});
console.log(hard.length + ' drift finding(s)' +
            (findings.length - hard.length ? ', plus ' + (findings.length - hard.length) + ' advisory' : '') + '.');
process.exit(hard.length ? 1 : 0);
