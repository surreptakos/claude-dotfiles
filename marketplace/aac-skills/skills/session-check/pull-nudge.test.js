'use strict';

/**
 * node --test pull-nudge.test.js
 *
 * Two halves: the pure logic in pull-nudge.js (whitelist parsing, matching, the three states),
 * and check.js's wiring of it — one real repo with a pushed "origin", so `defaultBranchHead()`
 * has a real `origin/HEAD` to read, exercising the three cases the ticket names (issue 735):
 * a whitelisted change nudges, a plugin-carried-only change stays quiet, and no stamp yet says so.
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseWhitelist, matchesWhitelist, evaluate, readStamp, writeStamp } = require('./pull-nudge');
const { localEnv } = require('./test-support');

const CHECKER = path.join(__dirname, 'check.js');

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

/* ------------------------------------------------------------------- pure logic --------------- */

const FIXTURE_MANIFEST = `
function Get-DotfileItems {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$UserHome
    )
    @(
        [pscustomobject]@{ Type = 'File'; Repo = 'profile/claude/settings.json'; Local = 'x' }
        [pscustomobject]@{ Type = 'Dir';  Repo = 'profile/claude/agents';        Local = 'y' }
    )
}

function Get-DocumentsPath {
    # Repo = 'not-a-whitelist-entry' — outside Get-DotfileItems, must not be picked up
}
`;

test('parseWhitelist reads Repo paths out of Get-DotfileItems only', () => {
  const { paths } = parseWhitelist(FIXTURE_MANIFEST);
  assert.deepEqual(paths, ['profile/claude/settings.json', 'profile/claude/agents']);
});

test('parseWhitelist reports absence rather than an empty list', () => {
  assert.match(parseWhitelist('no such function here').error, /no function Get-DotfileItems/);
});

test('matchesWhitelist: a File entry matches exactly, a Dir entry matches under it', () => {
  const list = ['profile/claude/settings.json', 'profile/claude/agents'];
  assert.equal(matchesWhitelist('profile/claude/settings.json', list), true);
  assert.equal(matchesWhitelist('profile/claude/agents/new-agent.md', list), true);
  assert.equal(matchesWhitelist('profile/claude/agentsomething.md', list), false);
  assert.equal(matchesWhitelist('aac-skills/some-skill/SKILL.md', list), false);
});

test('evaluate: no stamp, a whitelisted hit, and a miss are three distinct states', () => {
  const list = ['profile/claude/settings.json'];
  assert.equal(evaluate(null, ['profile/claude/settings.json'], list).state, 'no-stamp');
  assert.deepEqual(evaluate('abc123', ['profile/claude/settings.json', 'aac-skills/x/SKILL.md'], list),
    { state: 'needs-pull', files: ['profile/claude/settings.json'] });
  assert.deepEqual(evaluate('abc123', ['aac-skills/x/SKILL.md'], list), { state: 'clean' });
  assert.deepEqual(evaluate('abc123', [], list), { state: 'clean' });
});

test('writeStamp then readStamp round-trips the sha; a missing file reads as no stamp', () => {
  const dir = mkTmp('pull-nudge-stamp-');
  const file = path.join(dir, 'nested', 'state.json');
  try {
    assert.equal(readStamp(file), null);
    writeStamp('deadbeef', file);
    const read = readStamp(file);
    assert.equal(read.sha, 'deadbeef');
    assert.ok(read.pulledAt);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------- check.js wiring ----------- */

/**
 * A real repo with a pushed "origin" so `defaultBranchHead()` has a real `origin/HEAD` to read
 * (check.js fetches before this check runs). `lib/manifest.ps1` and `sync.ps1` are the two files
 * that gate the check on; the manifest whitelists `profile/claude/settings.json` only, so a commit
 * touching `aac-skills/` (plugin-carried) is the "no line" case.
 */
function pullNudgeRepo() {
  const root = mkTmp('pull-nudge-repo-');
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(root, 'init', '--quiet', '--bare', remote);
  git(root, 'clone', '--quiet', remote, work);
  fs.mkdirSync(path.join(work, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(work, 'profile', 'claude'), { recursive: true });
  fs.writeFileSync(path.join(work, 'lib', 'manifest.ps1'), FIXTURE_MANIFEST);
  fs.writeFileSync(path.join(work, 'sync.ps1'), '# placeholder\n');
  fs.writeFileSync(path.join(work, 'profile', 'claude', 'settings.json'), '{}\n');
  git(work, 'add', '.');
  git(work, 'commit', '--quiet', '-m', 'init');
  git(work, 'push', '--quiet', '-u', 'origin', 'HEAD');
  const stampSha = git(work, 'rev-parse', 'HEAD').trim();
  return { root, work, git, stampSha };
}

function runChecker(work, stateFile) {
  try {
    return execFileSync(process.execPath, [CHECKER], {
      cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: localEnv({ DOTFILES_PULL_STATE: stateFile }),
    });
  } catch (error) {
    return String(error.stdout || '') + String(error.stderr || '');
  }
}

test('a merged change to a whitelisted path produces one line naming the pull command', () => {
  const { root, work, git, stampSha } = pullNudgeRepo();
  const stateFile = path.join(root, 'state.json');
  try {
    writeStamp(stampSha, stateFile);
    fs.writeFileSync(path.join(work, 'profile', 'claude', 'settings.json'), '{"changed":true}\n');
    git(work, 'add', '.');
    git(work, 'commit', '--quiet', '-m', 'change a whitelisted file');
    git(work, 'push', '--quiet');

    const out = runChecker(work, stateFile);
    const hits = out.split('\n').filter((l) => l.includes('sync.ps1 -Mode pull'));
    assert.equal(hits.length, 1, out);
    assert.match(out, /profile\/claude\/settings\.json/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a merged change only to plugin-carried content produces no line', () => {
  const { root, work, git, stampSha } = pullNudgeRepo();
  const stateFile = path.join(root, 'state.json');
  try {
    writeStamp(stampSha, stateFile);
    fs.mkdirSync(path.join(work, 'aac-skills', 'some-skill'), { recursive: true });
    fs.writeFileSync(path.join(work, 'aac-skills', 'some-skill', 'SKILL.md'), '---\nname: some-skill\n---\n');
    git(work, 'add', '.');
    git(work, 'commit', '--quiet', '-m', 'edit a plugin-carried skill');
    git(work, 'push', '--quiet');

    const out = runChecker(work, stateFile);
    assert.doesNotMatch(out, /sync\.ps1 -Mode pull/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no stamp yet reports that, not the whitelist diff, and never names the pull command', () => {
  const { root, work } = pullNudgeRepo();
  const stateFile = path.join(root, 'state.json'); // never written
  try {
    const out = runChecker(work, stateFile);
    assert.match(out, /no pull recorded on this machine yet/);
    assert.doesNotMatch(out, /sync\.ps1 -Mode pull/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
