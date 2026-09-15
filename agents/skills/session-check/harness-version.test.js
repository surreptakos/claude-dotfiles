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

test('the shipped project-harness skill: this repo reads current against it', () => {
  const skillDir = findSkillDir(CHECK_DIR);
  const repoRoot = path.resolve(CHECK_DIR, '..', '..', '..');
  const r = harnessState(repoRoot, skillDir);
  assert.equal(r.state, 'current',
    `expected this repo to read current; got ${JSON.stringify(r)}`);
});
