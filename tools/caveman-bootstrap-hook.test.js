#!/usr/bin/env node
/**
 * node --test tools/caveman-bootstrap-hook.test.js
 *
 * The cloud-container caveman bootstrap (.claude/hooks/caveman-bootstrap.sh) and its
 * UserPromptSubmit half (.claude/hooks/caveman-prompt.sh), run against a fixture caveman
 * checkout and a fake HOME, offline (CAVEMAN_BOOTSTRAP_SKIP_CLI=1). What is pinned:
 *
 *   - a local session (no CLAUDE_CODE_REMOTE) exits 0 and prints nothing from either hook;
 *   - every skill dir carrying a SKILL.md lands in ~/.claude/skills/<name>/, and the plugin's
 *     `caveman` copy replaces the one the aac-skills payload put there first;
 *   - the additionalContext is one JSON line under the 2 KB cap (probe #175) that carries the
 *     marker sentence and the plugin's own activation banner, with the statusline nudge cut;
 *   - a second run copies nothing and still reports 0 problems (idempotent);
 *   - the marker file names the ref and the skills;
 *   - a missing checkout is reported as a problem in the line, never as a non-zero exit;
 *   - the prompt hook forwards `/caveman lite` to the plugin's mode tracker, which writes the
 *     session's mode under the fake HOME.
 */
'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const BOOTSTRAP = path.join(REPO_ROOT, '.claude', 'hooks', 'caveman-bootstrap.sh');
const PROMPT = path.join(REPO_ROOT, '.claude', 'hooks', 'caveman-prompt.sh');

