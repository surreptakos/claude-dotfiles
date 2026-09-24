// Regenerates DASHBOARD.md — the live working dashboard (issues / PRDs / ADRs / triage / pipeline health).
// Installed by the project-harness skill. Runs in CI (.github/workflows/dashboard.yml) on every push and
// issue change; also runnable locally (`node scripts/build-dashboard.js`) with an authenticated `gh` CLI.
// DASHBOARD.md is generated output. Never edit it by hand; edit this script.
//
// Run this locally to CHECK your changes, but do not commit the regenerated DASHBOARD.md: CI regenerates
// and commits it on every push, so a local copy in your commit collides with the bot's and every push
// turns into a rebase conflict on a file nobody authored. Let CI own the artifact.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---- CONFIG: the harness skill fills this per repo -------------------------
const CONFIG = {
  title: 'claude-dotfiles',
  // -From worktree, not origin: this repo is private, so a clone from inside a CI runner has no
  // credential, and a gate that cloned HEAD would report on the previous commit rather than the
  // one being made. worktree copies what git currently sees. ~13s.
  //
  // Not run by `dashboard.yml` any more (issue 452): the CI job reads the restore-test verdict
  // from the Actions API instead (see `restoreTestWorkflow` below and `fetchRestoreTestVerdict()`)
  // rather than paying `windows-latest`'s 2x billing multiplier to re-run this suite on every one
  // of the ~176 label/issue-event runs a day. This command is kept as an opt-in LOCAL path only:
  // set `RUN_LOCAL_TEST_COMMAND=1` to spawn it (e.g. from the desktop, where the PowerShell
  // profile it restores actually exists) instead of reading the Actions verdict.
  testCommand: 'powershell -ExecutionPolicy Bypass -File tests/restore-test.ps1 -From worktree',
  adrDir: null,                     // no ADRs here
  deployWorkflow: null,             // nothing deploys; sync.ps1 is the release path and it is local
  // The health line's real source of truth (issue 452): the latest completed run of this workflow
  // on `master`, read through the Actions API rather than re-run here. That workflow is the gate
  // on the PowerShell half of `sync.ps1` (CLAUDE.md's "Testing a change to the scripts") and
  // already runs on every push and PR that touches a PowerShell file, so its most recent master
  // run is a verdict on the tip this job is building a dashboard for — taken once, not
  // re-measured on every dashboard refresh.
  restoreTestWorkflow: 'windows-restore-test.yml',
  restoreTestBranch: 'master'
};
// -----------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'DASHBOARD.md');

// Children run without NODE_TEST_CONTEXT. `node --test` exports that variable into everything it
// spawns, and a nested `node --test` that inherits it exits 0 even when a test throws (Node 22.22.2:
// `node --test boom.test.js` exits 1, `NODE_TEST_CONTEXT=child-v8 node --test boom.test.js` exits 0
// on the same file). This script can run CONFIG.testCommand (the opt-in local path below), and it is
// spawned from inside node tests, so without the scrub the dashboard would report a failing suite as
// passing (claude-dotfiles issue 395).
const CHILD_ENV = (() => { const e = Object.assign({}, process.env); delete e.NODE_TEST_CONTEXT; return e; })();
function sh(cmd) { return execSync(cmd, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, cwd: ROOT, env: CHILD_ENV }); }
function ghJson(cmd) { try { return JSON.parse(sh(cmd)); } catch (e) { return null; } }
function esc(s) { return String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }
// Render timestamps as YYYY-MM-DD from the ISO string, NOT as "N days ago" relative to Date.now().
// A relative label re-renders every day the script runs, so a dashboard that would otherwise be
// byte-identical to yesterday's diffs on every rerun -- which is exactly the drift issue 21 removes.
// Absolute dates are stable: only real content changes produce a diff, so CI's "commit if changed"
// step can be the only thing that ever advances the artifact and the daily safety cron is redundant.
function ymd(iso) { return String(iso || '').slice(0, 10); }

/** A `prd` issue is a container, so its real question is whether it has been broken into tickets yet.
 *
 *  Read that from the tracker, NOT from the triage label. The label is hand-set and goes stale silently:
 *  a PRD can sit on `ready-for-human` with zero children and still look decomposed.
 *
 *  Native sub-issues are the primary signal (`gh issue edit <parent> --add-sub-issue <child>`). Body
 *  checklists are the fallback, because plenty of repos track children as `- [ ] #12` lines and would
 *  otherwise all report as undecomposed — but they are only consulted when there are no native children,
 *  since a body list left behind after real sub-issues were wired would undercount.
 *
 *  Verified against six shapes: absent summary, total 0, total>0 with 0 closed, partly closed, body-only
 *  checklist, and neither. */
