#!/usr/bin/env node
/**
 * node --test tools/stale-ref-sweep.test.js
 *
 * Tests for tools/stale-ref-sweep.js and the workflow that calls it (issue 474).
 *
 * The centre of this file is one real repository. `throwawayRepo()` builds a bare origin and a
 * clone, then pushes four branches that are the four cases the sweep exists to tell apart:
 *
 *   agent/squashed-solo   one commit, squash-merged to master  -> must be deleted
 *   agent/squashed-multi  two commits, squash-merged as one    -> must be deleted
 *   agent/stranded        one commit that never landed         -> must survive, by name, on the issue
 *   deploy/test           a live gas deploy ref, fully merged  -> must not even be a candidate
 *
 * Running the real sweep over that repo is what proves squash-landed detection: a squash merge
 * rewrites the SHA and the subject, so nothing but patch-id equality can see through it, and the
 * "deleted by the next dispatch" acceptance criterion is exactly this test with a runner around it.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  staleRefSweep, classifyBranch, plan, renderBody, hasFindings, sweepableKind, assertNoForce,
  normalizeSubject, resolveDefaultBranch, DELETABLE, MARKER, ISSUE_TITLE, ISSUE_LABEL, MISSING_TOKEN,
} = require('./stale-ref-sweep.js');
const { sliceBetween, sliceFrom } = require('./source-slice.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'stale-ref-sweep.yml');
const SKILL = path.join(REPO_ROOT, 'agents', 'skills', 'session-end', 'SKILL.md');
const quiet = () => {};

// ---- the fixture repository -------------------------------------------------------------------

/** git in `cwd`, with the hook variables scrubbed so a fixture never reaches the real checkout. */
function git(cwd, args, input) {
  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR',
                   'GIT_OBJECT_DIRECTORY']) delete env[k];
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', input, stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
}

function throwawayRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-ref-sweep-'));
  const origin = path.join(dir, 'origin.git');
  const work = path.join(dir, 'work');
  fs.mkdirSync(origin);
  git(origin, ['init', '-q', '--bare', '-b', 'master']);
  git(dir, ['clone', '-q', origin, work]);
  git(work, ['config', 'user.email', 'sweep@test']);
  git(work, ['config', 'user.name', 'sweep test']);
  const write = (name, body) => fs.writeFileSync(path.join(work, name), body);
  const commit = (m) => { git(work, ['add', '-A']); git(work, ['commit', '-qm', m]); };

  write('README', 'base\n');
  commit('base');
  git(work, ['push', '-q', 'origin', 'master']);

  // one commit, squash-merged: the squash diff is byte-identical, so `git cherry` sees the twin
  git(work, ['checkout', '-qb', 'agent/squashed-solo']);
  write('solo.txt', 'solo\n');
  commit('solo work');
  git(work, ['push', '-q', 'origin', 'agent/squashed-solo']);

  // two commits squashed into one: no single commit matches, only the whole branch diff does
  git(work, ['checkout', '-qb', 'agent/squashed-multi', 'master']);
  write('multi-a.txt', 'a\n');
  commit('multi first half');
  write('multi-b.txt', 'b\n');
  commit('multi second half');
  git(work, ['push', '-q', 'origin', 'agent/squashed-multi']);

  // never landed anywhere
  git(work, ['checkout', '-qb', 'agent/stranded', 'master']);
  write('stranded.txt', 'stranded\n');
  commit('stranded work nobody landed');
  git(work, ['push', '-q', 'origin', 'agent/stranded']);

  // a live deploy channel that IS fully merged — the whitelist, not the merge state, protects it
  git(work, ['checkout', '-qb', 'deploy/test', 'master']);
  git(work, ['push', '-q', 'origin', 'deploy/test']);

  // the squash merges, with the subject rewritten the way `gh pr merge --squash` rewrites it
  git(work, ['checkout', '-q', 'master']);
  git(work, ['merge', '-q', '--squash', 'agent/squashed-solo']);
  git(work, ['commit', '-qm', 'Solo work (#801)']);
  git(work, ['merge', '-q', '--squash', 'agent/squashed-multi']);
  git(work, ['commit', '-qm', 'Multi work, both halves (#802)']);
  git(work, ['push', '-q', 'origin', 'master']);

  // the sweep reads remote-tracking refs, exactly as a fresh runner checkout would
  git(work, ['fetch', '-q', 'origin']);
  return { dir, origin, work, remoteHeads: () => git(work, ['ls-remote', '--heads', 'origin']) };
}

