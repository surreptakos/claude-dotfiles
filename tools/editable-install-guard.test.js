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

/** A literal path inside a RegExp: Windows separators are regex escapes otherwise. */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const REPO_ROOT = path.resolve(__dirname, '..');
const GUARD = path.join(REPO_ROOT, 'aac-skills', 'ticket-fleet', 'editable-install-guard.js');
const FLEET_SCRIPT = path.join(REPO_ROOT, 'aac-skills', 'ticket-fleet', 'ticket-fleet.js');
const guard = require(GUARD);
const { sliceBetween, sliceBetweenTags } = require('./source-slice.js');

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
  assert.match(importFromMain(fx).stdout, new RegExp(`^${escapeRegExp(wt)}`), 'the repoint must actually take effect');

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
  assert.match(after.stdout, new RegExp(`^${escapeRegExp(fx.main)}`), 'and it must resolve inside the main checkout');
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
  assert.ok(rail[0].includes('${editableSeedCommand(editableGuardPaths(cfg.editableGuardScript))}'),
    'the rail must have every worktree agent seed its worktree before any Python command (issue 624)');
  assert.match(rail[0], /\.venv\/bin\/python -m <module>/, 'and say which interpreter runs in a seeded worktree');
  // Every agent the fleet runs inside a worktree: the two the ticket names, plus the prober,
  // which is worktree-isolated too and runs whatever commands its ticket asks for.
  for (const [prompt, tail] of [
    ['Implement GitHub issue', 'label: `impl:'],
    // The tail must be text that really follows the prompt: a tail indexOf cannot find used to
    // slice to the end of the file, and every later prompt's rail then satisfied this one
    // vacuously. sliceBetween throws on the missing anchor now (issue 488).
    ['You are an independent verifier. Your job', '{ label: verifyLabel, phase: \'Verify\''],
    ['Probe GitHub issue', 'label: `probe:'],
    // Issue 435: the probe lane's verifier re-runs whatever commands a probe ticket named, and
    // unlike the prober it is NOT worktree-isolated - an install it ran would land in the
    // orchestrator's own checkout. It carries the same rail now.
    ['You are an independent verifier for a probe ticket', 'Clean up your scratch worktree (git worktree remove) when done. Make no repository changes'],
  ]) {
    const body = sliceBetween(src, prompt, tail, `the "${prompt}" prompt in the fleet script`);
    assert.ok(body.includes('${PYTHON_RAIL}'), `the "${prompt}" prompt must carry the rail`);
  }
  assert.match(src, /editable-install-guard\.js/, 'the fleet must run the guard once the wave has drained');
});

