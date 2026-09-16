#!/usr/bin/env node
/**
 * node --test tools/board-sweep-proof.test.js
 *
 * Tests for tools/board-sweep-proof.js, the live acceptance proof the Board sweep job runs
 * (issue 216). The proof itself talks to a real board on a runner; these tests drive it against
 * a fake `gh` so every verdict it can reach — passed, the board did not move, the close raised no
 * run, no token, aborted mid-way — is executed here rather than discovered on a runner at 3am.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { boardSweepProof, WORKFLOW_FILE } = require('./board-sweep-proof.js');

const WORKFLOW = path.join(path.resolve(__dirname, '..'), '.github', 'workflows', WORKFLOW_FILE);
const quiet = () => {};
const ISSUE_URL = 'https://github.com/surreptakos/claude-dotfiles/issues/9001';

/** A `gh` that behaves like the real one against a one-card board.
 *  `statusAfterClose` is what the card reads back as once the run has been seen;
 *  `runs` is what the workflow-runs endpoint returns after the close. */
function fakeGh({ statusAfterClose = 'Done', runs = null } = {}) {
  const calls = [];
  let closed = false;
  const ok = (stdout) => ({ status: 0, stdout, stderr: '' });
  const defaultRuns = [{
    id: 4242, status: 'completed', conclusion: 'success', event: 'issues',
    created_at: '2026-09-16T12:00:30Z',
    html_url: 'https://github.com/surreptakos/claude-dotfiles/actions/runs/4242',
  }];
  const run = (args) => {
    calls.push(args.join(' '));
    const key = `${args[0]} ${args[1] || ''}`;
    switch (key) {
      case 'repo view':
        return ok(JSON.stringify({ projectsV2: { nodes: [{ title: 'AAC', closed: false, resourcePath: '/users/surreptakos/projects/3' }] } }));
      case 'api graphql':
        return ok(JSON.stringify({ data: { user: { projectV2: { id: 'PVT_board', fields: { nodes: [{
          __typename: 'ProjectV2SingleSelectField', id: 'FLD_status', name: 'Status',
          options: [{ id: 'OPT_todo', name: 'Todo' }, { id: 'OPT_done', name: 'Done' }],
        }] } } } } }));
      case 'issue create': return ok(`${ISSUE_URL}\n`);
      case 'project item-add': return ok(JSON.stringify({ id: 'PVTI_throwaway' }));
      case 'project item-edit': return ok('');
      case 'issue close': closed = true; return ok('');
      case 'project item-list':
        return ok(JSON.stringify({ items: [{ id: 'PVTI_throwaway', status: closed ? statusAfterClose : 'Todo', content: { url: ISSUE_URL } }] }));
      case 'project item-delete': return ok('');
      case 'run view': return ok('sweep\t2026-09-16T12:01:00Z surreptakos/#3 "AAC": 1 stale\nsweep\t  #9001 Todo throwaway\nsweep\ttotal moved 1, fails 0\n');
      default:
        if (args[0] === 'api' && String(args[1]).includes('/actions/workflows/')) {
          return ok(JSON.stringify({ workflow_runs: runs === null ? defaultRuns : runs }));
        }
        return { status: 9, stdout: '', stderr: `fake gh: unexpected call: ${args.join(' ')}` };
    }
  };
  return { run, calls };
}

/** A clock that advances a minute per read, so the poll loop reaches its deadline in finite
 *  time without any real waiting. */
function fakeClock(startIso = '2026-09-16T12:00:00Z') {
  let t = Date.parse(startIso);
  return () => { const v = t; t += 60 * 1000; return v; };
}

const ENV = { PROJECT_TOKEN: 'tok-215', GITHUB_REPOSITORY: 'surreptakos/claude-dotfiles', GITHUB_RUN_ID: '777' };

