#!/usr/bin/env node
/**
 * node --test tools/fleet-run-record.test.js
 *
 * The post-wave run record (issue 1010): the step the ticket-fleet skill and the orchestrator
 * runbook name must find its tool in this repo and write the record they describe.
 *   - the command the fleet hands back (RECORD_COMMAND) names a file that exists here
 *   - a journal distils into per-ticket attempts, verdicts (a -rerun verdict supersedes), PR and
 *     merge, with secret-shaped values redacted
 *   - --latest records THIS checkout's newest run, not another repo's newer one, and writes
 *     state/fleet-runs/<runId>.json
 *   - no journal at all is exit 2, never a pass
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const CLI = path.join(__dirname, 'fleet-run-record.js');
const REPO = path.join(__dirname, '..');
const { buildRecord, parseJournal, validateRecord, renderDigest, projectKey } = require('./fleet-run-record.js');

const line = (o) => JSON.stringify(o);
function journalText() {
  let n = 0;
  const call = (label, phase, outcome) => {
    n += 1;
    const key = `v2:${n}`;
    const started = line({ type: 'started', key, agentId: `a${n}`, label, phase });
    if (outcome === 'failed') return [started, line({ type: 'failed', key, agentId: '' })];
    return [started, line({ type: 'result', key, agentId: `a${n}`, result: outcome })];
  };
  return [
    line({ type: 'launched' }),
    ...call('scout', 'Scout', { tickets: [{ number: 41, title: 'first' }, { number: 42, title: 'second' }] }),
    ...call('impl:#41.1', 'Implement', { branch: 'agent/issue-41-attempt1', committed: true, testExitCode: 1, testTail: `token ${'ghp_' + 'x'.repeat(30)}`, discoveries: ['d1'] }),
    ...call('verify:#41.1', 'Verify', { pass: false, evidence: 'ran it', failures: [] }),
    ...call('impl:#41.2', 'Implement', { branch: 'agent/issue-41-attempt2', committed: true, testExitCode: 0, testTail: 'ok', discoveries: [] }),
    ...call('verify:#41.2', 'Verify', { pass: false, evidence: 'first pass', failures: ['flaky'] }),
    ...call('verify:#41.2-rerun', 'Verify', { pass: true, evidence: 'rerun passed', failures: [] }),
    ...call('deliver:#41', 'Deliver', { pushed: true, prUrl: 'https://github.com/o/r/pull/77', merged: true, prState: 'merged' }),
    ...call('tree-guard:implement-attempt1#41', 'Isolation guard', 'failed'),
    '{"type":"result","key":"cut-off-mid-wri',
  ].join('\n');
}

test('the command the fleet hands back names a tool that exists in this repo', () => {
  const fleet = fs.readFileSync(path.join(REPO, 'aac-skills', 'ticket-fleet', 'ticket-fleet.js'), 'utf8');
  const m = fleet.match(/const RECORD_COMMAND = '([^']+)'/);
  assert.ok(m, 'ticket-fleet.js declares RECORD_COMMAND');
  const script = m[1].split(/\s+/)[1];
  assert.equal(script, 'tools/fleet-run-record.js');
  assert.ok(fs.existsSync(path.join(REPO, script)), `${script} exists`);
  const skill = fs.readFileSync(path.join(REPO, 'aac-skills', 'ticket-fleet', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(m[1]), 'SKILL.md step 4 names the same command');
});

test('a journal distils into attempts, verdicts, PR and merge, secrets redacted', () => {
  const { entries, malformed } = parseJournal(journalText());
  assert.equal(malformed, 1, 'the cut-off tail line is counted, not thrown on');
  const record = buildRecord({ runId: 'wf_test', journalPath: 'j', entries, malformed, generatedAt: '2026-09-29T00:00:00Z' });
  assert.deepEqual(validateRecord(record), []);

  const t41 = record.tickets.find((t) => t.ticket === 41);
  assert.equal(t41.title, 'first');
  assert.equal(t41.outcome, 'delivered');
  assert.equal(t41.pr, 77);
  assert.equal(t41.merged, true);
  assert.equal(t41.discoveries, 1);
  assert.deepEqual(t41.attempts[0].verdict.failures, ['verifier returned pass=false with no failures listed']);
  assert.equal(t41.attempts[1].verdict.pass, true, 'the -rerun verdict supersedes the first pass');
  assert.ok(!JSON.stringify(record).includes('ghp_xxxxxxxxxxxxxxxx'), 'the token value is redacted');

  const t42 = record.tickets.find((t) => t.ticket === 42);
  assert.equal(t42.outcome, 'not-attempted');
  assert.equal(record.counts.isolationCheckpoints, 1);
  assert.deepEqual(record.agentFailures.map((f) => f.status), ['failed']);
  assert.match(renderDigest(record), /### #41 - first\n- outcome: \*\*delivered\*\* \(PR #77, merged\)/);
});

test('--latest records this checkout\'s newest run and writes state/fleet-runs/<runId>.json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-run-record-'));
  try {
    const home = path.join(tmp, 'home');
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    const put = (project, runId, mtime) => {
      const dir = path.join(home, '.claude', 'projects', project, 'sess', 'subagents', 'workflows', runId);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'journal.jsonl');
      fs.writeFileSync(file, journalText());
      fs.utimesSync(file, mtime, mtime);
    };
    put(`${projectKey(repo)}--claude-worktrees-wt`, 'wf_mine', new Date('2026-09-01'));
    put('C--some-other-repo', 'wf_other', new Date('2026-09-02'));

    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.CLAUDE_CONFIG_DIR;
    const run = spawnSync(process.execPath, [CLI, '--latest'], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const out = path.join(repo, 'state', 'fleet-runs', 'wf_mine.json');
    assert.equal(run.stdout.trim(), path.join('state', 'fleet-runs', 'wf_mine.json'));
    assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).runId, 'wf_mine');
    assert.ok(!fs.existsSync(path.join(repo, 'state', 'fleet-runs', 'wf_other.json')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('no journal anywhere is exit 2, never a pass', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-run-record-'));
  try {
    const env = { ...process.env, HOME: tmp, USERPROFILE: tmp };
    delete env.CLAUDE_CONFIG_DIR;
    const run = spawnSync(process.execPath, [CLI, '--latest'], { cwd: tmp, env, encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /no wf_\*\/journal\.jsonl found/);
    assert.ok(!fs.existsSync(path.join(tmp, 'state')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
