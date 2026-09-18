'use strict';
/**
 * node --test cloud-plugin-sweep.test.js
 *
 * The sweep decides whether cloud sessions are running stale skills, so every state it can report
 * is tested against a real temp tree: in-sync, added, changed, removed, packager-changed, the
 * dead-junction fallback, and the two states that must never read as a pass (never-uploaded,
 * unknown). The upload channel is the marketplace payload in the repo, published by merging a
 * packager rebuild, so no --accounts plumbing here — the tests describe the after-publish state
 * only.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'cloud-plugin-sweep.js');

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-sweep-'));
  const skills = path.join(root, 'skills');
  const fallback = path.join(root, 'agents-skills');
  fs.mkdirSync(skills, { recursive: true });
  fs.mkdirSync(fallback, { recursive: true });
  const builder = path.join(root, 'build-cloud-plugin.py');
  fs.writeFileSync(builder, '# packager v1\n');
  return {
    root, skills, fallback, builder,
    state: path.join(root, 'state', 'state.json'),
    env: {
      ...process.env,
      CLOUD_PLUGIN_SKILLS_DIR: skills,
      CLOUD_PLUGIN_FALLBACK_DIR: fallback,
      CLOUD_PLUGIN_STATE: path.join(root, 'state', 'state.json'),
      CLOUD_PLUGIN_BUILDER: builder,
      CLOUD_PLUGIN_AAC_DIR: path.join(root, 'no-aac-here'),
    },
  };
}

function addSkill(dir, name, body) {
  const d = path.join(dir, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), body || `---\nname: ${name}\ndescription: d\n---\n\nbody\n`);
  return d;
}

/** Run the sweep, returning { code, out } — a non-zero exit is a finding, not a crash. */
function run(env, args) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}
const runJson = (env) => {
  const r = run(env, ['--json']);
  return { code: r.code, json: JSON.parse(r.out) };
};

test('no stamp yet reads as never-uploaded, exit 1 — not a pass', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  const { code, json } = runJson(s.env);
  assert.equal(json.state, 'never-uploaded');
  assert.equal(json.count, 1);
  assert.equal(code, 1);
});

test('stamping then sweeping reports in-sync, exit 0', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  assert.equal(run(s.env, ['--stamp', '--quiet']).code, 0);
  const { code, json } = runJson(s.env);
  assert.equal(json.state, 'in-sync');
  assert.equal(code, 0);
});

test('a new skill is drift, named under added', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  run(s.env, ['--stamp', '--quiet']);
  addSkill(s.skills, 'beta');
  const { code, json } = runJson(s.env);
  assert.equal(json.state, 'drift');
  assert.deepEqual(json.added, ['beta']);
  assert.deepEqual(json.changed, []);
  assert.equal(code, 1);
});

test('an edited skill body is drift, named under changed', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  run(s.env, ['--stamp', '--quiet']);
  fs.writeFileSync(path.join(s.skills, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: edited\n---\n\nnew\n');
  const { json } = runJson(s.env);
  assert.deepEqual(json.changed, ['alpha']);
});

test('a deleted skill is drift, named under removed', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  addSkill(s.skills, 'beta');
  run(s.env, ['--stamp', '--quiet']);
  fs.rmSync(path.join(s.skills, 'beta'), { recursive: true, force: true });
  const { json } = runJson(s.env);
  assert.deepEqual(json.removed, ['beta']);
});

test('changing the packager is drift even when no skill changed', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  run(s.env, ['--stamp', '--quiet']);
  fs.writeFileSync(s.builder, '# packager v2\n');
  const { json } = runJson(s.env);
  assert.equal(json.state, 'drift');
  assert.equal(json.builderChanged, true);
  assert.deepEqual(json.changed, []);
});

test('backup files do not count as drift — the packager does not ship them', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  run(s.env, ['--stamp', '--quiet']);
  fs.writeFileSync(path.join(s.skills, 'alpha', 'SKILL.md.bak-20260828'), 'old copy\n');
  const { code, json } = runJson(s.env);
  assert.equal(json.state, 'in-sync');
  assert.equal(code, 0);
});

test('a directory whose SKILL.md lives in the fallback tree is still counted', (t) => {
  const s = scratch();
  fs.mkdirSync(path.join(s.skills, 'ghost'));           // dead junction: empty here
  addSkill(s.fallback, 'ghost');                         // real content there
  const { json } = runJson(s.env);
  assert.deepEqual(json.skills.map((x) => x.name), ['ghost']);
});

test('a directory with no SKILL.md anywhere is skipped, like the packager skips it', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  fs.mkdirSync(path.join(s.skills, 'not-a-skill'));
  const { json } = runJson(s.env);
  assert.deepEqual(json.skills.map((x) => x.name), ['alpha']);
});

test('a missing skills tree is unknown, exit 2 — never a pass', (t) => {
  const s = scratch();
  fs.rmSync(s.skills, { recursive: true, force: true });
  const { code, json } = runJson(s.env);
  assert.equal(json.state, 'unknown');
  assert.equal(code, 2);
});

test('an unreadable stamp is unknown, not in-sync', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  fs.mkdirSync(path.dirname(s.state), { recursive: true });
  fs.writeFileSync(s.state, '{ not json');
  const { code, json } = runJson(s.env);
  assert.equal(json.state, 'unknown');
  assert.equal(code, 2);
});

test('the report caps long lists instead of printing every name', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  run(s.env, ['--stamp', '--quiet']);
  for (let i = 0; i < 8; i++) addSkill(s.skills, `new-${i}`);
  const { json } = runJson(s.env);
  const added = json.lines.find((l) => l.startsWith('added:'));
  assert.match(added, /\.\.\.and 3 more$/);
});

test('a machine with neither a stamp nor the packager stays silent, exit 0', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  fs.rmSync(s.builder, { force: true });
  const { code, json } = runJson(s.env);
  assert.equal(json.state, 'not-configured');
  assert.equal(code, 0);
});

// --------------------------------------------------------------- fix text
// The single publish route now is a packager rebuild on a branch, merged (issue 214). Any old
// "re-upload at claude.ai" wording would send the operator to the wrong surface for a skill the
// plugin serves.

test('drift fix text points at the packager rebuild, not claude.ai', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  run(s.env, ['--stamp', '--quiet']);
  addSkill(s.skills, 'beta');
  const r = run(s.env, []);
  assert.equal(r.code, 1);
  assert.match(r.out, /build-cloud-plugin\.py/);
  assert.match(r.out, /merge/);
  assert.ok(!/claude\.ai/i.test(r.out), 'fix text must not send the operator back to claude.ai');
});

test('never-uploaded fix text points at the packager rebuild, not claude.ai', (t) => {
  const s = scratch();
  addSkill(s.skills, 'alpha');
  const r = run(s.env, []);
  assert.equal(r.code, 1);
  assert.match(r.out, /build-cloud-plugin\.py/);
  assert.ok(!/claude\.ai/i.test(r.out), 'fix text must not send the operator back to claude.ai');
});
