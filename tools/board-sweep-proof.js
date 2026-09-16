#!/usr/bin/env node
/**
 * Live acceptance proof for the Board sweep job (issue 216, spec #207).
 *
 *   node tools/board-sweep-proof.js      # on a runner, with PROJECT_TOKEN in the environment
 *
 * WHY THIS FILE EXISTS. Issue 216's acceptance is "closing a throwaway issue moves its card to
 * Done within one run, run log quoted". Nothing in a container or a branch checkout can produce
 * that: every ProjectsV2 read and write is GraphQL (the cloud egress proxy refuses GraphQL, and
 * refuses `/users/...` REST outright — sessions are bound to their configured repository), and an
 * `issues: closed` workflow fires only from the default branch. A unit test against a stubbed
 * `gh` cannot stand in either: it proves the sweep's arithmetic, not that GitHub delivers the
 * close event to a job that reaches a real board with the real token. So the acceptance check
 * itself is code, run by `.github/workflows/board-sweep.yml` on `workflow_dispatch` with
 * `proof: true`, and the evidence issue 216 asks for is that job's own log.
 *
 * What it does, end to end, against the live repo and the live board:
 *
 *   1. opens a throwaway issue,
 *   2. adds its card to the board and parks it in a non-Done Status,
 *   3. closes the issue WITH PROJECT_TOKEN — a PAT, because an event raised by the built-in
 *      GITHUB_TOKEN never triggers another workflow, and the point is to prove the trigger,
 *   4. waits for the Board sweep run that close started,
 *   5. reads the card back and requires Status == Done,
 *   6. quotes that run's URL and the sweep lines from its log,
 *   7. deletes the throwaway card, so the board is left as it was found.
 *
 * Exit 0 only when the card reached Done through a real run. Exit 1 with an `::error::` on a
 * missing token, a missing board, no run appearing before the deadline, a red run, or a card that
 * stayed put — each of those is the job quietly not working, which is the failure mode this
 * ticket exists to remove.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const { MISSING_TOKEN } = require('./board-sweep.js');

const WORKFLOW_FILE = 'board-sweep.yml';
// A close event has to reach GitHub's dispatcher, queue a run, boot a runner and sweep; two
// minutes is a normal cold start. Ten is generous without letting a stuck job hold a runner.
const RUN_DEADLINE_MS = 10 * 60 * 1000;
const POLL_MS = 15 * 1000;

/** A failure of the thing being proved, as opposed to a crash in the proof. */
class ProofFailure extends Error {}

