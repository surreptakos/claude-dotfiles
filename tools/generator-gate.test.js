#!/usr/bin/env node
/**
 * node --test tools/generator-gate.test.js
 *
 * Issue 487. Two artifacts here are written by a generator, and nothing invoked either one: the
 * ordinary sequence - edit `tools/ticket-fleet-branch.js` or `tools/tracker-audit.js`, commit,
 * forget the generator - put a stale artifact on master, where the next unrelated test run was
 * what reported it. The gate is now `--check` in two places, `.githooks/pre-commit` (commit time)
 * and `.github/workflows/generated-code.yml` (push and pull request, for a commit made with
 * --no-verify or from a clone with no hook installed). These tests pin the mechanism itself and
 * both of its callers; the per-artifact byte comparisons stay in
 * tools/fleet-inline-template.test.js and tools/tracker-audit-template.test.js.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, '.githooks', 'pre-commit');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'generated-code.yml');

/** Both generators, with an edit to their SOURCE that must make the artifact stale. */
const GENERATORS = [
  {
    script: 'tools/build-fleet-inline.js',
    // Only the text between the FLEET-INLINE markers travels, so the probe has to land inside it.
    mutate: (src) => src.replace('// [FLEET-INLINE-START]',
      '// [FLEET-INLINE-START]\n// probe: an unregenerated edit (issue 487)'),
  },
  {
    script: 'tools/build-harness-tracker-audit.js',
    // The whole file travels under a banner; anything after the shebang moves the template.
    mutate: (src) => src.replace('\n', '\n// probe: an unregenerated edit (issue 487)\n'),
  },
];

/** Copy the generator and its two files into a scratch repo, so the probe never writes here. */
function stageRepo(dir, script) {
  const { SOURCE, TARGET } = require(path.join(ROOT, script));
  for (const file of [path.join(ROOT, script), SOURCE, TARGET]) {
    const dest = path.join(dir, path.relative(ROOT, file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
  }
  return path.join(dir, path.relative(ROOT, SOURCE));
}

test('--check exits non-zero and names the regenerate command when the source moves', () => {
  for (const { script, mutate } of GENERATORS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generator-gate-'));
    try {
      const source = stageRepo(dir, script);
      const run = () => spawnSync(process.execPath, [path.join(dir, script), '--check'],
        { encoding: 'utf8' });

      const clean = run();
      assert.strictEqual(clean.status, 0,
        `${script} --check must pass on an untouched copy, said: ${clean.stderr}`);

      const before = fs.readFileSync(source, 'utf8');
      const after = mutate(before);
      assert.notStrictEqual(after, before, `${script}: the probe edit matched nothing in its source`);
      fs.writeFileSync(source, after);

      const stale = run();
      assert.strictEqual(stale.status, 1, `${script} --check passed an unregenerated source edit`);
      assert.match(stale.stderr, /STALE/);
      assert.match(stale.stderr, new RegExp(`Regenerate: node ${script}`));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('.githooks/pre-commit runs both generators with --check and blocks on a stale one', () => {
  const hook = fs.readFileSync(HOOK, 'utf8');
  for (const { script } of GENERATORS) {
    assert.ok(hook.includes(script), `pre-commit no longer runs ${script}`);
  }
  assert.match(hook, /node "\$gen" --check/, 'pre-commit must call the generators with --check');
  assert.match(hook, /commit blocked[\s\S]*?\n\s*exit 1/,
    'pre-commit must exit non-zero when a generated artifact is stale');
});

test('.github/workflows/generated-code.yml runs both generators with --check', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  for (const { script } of GENERATORS) {
    assert.match(workflow, new RegExp(`run: node ${script} --check`),
      `the CI gate no longer runs ${script} --check`);
  }
});

test('each generator names, in its header, what invokes it', () => {
  for (const { script } of GENERATORS) {
    const header = fs.readFileSync(path.join(ROOT, script), 'utf8').split("'use strict'")[0];
    assert.match(header, /\.githooks\/pre-commit/, `${script} header omits the pre-commit gate`);
    assert.match(header, /generated-code\.yml/, `${script} header omits the CI gate`);
  }
});
