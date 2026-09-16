'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const CHECKER = path.join(__dirname, 'check.js');

function runChecker(config, extra) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'session-check-test-'));
  fs.mkdirSync(path.join(repo, '.git'));
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.writeFileSync(path.join(repo, '.claude', 'session.json'), JSON.stringify(config));
  // Second arg is either { setup, env } (issue 139 tests) or a bare env map (issue 171 tests).
  const opts = extra && (extra.env || typeof extra.setup === 'function') ? extra : { env: extra };
  if (typeof opts.setup === 'function') opts.setup(repo);

  // A case that means to be a desktop session must say so, not inherit it: when this suite runs
  // inside a cloud container the real CLAUDE_CODE_REMOTE_* vars leak in and the cloud-only
  // branches fire. Blank them first; cloudEnv() puts them back for the cases that want cloud.
  const env = Object.assign({},
    process.env,
    { CLAUDE_CODE_REMOTE_SESSION_ID: '', CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: '' },
    opts.env || {});
  try {
    return execFileSync(process.execPath, [CHECKER], {
      cwd: repo,
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, env || {}),
    });
  } catch (error) {
    return String(error.stdout || '') + String(error.stderr || '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

/**
 * Build a project-harness skill fixture with a chosen version, so the four harness-check
 * states can be exercised without depending on this repo's own shipped skill number.
 */
function makeSkillFixture(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-skill-fixture-'));
  const skill = path.join(dir, 'project-harness');
  const templates = path.join(skill, 'templates');
  fs.mkdirSync(templates, { recursive: true });
  fs.writeFileSync(path.join(templates, 'harness-version.md'),
    `# Harness version\n\n    harness-version: ${version}\n\n`);
  fs.writeFileSync(path.join(skill, 'SKILL.md'),
    `---\nname: project-harness\n---\n\n**Current version: ${version}.**\n`);
  return { root: dir, skill };
}

function writeRepoStamp(repo, version) {
  const dir = path.join(repo, 'docs', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'harness-version.md'),
    `# Harness version\n\n    harness-version: ${version}\n\n`);
}

test('reports a passing configured command', () => {
  const output = runChecker({
    test: `${JSON.stringify(process.execPath)} -e "console.log('pass-marker')"`,
  });
  assert.match(output, /tests pass/);
  assert.doesNotMatch(output, /tests (?:FAIL|TIMEOUT)/);
});

test('reports a nonzero exit as failure with captured diagnostics', () => {
  const output = runChecker({
    test: `${JSON.stringify(process.execPath)} -e "console.error('fail-marker'); process.exit(7)"`,
  });
  assert.match(output, /STOP tests FAIL/);
  assert.match(output, /fail-marker/);
  assert.doesNotMatch(output, /tests TIMEOUT/);
});

test('reports timeout distinctly with command and configured duration', () => {
  const command = `${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 5000)"`;
  const output = runChecker({ test: command, testTimeoutMs: 50 });
  assert.match(output, /STOP tests TIMEOUT after 50 ms/);
  assert.match(output, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(output, /tests FAIL/);
});

// Issue 171: the cloud fallback path — a missing interpreter in half of an `&&` chain must not
// STOP the run when the other half passes. Uses a nonexistent-binary token in place of powershell
// so the test runs the same on every platform. IS_CLOUD is triggered by
// CLAUDE_CODE_REMOTE_SESSION_ID in the env; on a real Windows box powershell IS on PATH so the
// fallback stays inert.
test('cloud fallback: skips a half whose interpreter is missing, runs the surviving half, no STOP', () => {
  const missing = 'not-a-real-binary-issue-171';
  const nodeHalf = `${JSON.stringify(process.execPath)} -e "console.log('pass-marker')"`;
  const output = runChecker(
    { test: `${missing} --do-something && ${nodeHalf}` },
    { CLAUDE_CODE_REMOTE_SESSION_ID: '1' },
  );
  assert.match(output, /tests pass/);
  assert.doesNotMatch(output, /STOP tests FAIL/);
  assert.match(output, new RegExp('covered by CI'));
  assert.match(output, new RegExp(missing));
});

test('cloud fallback: outside a cloud container, a missing interpreter still STOPs (fallback inert)', () => {
  const missing = 'not-a-real-binary-issue-171';
  const nodeHalf = `${JSON.stringify(process.execPath)} -e "console.log('pass-marker')"`;
  const output = runChecker({ test: `${missing} --do-something && ${nodeHalf}` });
  assert.match(output, /STOP tests FAIL/);
});

test('prints captured diagnostics for a failing custom check', () => {
  const output = runChecker({
    checks: [{
      name: 'custom probe',
      run: `${JSON.stringify(process.execPath)} -e "console.error('custom-fail-marker'); process.exit(9)"`,
    }],
  });
  assert.match(output, /custom probe/);
  assert.match(output, /custom-fail-marker/);
});

test('harness state: current when the repo stamp matches the skill', () => {
  const fx = makeSkillFixture(17);
  try {
    const output = runChecker({}, {
      env: { HARNESS_SKILL_DIR: fx.skill },
      setup: (repo) => writeRepoStamp(repo, 17),
    });
    assert.match(output, /Harness/);
    assert.match(output, /ok\s*harness v17, current/);
    assert.doesNotMatch(output, /STOP harness/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('harness state: behind is a STOP that names the upgrade command', () => {
  const fx = makeSkillFixture(17);
  try {
    const output = runChecker({}, {
      env: { HARNESS_SKILL_DIR: fx.skill },
      setup: (repo) => writeRepoStamp(repo, 12),
    });
    assert.match(output, /STOP\s*harness v12 is behind v17/);
    assert.match(output, /\/project-harness/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('harness state: not-harnessed warns but does not STOP', () => {
  const fx = makeSkillFixture(17);
  try {
    const output = runChecker({}, {
      env: { HARNESS_SKILL_DIR: fx.skill },
    });
    assert.match(output, /!!\s*repo is not harnessed/);
    assert.doesNotMatch(output, /STOP\s*harness/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('harness state: skill not installed reports a note, never a pass', () => {
  const output = runChecker({}, {
    env: { HARNESS_SKILL_DIR: '' },
    setup: (repo) => writeRepoStamp(repo, 12),
  });
  assert.match(output, /Harness/);
  assert.match(output, /project-harness skill not available/);
  assert.doesNotMatch(output, /ok\s*harness v/);
  assert.doesNotMatch(output, /STOP\s*harness/);
});

test('harness state: this repo (v17) reads current against the shipped skill', () => {
  // The ticket's third acceptance line: running the check IN THIS REPO says current.
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  let output;
  try {
    output = execFileSync(process.execPath, [CHECKER], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    output = String(error.stdout || '') + String(error.stderr || '');
  }
  assert.match(output, /Harness/);
  assert.match(output, /ok\s*harness v\d+, current/);
});

test('harness state: v1-implicit (no marker, build-dashboard.js present) is behind on a modern skill', () => {
  const fx = makeSkillFixture(17);
  try {
    const output = runChecker({}, {
      env: { HARNESS_SKILL_DIR: fx.skill },
      setup: (repo) => {
        fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'scripts', 'build-dashboard.js'), '// stub');
      },
    });
    assert.match(output, /STOP\s*harness v1 \(no docs\/agents\/harness-version\.md; pre-marker\) is behind v17/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('harness state: .claude/session.json "harness": false silences the section', () => {
  const output = runChecker({ harness: false }, {
    env: { HARNESS_SKILL_DIR: '' },
  });
  assert.doesNotMatch(output, /\bHarness\b/);
});

/* --------- cloud bootstrap (issue 163): STOP with a named reason when the hook did not land */

function cloudEnv(extra) {
  return { CLAUDE_CODE_REMOTE_SESSION_ID: '1', HARNESS_SKILL_DIR: '', ...(extra || {}) };
}

test('cloud bootstrap: STOP names the marker path when the file is absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-missing-'));
  const marker = path.join(dir, 'state.json');
  try {
    const output = runChecker({}, { env: cloudEnv({
      BOOTSTRAP_MARKER_FILE: marker,
      BOOTSTRAP_SKILLS_DIR: dir,
    }) });
    assert.match(output, /Cloud bootstrap/);
    assert.match(output, /STOP aac-bootstrap marker absent/);
    assert.match(output, /state\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cloud bootstrap: STOP names every skill missing from the tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-skillgap-'));
  const marker = path.join(dir, 'state.json');
  const skills = path.join(dir, 'skills');
  fs.mkdirSync(skills);
  fs.mkdirSync(path.join(skills, 'ticket-fleet'));
  fs.writeFileSync(path.join(skills, 'ticket-fleet', 'SKILL.md'), '---\nname: ticket-fleet\n---\n');
  fs.writeFileSync(marker, JSON.stringify({
    payload_version: '2026.9.15',
    skills: ['ticket-fleet', 'ask-matt', 'caveman'],
    gh_path: '/usr/local/bin/gh',
  }));
  try {
    const output = runChecker({}, { env: cloudEnv({
      BOOTSTRAP_MARKER_FILE: marker,
      BOOTSTRAP_SKILLS_DIR: skills,
    }) });
    assert.match(output, /STOP 2 aac-skills skill\(s\) named in the marker are absent/);
    assert.match(output, /- ask-matt/);
    assert.match(output, /- caveman/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cloud bootstrap: ok line reports the payload version and reports drift vs master', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-ok-'));
  const marker = path.join(dir, 'state.json');
  const skills = path.join(dir, 'skills');
  const manifest = path.join(dir, 'plugin.json');
  fs.mkdirSync(skills);
  fs.mkdirSync(path.join(skills, 'ticket-fleet'));
  fs.writeFileSync(path.join(skills, 'ticket-fleet', 'SKILL.md'), '---\nname: ticket-fleet\n---\n');
  fs.writeFileSync(marker, JSON.stringify({
    payload_version: '2026.9.15',
    skills: ['ticket-fleet'],
    gh_path: '/usr/local/bin/gh',
  }));
  fs.writeFileSync(manifest, JSON.stringify({ version: '2026.9.16' }));
  try {
    const output = runChecker({}, { env: cloudEnv({
      BOOTSTRAP_MARKER_FILE: marker,
      BOOTSTRAP_SKILLS_DIR: skills,
      BOOTSTRAP_MASTER_MANIFEST: manifest,
    }) });
    assert.match(output, /ok\s+aac-bootstrap payload v2026\.9\.15/);
    assert.match(output, /gh installed/);
    assert.match(output, /master offers v2026\.9\.16/);
    assert.doesNotMatch(output, /STOP/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cloud bootstrap: the whole section is silent on a local (non-cloud) session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-local-'));
  try {
    const output = runChecker({}, { env: {
      HARNESS_SKILL_DIR: '',
      BOOTSTRAP_MARKER_FILE: path.join(dir, 'state.json'),
    } });
    assert.doesNotMatch(output, /Cloud bootstrap/);
    assert.doesNotMatch(output, /aac-bootstrap/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------- ticket pagination ------------
 * `gh api --paginate` follows GitHub's Link header, whose next URL is the numeric-ID form the
 * cloud egress proxy 403s, so a label with more than 100 open tickets used to read as a GitHub
 * outage (issue 394). The loop now asks for `...&page=N` itself; these drive it with a stub.
 */

const { paginateTicketPages } = require('./check.js');

const fullPage = (from) => JSON.stringify(
  Array.from({ length: 100 }, (unused, i) => ({ number: from + i, title: `t${from + i}` })));

test('a two-page label listing returns every row from both pages', () => {
  const asked = [];
  const result = paginateTicketPages((page) => {
    asked.push(page);
    return page === 1 ? fullPage(1) : JSON.stringify([{ number: 101, title: 'last' }]);
  });
  assert.deepEqual(asked, [1, 2]);
  assert.equal(result.error, undefined);
  assert.equal(result.list.length, 101);
  assert.equal(result.list[0], '#1  t1');
  assert.equal(result.list[100], '#101  last');
});

test('a failing second page reports the page rather than a bare unreachable GitHub', () => {
  const result = paginateTicketPages((page) => (page === 1 ? fullPage(1) : null));
  assert.equal(result.list, undefined);
  assert.match(result.error, /page 2/);
});
