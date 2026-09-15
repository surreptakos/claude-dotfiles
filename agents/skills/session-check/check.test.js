'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const CHECKER = path.join(__dirname, 'check.js');

function runChecker(config, env) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'session-check-test-'));
  fs.mkdirSync(path.join(repo, '.git'));
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.writeFileSync(path.join(repo, '.claude', 'session.json'), JSON.stringify(config));

  try {
    return execFileSync(process.execPath, [CHECKER], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, env || {}),
    });
  } catch (error) {
    return String(error.stdout || '') + String(error.stderr || '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
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
