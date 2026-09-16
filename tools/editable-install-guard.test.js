#!/usr/bin/env node
/**
 * node --test tools/editable-install-guard.test.js
 *
 * Covers claude-dotfiles issue 413: a ticket-fleet worktree that runs
 * `pip install -e` repoints the container's single editable install at its
 * scratch checkout, and removing the worktree orphans it - after which
 * `python -c 'import <pkg>'` from the main checkout fails in every subprocess
 * although nothing is wrong with the code.
 *
 * The first test is the ticket's regression check, run for real rather than
 * asserted about: a git worktree is added, the editable pointer is repointed at
 * it exactly as pip's PEP 660 install writes it, the worktree is removed, the
 * import is shown to break, and the guard is what makes it import again.
 * Site-packages is a scratch directory handed to `site.addsitedir`, which is the
 * same code path the real one goes through, so no pip, venv or network is needed.
 */
'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const GUARD = path.join(REPO_ROOT, 'aac-skills', 'ticket-fleet', 'editable-install-guard.js');
const FLEET_SCRIPT = path.join(REPO_ROOT, 'aac-skills', 'ticket-fleet', 'ticket-fleet.js');
const guard = require(GUARD);

const PY = ['python3', 'python'].find((exe) => spawnSync(exe, ['-c', 'print(1)'], { encoding: 'utf8' }).status === 0);

/** A main checkout with a src-layout package, committed, plus a scratch site-packages. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editable-guard-'));
  const main = path.join(root, 'main');
  fs.mkdirSync(path.join(main, 'src', 'fixturepkg'), { recursive: true });
  fs.writeFileSync(path.join(main, 'pyproject.toml'), '[project]\nname = "fixture-pkg"\nversion = "0.1.0"\n');
  fs.writeFileSync(path.join(main, 'src', 'fixturepkg', '__init__.py'), 'VALUE = "main"\n');
  const git = (...a) => assert.equal(spawnSync('git', ['-C', main, ...a], { encoding: 'utf8' }).status, 0, `git ${a[0]} failed`);
  spawnSync('git', ['-C', main, 'init', '-q'], { encoding: 'utf8' });
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'editable guard test');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const site = path.join(root, 'site-packages');
  fs.mkdirSync(site);
  // What pip's PEP 660 install writes for a src layout: one pointer file naming
  // the directory that holds the importable package.
  const pointer = path.join(site, '__editable__.fixture_pkg-0.1.0.pth');
  fs.writeFileSync(pointer, path.join(main, 'src') + '\n');
  return { root, main, site, pointer, git };
}

/** `python -c 'import fixturepkg'` from the main checkout, through site-packages. */
function importFromMain(fx) {
  return spawnSync(PY, ['-c', 'import site,sys;site.addsitedir(sys.argv[1]);import fixturepkg;print(fixturepkg.__file__)', fx.site],
    { cwd: fx.main, encoding: 'utf8' });
}

function runGuard(args) {
  const r = spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout.trim()); } catch (e) { /* left null: the assertions name it */ }
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

