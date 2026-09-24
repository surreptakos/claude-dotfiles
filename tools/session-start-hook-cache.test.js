#!/usr/bin/env node
/**
 * node --test tools/session-start-hook-cache.test.js
 *
 * Issue 241: the cloud SessionStart bootstrap hook keeps a shallow clone of dotfiles
 * master under ~/.aac-dotfiles. Its previous shape was
 *
 *   git fetch --depth 1 origin master || true
 *   git reset --hard origin/master     || true
 *
 * Both `|| true` masked failure. A force-push (or an aborted fetch) leaves the local
 * default branch with NO merge-base against origin/<ref>; the marker's compareToMaster
 * then reads plugin.json out of a stale checkout.
 *
 * The genuinely different fix here is repair-at-source: the hook now post-verifies
 * `git rev-parse HEAD == git rev-parse origin/<ref>` after every fetch+reset and, on
 * any failure or mismatch, rm -rf's the clone with a NAMED reason on stderr and
 * re-clones from origin. That is the "reset to origin" branch of the ticket's
 * acceptance criterion.
 *
 * These tests build REAL local bare remotes so the hook's `git clone` actually runs;
 * BOOTSTRAP_DOTFILES_REPO/_REF point it at the fixture instead of GitHub. The clone
 * would blow away and re-clone the fixture — that IS the assertion.
 */
'use strict';
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(REPO_ROOT, '.claude', 'hooks', 'session-start.sh');

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x',
    },
  }).trim();
}

/**
 * Build a bare remote that carries the marketplace/aac-skills/skills tree the
 * bootstrap hook expects to find, plus a plugin.json. The seed workdir stays around
 * so tests can force-push a rewritten history onto it.
 */
// Local-path remotes trigger git's hardlink optimisation, which bypasses the shallow
// protocol; the resulting clone has no .git/shallow file. Use file:// so the fetch
// codepath and shallow boundaries match what the hook sees against a real GitHub URL.
function toUrl(dir) { return 'file://' + dir; }

function seedRemote(root, branch = 'master') {
  const remote = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  fs.mkdirSync(remote);
  fs.mkdirSync(seed);
  git(remote, 'init', '--bare', '-b', branch);
  git(seed, 'init', '-b', branch);
  const payload = path.join(seed, 'marketplace', 'aac-skills');
  fs.mkdirSync(path.join(payload, 'skills', 'ticket-fleet'), { recursive: true });
  fs.mkdirSync(path.join(payload, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(payload, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'skills', 'ticket-fleet', 'SKILL.md'),
    '---\nname: ticket-fleet\ndescription: fixture\n---\n');
  fs.writeFileSync(path.join(payload, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {} }));
  fs.writeFileSync(path.join(payload, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'aac-skills', version: '2026.9.15-test' }));
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'seed origin');
  // A shallow --depth 1 clone only sets .git/shallow when there is history to hide.
  // Add two more commits so downstream clones actually exercise the shallow-boundary
  // case (otherwise the deepen shim is never exercised).
  for (const n of [2, 3]) {
    fs.writeFileSync(path.join(payload, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'aac-skills', version: `2026.9.15-test.${n}` }));
    git(seed, 'commit', '-am', `seed-${n}`);
  }
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', 'origin', branch);
  return { remote, seed };
}

function runHook({ home, remote, ref = 'master', extraEnv = {} } = {}) {
  const envFile = path.join(home, 'env-file');
  fs.writeFileSync(envFile, '');
  return spawnSync('bash', [HOOK], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      // Without it the Windows Python install manager behind python3 roots itself in the cwd and
      // downloads a whole Python into ./Python, printing "Downloading" into the hook output.
      ...(process.env.LOCALAPPDATA && { LOCALAPPDATA: process.env.LOCALAPPDATA }),
      HOME: home,
      CLAUDE_CODE_REMOTE: 'true',
      BOOTSTRAP_HOME: home,
      BOOTSTRAP_DOTFILES_REPO: toUrl(remote),
      BOOTSTRAP_DOTFILES_REF: ref,
      BOOTSTRAP_SKIP_GH: '1',
      CLAUDE_ENV_FILE: envFile,
      ...extraEnv,
    },
  });
}