/** A `gh` stand-in: records every call, answers the two reads the sweep makes. */
function fakeGh(state = {}) {
  const calls = [];
  const issues = state.issues || [];
  const prs = state.prs || [];
  const fn = (args, input) => {
    calls.push({ args, input });
    const key = `${args[0]} ${args[1]}`;
    if (key === 'issue list') return JSON.stringify(issues);
    if (key === 'pr list') return JSON.stringify(prs);
    if (key === 'issue create') return 'https://github.com/o/r/issues/999\n';
    return '';
  };
  fn.calls = calls;
  fn.of = (k) => calls.filter(c => `${c.args[0]} ${c.args[1]}` === k);
  return fn;
}

// ---- squash-landed detection, against a real repository ---------------------------------------

test('squash-landed refs are deleted, stranded work survives and is named on the issue', () => {
  const r = throwawayRepo();
  try {
    const gh = fakeGh({ prs: [] });
    const out = staleRefSweep({
      env: { GH_TOKEN: 'tok', STALE_REF_SWEEP_DEFAULT_BRANCH: 'master' },
      argv: ['--apply'],
      cwd: r.work,
      gh,
      log: quiet,
    });
    assert.equal(out.code, 0, `sweep failed:\n${out.output}`);

    // the one-commit squash: git cherry finds the twin
    assert.match(out.output, /squash-landed\s+agent\/squashed-solo/);
    // the two-commit squash: only the whole-branch patch-id can see it, and it names the squash SHA
    assert.match(out.output, /squash-landed\s+agent\/squashed-multi — its whole diff has the same patch-id as [0-9a-f]{12}/);
    assert.match(out.output, /stranded\s+agent\/stranded/);

    const heads = r.remoteHeads();
    assert.equal(/agent\/squashed-solo/.test(heads), false, `solo ref survived:\n${heads}`);
    assert.equal(/agent\/squashed-multi/.test(heads), false, `multi ref survived:\n${heads}`);
    assert.match(heads, /agent\/stranded/, 'a branch with unmerged work must never be deleted');
    assert.match(heads, /deploy\/test/, 'deploy/test is outside the sweepable namespaces');
    assert.match(heads, /refs\/heads\/master/);

    // the findings issue names the survivor by branch
    const created = gh.of('issue create');
    assert.equal(created.length, 1, 'one sweep issue, filed once');
    assert.deepEqual(created[0].args.slice(0, 6),
      ['issue', 'create', '--title', ISSUE_TITLE, '--label', ISSUE_LABEL]);
    assert.match(created[0].input, /`agent\/stranded`/);
    assert.match(created[0].input, /stranded work nobody landed/);
    assert.equal(/agent\/squashed-(solo|multi)/.test(created[0].input), false,
      'a deleted ref is not a finding for a human');
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test('a dry run classifies the same way and deletes nothing', () => {
  const r = throwawayRepo();
  try {
    const gh = fakeGh();
    const out = staleRefSweep({
      env: { STALE_REF_SWEEP_DEFAULT_BRANCH: 'master' },
      argv: [],
      cwd: r.work,
      gh,
      log: quiet,
    });
    assert.equal(out.code, 0, out.output);
    assert.match(out.output, /would delete origin\/agent\/squashed-solo/);
    assert.match(r.remoteHeads(), /agent\/squashed-solo/);
    assert.deepEqual(gh.of('issue create'), []);
    assert.deepEqual(gh.of('issue edit'), []);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

// ---- the never-force-delete rule ---------------------------------------------------------------

test('assertNoForce refuses every force spelling before git runs', () => {
  for (const bad of [
    ['branch', '-D', 'agent/x'],
    ['push', 'origin', '--delete', '--force', 'agent/x'],
    ['push', '-f', 'origin', 'agent/x'],
    ['push', 'origin', '+refs/heads/agent/x:refs/heads/agent/x'],
    ['push', '--force-with-lease', 'origin', 'agent/x'],
  ]) {
    assert.throws(() => assertNoForce(bad), /refuses a force/, `allowed ${bad.join(' ')}`);
  }
  assert.deepEqual(assertNoForce(['push', 'origin', '--delete', 'agent/x']),
    ['push', 'origin', '--delete', 'agent/x']);
});

test('only patch-id-proven verdicts are deletable; stranded and probably-landed never are', () => {
  const branches = [
    { name: 'agent/a', kind: 'fleet attempt', verdict: 'merged', evidence: 'ancestor' },
    { name: 'agent/b', kind: 'fleet attempt', verdict: 'squash-landed', evidence: 'patch-id' },
    { name: 'agent/c', kind: 'fleet attempt', verdict: 'probably-landed', evidence: 'subject only' },
    { name: 'agent/d', kind: 'fleet attempt', verdict: 'stranded', evidence: '1 commit' },
  ];
  const p = plan(branches, []);
  assert.deepEqual(p.deletions.map(b => b.name), ['agent/a', 'agent/b']);
  assert.deepEqual(p.stranded.map(b => b.name), ['agent/d']);
  assert.deepEqual(p.probably.map(b => b.name), ['agent/c']);
  assert.deepEqual([...DELETABLE].sort(), ['merged', 'squash-landed']);
  // A subject match alone is the case that makes an unproven delete tempting; it must stay a report.
  assert.equal(classifyBranch({
    isAncestor: false,
    commits: [{ sha: 'a'.repeat(40), subject: 'fix the thing' }],
    unique: [{ sha: 'a'.repeat(40), subject: 'fix the thing' }],
    equivalents: [],
    squashSha: null,
    subjectMatches: ['b'.repeat(40)],
  }).verdict, 'probably-landed');
});

test('every git command the real sweep issues is force-free', () => {
  const r = throwawayRepo();
  try {
    const seen = [];
    staleRefSweep({
      env: { GH_TOKEN: 'tok', STALE_REF_SWEEP_DEFAULT_BRANCH: 'master' },
      argv: ['--apply'],
      cwd: r.work,
      gh: fakeGh(),
      log: quiet,
      git: (args, input) => {
        seen.push(args);
        assertNoForce(args);
        return git(r.work, args, input);
      },
    });
    const deletes = seen.filter(a => a.includes('--delete'));
    assert.equal(deletes.length, 2, `expected two ref deletes, got ${JSON.stringify(deletes)}`);
    for (const a of deletes) assert.deepEqual(a.slice(0, 3), ['push', 'origin', '--delete']);
    assert.equal(seen.some(a => a.includes('agent/stranded') && a.includes('--delete')), false);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

// ---- the whitelist ----------------------------------------------------------------------------

test('only the generated namespaces are sweepable', () => {
  for (const name of ['agent/issue-474-attempt1-wf_x-w2', 'worktree-wf_abc', 'wf_abc', 'claude/happy-name-ab12cd'])
    assert.ok(sweepableKind(name), `${name} should be a candidate`);
  for (const name of ['master', 'main', 'deploy/run', 'deploy/test', 'deploy/prod', 'gas-canary',
                      'dashboard', 'research/cloud-plugin-determinism'])
    assert.equal(sweepableKind(name), null, `${name} must never be a candidate`);
});

// ---- one issue, updated, and closed when the sweep is empty ------------------------------------

test('findings update the existing sweep issue rather than filing a second one', () => {
  const gh = fakeGh({ issues: [
    { number: 12, title: 'unrelated', body: 'nothing to do with the sweep' },
    { number: 77, title: ISSUE_TITLE, body: `${MARKER}\nlast week's list` },
  ] });
  const r = throwawayRepo();
  try {
    const out = staleRefSweep({
      env: { GH_TOKEN: 'tok', STALE_REF_SWEEP_DEFAULT_BRANCH: 'master' },
      argv: ['--apply'], cwd: r.work, gh, log: quiet,
    });
    assert.equal(out.code, 0, out.output);
    assert.deepEqual(gh.of('issue create'), [], 'a weekly cron must not file a new issue each week');
    const edits = gh.of('issue edit');
    assert.equal(edits.length, 1);
    assert.deepEqual(edits[0].args, ['issue', 'edit', '77', '--body-file', '-']);
    assert.ok(edits[0].input.includes(MARKER), 'the rewritten body keeps the marker the next run finds');
    assert.match(edits[0].input, /`agent\/stranded`/);
    assert.match(out.output, /updated issue #77/);
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true });
  }
});

test('an empty sweep closes the open issue, and files nothing when there is none', () => {
  // No candidate refs at all -> no findings.
  const empty = { branches: [], prs: [] };
  assert.equal(hasFindings(plan(empty.branches, empty.prs)), false);

  const withIssue = fakeGh({ issues: [{ number: 77, title: ISSUE_TITLE, body: MARKER }] });
  const bare = fakeGh({ issues: [] });
  for (const [gh, expectClose] of [[withIssue, true], [bare, false]]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-ref-empty-'));
    const origin = path.join(dir, 'origin.git');
    const work = path.join(dir, 'work');
    fs.mkdirSync(origin);
    git(origin, ['init', '-q', '--bare', '-b', 'master']);
    git(dir, ['clone', '-q', origin, work]);
    git(work, ['config', 'user.email', 'sweep@test']);
    git(work, ['config', 'user.name', 'sweep test']);
    fs.writeFileSync(path.join(work, 'README'), 'base\n');
    git(work, ['add', '-A']);
    git(work, ['commit', '-qm', 'base']);
    git(work, ['push', '-q', 'origin', 'master']);
    try {
      const out = staleRefSweep({
        env: { GH_TOKEN: 'tok', STALE_REF_SWEEP_DEFAULT_BRANCH: 'master' },
        argv: ['--apply'], cwd: work, gh, log: quiet,
      });
      assert.equal(out.code, 0, out.output);
      assert.match(out.output, /findings: none/);
      assert.deepEqual(gh.of('issue create'), []);
      assert.deepEqual(gh.of('issue edit'), []);
      if (expectClose) {
        assert.deepEqual(gh.of('issue close')[0].args, ['issue', 'close', '77', '--reason', 'completed']);
        assert.equal(gh.of('issue comment').length, 1, 'closing says why on the ticket');
      } else {
        assert.deepEqual(gh.of('issue close'), []);
        assert.match(out.output, /no open sweep issue to close/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---- superseded PRs ----------------------------------------------------------------------------

test('an open PR on a landed branch is closed with the evidence; a fork PR is only reported', () => {
  const branches = [
    { name: 'agent/landed', kind: 'fleet attempt', verdict: 'squash-landed', evidence: 'patch-id 0123456789ab' },
    { name: 'agent/stranded', kind: 'fleet attempt', verdict: 'stranded', evidence: '1 commit' },
  ];
  const prs = [
    { number: 10, url: 'u10', headRefName: 'agent/landed', isCrossRepository: false },
    { number: 11, url: 'u11', headRefName: 'agent/stranded', isCrossRepository: false },
    { number: 12, url: 'u12', headRefName: 'agent/landed', isCrossRepository: true },
  ];
  const p = plan(branches, prs);
  assert.deepEqual(p.closures.map(c => c.pr.number), [10]);
  assert.deepEqual(p.undecidedPrs.map(x => x.number), [12]);
  const body = renderBody(p, { when: '2026-09-16T00:00:00Z', defaultBranch: 'master', runUrl: null });
  assert.match(body, /u12/);
  assert.equal(/u10/.test(body), false, 'a PR the sweep closed is not left for a human');
});

// ---- the token refusal -------------------------------------------------------------------------

test('--apply with no token refuses loudly and touches nothing', () => {
  let ranGit = false;
  const r = staleRefSweep({
    env: {}, argv: ['--apply'], log: quiet,
    git: () => { ranGit = true; return ''; },
    gh: () => '',
  });
  assert.equal(r.code, 1);
  assert.equal(ranGit, false);
  assert.match(r.output, /^::error::/);
  assert.match(MISSING_TOKEN, /contents: write/);
});

// ---- small pure pieces the verdicts rest on ----------------------------------------------------

test('a squash-merge subject suffix does not hide the match', () => {
  assert.equal(normalizeSubject('Solo work (#801)'), 'solo work');
  assert.equal(normalizeSubject('solo work'), 'solo work');
});

test('the default branch falls back to the ref that exists, never to a guess', () => {
  assert.equal(resolveDefaultBranch(() => '', { STALE_REF_SWEEP_DEFAULT_BRANCH: 'trunk' }), 'trunk');
  const onlyMaster = (args) => {
    if (args[0] === 'symbolic-ref') throw new Error('not a symbolic ref');
    if (args[0] === 'rev-parse' && args[3] === 'refs/remotes/origin/master') return 'sha\n';
    throw new Error('no such ref');
  };
  assert.equal(resolveDefaultBranch(onlyMaster, {}), 'master');
  assert.throws(() => resolveDefaultBranch(() => { throw new Error('nope'); }, {}),
    /no default branch/);
});

// ---- the workflow and the skill are wired to this script ---------------------------------------

test('stale-ref-sweep.yml ticks weekly, applies on dispatch, and runs the tests first', () => {
  const yml = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(yml, /^ {2}schedule:\n {4}- cron: '[^']+'$/m);
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /node --test tools\/stale-ref-sweep\.test\.js/);
  assert.match(yml, /node tools\/stale-ref-sweep\.js \$\{\{ inputs\.dry_run/);
  assert.match(yml, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  // Deleting a ref, closing a PR and rewriting the issue each need their own scope.
  assert.match(yml, /^permissions:\n {2}contents: write\n {2}issues: write\n {2}pull-requests: write\n/m);
  // fetch-depth 0: a shallow clone has no history to compute patch-ids over, so every
  // squash-merged branch would read as stranded and the sweep would delete nothing, forever.
  assert.match(yml, /fetch-depth: 0/);
  // This job must never advance the repo (issue 21's state3 lockup came from a cron that did).
  assert.equal(/git commit/.test(yml), false);
});

test('session-end step 11 is scoped to the session, and hands the repo-wide sweep to the job', () => {
  const skill = fs.readFileSync(SKILL, 'utf8');
  const step11 = sliceBetween(skill, '\n11. ', '\n12. ', "session-end's step 11");
  assert.match(step11, /this session's own branch and worktree/);
  assert.match(step11, /stale-ref-sweep\.yml/);
  assert.match(step11, /do not delete them/, 'other sessions\' refs are the job\'s, not the step\'s');
  // The two repo-wide instructions the step used to carry are gone, not merely reworded.
  assert.equal(/xargs -r git branch -d/.test(step11), false,
    'the repo-wide merged-branch pipeline belongs to the workflow now');
  assert.equal(/List foreign worktrees/.test(step11), false,
    'sweeping other sessions\' worktrees belongs to the workflow now');
  // And the cloud section must name the job rather than a skipped step. Issue 212 narrowed the
  // substitution table to GraphQL-backed spellings only, and a git ref delete is not one, so the
  // fact lives in the quirks list beneath the table instead of in a row of it.
  const cloud = sliceFrom(skill, '## In a cloud container', "session-end's cloud section");
  assert.match(cloud, /stale-ref-sweep\.yml/,
    'the cloud section names the job that owns the repo-wide sweep');
  assert.equal(/^\|.*stale-ref-sweep\.yml/m.test(cloud), false,
    'but not as a substitution row — a container runs step 11 the same way the desktop does');
  assert.equal(/^\|.*git branch --merged/m.test(cloud), false,
    'a git ref delete is not GraphQL-backed, so it does not belong in the substitution table');
});