// Issue 493: the probe lane's verifier re-runs whatever commands a probe ticket named, in the
// orchestrator's own checkout, and was the only fleet agent that could touch a tree with neither
// `isolation: 'worktree'` nor the orchestrator-tree paragraph. Both verifiers now render it from
// one named helper. The tail of each slice is text that really follows that prompt: a tail found
// past the end of it would let a LATER prompt's copy of the rail satisfy this assertion.
test("the probe lane's verifier carries the orchestrator-tree rail (issue 493)", () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const rail = src.match(/^const orchestratorTreeRail = \([\s\S]*?\) => `[\s\S]*?`$/m);
  assert.ok(rail, 'the orchestrator-tree rail the two verifiers share must be one named helper');
  assert.match(rail[0], /aac-routines issue 192, non-negotiable/, 'the rail must name the issue it comes from');
  assert.match(rail[0], /you are NOT worktree-isolated/, 'the rail must say the tree it starts in is the orchestrator\'s own');
  for (const [prompt, tail] of [
    ['You are an independent verifier for a probe ticket', 'Clean up your scratch worktree (git worktree remove) when done. Make no repository changes'],
    ['You are an independent verifier. Your job', '{ label: verifyLabel, phase: \'Verify\''],
  ]) {
    const start = src.indexOf(prompt);
    assert.ok(start > 0, `prompt "${prompt}" is gone from the fleet script`);
    const end = src.indexOf(tail, start);
    assert.ok(end > start, `the tail for "${prompt}" no longer follows it - this assertion would pass on another prompt's rail`);
    assert.ok(src.slice(start, end).includes('${orchestratorTreeRail('),
      `the "${prompt}" prompt must carry the orchestrator-tree rail`);
  }
  // The rail's last sentence promises a checkpoint straight after the verifier. The probe lane
  // had none, so it must run one now or the paragraph is a bluff.
  assert.match(src, /await treeGuardCheck\(pass === 1 \? `probe-verify-attempt/,
    'the probe lane must run an orchestrator-tree checkpoint straight after its verifier');
});

/** The fleet's own guard-path block, evaluated exactly as the fleet script evaluates it. */
function fleetEditableGuardBlock() {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const block = sliceBetweenTags(src, '// [FLEET-EDITABLE-GUARD-START]', '// [FLEET-EDITABLE-GUARD-END]',
    "the fleet script's editable-guard block");
  // eslint-disable-next-line no-new-func
  return new Function(`${block}
return { editableGuardPaths, editableGuardCommand, editableSeedCommand, editableGuardAbsentMessage };`)();
}

// Issue 435: the wave repaired nothing on the repo the incident happened in, because none of the
// candidate paths existed there and the skip message said only "copy it into the served repo's
// tools/". Run the real probe command in a repo shaped like that one - no guard anywhere - then do
// exactly what the new message says and run it again.
test('a served repo with no guard copy is told the exact path to create, and the probe runs once it exists (issue 435)', () => {
  const { editableGuardPaths, editableGuardCommand, editableGuardAbsentMessage } = fleetEditableGuardBlock();
  const paths = editableGuardPaths(null);
  const cmd = editableGuardCommand(paths, '.');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'editable-guard-served-'));
  // HOME is redirected at the scratch repo so the ~/.claude candidate cannot match either.
  const probe = () => spawnSync('sh', ['-c', cmd], { cwd: repo, encoding: 'utf8', env: Object.assign({}, process.env, { HOME: repo }) });

  const absent = probe();
  assert.equal(absent.status, 3, `a repo with no copy must report "not here" (3), got ${absent.status}: ${absent.stdout}${absent.stderr}`);

  const msg = editableGuardAbsentMessage(paths, '.');
  assert.match(msg, /tools\/editable-install-guard\.js/, 'the message must name the path to create');
  assert.match(msg, /\.claude\/workflows\/editable-install-guard\.js/, 'and the copy beside the fleet script a fork launches from');
  assert.match(msg, /cp "\$CLAUDE_PLUGIN_ROOT\/skills\/ticket-fleet\/editable-install-guard\.js" tools\/editable-install-guard\.js/,
    'and the command that creates it - the old message named no file, no source and no name, so nothing was ever copied');

  fs.mkdirSync(path.join(repo, 'tools'));
  fs.copyFileSync(GUARD, path.join(repo, 'tools', 'editable-install-guard.js'));
  const found = probe();
  assert.notEqual(found.status, 3, 'the first path the message names must be one the probe actually tries');
  if (PY) {
    assert.equal(found.status, 0, `a repo with no pyproject.toml is a clean no-op: ${found.stdout}${found.stderr}`);
    assert.match(found.stdout, /nothing to guard/, 'and it reports it as JSON, not as a skip');
  }
  // The seed command the rail hands every worktree agent probes the same homes (issue 624).
  const seedProbe = spawnSync('sh', ['-c', fleetEditableGuardBlock().editableSeedCommand(paths)],
    { cwd: repo, encoding: 'utf8', env: Object.assign({}, process.env, { HOME: repo }) });
  assert.equal(seedProbe.status, 0, `the seed probe must find the same copy: ${seedProbe.stdout}${seedProbe.stderr}`);
  assert.match(seedProbe.stdout, /nothing to seed/, 'and a repo with no Python package is a quiet no-op');
  fs.rmSync(repo, { recursive: true, force: true });
});

/** True when `exe` can run a real offline PEP 660 editable install: pip and setuptools >= 64. */
function canPipEditable(exe) {
  if (!exe) return false;
  const r = spawnSync(exe, ['-c', 'import setuptools,pip,sys;sys.exit(int(setuptools.__version__.split(".")[0])<64)'], { encoding: 'utf8' });
  return r.status === 0;
}

// Issue 624: seed the worktree instead of repairing afterwards. The ticket's order is followed
// literally - the capture is reproduced first, with a real `pip install -e` from a real worktree
// against a real interpreter (a venv standing in for the container's one shared interpreter, so
// the machine's own site-packages is never touched), and only then is a seeded worktree shown to
// install without capturing anything.
test('a real pip install -e from a worktree captures the shared install; from a seeded worktree it cannot (issue 624)',
  { skip: canPipEditable(PY) ? false : 'needs python with pip and setuptools>=64' }, () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'editable-seed-')));
    const main = path.join(root, 'main');
    fs.mkdirSync(path.join(main, 'src', 'fixturepkg'), { recursive: true });
    fs.writeFileSync(path.join(main, 'pyproject.toml'), '[build-system]\nrequires = ["setuptools>=64"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "fixture-pkg"\nversion = "0.1.0"\n');
    fs.writeFileSync(path.join(main, 'src', 'fixturepkg', '__init__.py'), 'VALUE = "main"\n');
    fs.writeFileSync(path.join(main, '.gitignore'), '*.egg-info/\nbuild/\n__pycache__/\n');
    const git = (...a) => {
      const r = spawnSync('git', ['-C', main, ...a], { encoding: 'utf8' });
      assert.equal(r.status, 0, `git ${a.join(' ')} failed: ${r.stderr}`);
      return r.stdout;
    };
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'editable seed test');
    git('add', '-A');
    git('commit', '-qm', 'fixture');

    // The shared interpreter: every checkout's `python -m pip` writes into its one site-packages.
    const shared = path.join(root, 'shared');
    assert.equal(spawnSync(PY, ['-m', 'venv', '--system-site-packages', '--without-pip', shared]).status, 0, 'shared venv');
    const sharedPy = path.join(shared, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const sharedSite = guard.sitePackagesOf(sharedPy)[0];
    const pipEditable = (py, cwd) => {
      const r = spawnSync(py, ['-m', 'pip', 'install', '-q', '--no-build-isolation', '--no-deps', '--no-index', '-e', '.'],
        { cwd, encoding: 'utf8', env: Object.assign({}, process.env, { PIP_DISABLE_PIP_VERSION_CHECK: '1' }) });
      assert.equal(r.status, 0, `pip install -e from ${cwd} failed: ${r.stdout}${r.stderr}`);
    };
    const importWith = (py) => spawnSync(py, ['-c', 'import fixturepkg;print(fixturepkg.__file__)'], { cwd: root, encoding: 'utf8' });
    pipEditable(sharedPy, main);
    assert.match(importWith(sharedPy).stdout, new RegExp(`^${escapeRegExp(main)}`), 'the main checkout is what the shared install names');

    // 1. The capture, reproduced: install from a worktree, delete the worktree, main no longer imports.
    const captured = path.join(root, 'wt-capture');
    git('worktree', 'add', '-q', '--detach', captured);
    pipEditable(sharedPy, captured);
    assert.match(importWith(sharedPy).stdout, new RegExp(`^${escapeRegExp(captured)}`), 'the worktree install captured the shared pointer');
    git('worktree', 'remove', '--force', captured);
    const orphaned = importWith(sharedPy);
    assert.notEqual(orphaned.status, 0, 'deleting the capturing worktree must orphan the install');
    assert.match(orphaned.stderr, /ModuleNotFoundError/);
    pipEditable(sharedPy, main); // put the shared install back the durable way before part 2

    // 2. The seed: the same install from a seeded worktree lands in the worktree's own venv.
    const seeded = path.join(root, 'wt-seeded');
    git('worktree', 'add', '-q', '--detach', seeded);
    const r = spawnSync(process.execPath, [GUARD, 'seed', '--worktree', seeded, '--python', PY, '--site-packages', sharedSite], { encoding: 'utf8' });
    assert.equal(r.status, 0, `seed must exit 0: ${r.stdout}${r.stderr}`);
    const report = JSON.parse(r.stdout.trim());
    assert.equal(report.python, path.join(seeded, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'));
    assert.deepEqual(report.seeded.map((s) => s.to), [path.join(seeded, 'src')], 'the copied pointer must name the worktree');
    assert.match(importWith(report.python).stdout, new RegExp(`^${escapeRegExp(seeded)}`), 'before any install, the seeded venv already imports the worktree\'s code');
    const show = spawnSync(report.python, ['-m', 'pip', 'show', 'fixture-pkg'], { encoding: 'utf8' });
    assert.equal(show.status, 0, `the seeded venv must carry the install metadata too, so a dependency check passes: ${show.stderr}`);
    assert.equal(git('-C', seeded, 'status', '--porcelain'), '', 'a seeded worktree must stay clean for the tree guard');

    pipEditable(report.python, seeded);
    assert.match(importWith(sharedPy).stdout, new RegExp(`^${escapeRegExp(main)}`), 'an install from the seeded worktree must not touch the shared pointer');
    git('worktree', 'remove', seeded); // no --force: the seeded venv must not block the cleanup verifiers run
    const after = importWith(sharedPy);
    assert.equal(after.status, 0, `the main checkout must still import once the seeded worktree is gone: ${after.stderr}`);
    const check = runGuard(['check', '--main', main, '--site-packages', sharedSite]);
    assert.equal(check.status, 0, `nothing is left to repair: ${check.stdout}`);
    fs.rmSync(root, { recursive: true, force: true });
  });
