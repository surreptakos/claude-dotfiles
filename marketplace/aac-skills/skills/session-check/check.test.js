'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { findSkillDir, readSkillVersion } = require('./harness-version');
const { localEnv } = require('./test-support');

const CHECKER = path.join(__dirname, 'check.js');

function runChecker(config, extra) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'session-check-test-'));
  fs.mkdirSync(path.join(repo, '.git'));
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.writeFileSync(path.join(repo, '.claude', 'session.json'), JSON.stringify(config));
  // Second arg is either { setup, env, args } (issue 139 tests) or a bare env map (issue 171 tests).
  const opts = extra && (extra.env || extra.args || typeof extra.setup === 'function')
    ? extra : { env: extra };
  if (typeof opts.setup === 'function') opts.setup(repo);

  // localEnv, not process.env: the cloud markers are set for every process inside a cloud agent
  // container, and the tests below that assert the LOCAL branch have to see them unset.
  const env = localEnv(opts.env);
  try {
    return execFileSync(process.execPath, [CHECKER, ...(opts.args || [])], {
      cwd: repo,
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
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

/** A canonical harness-version marker — what the PUBLISHED project-harness offers today. */
function makeCanonicalFixture(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-canonical-fixture-'));
  const file = path.join(dir, 'harness-version.md');
  fs.writeFileSync(file, `# Harness version\n\n    harness-version: ${version}\n\n`);
  return { root: dir, file };
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

/* ------------------------------------------------------- release gate timeout (issue 818) ----- */

test('release gate: default timeout is 300000 ms when gateTimeoutMs is not configured', () => {
  const output = runChecker({
    releaseGates: [`${JSON.stringify(process.execPath)} -e "console.log('no-verdict-marker')"`],
  }, { args: ['--end'] });
  assert.match(output, /release gate passes/);
  assert.doesNotMatch(output, /STOP release gate TIMEOUT/);
});

test('release gate: an invalid gateTimeoutMs falls back to the 300000 ms default and says so', () => {
  const output = runChecker({
    gateTimeoutMs: 'soon',
    releaseGates: [`${JSON.stringify(process.execPath)} -e "console.log('no-verdict-marker')"`],
  }, { args: ['--end'] });
  assert.match(output, /gateTimeoutMs must be a positive integer — using 300000 ms/);
});

test('release gate: a configured gateTimeoutMs finishes inside it and reports a pass', () => {
  const output = runChecker({
    gateTimeoutMs: 900000,
    releaseGates: [`${JSON.stringify(process.execPath)} -e "console.log('PASS release gate ok')"`],
  }, { args: ['--end'] });
  assert.match(output, /release gate passes/);
  assert.doesNotMatch(output, /STOP release gate TIMEOUT/);
});

test('release gate: a gate that prints nothing and never exits still STOPs with TIMEOUT', () => {
  const output = runChecker({
    gateTimeoutMs: 50,
    releaseGates: [`${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 5000)"`],
  }, { args: ['--end'] });
  assert.match(output, /STOP release gate TIMEOUT after 50 ms/);
});

test('release gate: a gate that prints a PASS verdict then hangs warns, quoting the PASS line, not a STOP', () => {
  const output = runChecker({
    gateTimeoutMs: 50,
    releaseGates: [`${JSON.stringify(process.execPath)}`
      + ` -e "console.log('PASS release gate ok'); setTimeout(() => {}, 5000)"`],
  }, { args: ['--end'] });
  assert.match(output, /!!\s*release gate TIMEOUT after 50 ms/);
  assert.match(output, /"PASS release gate ok"/);
  assert.doesNotMatch(output, /STOP release gate/);
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

test('harness state: the shipped skill, found as a sibling, reads a repo stamped at its version as current', () => {
  // Issue 300, and the choice this test makes: the FIXTURE moved, not the assertion. It used to
  // run the checker in `path.resolve(__dirname, '..', '..', '..')` — the repo root from the
  // aac-skills mirror, the home directory from the installed copy at
  // `~/.claude/skills/session-check`, where the check correctly reported "not harnessed" and this
  // test was red. What it was actually worth testing is the one thing the fixture-driven tests
  // above skip: discovery of the REAL shipped skill (no HARNESS_SKILL_DIR override) and its own
  // two version spellings, end to end through check.js. So the repo is a scratch one stamped at
  // whatever the sibling skill says today, which reads the same from either location. The
  // separate question — does THIS repo's stamp still match the skill? — is a drift guard that
  // needs no subprocess, and lives in harness-version.test.js.
  const skillDir = findSkillDir(__dirname);
  assert.ok(skillDir, 'sibling project-harness skill should be findable from this copy of the skill');
  const shipped = readSkillVersion(skillDir);
  assert.equal(shipped.error, undefined,
    `shipped skill version unreadable: ${shipped.error} (template=${shipped.template} skill=${shipped.skill})`);
  const output = runChecker({}, {
    setup: (repo) => writeRepoStamp(repo, shipped.version),
  });
  assert.match(output, /Harness/);
  assert.match(output, new RegExp(`ok\\s*harness v${shipped.version}, current`));
  assert.doesNotMatch(output, /STOP\s*harness/);
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

test('harness state: --end in a cloud session on a stale payload blames the payload, not the marker', () => {
  // Issue 412. Repo stamped v19, the project-harness copy this container loaded is v18, and the
  // published one is v23: the old reading accused someone of editing the marker.
  const fx = makeSkillFixture(18);
  const canonical = makeCanonicalFixture(23);
  try {
    const output = runChecker({}, {
      args: ['--end'],
      env: {
        CLAUDE_CODE_REMOTE_SESSION_ID: '1',
        HARNESS_SKILL_DIR: fx.skill,
        HARNESS_CANONICAL_FILE: canonical.file,
      },
      setup: (repo) => writeRepoStamp(repo, 19),
    });
    assert.match(output, /harness stamp says v19 but the project-harness copy here is v18, behind the published v23/);
    assert.match(output, /the plugin payload is stale, not the marker/);
    assert.match(output, /update-cloud-plugin/);
    assert.doesNotMatch(output, /someone edited the marker/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
    fs.rmSync(canonical.root, { recursive: true, force: true });
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

test('cloud bootstrap: STOP names the failed stage and its cause when the hook could not clone (issue 483)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-failed-'));
  const marker = path.join(dir, 'state.json');
  fs.writeFileSync(marker, JSON.stringify({
    failed: true,
    stage: 'clone',
    reason: "git clone --depth 1 --branch master https://github.com/surreptakos/claude-dotfiles.git: fatal: could not read Username for 'https://github.com': No such device or address",
    skills: [],
    failed_at: '2026-09-17T18:00:00Z',
  }));
  try {
    const output = runChecker({}, { env: cloudEnv({
      BOOTSTRAP_MARKER_FILE: marker,
      BOOTSTRAP_SKILLS_DIR: dir,
    }) });
    assert.match(output, /STOP aac-bootstrap clone failed — .*could not read Username/);
    assert.match(output, /ANTHROPIC_BASE_URL/);
    assert.match(output, /push_files/);
    assert.doesNotMatch(output, /marker absent/);
    assert.doesNotMatch(output, /ok\s+aac-bootstrap payload/);
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
    // Issue 703: drift is a `!!` warning naming both versions, not a dim note.
    assert.match(output, /!!\s+payload v2026\.9\.15 served; origin\/master offers v2026\.9\.16/);
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

const { curlTicketRows, paginateTicketPages } = require('./check.js');

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

// The no-gh fallback fetched one page and stopped, so a >100-ticket label printed as exactly
// 100 with no error (issue 400). It runs the same loop now; the stub stands in for curl.
test('the no-gh curl path pages too, so a two-page label arrives whole', () => {
  const urls = [];
  const result = curlTicketRows({ owner: 'o', repo: 'r' }, 'ready-for-agent', (cmd, args) => {
    assert.equal(cmd, 'curl');
    const url = args[args.length - 1];
    urls.push(url);
    return { out: /&page=1$/.test(url) ? fullPage(1) : JSON.stringify([{ number: 101, title: 'last' }]), code: 0 };
  });
  assert.equal(urls.length, 2);
  assert.match(urls[0], /per_page=100&page=1$/);
  assert.match(urls[1], /per_page=100&page=2$/);
  assert.equal(result.error, undefined);
  assert.equal(result.list.length, 101);
  assert.equal(result.list[0], '#1  t1');
  assert.equal(result.list[100], '#101  last');
});

/* --------- host predicate (issue 345): a desktop-only check must not run in a container ------- */

// `run` prints a marker and exits non-zero, so a check that DID run is unmistakable in the output.
const DESKTOP_ONLY = {
  name: 'board sweep',
  host: 'desktop',
  run: `${JSON.stringify(process.execPath)} -e "console.error('host-check-ran'); process.exit(2)"`,
};

test('host: desktop is skipped in a cloud container, on one line, without running', () => {
  const output = runChecker({ checks: [DESKTOP_ONLY] }, { env: cloudEnv() });
  assert.equal((output.match(/skipped \(desktop-only\)/g) || []).length, 1);
  assert.match(output, /board sweep — skipped \(desktop-only\)/);
  assert.doesNotMatch(output, /host-check-ran/);
});

test('host: desktop runs as usual on the desktop', () => {
  // Blank, not absent: the suite itself may run inside a cloud container, whose ambient
  // CLAUDE_CODE_REMOTE_* would otherwise make this the same case as the test above.
  const output = runChecker({ checks: [DESKTOP_ONLY] }, { env: {
    HARNESS_SKILL_DIR: '',
    CLAUDE_CODE_REMOTE_SESSION_ID: '',
    CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: '',
  } });
  assert.match(output, /host-check-ran/);
  assert.match(output, /board sweep — exit 2/);
  assert.doesNotMatch(output, /skipped \(desktop-only\)/);
});

/* ------------------------------------------------------ tracker audit job (issue 473) ---------
 * The audit runs as `.github/workflows/tracker-audit.yml` now; this engine reads that job's
 * latest run for the default branch's head instead of spawning `tools/tracker-audit.js` (which
 * needs gh, absent in every container — so the report there read "the tracker audit could not
 * run" twice per session, forever). Four states, four tests, driven through the pure reporter.
 */

const { trackerAuditReport } = require('./check.js');

const AUDIT_HEAD = 'abc1234def5678901234567890abcdef12345678';
const auditRun = (over) => Object.assign({
  head_sha: AUDIT_HEAD, status: 'completed', conclusion: 'success',
  html_url: 'https://github.com/surreptakos/claude-dotfiles/actions/runs/4242',
}, over);

test('tracker audit: a green run for this head reads as clean, with the run url', () => {
  const r = trackerAuditReport([auditRun()], AUDIT_HEAD, null);
  assert.equal(r.state, 'clean');
  assert.equal(r.level, 'ok');
  assert.equal(r.text, 'tracker audit clean');
  assert.match(r.notes.join('\n'), /actions\/runs\/4242/);
});

test('tracker audit: a red run for this head reads as drift, naming the run', () => {
  const r = trackerAuditReport([auditRun({ conclusion: 'failure' })], AUDIT_HEAD, null);
  assert.equal(r.state, 'drift');
  assert.equal(r.level, 'warn');
  assert.equal(r.text,
    'tracker audit: drift — https://github.com/surreptakos/claude-dotfiles/actions/runs/4242');
});

test('tracker audit: no run for this head is not a pass, and a pending or cancelled one is no verdict', () => {
  const older = auditRun({ head_sha: 'f'.repeat(40) });
  assert.equal(trackerAuditReport([older], AUDIT_HEAD, null).state, 'no-run');
  assert.match(trackerAuditReport([older], AUDIT_HEAD, null).text, /no run for this head/);
  // Still running, and cancelled by the next event's run: neither carries a verdict to read.
  const pending = trackerAuditReport([auditRun({ status: 'in_progress', conclusion: null })], AUDIT_HEAD, null);
  assert.equal(pending.state, 'no-run');
  assert.match(pending.notes.join('\n'), /in_progress/);
  assert.equal(trackerAuditReport([auditRun({ conclusion: 'cancelled' })], AUDIT_HEAD, null).state, 'no-run');
  // The newest run that DOES carry a verdict wins over a cancelled one in front of it.
  const after = trackerAuditReport(
    [auditRun({ conclusion: 'cancelled' }), auditRun({ conclusion: 'failure' })], AUDIT_HEAD, null);
  assert.equal(after.state, 'drift');
});

test('tracker audit: an unreadable job says so rather than passing', () => {
  for (const [runs, head, error] of [
    [null, AUDIT_HEAD, 'GitHub did not answer for the tracker audit job'],
    [[auditRun()], null, null],
    ['not-an-array', AUDIT_HEAD, null],
  ]) {
    const r = trackerAuditReport(runs, head, error);
    assert.equal(r.state, 'unreadable');
    assert.equal(r.level, 'warn');
    assert.match(r.text, /could not read the tracker audit job — that is not a pass/);
    assert.ok(r.notes[0], 'an unreadable job has to say what stopped it');
  }
});

// Issue 473's third criterion, executed: in a container the engine must not spawn the audit, and
// the old "could not run" line must be gone. The stub audit writes a marker if it is ever run.
test('tracker audit: a cloud session reads the job and never spawns the audit', () => {
  const marker = path.join(os.tmpdir(), `tracker-audit-spawned-${process.pid}`);
  fs.rmSync(marker, { force: true });
  const output = runChecker({ test: `${JSON.stringify(process.execPath)} -e "0"` }, {
    env: { CLAUDE_CODE_REMOTE_SESSION_ID: '1' },
    setup: (repo) => {
      fs.mkdirSync(path.join(repo, 'tools'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'tools', 'tracker-audit.js'),
        `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
      fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.github', 'workflows', 'tracker-audit.yml'), 'name: Tracker audit\n');
    },
  });
  try {
    assert.equal(fs.existsSync(marker), false, 'the engine must not spawn the audit any more');
    assert.doesNotMatch(output, /the tracker audit could not run/);
    assert.match(output, /tracker audit/);
  } finally {
    fs.rmSync(marker, { force: true });
  }
});

/**
 * A real git repo with a pushed upstream, for the end-of-session test skip: the fake `.git`
 * directory `runChecker` builds makes every git call fail, which reads as "no upstream" and
 * never reaches the skip. `mutate(work)` runs after the push, before check.js.
 */
function runCheckerPushed(config, mutate, args, env) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-check-git-'));
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(root, 'init', '--quiet', '--bare', remote);
    git(root, 'clone', '--quiet', remote, work);
    fs.mkdirSync(path.join(work, '.claude'));
    fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(work, '.claude', 'session.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), 'on: push\n');
    git(work, 'add', '.');
    git(work, 'commit', '--quiet', '-m', 'init');
    git(work, 'push', '--quiet', '-u', 'origin', 'HEAD');
    // A mutate that returns a path runs the checker there instead — for the worktree case, where
    // the point is that the checkout git config belongs to is NOT the directory being checked.
    const from = (mutate && mutate(work, git)) || work;
    return execFileSync(process.execPath, [CHECKER, ...(args || ['--end'])], {
      cwd: from, encoding: 'utf8', env: localEnv(env), stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (!error.stdout && !error.stderr) throw error;
    return String(error.stdout || '') + String(error.stderr || '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const MARKER_TEST = { test: `${JSON.stringify(process.execPath)} -e "console.log('ran-marker')"` };

test('--end on a committed, pushed head with CI skips the suite and says who owns the verdict', () => {
  const output = runCheckerPushed(MARKER_TEST);
  assert.match(output, /nothing unpushed/);
  assert.match(output, /-- +tests — .*not re-run: HEAD is committed and pushed/);
  assert.doesNotMatch(output, /tests pass/);
});

test('--end with an uncommitted file still runs the suite', () => {
  const output = runCheckerPushed(MARKER_TEST, (work) => {
    fs.writeFileSync(path.join(work, 'scratch.txt'), 'x');
  });
  assert.match(output, /1 uncommitted file/);
  assert.match(output, /tests pass/);
  assert.doesNotMatch(output, /not re-run/);
});

test('--end with an unpushed commit still runs the suite', () => {
  const output = runCheckerPushed(MARKER_TEST, (work, git) => {
    fs.writeFileSync(path.join(work, 'more.txt'), 'x');
    git(work, 'add', '.');
    git(work, 'commit', '--quiet', '-m', 'local only');
  });
  assert.match(output, /1 commit\(s\) not pushed/);
  assert.match(output, /tests pass/);
  assert.doesNotMatch(output, /not re-run/);
});

test('start on the same pushed head runs the suite — the skip is end-only', () => {
  const output = runCheckerPushed(MARKER_TEST, null, []);
  assert.match(output, /tests pass/);
  assert.doesNotMatch(output, /not re-run/);
});

/** Writes a `.githooks/pre-commit` into the pushed work tree and commits+pushes it, so the head
 *  stays clean and the repo has a gate the skip could be leaning on. */
function withGithooks(extra) {
  return (work, git) => {
    fs.mkdirSync(path.join(work, '.githooks'), { recursive: true });
    fs.writeFileSync(path.join(work, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
    git(work, 'add', '.');
    git(work, 'commit', '--quiet', '-m', 'hooks');
    git(work, 'push', '--quiet');
    if (extra) extra(work, git);
  };
}

// Issue 459's follow-on: the skip's premise is that the pre-commit hook ran, and in the
// aac-routines session of 2026-09-18 it had not — `core.hooksPath` was empty because the
// bootstrap hook never ran, so the commit passed through no gate at all while this line
// printed a benign `--`.
test('--end on a pushed head whose core.hooksPath is unset runs the suite and names the gap', () => {
  const output = runCheckerPushed(MARKER_TEST, withGithooks());
  assert.match(output, /tests pass/);
  assert.doesNotMatch(output, /not re-run/);
  assert.match(output, /`core\.hooksPath` is unset/);
  assert.match(output, /commit gate on this head is untrusted/);
});

test('--end on a pushed head whose core.hooksPath points elsewhere runs the suite', () => {
  const output = runCheckerPushed(MARKER_TEST, withGithooks((work, git) => {
    git(work, 'config', 'core.hooksPath', '.git/hooks');
  }));
  assert.match(output, /tests pass/);
  assert.doesNotMatch(output, /not re-run/);
  assert.match(output, /not this repo's `\.githooks`/);
});

test("--end still skips when core.hooksPath does point at the repo's .githooks", () => {
  const output = runCheckerPushed(MARKER_TEST, withGithooks((work, git) => {
    git(work, 'config', 'core.hooksPath', '.githooks');
  }));
  assert.match(output, /-- +tests — .*not re-run: HEAD is committed and pushed/);
  assert.doesNotMatch(output, /tests pass/);
  assert.doesNotMatch(output, /commit gate on this head is untrusted/);
});

// A worktree shares its checkout's config, and the hook installer writes an absolute path, so
// core.hooksPath there names the MAIN checkout's .githooks. That is the same repo's gate: read
// naively it made every worktree session look ungated, which is where this was caught.
test('--end in a worktree trusts the main checkout .githooks its config names', () => {
  const output = runCheckerPushed(MARKER_TEST, (work, git) => {
    fs.mkdirSync(path.join(work, '.githooks'), { recursive: true });
    fs.writeFileSync(path.join(work, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
    git(work, 'add', '.');
    git(work, 'commit', '--quiet', '-m', 'hooks');
    git(work, 'push', '--quiet');
    git(work, 'config', 'core.hooksPath', path.join(work, '.githooks'));
    const tree = path.join(path.dirname(work), 'wt');
    git(work, 'worktree', 'add', '--quiet', '-b', 'side', tree);
    git(tree, 'push', '--quiet', '-u', 'origin', 'side');
    return tree;
  });
  assert.match(output, /-- +tests — .*not re-run: HEAD is committed and pushed/);
  assert.doesNotMatch(output, /commit gate on this head is untrusted/);
});

// Same head, same git state, in a container the bootstrap hook never reached: the suite's
// dependencies are not installed there either, so "committed and pushed" proves nothing.
test('--end in a cloud container with no bootstrap marker runs the suite instead of skipping', () => {
  const output = runCheckerPushed(MARKER_TEST, null, ['--end'], {
    CLAUDE_CODE_REMOTE_SESSION_ID: '1',
    BOOTSTRAP_MARKER_FILE: path.join(os.tmpdir(), `no-such-marker-${process.pid}.json`),
  });
  assert.match(output, /tests pass/);
  assert.doesNotMatch(output, /not re-run/);
  assert.match(output, /aac-bootstrap marker is missing/);
});
