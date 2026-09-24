'use strict';
/**
 * node --test tests/build-dashboard-verdict.test.js
 *
 * Issue 452: the dashboard reads its test health line from the latest completed
 * windows-restore-test.yml run on master instead of spawning the Windows suite per event, and
 * dashboard.yml runs on ubuntu with every trigger it had (the issue-21 label events included).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const { CONFIG, workflowVerdict } = require(path.join(ROOT, 'scripts', 'build-dashboard.js'));
const RUN = { headSha: '0123456789ab', updatedAt: '2026-09-22T10:00:00Z', url: 'https://example/run/1' };

test('the verdict source is windows-restore-test.yml on master, and no suite is spawned', () => {
  assert.equal(CONFIG.testWorkflow, 'windows-restore-test.yml');
  assert.equal(CONFIG.testBranch, 'master');
  assert.equal(CONFIG.testCommand, null);
});

test('workflowVerdict: only success is green; a missing or unreadable run is unknown', () => {
  const v = (run) => workflowVerdict(run, 'w.yml', 'master');
  assert.deepEqual(v(Object.assign({ conclusion: 'success' }, RUN)),
    { ok: true, text: 'passing at `0123456` (2026-09-22) — [run](https://example/run/1)' });
  assert.match(v(Object.assign({ conclusion: 'failure' }, RUN)).text, /^FAILING at `0123456`/);
  assert.equal(v(Object.assign({ conclusion: 'cancelled' }, RUN)).ok, false);
  assert.deepEqual(v(null), { ok: false, text: 'unknown — no completed run of `w.yml` on `master`' });
  assert.match(v(undefined).text, /^unknown — could not read/);
});

test('dashboard.yml runs on ubuntu and keeps every issue trigger', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'dashboard.yml'), 'utf8');
  assert.match(yml, /^\s+runs-on: ubuntu-latest$/m);
  assert.doesNotMatch(yml, /^\s+runs-on: windows/m);
  assert.match(yml, /types: \[opened, closed, reopened, edited, labeled, unlabeled, assigned, unassigned\]/);
  assert.match(yml, /^\s+actions: read$/m);
});
