#!/usr/bin/env node
/**
 * Live acceptance proof for the Tracker audit job (issue 473).
 *
 *   node tools/tracker-audit-proof.js    # on a runner, with PROJECT_TOKEN in the environment
 *
 * WHY THIS FILE EXISTS. Issue 473's first acceptance criterion is "a throwaway issue closed with
 * an unticked acceptance box turns the next run red and the summary names the finding, run log
 * quoted". No branch checkout and no container can produce that: an `issues` workflow fires only
 * from the default branch, and an event raised by the built-in GITHUB_TOKEN triggers no workflow at
 * all. A unit test against a stubbed `gh` proves the audit's arithmetic, not that GitHub delivers a
 * close event to a job that reads the real tracker and goes red. So the acceptance check is code,
 * run by `.github/workflows/tracker-audit.yml` on `workflow_dispatch` with `proof: true`, and the
 * evidence is that job's own log.
 *
 * What it does, end to end, against the live tracker:
 *
 *   1. opens a throwaway issue carrying exactly one unticked acceptance box,
 *   2. closes it WITH PROJECT_TOKEN — a PAT, because a GITHUB_TOKEN close raises no workflow event,
 *   3. waits for the Tracker audit run that close started,
 *   4. requires that run to have concluded `failure` — drift is a red check, which is the point,
 *   5. quotes its log and requires a `[closed-with-open-boxes]` finding naming that issue,
 *   6. ticks the box, so the drift it deliberately created does not outlive the proof.
 *
 * Exit 0 only when a real run went red naming the throwaway. Exit 1 with an `::error::` on a
 * missing token, no run appearing before the deadline, a GREEN run (the job saw the drift and
 * called it clean), or a red run whose log never names the finding — each of those is the job
 * quietly not working, which is what this ticket exists to remove.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const WORKFLOW_FILE = 'tracker-audit.yml';
// A close has to reach GitHub's dispatcher, queue a run, boot a runner and read the whole tracker;
// two minutes is a normal cold start. Ten is generous without letting a stuck job hold a runner.
const RUN_DEADLINE_MS = 10 * 60 * 1000;
const POLL_MS = 15 * 1000;
const BOX = 'this box is deliberately left unticked — the proof ticks it at the end';
const MISSING_TOKEN = 'PROJECT_TOKEN is not set. The proof has to close an issue in a way that '
  + 'TRIGGERS a workflow, and an event raised by the built-in GITHUB_TOKEN triggers none. Store a '
  + 'classic token carrying `repo` as the Actions secret PROJECT_TOKEN and dispatch again.';

/** A failure of the thing being proved, as opposed to a crash in the proof. */
class ProofFailure extends Error {}