test('a worktree that captures the editable install is repaired after the worktree is deleted', { skip: PY ? false : 'no Python interpreter on PATH' }, () => {
  const fx = fixture();
  const wt = path.join(fx.root, 'verify-413');

  assert.equal(importFromMain(fx).status, 0, 'the fixture must import before anything touches it');

  fx.git('worktree', 'add', '-q', '--detach', wt);
  // Exactly what `pip install -e .` run from that worktree leaves behind: one
  // interpreter, one pointer file, last writer wins.
  fs.writeFileSync(fx.pointer, path.join(wt, 'src') + '\n');
  assert.match(importFromMain(fx).stdout, new RegExp(`^${wt}`), 'the repoint must actually take effect');

  fx.git('worktree', 'remove', '--force', wt);
  const orphaned = importFromMain(fx);
  assert.notEqual(orphaned.status, 0, 'deleting the worktree must orphan the install - otherwise this test proves nothing');
  assert.match(orphaned.stderr, /ModuleNotFoundError/, 'the symptom issue 413 reports is a ModuleNotFoundError');

  const found = runGuard(['check', '--main', fx.main, '--site-packages', fx.site]);
  assert.equal(found.status, 1, `check must exit 1 on an orphaned pointer, got ${found.status}: ${found.stdout}${found.stderr}`);
  assert.equal(found.json.ok, false);
  assert.deepEqual(found.json.pointers.map((p) => p.state), ['orphaned']);
  assert.match(found.json.repair, /pip install -e/, 'the report must name the durable fix');

  const fixed = runGuard(['check', '--main', fx.main, '--site-packages', fx.site, '--repair']);
  assert.equal(fixed.status, 0, `repair must exit 0, got ${fixed.status}: ${fixed.stdout}${fixed.stderr}`);
  assert.equal(fixed.json.repaired.length, 1);
  assert.equal(fixed.json.repaired[0].to, path.join(fx.main, 'src'));

  const after = importFromMain(fx);
  assert.equal(after.status, 0, `import from the main checkout must work again: ${after.stderr}`);
  assert.match(after.stdout, new RegExp(`^${fx.main}`), 'and it must resolve inside the main checkout');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('a pointer that still names the main checkout is left alone, and other packages are never read', () => {
  const fx = fixture();
  const other = path.join(fx.site, '__editable__.other_pkg-2.0.0.pth');
  fs.writeFileSync(other, '/gone/elsewhere/src\n');
  const before = fs.readFileSync(fx.pointer, 'utf8');

  const r = runGuard(['check', '--main', fx.main, '--site-packages', fx.site, '--repair']);
  assert.equal(r.status, 0, `a healthy install must exit 0: ${r.stdout}${r.stderr}`);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.pointers.map((p) => p.state), ['main']);
  assert.equal(fs.readFileSync(fx.pointer, 'utf8'), before, 'a healthy pointer must not be rewritten');
  assert.equal(fs.readFileSync(other, 'utf8'), '/gone/elsewhere/src\n',
    "another distribution's editable install must not be touched, however broken it looks");

  // The finder sidecar pip writes beside the .pth is matched and rewritten the same way.
  assert.ok(guard.isPointerFor('__editable___fixture_pkg_0_1_0_finder.py', 'fixture_pkg'));
  assert.ok(!guard.isPointerFor('__editable___other_pkg_2_0_0_finder.py', 'fixture_pkg'));
  assert.deepEqual(guard.extractPaths("# see https://github.com/pypa/setuptools\nMAPPING = {'fixturepkg': '/tmp/verify-413/src/fixturepkg'}"),
    ['/tmp/verify-413/src/fixturepkg'], 'a URL in a finder sidecar is not a project directory and must never be rewritten');
  assert.equal(guard.repairTarget(fx.main, '/tmp/verify-413/src/fixturepkg'), path.join(fx.main, 'src', 'fixturepkg'));
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('a repo with no Python project reports nothing to guard rather than failing the run', () => {
  const r = runGuard(['check', '--main', REPO_ROOT, '--site-packages', os.tmpdir()]);
  assert.equal(r.status, 0, 'claude-dotfiles has no pyproject.toml; the guard must be a quiet no-op there');
  assert.equal(r.json.ok, true);
  assert.match(r.json.note, /nothing to guard/);
});

test('the fleet prompts carry the editable-install rail and no pip install -e against a scratch path', () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  for (const m of src.matchAll(/pip install\s+(?:-e|--editable)/g)) {
    assert.match(src.slice(Math.max(0, m.index - 140), m.index), /never|do not|main checkout/i,
      `every pip editable install named in ticket-fleet.js must be a prohibition or the main checkout's own repair, not an instruction to a worktree agent (near offset ${m.index})`);
  }
  const rail = src.match(/^const PYTHON_RAIL = `[\s\S]*?`$/m);
  assert.ok(rail, 'the rail both worktree-facing prompts share must be one named constant');
  assert.match(rail[0], /PYTHONPATH=<your worktree>\/src/, 'the rail must say how a test finds the package from a worktree');
  assert.match(rail[0], /never run \\`pip install -e\\`/, 'the rail must forbid the install outright');
  // Every agent the fleet runs inside a worktree: the two the ticket names, plus the prober,
  // which is worktree-isolated too and runs whatever commands its ticket asks for.
  for (const [prompt, tail] of [
    ['Implement GitHub issue', 'label: `impl:'],
    ['You are an independent verifier. Your job', 'label: `verify:#${t.number}.${attempt}`, phase'],
    ['Probe GitHub issue', 'label: `probe:'],
  ]) {
    const start = src.indexOf(prompt);
    assert.ok(start > 0, `prompt "${prompt}" is gone from the fleet script`);
    const body = src.slice(start, src.indexOf(tail, start));
    assert.ok(body.includes('${PYTHON_RAIL}'), `the "${prompt}" prompt must carry the rail`);
  }
  assert.match(src, /editable-install-guard\.js/, 'the fleet must run the guard once the wave has drained');
});
