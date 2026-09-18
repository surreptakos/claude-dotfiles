#!/usr/bin/env node
/**
 * node --test tools/board-sweep.test.js
 *
 * Tests for tools/board-sweep.js and the workflow that calls it (issue 216).
 *
 * The point of this file is that the board sweep's behaviour on a runner is *demonstrated*
 * rather than asserted in YAML comments. The last test stands up a throwaway board behind a
 * stub `gh` on PATH — one card for a closed issue sitting in "In Progress", one already-Done
 * card, one card for an open issue — runs the real `sweep-closed-to-done.js` the workflow runs,
 * and checks that exactly the first card is written to the Done option and the other two are
 * left alone. That is the "closing an issue moves its card to Done" claim, executed.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { boardSweep, resolveScript, MISSING_TOKEN } = require('./board-sweep.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'board-sweep.yml');
const quiet = () => {};

function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `board-sweep-${tag}-`));
}

// ---- the token refusal ---------------------------------------------------------------------

test('no PROJECT_TOKEN: refuses loudly, exits 1, spawns nothing', () => {
  for (const value of [undefined, '', '   ']) {
    const calls = [];
    const r = boardSweep({
      env: value === undefined ? {} : { PROJECT_TOKEN: value },
      argv: ['--apply'],
      log: quiet,
      spawn: (...a) => { calls.push(a); return { status: 0, stdout: '', stderr: '' }; },
    });
    assert.equal(r.code, 1, `PROJECT_TOKEN=${JSON.stringify(value)} should fail`);
    assert.equal(r.spawned, false);
    assert.deepEqual(calls, [], 'the sweep must not run without a token');
    assert.match(r.output, /^::error::/);
    assert.match(r.output, /PROJECT_TOKEN/);
  }
  // The message has to name the fix, not just the fault: an Actions log is read by whoever the
  // red check paged, who may never have seen issue 215.
  assert.match(MISSING_TOKEN, /Actions secret PROJECT_TOKEN/);
});

// ---- what the child is handed --------------------------------------------------------------

test('with a token: child gets GH_TOKEN and no GITHUB_TOKEN, and --apply is forwarded', () => {
  let seen = null;
  const r = boardSweep({
    env: { PROJECT_TOKEN: 'tok-215', GITHUB_TOKEN: 'repo-scoped-job-token' },
    argv: ['--apply'],
    log: quiet,
    spawn: (cmd, args, o) => { seen = { cmd, args, o }; return { status: 0, stdout: 'ok\n', stderr: '' }; },
  });
  assert.equal(r.code, 0);
  assert.equal(seen.cmd, process.execPath);
  assert.equal(seen.args[0], resolveScript());
  assert.deepEqual(seen.args.slice(1), ['--apply']);
  assert.equal(seen.o.env.GH_TOKEN, 'tok-215');
  // gh prefers GH_TOKEN, but leaving the repo-scoped token in the environment is one `gh`
  // precedence change away from a green run that silently reaches no owner-level board.
  assert.equal('GITHUB_TOKEN' in seen.o.env, false);
  assert.match(r.output, /ok/);
});

test('dry run: --apply is only forwarded when asked for', () => {
  let seen = null;
  boardSweep({
    env: { PROJECT_TOKEN: 'tok-215' },
    argv: [],
    log: quiet,
    spawn: (cmd, args) => { seen = args; return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.deepEqual(seen.slice(1), []);
});

// ---- failure propagation and the run log -----------------------------------------------------

test('a failed board write propagates the exit code and annotates the run', () => {
  const r = boardSweep({
    env: { PROJECT_TOKEN: 'tok-215' },
    argv: ['--apply'],
    log: quiet,
    spawn: () => ({ status: 1, stdout: '  #900 FAIL\n', stderr: '' }),
  });
  assert.equal(r.code, 1);
  assert.match(r.output, /#900 FAIL/);
  assert.match(r.output, /::error::board sweep exited 1/);
});

test('the sweep log is mirrored to $GITHUB_STEP_SUMMARY', () => {
  const dir = tmpdir('summary');
  const summary = path.join(dir, 'summary.md');
  fs.writeFileSync(summary, '');
  boardSweep({
    env: { PROJECT_TOKEN: 'tok-215', GITHUB_STEP_SUMMARY: summary },
    argv: ['--apply'],
    log: quiet,
    spawn: () => ({ status: 0, stdout: 'board: 1 stale\ntotal moved 1, fails 0\n', stderr: '' }),
  });
  const written = fs.readFileSync(summary, 'utf8');
  assert.match(written, /### Board sweep/);
  assert.match(written, /total moved 1, fails 0/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- the sweep itself, against a stub board --------------------------------------------------

const BOARD = {
  repoView: JSON.stringify({
    projectsV2: { nodes: [{ title: 'AAC', closed: false, resourcePath: '/users/surreptakos/projects/3' }] },
  }),
  fields: JSON.stringify({
    data: {
      user: {
        projectV2: {
          id: 'PVT_board',
          fields: {
            nodes: [{
              __typename: 'ProjectV2SingleSelectField',
              id: 'FLD_status',
              name: 'Status',
              options: [{ id: 'OPT_todo', name: 'Todo' }, { id: 'OPT_prog', name: 'In Progress' }, { id: 'OPT_done', name: 'Done' }],
            }],
          },
        },
      },
    },
  }),
  // The board's items, as the ProjectsV2 `items` connection returns them (issue 569): two pages,
  // so the sweep is seen to follow endCursor rather than stop at the first hundred.
  itemsPage1: JSON.stringify({
    data: { user: { projectV2: { items: {
      pageInfo: { hasNextPage: true, endCursor: 'CUR_page2' },
      nodes: [
        // the throwaway issue: closed, card still In Progress -> must move
        { id: 'ITEM_closed_issue', fieldValueByName: { name: 'In Progress' }, content: { title: 'throwaway', url: 'https://github.com/surreptakos/claude-dotfiles/issues/900' } },
        // closed PR whose card is already Done -> must be left alone (no pointless write)
        { id: 'ITEM_done_pr', fieldValueByName: { name: 'Done' }, content: { title: 'merged pr', url: 'https://github.com/surreptakos/claude-dotfiles/pull/901' } },
      ],
    } } } },
  }),
  itemsPage2: JSON.stringify({
    data: { user: { projectV2: { items: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        // still open -> must be left alone
        { id: 'ITEM_open_issue', fieldValueByName: { name: 'Todo' }, content: { title: 'open work', url: 'https://github.com/surreptakos/claude-dotfiles/issues/902' } },
        // a draft item with no Status and no content -> skipped, never a crash
        { id: 'ITEM_draft', fieldValueByName: null, content: null },
        // closed issue on the second page, card still Todo -> must move too (pagination proof)
        { id: 'ITEM_closed_issue_p2', fieldValueByName: { name: 'Todo' }, content: { title: 'late closer', url: 'https://github.com/surreptakos/claude-dotfiles/issues/903' } },
      ],
    } } } },
  }),
};

function stubGh(dir, callsFile, opts = {}) {
  const bin = path.join(dir, 'gh');
  // The items query is told apart from the field query by its text; the second page by the
  // cursor the first page handed back.
  const itemsQuery = opts.itemsStderr
    ? `printf '%s\\n' '${opts.itemsStderr}' >&2; exit 1`
    : `case "$*" in *"after=CUR_page2"*) cat <<'J'\n${BOARD.itemsPage2}\nJ\n;; *) cat <<'J'\n${BOARD.itemsPage1}\nJ\n;; esac`;
  fs.writeFileSync(bin, `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "${callsFile}"
case "$1 \${2:-}" in
  "repo view")         cat <<'J'
${BOARD.repoView}
J
  ;;
  "issue list")        echo '[{"number":900},{"number":903}]' ;;
  "pr list")           echo '[{"number":901}]' ;;
  "api graphql")       case "$*" in
    *"items(first:100"*) ${itemsQuery}
    ;;
    *) cat <<'J'
${BOARD.fields}
J
    ;;
  esac
  ;;
  "project item-edit") exit 0 ;;
  *) echo "stub gh: unexpected call: $*" >&2; exit 9 ;;
esac
`, { mode: 0o755 });
  return bin;
}

// The stub gh is a POSIX shell script found through a colon-joined PATH, so on Windows the real
// gh runs instead and fails on the fake token. CI is Linux and runs it for real; a desktop
// pre-commit skips it with the reason on the line.
test('a closed issue whose card is not Done is moved to Done; nothing else is touched',
  { skip: process.platform === 'win32' && 'POSIX shell stub gh; runs on Linux CI' }, () => {
  const dir = tmpdir('e2e');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/surreptakos/claude-dotfiles'], { cwd: repo });
  const callsFile = path.join(dir, 'gh-calls.txt');
  fs.writeFileSync(callsFile, '');
  stubGh(dir, callsFile);

  const r = boardSweep({
    env: { PROJECT_TOKEN: 'tok-215', PATH: `${dir}:${process.env.PATH}`, HOME: dir },
    argv: ['--apply'],
    cwd: repo,
    log: quiet,
  });

  assert.equal(r.code, 0, `sweep failed:\n${r.output}`);
  const calls = fs.readFileSync(callsFile, 'utf8').split('\n');
  // No item-list anywhere: that is the call PROJECT_TOKEN cannot make (issue 569). The items
  // came over two GraphQL pages, the second asked for with the first page's cursor.
  assert.equal(calls.some(l => l.startsWith('project item-list')), false, `gh project item-list was called:\n${calls.join('\n')}`);
  const itemPages = calls.filter(l => l.startsWith('api graphql') && l.includes('items(first:100'));
  assert.equal(itemPages.length, 2, `expected two item pages, got:\n${itemPages.join('\n')}`);
  assert.equal(itemPages[0].includes('after='), false, 'the first page carries no cursor');
  assert.match(itemPages[1], /after=CUR_page2/);
  const edits = calls.filter(l => l.startsWith('project item-edit'));
  assert.equal(edits.length, 2, `expected exactly two board writes, got:\n${edits.join('\n')}`);
  assert.match(edits[0], /--project-id PVT_board/);
  assert.match(edits[0], /--id ITEM_closed_issue /);
  assert.match(edits[0], /--field-id FLD_status/);
  assert.match(edits[0], /--single-select-option-id OPT_done/);
  assert.match(edits[1], /--id ITEM_closed_issue_p2 /);
  assert.equal(/ITEM_done_pr|ITEM_open_issue|ITEM_draft/.test(edits.join('\n')), false);
  assert.match(r.output, /#900\s+In Progress/);
  assert.match(r.output, /#903\s+Todo/);
  assert.match(r.output, /total moved 2, fails 0/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- an unsweepable linked board is a failure, not a green skip (issue 409) -------------------

// The Board sweep job read `success` for weeks while moving nothing: the only `gh` call that
// failed was the per-board item listing, and the sweep logged it as a one-line "skip" with gh's
// stderr — the rate limit that actually caused it — discarded, then exited 0.
test('a linked board whose items query fails: exits non-zero and prints gh\'s full stderr',
  { skip: process.platform === 'win32' && 'POSIX shell stub gh; runs on Linux CI' }, () => {
  const dir = tmpdir('unswept');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/surreptakos/claude-dotfiles'], { cwd: repo });
  const callsFile = path.join(dir, 'gh-calls.txt');
  fs.writeFileSync(callsFile, '');
  stubGh(dir, callsFile, { itemsStderr: 'GraphQL: API rate limit already exceeded for user ID 12160797.' });

  const r = boardSweep({
    env: { PROJECT_TOKEN: 'tok-215', PATH: `${dir}:${process.env.PATH}`, HOME: dir },
    argv: ['--apply'],
    cwd: repo,
    log: quiet,
  });

  assert.notEqual(r.code, 0, `an unswept linked board must fail the run:\n${r.output}`);
  assert.match(r.output, /FAIL surreptakos\/#3 "AAC": items query failed/);
  assert.match(r.output, /API rate limit already exceeded for user ID 12160797/);
  assert.match(r.output, /could not be swept/);
  assert.equal(/^skip /m.test(r.output), false, 'a linked board must never read as a skip');
  assert.match(r.output, /::error::board sweep exited 1/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- the workflow is wired to the runner -----------------------------------------------------

test('board-sweep.yml fires on close, ticks daily, and passes secrets.PROJECT_TOKEN', () => {
  const yml = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(yml, /^ {2}issues:\n {4}types: \[closed\]$/m);
  // pull_request_target, not pull_request: a fork PR's `pull_request` run gets no secrets, so
  // every fork PR close would trip the token refusal and go red.
  assert.match(yml, /^ {2}pull_request_target:\n {4}types: \[closed\]$/m);
  assert.equal(/^on:[\s\S]*?^ {2}pull_request:/m.test(yml), false);
  assert.match(yml, /^ {2}schedule:\n {4}- cron: /m);
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /PROJECT_TOKEN: \$\{\{ secrets\.PROJECT_TOKEN \}\}/);
  assert.match(yml, /node tools\/board-sweep\.js --apply/);
  assert.match(yml, /node --test tools\/board-sweep\.test\.js/);
  // A cron that committed was what made dashboard.yml's cron unsafe (issue 21); this job must
  // stay read-only towards the repo.
  assert.match(yml, /^permissions:\n {2}contents: read\n/m);
  assert.equal(/git (commit|push)/.test(yml), false);
});