test('the card reaches Done through a real run: exit 0, run URL and log quoted, card cleaned up', () => {
  const gh = fakeGh();
  const r = boardSweepProof({ env: ENV, run: gh.run, now: fakeClock(), sleep: () => {}, log: quiet });

  assert.equal(r.code, 0, r.output);
  // The acceptance sentence, executed: a throwaway issue was opened, closed, and its card read Done.
  assert.match(r.output, /opened throwaway issue #9001/);
  assert.match(r.output, /closed #9001 at 2026-09-16T/);
  assert.match(r.output, /card PVTI_throwaway Status after the run: "Done"/);
  assert.match(r.output, /PROOF PASSED: closing #9001 moved its card to "Done" within run 4242/);
  // "run log quoted" is the other half of the criterion.
  assert.match(r.output, /actions\/runs\/4242/);
  assert.match(r.output, /total moved 1, fails 0/);
  // The card is parked off Done before the close, or the proof would pass on a card that was
  // already Done and prove nothing.
  assert.ok(gh.calls.some((c) => c === 'project item-edit --project-id PVT_board --id PVTI_throwaway --field-id FLD_status --single-select-option-id OPT_todo'),
    `parked-card write missing from:\n${gh.calls.join('\n')}`);
  assert.ok(gh.calls.some((c) => c.startsWith('project item-delete')), 'the throwaway card must be swept off the board');
});

test('a run that leaves the card parked fails the proof, naming what did not move', () => {
  const gh = fakeGh({ statusAfterClose: 'Todo' });
  const r = boardSweepProof({ env: ENV, run: gh.run, now: fakeClock(), sleep: () => {}, log: quiet });

  assert.equal(r.code, 1);
  assert.match(r.output, /::error::#9001 closed, run .*4242 finished success, but its card is still "Todo"/);
  assert.equal(/PROOF PASSED/.test(r.output), false);
  assert.ok(gh.calls.some((c) => c.startsWith('project item-delete')), 'cleanup runs on failure too');
});

test('a close that raises no run fails the proof, naming the default-branch rule', () => {
  const gh = fakeGh({ runs: [] });
  const r = boardSweepProof({ env: ENV, run: gh.run, now: fakeClock(), sleep: () => {}, log: quiet });

  assert.equal(r.code, 1);
  assert.match(r.output, /no Board sweep run appeared within 10 minutes of closing #9001/);
  assert.match(r.output, /default branch only/);
});

test('no PROJECT_TOKEN: refuses before opening anything', () => {
  const gh = fakeGh();
  const r = boardSweepProof({ env: { GITHUB_REPOSITORY: 'surreptakos/claude-dotfiles' }, run: gh.run, now: fakeClock(), sleep: () => {}, log: quiet });

  assert.equal(r.code, 1);
  assert.match(r.output, /PROJECT_TOKEN is not set/);
  assert.deepEqual(gh.calls, [], 'a token-less proof must not open a throwaway issue');
});

test('an abort before the close leaves no open throwaway issue behind', () => {
  const gh = fakeGh();
  const inner = gh.run;
  // The board rejects the card — the proof is over, but the issue it just opened is not.
  const run = (args) => (args[0] === 'project' && args[1] === 'item-add'
    ? { status: 1, stdout: '', stderr: 'could not add item: board is archived' }
    : inner(args));
  const r = boardSweepProof({ env: ENV, run, now: fakeClock(), sleep: () => {}, log: quiet });

  assert.equal(r.code, 1);
  assert.match(r.output, /proof aborted: gh project item-add: could not add item/);
  assert.match(r.output, /cleaned up: throwaway issue #9001 closed/);
  // An open, unlabelled, un-milestoned issue is two tracker-audit findings the proof caused.
  assert.ok(gh.calls.some((c) => c.startsWith('issue close 9001')), `no close in:\n${gh.calls.join('\n')}`);
});

test('board-sweep.yml runs the proof only on an explicit dispatch, and not alongside the sweep', () => {
  const yml = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(yml, /^ {6}proof:\n {8}type: boolean/m);
  assert.match(yml, /node tools\/board-sweep-proof\.js/);
  // Both jobs in one run would deadlock: the proof waits for the run the close triggers, and that
  // run queues behind this one on the shared concurrency group.
  assert.match(yml, /^ {4}if: github\.event_name == 'workflow_dispatch' && inputs\.proof$/m);
  assert.match(yml, /^ {4}if: github\.event_name != 'workflow_dispatch' \|\| !inputs\.proof$/m);
});
