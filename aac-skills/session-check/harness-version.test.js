'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  findSkillDir,
  readSkillVersion,
  readRepoVersion,
  harnessState,
} = require('./harness-version');
const { findHarnessedRepoRoot } = require('./test-support');

const CHECK_DIR = __dirname;

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-version-test-')); }

function writeSkill(dir, templateN, skillN) {
  const skillDir = path.join(dir, 'project-harness');
  const templates = path.join(skillDir, 'templates');
  fs.mkdirSync(templates, { recursive: true });
  fs.writeFileSync(path.join(templates, 'harness-version.md'),
    `# Harness version\n\n    harness-version: ${templateN}\n\nInstalled/upgraded: YYYY-MM-DD.\n`);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
    `---\nname: project-harness\n---\n\n9. **Harness version marker** — copy the template. **Current version: ${skillN}.**\n`);
  return skillDir;
}

function writeRepo(dir, opts) {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  if (opts && typeof opts.stampVersion === 'number') {
    const stamp = path.join(repo, 'docs', 'agents');
    fs.mkdirSync(stamp, { recursive: true });
    fs.writeFileSync(path.join(stamp, 'harness-version.md'),
      `# Harness version\n\n    harness-version: ${opts.stampVersion}\n\n`);
  }
  if (opts && opts.buildDashboard) {
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'scripts', 'build-dashboard.js'), '// stub');
  }
  return repo;
}

function writeCanonical(dir, version) {
  const file = path.join(dir, 'canonical-harness-version.md');
  fs.writeFileSync(file, `# Harness version\n\n    harness-version: ${version}\n\n`);
  return file;
}

