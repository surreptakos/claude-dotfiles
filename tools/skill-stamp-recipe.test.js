#!/usr/bin/env node
/**
 * node --test tools/skill-stamp-recipe.test.js
 *
 * Issue 431: the stamp recipe a human or agent copies must reproduce what CI checks.
 * `tools/skill-stamps.py` hashes each skill with the owner's home folded into the sync tokens.
 * It used to default that home to the running user's, so a recipe without `--home` re-stamped,
 * in any Linux container, every skill whose text carries the owner's path (aac-google-access,
 * ticket-fleet) - a revision bump for a skill nobody touched. Since issue 492 the default is the
 * owner's home itself (OWNER_HOME, pinned to the workflow by tools/skill-stamps.test.py); the
 * flag stays in the recipe so it reads like the job.
 *
 * So: the documented `--home` must be the one CI checks with, and the workflow's remediation
 * comment must teach CLAUDE.md's spelling verbatim rather than a second, drifting one.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const CLAUDE_MD = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/skill-stamps.yml'), 'utf8');

// The recipe lines, wherever they sit: CLAUDE.md holds them in a bash block, the workflow in a
// `#   ` comment (its own `run:` steps are the job, not the recipe, so they are excluded).
const lines = (text, tool, commented) =>
  text
    .split('\n')
    .filter((l) => (commented ? l.trimStart().startsWith('#') : true))
    .map((l) => l.replace(/^\s*#\s*/, '').trim())
    .filter((l) => l.startsWith(`python3 tools/${tool}`));

const stampRecipe = (text, c) => lines(text, 'skill-stamps.py', c).filter((l) => l.includes(' stamp '));
const buildRecipe = (text, c) => lines(text, 'build-cloud-plugin.py', c);

// What CI actually checks against - the source of truth for the home spelling.
const ciHomes = [...WORKFLOW.matchAll(/skill-stamps\.py check \S+ --home '([^']+)'/g)].map((m) => m[1]);

test('CLAUDE.md teaches the stamp command with the home CI checks against', () => {
  assert.ok(ciHomes.length > 0, 'workflow should run skill-stamps.py check --home');
  assert.deepEqual([...new Set(ciHomes)], [ciHomes[0]], 'CI check steps should agree on --home');
  const recipe = stampRecipe(CLAUDE_MD);
  assert.equal(recipe.length, 1, `CLAUDE.md should teach one stamp command, got ${recipe.length}`);
  assert.ok(
    recipe[0].includes(`--home '${ciHomes[0]}'`),
    `CLAUDE.md's stamp command must carry --home '${ciHomes[0]}' (issue 431): ${recipe[0]}`,
  );
});

test("skill-stamps.yml's remediation teaches CLAUDE.md's spelling verbatim", () => {
  assert.deepEqual(stampRecipe(WORKFLOW, true), stampRecipe(CLAUDE_MD));
});

test('only master builds the payload, with the stamp recipe and the home CI checks against (issue 1308)', () => {
  // A branch that commits its own build conflicts with every open PR on the version line, so
  // neither the branch recipe nor the PR job's remediation teaches the build; the master job runs it.
  assert.deepEqual(buildRecipe(CLAUDE_MD), [], 'CLAUDE.md must not teach a branch to build the payload');
  assert.deepEqual(buildRecipe(WORKFLOW, true), [], "skill-stamps.yml's remediation must not teach the build");
  const master = fs.readFileSync(path.join(ROOT, '.github/workflows/plugin-payload.yml'), 'utf8');
  const runs = lines(master, 'skill-stamps.py').concat(lines(master, 'build-cloud-plugin.py'));
  assert.ok(runs.some((l) => l === stampRecipe(CLAUDE_MD)[0]), 'plugin-payload.yml must stamp with the CLAUDE.md recipe');
  assert.ok(runs.some((l) => l === `python3 tools/build-cloud-plugin.py --home '${ciHomes[0]}'`),
    'plugin-payload.yml must build with the home CI checks against');
  assert.match(master, /\[skip ci\]/, 'the bot commit must carry [skip ci] so it cannot retrigger a push run');
  assert.match(master, /github\.actor != 'github-actions\[bot\]'/, 'the job must skip pushes made by the bot');
});

test('the check drift hint echoes back the --home it ran with', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-recipe-'));
  try {
    const skill = path.join(dir, 'skills', 'demo');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(
      path.join(skill, 'SKILL.md'),
      '---\nname: demo\ndescription: d\nmetadata:\n  modified: "2026-01-01T00:00:00Z"\n' +
        '  previous-modified: "none"\n  revision: "1"\n  content-sha: "deadbeefdead"\n---\nbody\n',
    );
    const res = spawnSync(
      'python3',
      [path.join(ROOT, 'tools/skill-stamps.py'), 'check', path.join(dir, 'skills'), '--home', 'C:\\Users\\Dan'],
      { encoding: 'utf8' },
    );
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /stamp .* --home 'C:\\Users\\Dan'/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
