'use strict';
/**
 * node --test scripts/build-dashboard.test.js
 *
 * Covers the pieces of scripts/build-dashboard.js that don't need a live `gh` CLI or network:
 * testSummary()'s parsing (the opt-in local test-command path), and fetchRestoreTestVerdict()'s
 * Actions-read (issue 452) — exercised entirely with an injected `fetchImpl`, no real fetch.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const { testSummary, fetchRestoreTestVerdict, UNKNOWN_VERDICT } = require('./build-dashboard.js');

// ---- testSummary() (unchanged behavior; still used by the opt-in local path) ----

test('testSummary reads node --test pass/fail counts, not the last line', () => {
  const out = ['ℹ tests 255', 'ℹ suites 0', 'ℹ pass 255', 'ℹ fail 0',
    'ℹ skipped 0', 'ℹ duration_ms 150.1037'].join('\n');
  assert.equal(testSummary(out), '255 passing, 0 failing');
});

test('testSummary reports skips when present', () => {
  const out = ['ℹ tests 247', 'ℹ pass 246', 'ℹ fail 0', 'ℹ skipped 1', 'ℹ duration_ms 140'].join('\n');
  assert.equal(testSummary(out), '246 passing, 0 failing, 1 skipped');
});

test('testSummary reads the jest/vitest "N failed, M passed" shape regardless of order', () => {
  const out = 'Tests:  3 failed, 41 passed, 44 total\nTime:   2.5 s';
  assert.equal(testSummary(out), '41 passing, 3 failing');
});

test('testSummary falls back to the last line when no known shape is found', () => {
  assert.equal(testSummary('some\nunrecognized\noutput'), 'output');
});

// ---- fetchRestoreTestVerdict() (issue 452: read, don't re-run) ----

function fakeRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('fetchRestoreTestVerdict reports PASSING with the run id and url on a successful run', async () => {
  const run = { id: 987654321, conclusion: 'success', updated_at: '2026-09-18T10:00:00Z', html_url: 'https://github.com/o/r/actions/runs/987654321' };
  const fetchImpl = async (url) => {
    assert.match(url, /\/repos\/o\/r\/actions\/workflows\/windows-restore-test\.yml\/runs\?branch=master&status=completed&per_page=1/);
    return fakeRes(200, { workflow_runs: [run] });
  };
  const verdict = await fetchRestoreTestVerdict({ repoSlug: 'o/r', fetchImpl, token: 'tok' });
  assert.match(verdict, /^PASSING/);
  assert.match(verdict, /987654321/);
  assert.match(verdict, /2026-09-18/);
  assert.match(verdict, /https:\/\/github\.com\/o\/r\/actions\/runs\/987654321/);
});

test('fetchRestoreTestVerdict reports FAILING with the conclusion on a failed run', async () => {
  const run = { id: 42, conclusion: 'failure', updated_at: '2026-09-17T00:00:00Z', html_url: 'https://x/runs/42' };
  const fetchImpl = async () => fakeRes(200, { workflow_runs: [run] });
  const verdict = await fetchRestoreTestVerdict({ repoSlug: 'o/r', fetchImpl });
  assert.match(verdict, /^FAILING — failure/);
  assert.match(verdict, /42/);
});

test('fetchRestoreTestVerdict returns the explicit unknown verdict when no completed run exists', async () => {
  const fetchImpl = async () => fakeRes(200, { workflow_runs: [] });
  const verdict = await fetchRestoreTestVerdict({ repoSlug: 'o/r', fetchImpl });
  assert.equal(verdict, UNKNOWN_VERDICT);
});

test('fetchRestoreTestVerdict returns the explicit unknown verdict on a non-2xx response, not a throw', async () => {
  const fetchImpl = async () => fakeRes(404, {});
  const verdict = await fetchRestoreTestVerdict({ repoSlug: 'o/r', fetchImpl });
  assert.equal(verdict, UNKNOWN_VERDICT);
});

test('fetchRestoreTestVerdict returns the explicit unknown verdict when fetch itself rejects', async () => {
  const fetchImpl = async () => { throw new Error('network down'); };
  const verdict = await fetchRestoreTestVerdict({ repoSlug: 'o/r', fetchImpl });
  assert.equal(verdict, UNKNOWN_VERDICT);
});

test('fetchRestoreTestVerdict returns the explicit unknown verdict with no repo slug and no fetch impl', async () => {
  const verdict = await fetchRestoreTestVerdict({ repoSlug: null, fetchImpl: null });
  assert.equal(verdict, UNKNOWN_VERDICT);
});