function realRun(args, env) {
  const childEnv = { ...env, GH_TOKEN: env.PROJECT_TOKEN };
  // Same precedence rule as tools/board-sweep.js: a repo-scoped GITHUB_TOKEN left in the
  // environment can win inside `gh` and reach no owner-level board.
  delete childEnv.GITHUB_TOKEN;
  const r = spawnSync('gh', args, { encoding: 'utf8', env: childEnv, maxBuffer: 50 * 1024 * 1024 });
  return { status: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function boardSweepProof(opts = {}) {
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
  let itemId = null;
  let board = null;
  let openIssue = null;   // set between `issue create` and `issue close`

  try {
    if (!(env.PROJECT_TOKEN || '').trim()) throw new ProofFailure(MISSING_TOKEN.replace(/^::error::/, ''));

    const REPO = opts.repo || env.GITHUB_REPOSITORY;
    if (!REPO || !REPO.includes('/')) {
      throw new ProofFailure('GITHUB_REPOSITORY is not set — this proof runs on a runner, where it always is.');
    }

    // ---- the board the sweep will sweep ------------------------------------------------------
    const linked = ghJson(['repo', 'view', REPO, '--json', 'projectsV2']);
    const nodes = (linked.projectsV2 && (linked.projectsV2.nodes || linked.projectsV2.Nodes)) || [];
    for (const p of nodes.filter((n) => !n.closed)) {
      const m = (p.resourcePath || '').match(/^\/(users|orgs)\/([^/]+)\/projects\/(\d+)$/);
      if (m) { board = { owner: m[2], number: Number(m[3]), title: p.title, ownerType: m[1] === 'orgs' ? 'organization' : 'user' }; break; }
    }
    if (!board) throw new ProofFailure(`no open ProjectsV2 board is linked to ${REPO}, so there is nothing to prove against.`);

    const q = board.ownerType === 'organization'
      ? 'query($o:String!,$n:Int!){organization(login:$o){projectV2(number:$n){id fields(first:50){nodes{__typename ... on ProjectV2SingleSelectField{id name options{id name}}}}}}}'
      : 'query($o:String!,$n:Int!){user(login:$o){projectV2(number:$n){id fields(first:50){nodes{__typename ... on ProjectV2SingleSelectField{id name options{id name}}}}}}}';
    const res = JSON.parse(gh(['api', 'graphql', '-f', `query=${q}`, '-f', `o=${board.owner}`, '-F', `n=${board.number}`]));
    const proj = res.data[board.ownerType === 'organization' ? 'organization' : 'user'].projectV2;
    const status = proj.fields.nodes.find((f) => f.name === 'Status' && f.__typename === 'ProjectV2SingleSelectField');
    if (!status) throw new ProofFailure(`board ${board.owner}/#${board.number} has no Status single-select field.`);
    const done = status.options.find((o) => o.name.toLowerCase() === 'done');
    const parked = status.options.find((o) => o.name.toLowerCase() !== 'done');
    if (!done || !parked) throw new ProofFailure(`board ${board.owner}/#${board.number} needs a Done option and one other option to park a card in.`);

    // ---- 1. the throwaway issue ---------------------------------------------------------------
    const stamp = env.GITHUB_RUN_ID || String(now());
    // No acceptance heading and no checkboxes: tools/tracker-audit.js reports a CLOSED issue with
    // unticked boxes, and this one is closed a minute after it is opened.
    const body = 'Throwaway issue opened by `.github/workflows/board-sweep.yml` (issue 216) to prove that '
      + 'closing an issue moves its board card to Done within one run. Closed automatically by run '
      + `${stamp}; its card is deleted from the board when the proof finishes.`;
    const issueUrl = gh(['issue', 'create', '-R', REPO, '--title', `board-sweep proof ${stamp}`, '--body', body])
      .trim().split('\n').filter(Boolean).pop();
    const num = String(issueUrl).match(/\/issues\/(\d+)$/);
    if (!num) throw new ProofFailure(`could not read an issue number out of \`gh issue create\` output: ${issueUrl}`);
    const issueNumber = Number(num[1]);
    openIssue = issueNumber;
    log(`opened throwaway issue #${issueNumber} — ${issueUrl}`);

    // ---- 2. its card, parked off Done ---------------------------------------------------------
    itemId = ghJson(['project', 'item-add', String(board.number), '--owner', board.owner, '--url', issueUrl, '--format', 'json']).id;
    gh(['project', 'item-edit', '--project-id', proj.id, '--id', itemId, '--field-id', status.id, '--single-select-option-id', parked.id]);
    log(`card ${itemId} added to ${board.owner}/#${board.number} "${board.title}" with Status "${parked.name}"`);

    // ---- 3. close it, with the PAT so the event triggers the workflow --------------------------
    const closedAt = now();
    gh(['issue', 'close', String(issueNumber), '-R', REPO, '--comment', 'Closing to trigger the Board sweep job (issue 216 acceptance proof).']);
    openIssue = null;
    log(`closed #${issueNumber} at ${new Date(closedAt).toISOString()} using PROJECT_TOKEN (a GITHUB_TOKEN close raises no workflow event)`);

    // ---- 4. the run that close started --------------------------------------------------------
    // A minute of slack: GitHub timestamps a run when its dispatcher accepts it, and that clock is
    // not this runner's clock. A concurrent close could in principle match first — harmless, since
    // step 5 asserts on this card rather than on the run's identity.
    const since = closedAt - 60 * 1000;
    const deadline = closedAt + RUN_DEADLINE_MS;
    let run = null;
    while (now() < deadline) {
      const runs = ghJson(['api', `repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=issues&per_page=20`]).workflow_runs || [];
      run = runs.find((r) => Date.parse(r.created_at) >= since) || null;
      if (run && run.status === 'completed') break;
      if (run) log(`run ${run.id} is ${run.status} — waiting`);
      sleep(POLL_MS);
    }
    if (!run) {
      throw new ProofFailure(`no Board sweep run appeared within ${RUN_DEADLINE_MS / 60000} minutes of closing #${issueNumber}. `
        + `The issues:closed trigger is not wired, or ${WORKFLOW_FILE} is not on the default branch yet — `
        + 'a workflow fires from the default branch only.');
    }
    if (run.status !== 'completed') throw new ProofFailure(`run ${run.html_url} was still ${run.status} at the deadline.`);
    log(`triggered run ${run.id}: ${run.event} -> ${run.conclusion} — ${run.html_url}`);

    // ---- 5. the card, read back ---------------------------------------------------------------
    const items = ghJson(['project', 'item-list', String(board.number), '--owner', board.owner, '--format', 'json', '--limit', '500']).items || [];
    const card = items.find((i) => i.id === itemId);
    if (!card) throw new ProofFailure(`the throwaway card ${itemId} is gone from the board — nothing to read a Status off.`);
    log(`card ${itemId} Status after the run: "${card.status}"`);

    // ---- 6. the run log, quoted ---------------------------------------------------------------
    let lines;
    try {
      lines = gh(['run', 'view', String(run.id), '-R', REPO, '--log']).split('\n')
        .filter((l) => l.includes(`#${issueNumber}`) || /total moved|stale|::error::/.test(l))
        .slice(0, 20);
    } catch (e) {
      lines = [`(could not download the run log: ${e.message})`];
    }
    log('--- run log ---');
    for (const l of lines) log(l);
    log('--- end run log ---');

    if (card.status !== done.name) {
      throw new ProofFailure(`#${issueNumber} closed, run ${run.html_url} finished ${run.conclusion}, but its card is still `
        + `"${card.status}" instead of "${done.name}". The job ran and the board did not move.`);
    }
    if (run.conclusion !== 'success') {
      throw new ProofFailure(`the card reached "${done.name}" but run ${run.html_url} concluded ${run.conclusion} — read the log above.`);
    }
    log(`PROOF PASSED: closing #${issueNumber} moved its card to "${done.name}" within run ${run.id} (${run.html_url}).`);
  } catch (e) {
    failure = e instanceof ProofFailure ? e.message : `proof aborted: ${e.message}`;
  }

  // An abort between opening the throwaway and closing it would otherwise leave an OPEN issue
  // with no triage label and no milestone — two findings in the next tracker audit, caused by the
  // proof rather than by the tracker.
  if (openIssue) {
    const r = runGh(['issue', 'close', String(openIssue), '-R', opts.repo || env.GITHUB_REPOSITORY,
      '--comment', 'Closing: the board-sweep proof aborted before it got this far.']);
    log(r.status === 0
      ? `cleaned up: throwaway issue #${openIssue} closed`
      : `::warning::throwaway issue #${openIssue} is still open — close it by hand`);
  }
  // The throwaway card comes off the board whether the proof passed or failed; the issue is left
  // closed rather than deleted, so the run log's `#N` still resolves to something.
  if (itemId && board) {
    const r = runGh(['project', 'item-delete', String(board.number), '--owner', board.owner, '--id', itemId]);
    log(r.status === 0
      ? `cleaned up: card ${itemId} deleted from the board`
      : `::warning::could not delete throwaway card ${itemId} — remove it by hand`);
  }
  if (failure) log(`::error::${failure}`);

  const summary = env.GITHUB_STEP_SUMMARY;
  if (summary) {
    try {
      fs.appendFileSync(summary, `### Board sweep — live proof\n\n\`\`\`\n${out.join('\n')}\n\`\`\`\n`, 'utf8');
    } catch { /* a summary that cannot be written must not decide the proof */ }
  }
  return { code: failure ? 1 : 0, output: out.join('\n') };
}

module.exports = { boardSweepProof, RUN_DEADLINE_MS, WORKFLOW_FILE };

if (require.main === module) process.exit(boardSweepProof().code);
