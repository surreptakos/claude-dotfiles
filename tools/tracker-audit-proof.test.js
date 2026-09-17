#!/usr/bin/env node
/**
 * node --test tools/tracker-audit-proof.test.js
 *
 * Tests for tools/tracker-audit-proof.js, the live acceptance proof the Tracker audit job runs
 * (issue 473). The proof itself closes a real issue on a runner; these tests drive it against a
 * fake `gh` so every verdict it can reach — passed, a green run, a red run for the wrong reason,
 * no run at all, no token — is executed here rather than discovered on a runner at 3am.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { trackerAuditProof, throwawayBody, WORKFLOW_FILE, BOX } = require('./tracker-audit-proof.js');

const WORKFLOW = path.join(path.resolve(__dirname, '..'), '.github', 'workflows', WORKFLOW_FILE);
const quiet = () => {};
const ISSUE_URL = 'https://github.com/surreptakos/claude-dotfiles/issues/9001';
const RUN_URL = 'https://github.com/surreptakos/claude-dotfiles/actions/runs/4242';
const RED_LOG = 'audit\tTracker audit — surreptakos/claude-dotfiles (3 open, 40 total)\n'
  + 'audit\t[closed-with-open-boxes] #9001 tracker-audit proof 77\n'
  + 'audit\t1 drift finding(s).\n'
  + 'audit\t::error::tracker audit exited 1 (drift found)\n';

/** A `gh` that behaves like the real one. `runs` is what the workflow-runs endpoint returns after
 *  the close, `runLog` what `gh run view --log` hands back. */
function fakeGh({ runs, runLog = RED_LOG, editStatus = 0 } = {}) {
  const calls = [];
  const ok = (stdout) => ({ status: 0, stdout, stderr: '' });
  const defaultRuns = [{
    id: 4242, status: 'completed', conclusion: 'failure', event: 'issues',
    created_at: '2026-09-16T12:00:30Z', html_url: RUN_URL,
  }];
  const run = (args) => {
    calls.push(args.join(' '));
    const key = `${args[0]} ${args[1] || ''}`;
    switch (key) {
      case 'issue create': return ok(`${ISSUE_URL}\n`);
      case 'issue close': return ok('');
      case 'issue edit': return editStatus === 0 ? ok('') : { status: editStatus, stdout: '', stderr: 'no write access' };
      case 'run view': return ok(runLog);
      default:
        if (args[0] === 'api' && String(args[1]).includes('/actions/workflows/')) {
          return ok(JSON.stringify({ workflow_runs: runs === undefined ? defaultRuns : runs }));
        }
        return { status: 9, stdout: '', stderr: `fake gh: unexpected call: ${args.join(' ')}` };
    }
  };
  return { run, calls };
}

/** A clock advancing a minute per read, so the poll loop reaches its deadline without real waiting. */
function fakeClock(startIso = '2026-09-16T12:00:00Z') {
  let t = Date.parse(startIso);
  return () => { const v = t; t += 60 * 1000; return v; };
}

function proof(gh, extra) {
  return trackerAuditProof(Object.assign({
    env: { PROJECT_TOKEN: 'pat', GITHUB_REPOSITORY: 'surreptakos/claude-dotfiles', GITHUB_RUN_ID: '77' },
    run: gh.run, now: fakeClock(), sleep: () => {}, log: quiet,
  }, extra));
}

test('a red run naming the throwaway passes, quotes the log, and ticks the box afterwards', () => {
  const gh = fakeGh();
  const r = proof(gh);
  assert.equal(r.code, 0, r.output);
  assert.equal(r.issue, 9001);
  assert.equal(r.ticked, true);
  assert.match(r.output, /PROOF PASSED/);
  assert.match(r.output, /\[closed-with-open-boxes\] #9001/);
  assert.match(r.output, /--- run log ---/);
  assert.match(r.output, new RegExp(RUN_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // The box the proof opened un-ticked is ticked in the same body it wrote, so a later run is green.
  const edit = gh.calls.find((c) => c.startsWith('issue edit'));
  assert.ok(edit, 'the proof must tick the box it left unticked');
  assert.match(edit, /- \[x\]/);
  assert.doesNotMatch(edit, /- \[ \]/);
});

test('a GREEN run fails the proof: drift the job can see has to be a red check', () => {
  const gh = fakeGh({ runs: [{
    id: 4243, status: 'completed', conclusion: 'success', event: 'issues',
    created_at: '2026-09-16T12:00:30Z', html_url: RUN_URL,
  }] });
  const r = proof(gh);
  assert.equal(r.code, 1);
  assert.match(r.output, /::error::.*concluded success/);
  assert.equal(r.ticked, true, 'the throwaway is cleaned up even when the proof fails');
});

test('a red run whose log never names the finding proves nothing', () => {
  const r = proof(fakeGh({ runLog: 'audit\t::error::npm ci failed\n' }));
  assert.equal(r.code, 1);
  assert.match(r.output, /never names/);
});

test('no run before the deadline names the trigger and the default-branch rule', () => {
  const r = proof(fakeGh({ runs: [] }));
  assert.equal(r.code, 1);
  assert.match(r.output, /no Tracker audit run appeared/);
  assert.match(r.output, /default branch only/);
});

test('a cancelled run carries no verdict and is not read as one', () => {
  const gh = fakeGh({ runs: [{
    id: 4244, status: 'completed', conclusion: 'cancelled', event: 'issues',
    created_at: '2026-09-16T12:00:30Z', html_url: RUN_URL,
  }] });
  const r = proof(gh);
  assert.equal(r.code, 1);
  assert.match(r.output, /no Tracker audit run appeared/);
});

test('no PROJECT_TOKEN: refuses, opens nothing, says why a GITHUB_TOKEN close would not do', () => {
  const gh = fakeGh();
  const r = trackerAuditProof({
    env: { GITHUB_REPOSITORY: 'surreptakos/claude-dotfiles' },
    run: gh.run, now: fakeClock(), sleep: () => {}, log: quiet,
  });
  assert.equal(r.code, 1);
  assert.equal(r.issue, null);
  assert.deepEqual(gh.calls, []);
  assert.match(r.output, /PROJECT_TOKEN/);
  assert.match(r.output, /triggers none/);
});

test('the throwaway body carries exactly one unticked box and cites no issue number', () => {
  const body = throwawayBody('77');
  assert.equal((body.match(/^- \[ \] /gm) || []).length, 1);
  assert.match(body, new RegExp(BOX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // A `#N` would be read by the audit's dangling-reference check; the proof must create exactly
  // the one finding it is proving.
  assert.doesNotMatch(body, /#\d+/);
});

test('the workflow dispatches this proof behind an input, never on an event', () => {
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(yaml, /node tools\/tracker-audit-proof\.js/);
  assert.match(yaml, /if: github\.event_name == 'workflow_dispatch' && inputs\.proof/);
  assert.match(yaml, /PROJECT_TOKEN: \$\{\{ secrets\.PROJECT_TOKEN \}\}/);
});
