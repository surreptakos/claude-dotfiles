#!/usr/bin/env node
/**
 * node --test tools/generator-gate.test.js
 *
 * Issue 487. Two artifacts here are written by a generator, and nothing invoked either one: the
 * ordinary sequence - edit `tools/ticket-fleet-branch.js` or `tools/tracker-audit.js`, commit,
 * forget the generator - put a stale artifact on master, where the next unrelated test run was
 * what reported it. The gate is `--check` from `.github/workflows/generated-code.yml`, on every
 * push and pull request. (It ran at commit time too, from `.githooks/pre-commit`, until that hook
 * retired with the freshness loop in issue 213.) These tests pin the mechanism itself and
 * its caller; the per-artifact byte comparisons stay in
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

/** Copy the generator and every file it reads or writes into a scratch repo, so the probe never
 *  writes here. A generator with more than one output exports OUTPUTS (issue 675); staging only
 *  SOURCE/TARGET would leave the others missing and `--check` would die on ENOENT rather than
 *  answering the question this gate asks. */
function stageRepo(dir, script) {
  const generator = require(path.join(ROOT, script));
  const { SOURCE, TARGET, OUTPUTS } = generator;
  const files = new Set([path.join(ROOT, script), SOURCE, TARGET]);
  for (const out of OUTPUTS || []) { files.add(out.source); files.add(out.target); }
  for (const file of files) {
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
    assert.match(header, /generated-code\.yml/, `${script} header omits the CI gate`);
  }
});
