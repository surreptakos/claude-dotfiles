// aac-design gate (issue 1082): the write and Stop hooks act only inside a folder that opts in with
// the `.aac-design` marker file, so the plugin can wire them without blocking ordinary code work.
// Each case drives the real designgate.py with the stdin payload Claude Code sends the hook.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GATE = path.join(__dirname, '..', 'aac-skills', 'aac-design', 'scripts', 'designgate.py');

// Under os.tmpdir() on purpose: a tmp or temp folder ABOVE the marker must not exempt a marked
// folder, so these cases pass wherever the checkout and the temp dir live.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aac-design-gate-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const state = path.join(root, 'state');
const plain = path.join(root, 'code-repo');
const marked = path.join(root, 'deliverables');
fs.mkdirSync(state);
fs.mkdirSync(plain);
fs.mkdirSync(path.join(marked, 'letters'), { recursive: true });
fs.writeFileSync(path.join(marked, '.aac-design'), '');

const LINT_ERROR = '<!doctype html><html><body><p>Hello</p><img src="logo.png"></body></html>\n';
const CLEAN = '<!doctype html><html><body><p>Hello</p></body></html>\n';

function write(dir, name, text) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, text);
  return p;
}

function run(mode, payload) {
  // The block counter lives under the temp dir; point every spelling of it at this run's own.
  const env = { ...process.env, TMPDIR: state, TEMP: state, TMP: state };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.DESIGN_GATE_DIRS;
  return spawnSync('python3', [GATE, mode], { input: JSON.stringify(payload), encoding: 'utf8', env });
}

test('an .html write outside a marked folder exits 0, lint error and all', () => {
  const p = write(plain, 'board.html', LINT_ERROR);
  const r = run('write', { cwd: plain, tool_name: 'Write', tool_input: { file_path: p } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});

test('the same write inside a marked folder, even a subfolder of it, exits 2 with the finding', () => {
  const p = write(path.join(marked, 'letters'), 'board.html', LINT_ERROR);
  const r = run('write', { cwd: marked, tool_name: 'Write', tool_input: { file_path: p } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /design gate FAILED/);
  assert.match(r.stderr, /\[H04\]/);
});

test('a render folder below the marker is still scratch: the write exits 0', () => {
  fs.mkdirSync(path.join(marked, 'render'), { recursive: true });
  const p = write(path.join(marked, 'render'), 'board.html', LINT_ERROR);
  const r = run('write', { cwd: marked, tool_name: 'Write', tool_input: { file_path: p } });
  assert.equal(r.status, 0, r.stderr);
});

test('Stop outside a marked folder exits 0 over an unstamped page', () => {
  write(plain, 'page.html', CLEAN);
  const r = run('stop', { session_id: 'plain-stop', cwd: plain });
  assert.equal(r.status, 0, r.stderr);
});

test('Stop inside a marked folder with no stamp exits 2; the fourth consecutive block exits 0 with the override', () => {
  write(marked, 'page.html', CLEAN);
  const payload = { session_id: 'marked-stop', cwd: marked };
  for (let i = 1; i <= 3; i++) {
    const r = run('stop', payload);
    assert.equal(r.status, 2, `block ${i}: ${r.stderr}`);
    assert.match(r.stderr, /critique: no critique stamp/);
  }
  const fourth = run('stop', payload);
  assert.equal(fourth.status, 0, fourth.stderr);
  assert.match(fourth.stderr, /DESIGN GATE OVERRIDDEN after 3 blocks/);
});

// Issue 1151: a git pull gives a tracked deliverable a fresh mtime without the session touching
// it. A tracked file that matches HEAD is gated only when a write tool call this turn names it.
const repo = path.join(root, 'pulled');
fs.mkdirSync(repo);
fs.writeFileSync(path.join(repo, '.aac-design'), '');
const pulled = write(repo, 'day-board.html', LINT_ERROR);
for (const args of [['init', '-q'], ['config', 'core.autocrlf', 'false'], ['add', '-A'],
  ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'pulled']]) {
  const g = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  assert.equal(g.status, 0, g.stderr);
}

function transcript(name, toolUses) {
  const lines = [{ type: 'user', timestamp: new Date(Date.now() - 60000).toISOString(), message: { content: 'go' } },
    { type: 'assistant', message: { content: toolUses.map((t) => ({ type: 'tool_use', ...t })) } }];
  return write(state, name, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('Stop over a tracked, clean deliverable with a fresh mtime and no write call exits 0', () => {
  fs.utimesSync(pulled, new Date(), new Date());
  const r = run('stop', { session_id: 'pulled-clean', cwd: repo, transcript_path: transcript('t1.jsonl', []) });
  assert.equal(r.status, 0, r.stderr);
});

test('a read-only Bash command naming the clean tracked deliverable does not gate it', () => {
  const t = transcript('t2.jsonl', [{ name: 'Bash', input: { command: `ls -l "${pulled}"` } }]);
  const r = run('stop', { session_id: 'pulled-ls', cwd: repo, transcript_path: t });
  assert.equal(r.status, 0, r.stderr);
});

test('a Write tool call this turn gates the same file even once committed: exits 2, error and no stamp', () => {
  const t = transcript('t3.jsonl', [{ name: 'Write', input: { file_path: pulled, content: LINT_ERROR } }]);
  const r = run('stop', { session_id: 'pulled-write', cwd: repo, transcript_path: t });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /\[H04\]/);
  assert.match(r.stderr, /critique: no critique stamp/);
});