function realRun(args, env) {
  const childEnv = Object.assign({}, env, { GH_TOKEN: env.PROJECT_TOKEN });
  // Same precedence rule as tools/board-sweep.js: a GITHUB_TOKEN left in the environment can win
  // inside `gh`, and a close it raises triggers nothing.
  delete childEnv.GITHUB_TOKEN;
  const r = spawnSync('gh', args, { encoding: 'utf8', env: childEnv, maxBuffer: 50 * 1024 * 1024 });
  return { status: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** The body of the throwaway. No `#N` citation anywhere in it: the audit's dangling-reference
 *  check reads those, and a proof must create exactly the one finding it is proving. */
function throwawayBody(stamp) {
  return 'Throwaway issue opened by `.github/workflows/tracker-audit.yml` (issue 473) to prove that '
    + 'closing an issue with an unticked acceptance box turns the next Tracker audit run red. Closed '
    + `automatically by run ${stamp}; the box below is ticked again when the proof finishes.\n\n`
    + `## Acceptance criteria\n\n- [ ] ${BOX}\n`;
}

function trackerAuditProof(opts = {}) {
  const env = opts.env || process.env;
  const out = [];
  const emit = opts.log || ((line) => console.log(line));
  const log = (line) => { out.push(line); emit(line); };
  const sleep = opts.sleep || ((ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); });
  const now = opts.now || (() => Date.now());
  const runGh = opts.run || ((args) => realRun(args, env));

  const gh = (args) => {
    const r = runGh(args);
    if (r.status !== 0) {
      const why = (r.stderr || r.stdout || '').split('\n').filter(Boolean)[0] || `exit ${r.status}`;
      throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${why}`);
    }
    return r.stdout;
  };
  const ghJson = (args) => JSON.parse(gh(args));

  let failure = null;
  let issueNumber = null;
  let ticked = false;
  const REPO = opts.repo || env.GITHUB_REPOSITORY;

  try {
    if (!String(env.PROJECT_TOKEN || '').trim()) throw new ProofFailure(MISSING_TOKEN);
    if (!REPO || !REPO.includes('/')) {
      throw new ProofFailure('GITHUB_REPOSITORY is not set — this proof runs on a runner, where it always is.');
    }

    // ---- 1. the throwaway, with one unticked box ----------------------------------------------
    const stamp = env.GITHUB_RUN_ID || String(now());
    const issueUrl = gh(['issue', 'create', '-R', REPO, '--title', `tracker-audit proof ${stamp}`,
      '--body', throwawayBody(stamp)]).trim().split('\n').filter(Boolean).pop();
    const m = String(issueUrl).match(/\/issues\/(\d+)$/);
    if (!m) throw new ProofFailure(`could not read an issue number out of \`gh issue create\` output: ${issueUrl}`);
    issueNumber = Number(m[1]);
    log(`opened throwaway issue #${issueNumber} with one unticked acceptance box — ${issueUrl}`);

    // ---- 2. close it with the PAT, so the event reaches the workflow --------------------------
    const closedAt = now();
    gh(['issue', 'close', String(issueNumber), '-R', REPO,
      '--comment', 'Closing with the box unticked on purpose (issue 473 acceptance proof).']);
    log(`closed #${issueNumber} at ${new Date(closedAt).toISOString()} using PROJECT_TOKEN `
      + '(a GITHUB_TOKEN close raises no workflow event)');

    // ---- 3. the run that close started -------------------------------------------------------
    // A minute of slack: GitHub timestamps a run when its dispatcher accepts it, and that clock is
    // not this runner's. A cancelled run carries no verdict (the audit job cancels in flight), so
    // it is skipped rather than read.
    const since = closedAt - 60 * 1000;
    const deadline = closedAt + RUN_DEADLINE_MS;
    let run = null;
    while (now() < deadline) {
      const runs = ghJson(['api', `repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=issues&per_page=20`]).workflow_runs || [];
      const candidates = runs.filter((r) => Date.parse(r.created_at) >= since && r.conclusion !== 'cancelled');
      run = candidates[0] || null;
      if (run && run.status === 'completed') break;
      if (run) log(`run ${run.id} is ${run.status} — waiting`);
      sleep(POLL_MS);
    }
    if (!run) {
      throw new ProofFailure(`no Tracker audit run appeared within ${RUN_DEADLINE_MS / 60000} minutes of closing `
        + `#${issueNumber}. The issues:closed trigger is not wired, or ${WORKFLOW_FILE} is not on the `
        + 'default branch yet — a workflow fires from the default branch only.');
    }
    if (run.status !== 'completed') throw new ProofFailure(`run ${run.html_url} was still ${run.status} at the deadline.`);
    log(`triggered run ${run.id}: ${run.event} -> ${run.conclusion} — ${run.html_url}`);

    // ---- 4. the run log, quoted --------------------------------------------------------------
    let logText = '';
    try {
      logText = gh(['run', 'view', String(run.id), '-R', REPO, '--log']);
    } catch (e) {
      logText = '';
      log(`::warning::could not download the run log: ${e.message}`);
    }
    const quoted = logText.split('\n')
      .filter((l) => l.includes(`#${issueNumber}`) || /closed-with-open-boxes|drift finding|::error::/.test(l))
      .slice(0, 20);
    log('--- run log ---');
    for (const l of quoted) log(l);
    log('--- end run log ---');

    const names = new RegExp(`\\[closed-with-open-boxes\\] #${issueNumber}\\b`).test(logText);
    if (run.conclusion !== 'failure') {
      throw new ProofFailure(`#${issueNumber} was closed with an unticked acceptance box and run ${run.html_url} `
        + `concluded ${run.conclusion}. Drift has to be a red check — a green one here is the audit reporting `
        + 'drift it can see as a pass.');
    }
    if (!names) {
      throw new ProofFailure(`run ${run.html_url} went red, but its log never names `
        + `[closed-with-open-boxes] #${issueNumber} — it failed for some other reason, so this proves nothing.`);
    }
    log(`PROOF PASSED: closing #${issueNumber} with an unticked box turned run ${run.id} red with `
      + `[closed-with-open-boxes] #${issueNumber} (${run.html_url}).`);
  } catch (e) {
    failure = e instanceof ProofFailure ? e.message : `proof aborted: ${e.message}`;
  }

  // The drift was created on purpose and must not outlive the proof: a closed issue with an
  // unticked box is a finding in every later run, and this job's whole point is that such a
  // finding means something. Ticking the box is the same fix a human would apply.
  if (issueNumber) {
    const stamp = env.GITHUB_RUN_ID || 'a manual dispatch';
    const body = throwawayBody(stamp).replace(`- [ ] ${BOX}`, `- [x] ${BOX} — ticked by run ${stamp}`);
    const r = runGh(['issue', 'edit', String(issueNumber), '-R', REPO, '--body', body]);
    ticked = r.status === 0;
    log(ticked
      ? `cleaned up: the acceptance box on #${issueNumber} is ticked, so the tracker is clean again`
      : `::warning::could not tick the box on #${issueNumber} — tick it by hand or the next run stays red`);
  }
  if (failure) log(`::error::${failure}`);

  const summary = env.GITHUB_STEP_SUMMARY;
  if (summary) {
    try {
      fs.appendFileSync(summary, `### Tracker audit — live proof\n\n\`\`\`\n${out.join('\n')}\n\`\`\`\n`, 'utf8');
    } catch (e) { /* a summary that cannot be written must not decide the proof */ }
  }
  return { code: failure ? 1 : 0, output: out.join('\n'), issue: issueNumber, ticked };
}

module.exports = { trackerAuditProof, throwawayBody, RUN_DEADLINE_MS, WORKFLOW_FILE, MISSING_TOKEN, BOX };

if (require.main === module) process.exit(trackerAuditProof().code);