function decomposition(i) {
  const s = i.subIssuesSummary || { total: 0, completed: 0 };
  if (s.total) return { done: true, label: s.completed + ' of ' + s.total + ' closed' };
  const boxes = (i.body || '').match(/- \[( |x)\] #\d+/g) || [];
  if (boxes.length) {
    const done = boxes.filter(b => b.includes('[x]')).length;
    return { done: true, label: done + ' of ' + boxes.length + ' closed _(body checklist)_' };
  }
  return { done: false, label: '**none — needs `/to-tickets`**' };
}

/** A one-line health summary from a test run's output.
 *
 *  The last line of output is NOT the summary for most runners, and using it produces a dashboard
 *  that cannot report the one thing it exists to report. Measured against `node --test`: a passing
 *  run ends with `duration_ms 150.1037` (a duration says nothing about health) and a FAILING run
 *  ends with `}` — a closing brace from the last stack trace, rendered as "FAILING — }".
 *
 *  So: prefer an explicit pass/fail count. `count()` handles node's `# pass 12` / `ℹ pass 12`
 *  summary lines; the `alt` regex handles the common "12 passed, 3 failed" shape (jest, vitest,
 *  pytest-style). Skips are reported when present, because a lower pass count with no explanation
 *  reads as healthy — CI often skips suites whose fixtures are git-ignored. Only when neither shape
 *  is found does this fall back to the last line.
 *
 *  Parsed in JS rather than piped through grep so it works on Windows, where execSync runs cmd.exe
 *  and a pipeline of unix tools is unavailable.
 *
 *  Used only by the opt-in local `RUN_LOCAL_TEST_COMMAND=1` path (issue 452); the CI job reads the
 *  restore-test verdict from Actions instead, via `fetchRestoreTestVerdict()` below. Verified by
 *  `verify-dashboard-parse.js` in the project-harness skill folder — run it after editing this. */
function testSummary(out) {
  const text = String(out || '');
  function count(label) {
    const m = new RegExp('^\\W?\\s*' + label + '\\s+(\\d+)\\s*$', 'mi').exec(text);
    return m ? Number(m[1]) : null;
  }
  const pass = count('pass'), fail = count('fail'), skipped = count('skipped');
  if (pass !== null && fail !== null) {
    return pass + ' passing, ' + fail + ' failing' + (skipped ? ', ' + skipped + ' skipped' : '');
  }
  // "N passed" / "N failed", matched INDEPENDENTLY rather than as one ordered pair: jest and vitest
  // print failures first ("Tests: 3 failed, 41 passed, 44 total"), so a passed-then-failed regex
  // misses the most common JS runner entirely and silently falls through to the last line.
  const passed = /(\d+)\s+passed/i.exec(text);
  const failed = /(\d+)\s+failed/i.exec(text);
  if (passed || failed) {
    // Skips and xfails ride along when present. A pass count that silently shrank because a
    // platform-conditional test skipped in CI reads as healthy-but-different from local, which is
    // exactly the unexplained drift this line exists to prevent (hit on aac-contract-builder,
    // 2026-08-21: 316 local vs 315 CI, the difference a Windows-only test skipping on Linux).
    const skippedAlt = /(\d+)\s+skipped/i.exec(text);
    const xfailed = /(\d+)\s+xfailed/i.exec(text);
    return (passed ? passed[1] : '0') + ' passing, ' + (failed ? failed[1] : '0') + ' failing'
      + (skippedAlt ? ', ' + skippedAlt[1] + ' skipped' : '')
      + (xfailed ? ', ' + xfailed[1] + ' xfailed' : '');
  }
  return (text.trim().split('\n').pop() || '').trim();
}

/** The repo slug (`owner/repo`) the Actions API call needs. `GITHUB_REPOSITORY` is set by every
 *  Actions runner automatically; a local run has no such env var, so fall back to the `origin`
 *  remote (the same shape `git@github.com:owner/repo.git` / `https://github.com/owner/repo.git`
 *  either form of remote produces). */
function repoSlugFromGit() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = sh('git remote get-url origin').trim();
    const m = /github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/.exec(url);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

const UNKNOWN_VERDICT = 'unknown (no completed windows-restore-test run on master)';

/** The dashboard's health line, read from the latest completed run of `restoreTestWorkflow` on
 *  `restoreTestBranch` (issue 452) instead of spawned locally. `fetchImpl` is injectable so this
 *  is testable without network — pass a stub that resolves a canned Response-shaped object (or
 *  rejects, to exercise the failure path) instead of the real `fetch`.
 *
 *  Never throws: any failure (network, non-2xx, no runs found, malformed body) resolves to the
 *  explicit `UNKNOWN_VERDICT` string rather than crashing the dashboard build — a hiccup reading
 *  Actions must not stop DASHBOARD.md from being written. */
async function fetchRestoreTestVerdict(opts) {
  opts = opts || {};
  const workflow = opts.workflow || CONFIG.restoreTestWorkflow;
  const branch = opts.branch || CONFIG.restoreTestBranch;
  const repoSlug = opts.repoSlug || repoSlugFromGit();
  const token = opts.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);

  if (!repoSlug || !fetchImpl) return UNKNOWN_VERDICT;

  const url = 'https://api.github.com/repos/' + repoSlug + '/actions/workflows/' + workflow
    + '/runs?branch=' + encodeURIComponent(branch) + '&status=completed&per_page=1';

  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'build-dashboard.js' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetchImpl(url, { headers });
    if (!res || !res.ok) return UNKNOWN_VERDICT;
    const data = await res.json();
    const run = (data && data.workflow_runs && data.workflow_runs[0]) || null;
    if (!run) return UNKNOWN_VERDICT;

    const conclusion = run.conclusion || run.status || 'unknown';
    const label = conclusion === 'success' ? 'PASSING' : 'FAILING — ' + conclusion;
    const where = 'windows-restore-test run ' + run.id + ' on ' + branch + ', ' + ymd(run.updated_at);
    return label + ' (' + where + ') — ' + (run.html_url || url);
  } catch (e) {
    return UNKNOWN_VERDICT;
  }
}