// A fixture that has the shape the hooks depend on: skills/<name>/SKILL.md and the two plugin
// hooks. The activate stub prints what the real one prints (banner, rules, statusline nudge);
// the tracker stub writes the mode file the way caveman-config.js does.
function fixtureCheckout(dir) {
  for (const name of ['caveman', 'caveman-commit', 'lean-build']) {
    fs.mkdirSync(path.join(dir, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\nplugin copy of ${name}\n`);
  }
  fs.mkdirSync(path.join(dir, 'skills', 'generated'), { recursive: true }); // no SKILL.md: not a skill
  fs.mkdirSync(path.join(dir, 'src', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'hooks', 'caveman-activate.js'),
    'const rules = "## Rules\\n\\n" + "Drop articles and filler. ".repeat(300);\n' +
    'process.stdout.write("CAVEMAN MODE ACTIVE — level: ultra\\n\\n" + rules +\n' +
    '  "\\n\\nSTATUSLINE SETUP NEEDED: add this to settings.json ...\\n");\n');
  fs.writeFileSync(path.join(dir, 'src', 'hooks', 'caveman-mode-tracker.js'),
    'const fs = require("fs"); const path = require("path");\n' +
    'let raw = ""; process.stdin.on("data", (d) => raw += d); process.stdin.on("end", () => {\n' +
    '  const evt = JSON.parse(raw || "{}"); const m = /\\/caveman (\\w+)/.exec(evt.prompt || "");\n' +
    '  if (m) fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, ".caveman-active"), m[1]);\n' +
    '  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit",' +
    ' additionalContext: "CAVEMAN MODE ACTIVE — level: " + (m ? m[1] : "ultra") } }));\n});\n');
}

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-bootstrap-hook-'));
  const source = path.join(home, 'checkout');
  fixtureCheckout(source);
  // What the aac-skills bootstrap leaves behind before this hook runs: its marker and its
  // (older) copy of the caveman skill.
  fs.mkdirSync(path.join(home, '.claude', 'hook-state', 'aac-bootstrap'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'hook-state', 'aac-bootstrap', 'state.json'), '{}');
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'caveman'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'skills', 'caveman', 'SKILL.md'), 'aac payload copy\n');
  return { home, source };
}

function run(hook, { home, source, remote = true, stdin = '', extraEnv = {} }) {
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    CAVEMAN_BOOTSTRAP_HOME: home,
    CAVEMAN_BOOTSTRAP_SOURCE: source,
    CAVEMAN_BOOTSTRAP_SKIP_CLI: '1',
    CAVEMAN_BOOTSTRAP_AAC_WAIT: '2',
    CLAUDE_PROJECT_DIR: REPO_ROOT,
    ...extraEnv,
  };
  if (remote) env.CLAUDE_CODE_REMOTE = 'true';
  return spawnSync('bash', [hook], { encoding: 'utf8', env, input: stdin, cwd: REPO_ROOT });
}

function contextOf(result) {
  assert.equal(result.status, 0, `hook exited ${result.status}\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `expected one JSON line, got:\n${result.stdout}`);
  return JSON.parse(lines[0]).hookSpecificOutput.additionalContext;
}

test('local session: both hooks exit 0 and print nothing', () => {
  const f = makeHome();
  for (const hook of [BOOTSTRAP, PROMPT]) {
    const r = run(hook, { ...f, remote: false, stdin: '{"prompt":"/caveman lite"}' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  }
  assert.ok(!fs.existsSync(path.join(f.home, '.claude', 'hook-state', 'caveman-bootstrap')));
});

test('skills land under ~/.claude/skills and the plugin copy of caveman replaces the payload copy', () => {
  const f = makeHome();
  const ctx = contextOf(run(BOOTSTRAP, { ...f, stdin: '{"session_id":"t","source":"startup"}' }));
  for (const name of ['caveman', 'caveman-commit', 'lean-build']) {
    assert.equal(fs.readFileSync(path.join(f.home, '.claude', 'skills', name, 'SKILL.md'), 'utf8'),
      `---\nname: ${name}\n---\nplugin copy of ${name}\n`);
  }
  assert.ok(!fs.existsSync(path.join(f.home, '.claude', 'skills', 'generated')), 'a dir without SKILL.md is not a skill');
  assert.match(ctx, /^CAVEMAN-BOOTSTRAP MARKER: ref v[\d.]+; skills copied=3 of 3; cli: skipped; proxy: skipped; enable: skipped; problems=0/);
  assert.doesNotMatch(ctx, /PROBLEMS:/);
  const marker = JSON.parse(fs.readFileSync(path.join(f.home, '.claude', 'hook-state', 'caveman-bootstrap', 'state.json'), 'utf8'));
  assert.deepEqual([...marker.skills].sort(), ['caveman', 'caveman-commit', 'lean-build']);
  assert.equal(marker.copied_this_run, 3);
  assert.equal(marker.problems, 0);
});

test('a checkout path holding backslashes lands in the marker escaped, so the marker still parses (issue 482)', () => {
  // On Windows every temp path already carries backslashes; on POSIX a backslash is an ordinary
  // filename character, so put one in the checkout's own name.
  const f = makeHome();
  let source = f.source;
  if (process.platform !== 'win32') {
    source = path.join(f.home, 'back\\slash');
    fs.renameSync(f.source, source);
  }
  assert.match(source, /\\/, 'the fixture path must contain a backslash for this test to mean anything');
  const ctx = contextOf(run(BOOTSTRAP, { ...f, source, stdin: '{}' }));
  assert.match(ctx, /skills copied=3 of 3;.*problems=0/);
  const raw = fs.readFileSync(path.join(f.home, '.claude', 'hook-state', 'caveman-bootstrap', 'state.json'), 'utf8');
  const marker = JSON.parse(raw);
  assert.equal(marker.source, source);
  assert.equal(marker.ref, 'v2.7.0');
});

test('additionalContext is under the 2 KB cap, carries the activation banner and drops the statusline nudge', () => {
  const f = makeHome();
  const ctx = contextOf(run(BOOTSTRAP, { ...f, stdin: '{"session_id":"t","source":"startup"}' }));
  assert.ok(ctx.length <= 2000, `additionalContext is ${ctx.length} bytes; the platform cap is 2000`);
  assert.match(ctx, /CAVEMAN MODE ACTIVE — level: ultra/);
  assert.match(ctx, /## Rules/);
  assert.doesNotMatch(ctx, /STATUSLINE SETUP NEEDED/);
  assert.match(ctx, /rest of the rules: ~\/.claude\/skills\/caveman\/SKILL.md\]$/, 'truncated activation must point at the installed skill');
  assert.match(ctx, /caveman retrieve <handle>/);
});

test('second run is a no-op: nothing copied, still zero problems', () => {
  const f = makeHome();
  contextOf(run(BOOTSTRAP, { ...f, stdin: '{}' }));
  const ctx = contextOf(run(BOOTSTRAP, { ...f, stdin: '{}' }));
  assert.match(ctx, /skills copied=0 of 3;.*problems=0/);
});

test('a missing checkout is a named problem in the line, not a failed hook', () => {
  const f = makeHome();
  const r = run(BOOTSTRAP, { ...f, source: path.join(f.home, 'nowhere'), stdin: '{}' });
  const ctx = contextOf(r);
  assert.match(ctx, /problems=1 PROBLEMS: no caveman checkout at /);
  assert.ok(ctx.length <= 2000);
});

test('prompt hook forwards /caveman lite to the mode tracker, which records the mode under the fake HOME', () => {
  const f = makeHome();
  const r = run(PROMPT, { ...f, stdin: '{"session_id":"t","prompt":"/caveman lite"}' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /level: lite/);
  assert.equal(fs.readFileSync(path.join(f.home, '.claude', '.caveman-active'), 'utf8'), 'lite');
});

test('prompt hook stays silent when the checkout is absent', () => {
  const f = makeHome();
  const r = run(PROMPT, { ...f, source: path.join(f.home, 'nowhere'), stdin: '{"prompt":"/caveman lite"}' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});
