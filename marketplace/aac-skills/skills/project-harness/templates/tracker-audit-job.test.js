#!/usr/bin/env node
// GENERATED - do not hand-edit. Built from the claude-dotfiles repo's own
// tools/tracker-audit-job.js by tools/build-harness-tracker-audit.js (claude-dotfiles issue
// 675). Edit that file and re-run the generator.
//
// In a harnessed repo this file IS tools/tracker-audit-job.js, and the next harness re-copy
// overwrites it - send a fix upstream to claude-dotfiles rather than editing it in place.
/**
 * node --test tools/tracker-audit-job.test.js
 *
 * Tests for tools/tracker-audit-job.js, the runner .github/workflows/tracker-audit.yml calls
 * (issue 473). The audit itself is tested by tools/tracker-audit.test.js; what is asserted here
 * is the job's own contract — a loud refusal with no token, the audit's exit code reaching the
 * check unchanged, and a job summary that NAMES the findings rather than burying them.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { trackerAuditJob, findingLines, MISSING_TOKEN, AUDIT } = require('./tracker-audit-job.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'tracker-audit.yml');
const quiet = () => {};

const DRIFT = 'Tracker audit — surreptakos/claude-dotfiles (3 open, 40 total)\n\n'
  + '[closed-with-open-boxes] #472 a throwaway\n'
  + '    closed with 1 unticked acceptance box: "- [ ] never ticked"\n'
  + '    https://github.com/surreptakos/claude-dotfiles/issues/472\n\n'
  + '1 drift finding(s).';

function summaryFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-audit-job-')), 'summary.md');
}

test('no token: refuses loudly, exits 2, spawns nothing', () => {
  const calls = [];
  const r = trackerAuditJob({
    env: {}, log: quiet,
    spawn: (...a) => { calls.push(a); return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(r.code, 2);
  assert.equal(r.spawned, false);
  assert.deepEqual(calls, [], 'the audit must not run unauthenticated');
  assert.match(r.output, /^::error::/);
  assert.match(MISSING_TOKEN, /GH_TOKEN/);
});

test('GH_TOKEN wins, and the child is handed it with GITHUB_TOKEN removed', () => {
  let seen = null;
  const r = trackerAuditJob({
    env: { GH_TOKEN: 'tok-473', GITHUB_TOKEN: 'job-token' }, log: quiet,
    spawn: (cmd, args, o) => { seen = { cmd, args, o }; return { status: 0, stdout: 'No drift found', stderr: '' }; },
  });
  assert.equal(r.code, 0);
  assert.equal(seen.args.length, 1);
  assert.equal(seen.args[0], path.join(REPO_ROOT, AUDIT));
  assert.equal(seen.o.env.GH_TOKEN, 'tok-473');
  assert.equal(seen.o.env.GITHUB_TOKEN, undefined);
});

test('the audit exit code reaches the check unchanged, and the error names the first finding', () => {
  for (const [status, pattern] of [[1, /drift found/], [2, /NOT a pass/], [null, /NOT a pass/]]) {
    const r = trackerAuditJob({
      env: { GITHUB_TOKEN: 'job-token' }, log: quiet,
      spawn: () => ({ status, stdout: DRIFT, stderr: '' }),
    });
    assert.equal(r.code, status === null ? 2 : status);
    assert.match(r.output, /^::error::tracker audit exited/m);
    assert.match(r.output, pattern);
  }
  const r = trackerAuditJob({
    env: { GITHUB_TOKEN: 'job-token' }, log: quiet,
    spawn: () => ({ status: 1, stdout: DRIFT, stderr: '' }),
  });
  assert.match(r.output, /::error::.*\[closed-with-open-boxes\] #472 a throwaway/);
});

test('the job summary names every finding above the quoted audit output', () => {
  const file = summaryFile();
  const r = trackerAuditJob({
    env: { GITHUB_TOKEN: 'job-token', GITHUB_STEP_SUMMARY: file }, log: quiet,
    spawn: () => ({ status: 1, stdout: DRIFT, stderr: '' }),
  });
  assert.equal(r.code, 1);
  const summary = fs.readFileSync(file, 'utf8');
  assert.match(summary, /### Tracker audit — exit 1 \(drift found\)/);
  assert.match(summary, /- `\[closed-with-open-boxes\] #472 a throwaway`/);
  assert.match(summary, /```\n[\s\S]*1 drift finding\(s\)\.\n[\s\S]*```/);
  assert.match(summary, /closed with 1 unticked acceptance box/);
  // The refusal is summarized too: a run that never reached the audit must still say why.
  const second = summaryFile();
  trackerAuditJob({ env: { GITHUB_STEP_SUMMARY: second }, log: quiet, spawn: () => ({ status: 0 }) });
  assert.match(fs.readFileSync(second, 'utf8'), /exit 2 \(could not audit/);
});

test('findingLines picks hard and advisory findings only, not headers or notes', () => {
  assert.deepEqual(findingLines(DRIFT), ['[closed-with-open-boxes] #472 a throwaway']);
  assert.deepEqual(findingLines('[landed-but-open?] #12 t\nNOTE: something\n    detail\n[untriaged] #13 u'),
    ['[landed-but-open?] #12 t', '[untriaged] #13 u']);
});

// The workflow is YAML bash's only home in this repo, so what cannot be unit-tested is at least
// pinned: the triggers the ticket names, the token the audit is handed, and the runner being what
// runs (no inline `node tools/tracker-audit.js` growing back in the YAML).
test('the workflow runs this runner, on issue, push and dispatch events', () => {
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(yaml, /node tools\/tracker-audit-job\.js/);
  assert.doesNotMatch(yaml, /run: node tools\/tracker-audit\.js/);
  for (const t of ['opened', 'closed', 'edited', 'labeled', 'unlabeled', 'milestoned']) {
    assert.match(yaml, new RegExp(`types: \\[[^\\]]*${t}`));
  }
  // The default branch, substituted by project-harness step 8b. `DEFAULT_BRANCH` still in the
  // file means the push trigger never fires and nothing else says so.
  assert.match(yaml, /push:\s*\n(?:\s*#[^\n]*\n)*\s*branches: \[(?<branch>[\w.\/-]+)\]/);
  assert.doesNotMatch(yaml, /branches: \[DEFAULT_BRANCH\]/);
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  // The landed-but-open class reads the default branch's log; a shallow checkout has none of it.
  assert.match(yaml, /fetch-depth: 0/);
  assert.match(yaml, /pull-requests: read/);
});