// -------------------------------------------------------------------------------
// Acceptance criterion 1: fake clone with unrelated local default branch — bootstrap
// names the condition and rebuilds against origin.
// -------------------------------------------------------------------------------
test('bootstrap self-repair: cached clone with a local master that has no merge-base with origin is named and re-cloned (issue 241)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-bootstrap-unrelated-'));
  try {
    const { remote, seed } = seedRemote(home);
    const cache = path.join(home, '.aac-dotfiles');
    // Bring the cache into existence the same way a healthy prior run would.
    execFileSync('git', ['clone', '--depth', '1', '-b', 'master', toUrl(remote), cache],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    const originalOriginTip = git(cache, 'rev-parse', 'origin/master');

    // Force-push an unrelated orphan-rooted branch onto origin/master. The cached
    // clone still holds the pre-force-push tip; after a `--depth 1` fetch, the
    // local master and the new origin/master have NO merge-base. This is the
    // condition the ticket wants named.
    git(seed, 'checkout', '--orphan', 'orphan');
    for (const f of fs.readdirSync(seed)) {
      if (f === '.git') continue;
      fs.rmSync(path.join(seed, f), { recursive: true, force: true });
    }
    const payload = path.join(seed, 'marketplace', 'aac-skills');
    fs.mkdirSync(path.join(payload, 'skills', 'ticket-fleet'), { recursive: true });
    fs.mkdirSync(path.join(payload, 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(payload, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(payload, 'skills', 'ticket-fleet', 'SKILL.md'),
      '---\nname: ticket-fleet\ndescription: rewritten fixture\n---\n');
    fs.writeFileSync(path.join(payload, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {} }));
    fs.writeFileSync(path.join(payload, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'aac-skills', version: '2026.9.15-rewritten' }));
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'orphan-root');
    git(seed, 'branch', '-D', 'master');
    git(seed, 'branch', '-m', 'master');
    git(seed, 'push', '-f', 'origin', 'master');

    const newOriginTip = git(seed, 'rev-parse', 'HEAD');
    assert.notEqual(newOriginTip, originalOriginTip,
      'test setup: origin/master should now be the orphan-rooted commit');

    const { status, stderr, stdout } = runHook({ home, remote });

    assert.equal(status, 0,
      `hook exited ${status}\nstderr:\n${stderr}\nstdout:\n${stdout}`);

    // Acceptance criterion 1a: the condition is reported by name on stderr.
    assert.match(stderr, /aac-bootstrap: rebuilding cached clone/,
      `stderr should announce the rebuild:\n${stderr}`);
    assert.match(stderr, /no merge-base with origin/,
      `stderr should name the merge-base condition:\n${stderr}`);
    assert.match(stderr, /issue 241/,
      `stderr should back-reference issue 241 so the coupling to the ticket is visible:\n${stderr}`);

    // Acceptance criterion 1b: the cache is reset — post-hook HEAD matches the new
    // origin tip, i.e. the stale checkout is gone.
    const postHead = git(cache, 'rev-parse', 'HEAD');
    assert.equal(postHead, newOriginTip,
      `cached clone HEAD should match the rewritten origin/master after self-repair; got ${postHead} vs ${newOriginTip}`);

    // And the marker records the rebuilt payload's plugin.json, not the stale one.
    const marker = JSON.parse(fs.readFileSync(
      path.join(home, '.claude', 'hook-state', 'aac-bootstrap', 'state.json'), 'utf8'));
    assert.equal(marker.payload_version, '2026.9.15-rewritten',
      `marker should carry the rebuilt payload version; got ${marker.payload_version}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------
// Acceptance criterion 2: clone where local/origin agree — bootstrap is silent about
// the cache and does not rebuild it.
// -------------------------------------------------------------------------------
test('bootstrap self-repair: cached clone where local == origin is silent about the cache and does not re-clone (issue 241)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-bootstrap-same-'));
  try {
    const { remote } = seedRemote(home);
    const cache = path.join(home, '.aac-dotfiles');
    execFileSync('git', ['clone', '--depth', '1', '-b', 'master', toUrl(remote), cache],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    // Take a stable inode/mtime witness so we can detect a rebuild without relying
    // on stderr silence alone.
    const beforeStat = fs.statSync(path.join(cache, '.git'));

    const { status, stderr, stdout } = runHook({ home, remote });

    assert.equal(status, 0,
      `hook exited ${status}\nstderr:\n${stderr}\nstdout:\n${stdout}`);
    // The whole point of the silent case: no rebuild announcement.
    assert.doesNotMatch(stderr, /aac-bootstrap: rebuilding cached clone/,
      `stderr should not announce a rebuild when local == origin:\n${stderr}`);
    assert.doesNotMatch(stderr, /no merge-base with origin/,
      `stderr should not name the merge-base condition when local == origin:\n${stderr}`);

    // The .git dir was not blown away and re-created.
    const afterStat = fs.statSync(path.join(cache, '.git'));
    assert.equal(afterStat.ino, beforeStat.ino,
      'the cached clone .git should not have been rebuilt on the silent path');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------
// Regression guard: linear fast-forward on a shallow clone must NOT be misclassified
// as unrelated. Attempt 1's naive merge-base check false-positived on every real
// session; the deepen shim in the hook prevents that. Freeze the invariant so a
// future edit dropping the deepen fires here first.
// -------------------------------------------------------------------------------
test('bootstrap self-repair: shallow clone, origin advanced (linear fast-forward) resets silently — no false rebuild (issue 241)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-bootstrap-ff-'));
  try {
    const { remote, seed } = seedRemote(home);
    const cache = path.join(home, '.aac-dotfiles');
    execFileSync('git', ['clone', '--depth', '1', '-b', 'master', toUrl(remote), cache],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    assert.ok(fs.existsSync(path.join(cache, '.git', 'shallow')),
      'the fixture must be shallow to exercise the deepen shim');
    const beforeStat = fs.statSync(path.join(cache, '.git'));
    // Advance origin by one commit. On a shallow clone, merge-base(local, origin) is
    // empty until we deepen — that ambiguity is exactly what the hook resolves.
    fs.writeFileSync(path.join(seed, 'ff.txt'), 'forward');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'ff');
    git(seed, 'push', 'origin', 'master');
    const newTip = git(seed, 'rev-parse', 'HEAD');

    const { status, stderr, stdout } = runHook({ home, remote });

    assert.equal(status, 0,
      `hook exited ${status}\nstderr:\n${stderr}\nstdout:\n${stdout}`);
    assert.doesNotMatch(stderr, /aac-bootstrap: rebuilding cached clone/,
      `stderr must not announce a rebuild for linear fast-forward:\n${stderr}`);
    assert.doesNotMatch(stderr, /no merge-base with origin/,
      `stderr must not name the merge-base condition for linear fast-forward:\n${stderr}`);
    const afterStat = fs.statSync(path.join(cache, '.git'));
    assert.equal(afterStat.ino, beforeStat.ino,
      'the cached clone .git must not be rebuilt on a fast-forward');
    // And the reset actually moved HEAD to the new tip.
    assert.equal(git(cache, 'rev-parse', 'HEAD'), newTip,
      'HEAD must advance to the new origin tip after the hook runs');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
