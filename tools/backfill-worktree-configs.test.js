#!/usr/bin/env node
/**
 * node --test tools/backfill-worktree-configs.test.js
 *
 * Unit tests for the config.worktree backfill (issue 30).
 *
 * The fixture builds a fake .git tree on disk that looks like the parent bare
 * repo we ship: `HEAD` file so resolveCommonDir accepts it, plus a `worktrees`
 * subtree of named entries whose gitdir file points at real scratch
 * directories. No child git process is invoked for the pure-backfill cases;
 * cleanup uses --dry-run so the tests never touch the real repo.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  parseArgs,
  readCoreBare,
  backfillEntry,
  resolveCommonDir,
  readGitdirTarget,
  isLocked,
  readHeadBranch,
  main,
  BODY,
} = require('./backfill-worktree-configs.js');

function mkTemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Build a fake bare-shaped common dir (root/HEAD + root/worktrees/<entries>)
// plus a working-dir per entry. Returns paths for the test to point at.
function buildFakeRepo(spec) {
  const root = mkTemp('bft-repo-');
  fs.writeFileSync(path.join(root, 'HEAD'), 'ref: refs/heads/master\n', 'utf8');
  const wtRoot = path.join(root, 'worktrees');
  fs.mkdirSync(wtRoot);
  const workRoot = mkTemp('bft-work-');
  const entries = {};
  for (const [name, s] of Object.entries(spec)) {
    const entry = path.join(wtRoot, name);
    fs.mkdirSync(entry);
    const workDir = path.join(workRoot, name);
    fs.mkdirSync(workDir);
    fs.writeFileSync(path.join(entry, 'gitdir'), path.join(workDir, '.git') + '\n', 'utf8');
    if (s.head) { fs.writeFileSync(path.join(entry, 'HEAD'), s.head + '\n', 'utf8'); }
    if (s.locked) { fs.writeFileSync(path.join(entry, 'locked'), 'reason\n', 'utf8'); }
    if (s.config !== undefined) { fs.writeFileSync(path.join(entry, 'config.worktree'), s.config, 'utf8'); }
    entries[name] = { entry, workDir };
  }
  return { root, wtRoot, workRoot, entries };
}

function cleanup(fake) {
  try { fs.rmSync(fake.root, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(fake.workRoot, { recursive: true, force: true }); } catch {}
}

test('parseArgs: defaults', () => {
  const o = parseArgs([]);
  assert.strictEqual(o.dryRun, false);
  assert.strictEqual(o.cleanup, false);
  assert.strictEqual(o.base, 'master');
  assert.strictEqual(o.json, false);
});

test('parseArgs: flags round-trip', () => {
  const o = parseArgs(['--dry-run', '--cleanup', '--base', 'main', '--json', '--repo', '/x/y']);
  assert.strictEqual(o.dryRun, true);
  assert.strictEqual(o.cleanup, true);
  assert.strictEqual(o.base, 'main');
  assert.strictEqual(o.json, true);
  assert.strictEqual(o.repo, '/x/y');
});

test('readCoreBare: missing file reports absent', () => {
  const tmp = mkTemp('bft-rcb-');
  try {
    const state = readCoreBare(path.join(tmp, 'nope'));
    assert.deepStrictEqual(state, { present: false });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('readCoreBare: reads bare=false', () => {
  const tmp = mkTemp('bft-rcb-');
  try {
    const p = path.join(tmp, 'config');
    fs.writeFileSync(p, '[core]\n\tbare = false\n', 'utf8');
    assert.deepStrictEqual(readCoreBare(p), { present: true, value: false });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('readCoreBare: reads bare=true and other truthy tokens', () => {
  const tmp = mkTemp('bft-rcb-');
  try {
    for (const truthy of ['true', 'True', '1', 'yes', 'on']) {
      const p = path.join(tmp, `config-${truthy}`);
      fs.writeFileSync(p, `[core]\n\tbare = ${truthy}\n`, 'utf8');
      assert.deepStrictEqual(readCoreBare(p), { present: true, value: true }, `truthy=${truthy}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('readCoreBare: ignores bare= outside [core]', () => {
  const tmp = mkTemp('bft-rcb-');
  try {
    const p = path.join(tmp, 'config');
    fs.writeFileSync(p, '[remote "x"]\n\tbare = true\n[core]\n\tignorecase = true\n', 'utf8');
    assert.deepStrictEqual(readCoreBare(p), { present: false });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('backfillEntry: writes when config.worktree is missing', () => {
  const fake = buildFakeRepo({ 'e1': {} });
  try {
    const r = backfillEntry(fake.entries.e1.entry, { dryRun: false });
    assert.strictEqual(r.action, 'wrote');
    assert.strictEqual(fs.readFileSync(r.target, 'utf8'), BODY);
  } finally { cleanup(fake); }
});

test('backfillEntry: idempotent — second call is already-configured', () => {
  const fake = buildFakeRepo({ 'e1': {} });
  try {
    backfillEntry(fake.entries.e1.entry, { dryRun: false });
    const r = backfillEntry(fake.entries.e1.entry, { dryRun: false });
    assert.strictEqual(r.action, 'already-configured');
    assert.strictEqual(r.value, false);
  } finally { cleanup(fake); }
});

test('backfillEntry: --dry-run leaves disk untouched', () => {
  const fake = buildFakeRepo({ 'e1': {} });
  try {
    const r = backfillEntry(fake.entries.e1.entry, { dryRun: true });
    assert.strictEqual(r.action, 'would-write');
    assert.strictEqual(fs.existsSync(r.target), false);
  } finally { cleanup(fake); }
});

test('backfillEntry: preserves bare=true set on purpose', () => {
  const fake = buildFakeRepo({ 'e1': { config: '[core]\n\tbare = true\n' } });
  try {
    const r = backfillEntry(fake.entries.e1.entry, { dryRun: false });
    assert.strictEqual(r.action, 'already-configured');
    assert.strictEqual(r.value, true);
    // File contents unchanged.
    assert.strictEqual(fs.readFileSync(r.target, 'utf8'), '[core]\n\tbare = true\n');
  } finally { cleanup(fake); }
});

test('resolveCommonDir: accepts a bare-shaped root', () => {
  const fake = buildFakeRepo({});
  try {
    assert.strictEqual(resolveCommonDir(fake.root), path.resolve(fake.root));
  } finally { cleanup(fake); }
});

test('resolveCommonDir: follows a linked worktree .git pointer', () => {
  // Simulate a linked worktree: <working>/.git file → gitdir → commondir → bare-root
  const fake = buildFakeRepo({});
  const wt = mkTemp('bft-linked-');
  try {
    const gitDir = path.join(fake.root, 'worktrees', 'linked');
    fs.mkdirSync(gitDir);
    fs.writeFileSync(path.join(gitDir, 'commondir'), '../..\n', 'utf8');
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitDir}\n`, 'utf8');
    assert.strictEqual(resolveCommonDir(wt), path.resolve(fake.root));
  } finally { cleanup(fake); fs.rmSync(wt, { recursive: true, force: true }); }
});

test('isLocked / readGitdirTarget / readHeadBranch', () => {
  const fake = buildFakeRepo({
    'e1': { head: 'ref: refs/heads/agent/issue-99-attempt1', locked: true },
    'e2': { head: 'detached' },
  });
  try {
    assert.strictEqual(isLocked(fake.entries.e1.entry), true);
    assert.strictEqual(isLocked(fake.entries.e2.entry), false);
    assert.strictEqual(readHeadBranch(fake.entries.e1.entry), 'agent/issue-99-attempt1');
    assert.strictEqual(readHeadBranch(fake.entries.e2.entry), null);
    assert.ok(readGitdirTarget(fake.entries.e1.entry).endsWith(path.join('e1', '.git')));
  } finally { cleanup(fake); }
});

test('main: JSON output enumerates entries and their actions', () => {
  const fake = buildFakeRepo({ 'a': {}, 'b': { config: '[core]\n\tbare = false\n' } });
  try {
    const chunks = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c) => { chunks.push(c); return true; };
    let code;
    try {
      code = main(['--repo', fake.root, '--json']);
    } finally { process.stdout.write = write; }
    assert.strictEqual(code, 0);
    const payload = JSON.parse(chunks.join(''));
    const byName = Object.fromEntries(payload.entries.map((e) => [e.name, e.action]));
    assert.strictEqual(byName.a, 'wrote');
    assert.strictEqual(byName.b, 'already-configured');
    assert.strictEqual(fs.readFileSync(path.join(fake.entries.a.entry, 'config.worktree'), 'utf8'), BODY);
  } finally { cleanup(fake); }
});

// Issue 377: the fleet's discoveries branch (`agent/fleet-discoveries-wf_<runId>`, issue 360)
// is a fleet branch too, so --cleanup must recognise its worktree rather than walk past it -
// while a branch the fleet never created stays out of the removal path entirely.
test('main: --cleanup classifies the discoveries prefix as a fleet branch', () => {
  const fake = buildFakeRepo({
    'disc': { head: 'ref: refs/heads/agent/fleet-discoveries-wf_testrun' },
    'mine': { head: 'ref: refs/heads/dan/scratch' },
  });
  try {
    const chunks = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c) => { chunks.push(c); return true; };
    let code;
    try {
      code = main(['--repo', fake.root, '--cleanup', '--dry-run', '--json']);
    } finally { process.stdout.write = write; }
    assert.strictEqual(code, 0);
    const byName = Object.fromEntries(JSON.parse(chunks.join('')).entries.map((e) => [e.name, e]));
    assert.strictEqual(byName.disc.fleet, true, 'the discoveries branch must be seen as a fleet branch');
    assert.strictEqual(byName.mine.fleet, false, 'a non-fleet branch must stay out of the removal path');
    // Unmerged either way, so both keep their config.worktree backfill.
    assert.strictEqual(byName.disc.action, 'would-write');
    assert.strictEqual(byName.mine.action, 'would-write');
  } finally { cleanup(fake); }
});

test('main: --dry-run does not touch disk', () => {
  const fake = buildFakeRepo({ 'a': {} });
  try {
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    try { main(['--repo', fake.root, '--dry-run']); } finally { process.stdout.write = write; }
    assert.strictEqual(fs.existsSync(path.join(fake.entries.a.entry, 'config.worktree')), false);
  } finally { cleanup(fake); }
});

test('main: no worktrees dir → clean exit, no error', () => {
  const root = mkTemp('bft-empty-');
  try {
    fs.writeFileSync(path.join(root, 'HEAD'), 'ref: refs/heads/master\n', 'utf8');
    const write = process.stdout.write.bind(process.stdout);
    const chunks = [];
    process.stdout.write = (c) => { chunks.push(c); return true; };
    let code;
    try { code = main(['--repo', root, '--json']); } finally { process.stdout.write = write; }
    assert.strictEqual(code, 0);
    const payload = JSON.parse(chunks.join(''));
    assert.deepStrictEqual(payload.entries, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('main: bad repo path → exit 1', () => {
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  let code;
  try { code = main(['--repo', path.join(os.tmpdir(), 'definitely-not-a-repo-xyz-' + Date.now())]); }
  finally { process.stderr.write = write; }
  assert.strictEqual(code, 1);
});