function table(rows, cols) {
  if (!rows.length) return '_None._\n';
  const head = '| ' + cols.map(c => c.h).join(' | ') + ' |';
  const rule = '|' + cols.map(() => ' --- ').join('|') + '|';
  return [head, rule].concat(rows.map(r => '| ' + cols.map(c => c.f(r)).join(' | ') + ' |')).join('\n') + '\n';
}

async function build() {
  const TRIAGE = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-local-agent', 'ready-for-human', 'wontfix'];
  const issues = ghJson('gh issue list --state open --limit 500 --json number,title,labels,assignees,updatedAt,url,body,subIssuesSummary,parent') || [];
  issues.forEach(i => {
    const names = i.labels.map(l => l.name);
    i.triage = TRIAGE.find(t => names.includes(t)) || '';
    i.type = names.find(n => !TRIAGE.includes(n)) || '';
  });
  issues.filter(i => i.type === 'prd').forEach(i => { i.decomp = decomposition(i); });

  const deploy = CONFIG.deployWorkflow
    ? (ghJson('gh run list --workflow ' + CONFIG.deployWorkflow + ' --limit 1 --json conclusion,status,headSha,updatedAt,url') || [])[0] || null
    : null;

  let adrs = [];
  if (CONFIG.adrDir && fs.existsSync(path.join(ROOT, CONFIG.adrDir))) {
    const dir = path.join(ROOT, CONFIG.adrDir);
    adrs = fs.readdirSync(dir).filter(f => /^\d{4}-.*\.md$/.test(f)).sort().map(f => {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const title = (text.match(/^#\s+(.+)$/m) || [])[1] || f;
      let status = (text.match(/^\*\*Status:\*\*\s*(.+)$/m) || [])[1] || 'no status line';
      status = status.split(/(?<=\w[.)])\s/)[0];
      if (status.length > 160) status = status.slice(0, 157) + '...';
      return { id: f.slice(0, 4), title, status, file: CONFIG.adrDir + '/' + f };
    });
  }

  // The health line's source (issue 452): RUN_LOCAL_TEST_COMMAND=1 opts into spawning
  // CONFIG.testCommand locally (the old default, kept for a desktop that wants the real
  // PowerShell suite run against its own worktree). Otherwise — including every CI run of
  // `dashboard.yml`, which no longer sets that variable — the verdict is read from the latest
  // completed `restoreTestWorkflow` run on `restoreTestBranch` through the Actions API.
  let tests = null;
  if (process.env.RUN_LOCAL_TEST_COMMAND === '1' && CONFIG.testCommand) {
    try {
      tests = testSummary(sh(CONFIG.testCommand));
    } catch (e) {
      tests = 'FAILING — ' + testSummary(String((e.stdout || '') + (e.stderr || '')));
    }
  } else if (CONFIG.restoreTestWorkflow) {
    tests = await fetchRestoreTestVerdict();
  }

  // sha and generation-time timestamp used to head every DASHBOARD.md. Both drifted on every rerun
  // against unchanged inputs — the timestamp always, the sha whenever HEAD moved for unrelated reasons
  // — so the artifact never converged to byte-identical output and CI would either commit a no-op
  // churn or (with the v6 "commit only when changed" guard) swallow the run. Header dropped in issue
  // 26; sha with it, since nothing else read it.

  const issueCols = [
    { h: 'Issue', f: i => '[#' + i.number + '](' + i.url + ')' },
    { h: 'Title', f: i => esc(i.title) },
    { h: 'Type', f: i => i.type || '—' },
    { h: 'Triage', f: i => i.triage || '—' },
    // The child's-eye view of decomposition. `parent` is already fetched for `decomposition()`, so this costs
    // nothing, and without it the relationship is only visible from the PRD side — someone scanning the issue
    // list cannot tell which tickets belong to an initiative and which are standalone.
    { h: 'From PRD', f: i => i.parent ? '#' + i.parent.number : '—' },
    { h: 'Updated', f: i => ymd(i.updatedAt) }
  ];
  // The PRD table swaps "From PRD" (always blank on a parent) for the decomposition state.
  const prdCols = issueCols.slice(0, 4)
    .concat([{ h: 'Tickets', f: i => i.decomp.label }, issueCols[issueCols.length - 1]]);

  const attention = [];
  if (CONFIG.deployWorkflow) {
    if (!deploy) attention.push('- **No deploy run found** for `' + CONFIG.deployWorkflow + '`.');
    else if (deploy.status !== 'completed' || deploy.conclusion !== 'success')
      attention.push('- **Deploy is ' + (deploy.conclusion || deploy.status) + '** — [run](' + deploy.url + ') at `' + deploy.headSha.slice(0, 7) + '`.');
  }
  if (tests && /FAILING/.test(tests)) attention.push('- **Test suite failing at this commit:** ' + tests);
  ['needs-triage', 'needs-info', 'ready-for-human'].forEach(k => {
    issues.filter(i => i.triage === k).forEach(i =>
      attention.push('- **' + k + ':** [#' + i.number + '](' + i.url + ') ' + esc(i.title) + ' _(updated ' + ymd(i.updatedAt) + ')_'));
  });
  issues.filter(i => i.type === 'bug').forEach(i =>
    attention.push('- **open bug:** [#' + i.number + '](' + i.url + ') ' + esc(i.title) + ' _(updated ' + ymd(i.updatedAt) + ')_'));

  issues.filter(i => i.type === 'prd' && !i.decomp.done).forEach(i =>
    attention.push('- **PRD not broken into tickets:** [#' + i.number + '](' + i.url + ') ' + esc(i.title) + ' — run `/to-tickets`'));

  const prds = issues.filter(i => i.type === 'prd');
  const rest = issues.filter(i => i.type !== 'prd');

  const health = [];
  if (CONFIG.deployWorkflow) health.push('- **Deploy (`' + CONFIG.deployWorkflow + '`):** ' + (deploy ? (deploy.conclusion || deploy.status) + ' at `' + deploy.headSha.slice(0, 7) + '` (' + ymd(deploy.updatedAt) + ') — [run](' + deploy.url + ')' : 'no runs found'));
  if (tests) health.push('- **Test suite at this commit:** ' + tests);

  const md = [
    '# ' + CONFIG.title + ' — working dashboard',
    '',
    '_Generated by `scripts/build-dashboard.js` (CI: `dashboard.yml`). Do not edit by hand._',
    '',
    '## Needs your attention',
    '',
    attention.length ? attention.join('\n') : '_Nothing waiting on you._',
    ''
  ].concat(health.length ? ['## Pipeline health', '', health.join('\n'), ''] : []).concat([
    '## Open PRDs',
    '',
    table(prds, prdCols),
    '## Open issues',
    '',
    table(rest, issueCols)
  ]).concat(adrs.length ? [
    '## ADRs',
    '',
    table(adrs, [
      { h: 'ADR', f: a => '[' + a.id + '](' + a.file + ')' },
      { h: 'Title', f: a => esc(a.title) },
      { h: 'Status', f: a => esc(a.status) }
    ])
  ] : []).concat([
    '## Where the rest lives',
    '',
    '- Triage vocabulary: [docs/agents/triage-labels.md](docs/agents/triage-labels.md)',
    '- Tracker conventions: [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)',
    ''
  ]).join('\n');

  fs.writeFileSync(OUT, md);
  console.log('DASHBOARD.md written (' + issues.length + ' open issues, ' + adrs.length + ' ADRs)');
}

if (require.main === module) {
  build().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { testSummary, decomposition, table, ymd, repoSlugFromGit, fetchRestoreTestVerdict, UNKNOWN_VERDICT, CONFIG, build };