test('readSkillVersion returns the number when template and SKILL.md agree', () => {
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 17, 17);
  assert.deepEqual(readSkillVersion(skillDir), { version: 17 });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('readSkillVersion flags a mismatch between template and SKILL.md — the stamp-drift case', () => {
  const tmp = mkTmp();
  // Ticket cites the v9 row: the template still said 7. Model that here.
  const skillDir = writeSkill(tmp, 7, 9);
  const r = readSkillVersion(skillDir);
  assert.equal(r.error, 'template and SKILL.md disagree');
  assert.equal(r.template, 7);
  assert.equal(r.skill, 9);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('readRepoVersion parses a stamped repo', () => {
  const tmp = mkTmp();
  const repo = writeRepo(tmp, { stampVersion: 12 });
  assert.deepEqual(readRepoVersion(repo), { version: 12 });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('readRepoVersion returns v1Implicit when only build-dashboard.js exists', () => {
  const tmp = mkTmp();
  const repo = writeRepo(tmp, { buildDashboard: true });
  assert.deepEqual(readRepoVersion(repo), { v1Implicit: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('readRepoVersion returns absent when neither signal exists', () => {
  const tmp = mkTmp();
  const repo = writeRepo(tmp, {});
  assert.deepEqual(readRepoVersion(repo), { absent: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('harnessState: current when repo matches skill', () => {
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 17, 17);
  const repo = writeRepo(tmp, { stampVersion: 17 });
  assert.deepEqual(harnessState(repo, skillDir), { state: 'current', current: 17, repo: 17 });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('harnessState: behind when repo is older', () => {
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 17, 17);
  const repo = writeRepo(tmp, { stampVersion: 12 });
  const r = harnessState(repo, skillDir);
  assert.equal(r.state, 'behind');
  assert.equal(r.current, 17);
  assert.equal(r.repo, 12);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('harnessState: not-harnessed when the repo carries neither signal', () => {
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 17, 17);
  const repo = writeRepo(tmp, {});
  assert.deepEqual(harnessState(repo, skillDir), { state: 'not-harnessed', current: 17 });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('harnessState: v1-implicit is folded into behind when the skill is past v1', () => {
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 17, 17);
  const repo = writeRepo(tmp, { buildDashboard: true });
  const r = harnessState(repo, skillDir);
  assert.equal(r.state, 'behind');
  assert.equal(r.repo, 1);
  assert.equal(r.v1Implicit, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('harnessState: a stamp past a STALE skill copy is stale-skill-copy, not ahead (issue 412)', () => {
  // The cloud case: the repo is stamped at 19, the plugin payload this session loaded carries
  // v18, and the published project-harness is already at v23. The marker is innocent.
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 18, 18);
  const repo = writeRepo(tmp, { stampVersion: 19 });
  const env = { HARNESS_CANONICAL_FILE: writeCanonical(tmp, 23) };
  assert.deepEqual(harnessState(repo, skillDir, env),
    { state: 'stale-skill-copy', current: 18, repo: 19, canonical: 23 });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('harnessState: an unreadable canonical copy leaves the ahead reading alone', () => {
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 18, 18);
  const repo = writeRepo(tmp, { stampVersion: 19 });
  const env = { HARNESS_CANONICAL_FILE: path.join(tmp, 'no-such-canonical.md') };
  assert.deepEqual(harnessState(repo, skillDir, env), { state: 'ahead', current: 18, repo: 19 });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('harnessState: a stamp past the canonical number is still ahead — the marker really did move', () => {
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 18, 18);
  const repo = writeRepo(tmp, { stampVersion: 25 });
  const env = { HARNESS_CANONICAL_FILE: writeCanonical(tmp, 23) };
  assert.deepEqual(harnessState(repo, skillDir, env), { state: 'ahead', current: 18, repo: 25 });
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Issue 674: in a cloud container the loaded skill copy is copied from the bootstrap's dotfiles
// clone, so that clone's template always carries the same number and cannot be the canonical one.
// These tests leave HARNESS_CANONICAL_FILE unset and drive the real path: a fetch of master in
// ~/.aac-dotfiles and a read of FETCH_HEAD, with git injected.
function staleCloneHome(dir, cloneVersion) {
  const home = path.join(dir, 'home');
  const clone = path.join(home, '.aac-dotfiles');
  fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
  const tmpl = path.join(clone, 'marketplace', 'aac-skills', 'skills', 'project-harness', 'templates');
  fs.mkdirSync(tmpl, { recursive: true });
  fs.writeFileSync(path.join(tmpl, 'harness-version.md'), `    harness-version: ${cloneVersion}\n`);
  return home;
}

function remoteAt(version, calls) {
  return (cmd, args) => {
    if (calls) calls.push(args.join(' '));
    if (args.includes('show')) return { status: 0, stdout: `# Harness version\n\n    harness-version: ${version}\n` };
    return { status: 0, stdout: '' };
  };
}

// Container on a v31 payload (loaded copy and clone agree), repo stamped v32 from master at v32.
function assertStaleCopyAgainstMaster(r) {
  assert.deepEqual(r, { state: 'stale-skill-copy', current: 31, repo: 32, canonical: 32 });
}

test('harnessState: a stamp above the loaded copy but at master reads stale-skill-copy off the remote (issue 674)', () => {
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 31, 31);
  const repo = writeRepo(tmp, { stampVersion: 32 });
  const calls = [];
  const r = harnessState(repo, skillDir, { HOME: staleCloneHome(tmp, 31) }, remoteAt(32, calls));
  assertStaleCopyAgainstMaster(r);
  assert.ok(calls.some((a) => a.includes('fetch --depth 1 origin master')), calls.join(' | '));
  assert.ok(calls.some((a) => a.includes(
    'show FETCH_HEAD:marketplace/aac-skills/skills/project-harness/templates/harness-version.md')), calls.join(' | '));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('fault: reading the canonical number from the stale clone fails the issue-674 assertion', () => {
  // The pre-fix reading, reproduced: the canonical number taken from the clone's own template.
  // The assertion above must reject it, or it could not have caught the bug.
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 31, 31);
  const repo = writeRepo(tmp, { stampVersion: 32 });
  const home = staleCloneHome(tmp, 31);
  const cloneTemplate = path.join(home, '.aac-dotfiles', 'marketplace', 'aac-skills', 'skills',
    'project-harness', 'templates', 'harness-version.md');
  const r = harnessState(repo, skillDir, { HOME: home, HARNESS_CANONICAL_FILE: cloneTemplate }, remoteAt(32));
  assert.equal(r.state, 'ahead');
  assert.throws(() => assertStaleCopyAgainstMaster(r), assert.AssertionError);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('harnessState: an unreachable remote leaves the ahead reading unchanged, never the clone\'s number', () => {
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 31, 31);
  const repo = writeRepo(tmp, { stampVersion: 32 });
  // The clone claims v40, which would fabricate stale-skill-copy if it were ever a fallback.
  const home = staleCloneHome(tmp, 40);
  const unreachable = () => ({ status: 128, stdout: '' });
  assert.deepEqual(harnessState(repo, skillDir, { HOME: home }, unreachable),
    { state: 'ahead', current: 31, repo: 32 });
  // No clone to fetch in at all (a desktop): the same prior reading, and git never runs.
  let ran = false;
  const never = () => { ran = true; return { status: 0, stdout: '' }; };
  assert.deepEqual(harnessState(repo, skillDir, { HOME: path.join(tmp, 'empty-home') }, never),
    { state: 'ahead', current: 31, repo: 32 });
  assert.equal(ran, false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('harnessState: skill-missing when the skill directory is null', () => {
  const tmp = mkTmp();
  const repo = writeRepo(tmp, { stampVersion: 17 });
  const r = harnessState(repo, null);
  assert.equal(r.state, 'skill-missing');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('harnessState: stamp-mismatch when SKILL.md and the template disagree', () => {
  const tmp = mkTmp();
  const skillDir = writeSkill(tmp, 7, 9);
  const repo = writeRepo(tmp, { stampVersion: 12 });
  const r = harnessState(repo, skillDir);
  assert.equal(r.state, 'stamp-mismatch');
  assert.equal(r.template, 7);
  assert.equal(r.skill, 9);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the shipped project-harness skill: template and SKILL.md agree', () => {
  // Guards against a repeat of the v9 slip.
  const skillDir = findSkillDir(CHECK_DIR);
  assert.ok(skillDir, 'sibling project-harness skill should be findable from this checkout');
  const r = readSkillVersion(skillDir);
  assert.equal(r.error, undefined, `template/SKILL.md disagree: template=${r.template} skill=${r.skill}`);
  assert.equal(typeof r.version, 'number');
});

test('the shipped project-harness skill: the repo this copy lives in reads current against it', () => {
  // Issue 300, same fixture bug check.test.js carried: `path.resolve(CHECK_DIR, '..', '..', '..')`
  // is the repo root only from the aac-skills mirror. From the installed copy at
  // `~/.claude/skills/session-check` — the directory SKILL.md sends you to — it named the home
  // directory, harnessState said not-harnessed, and this test was red for anyone running the
  // skill's own documented command. The fixture now searches for the enclosing harnessed
  // checkout. Where there is one, the drift guard is unchanged: its stamp must equal the skill's
  // number. Installed outside a checkout there is no "this repo" to drift, so the reachable half
  // is asserted instead — a repo stamped at the skill's own number reads current.
  const skillDir = findSkillDir(CHECK_DIR);
  const repoRoot = findHarnessedRepoRoot(CHECK_DIR);
  if (repoRoot) {
    const r = harnessState(repoRoot, skillDir);
    assert.equal(r.state, 'current',
      `expected ${repoRoot} to read current; got ${JSON.stringify(r)}`);
    return;
  }
  const version = readSkillVersion(skillDir).version;
  const tmp = mkTmp();
  const repo = writeRepo(tmp, { stampVersion: version });
  assert.deepEqual(harnessState(repo, skillDir), { state: 'current', current: version, repo: version });
  fs.rmSync(tmp, { recursive: true, force: true });
});
