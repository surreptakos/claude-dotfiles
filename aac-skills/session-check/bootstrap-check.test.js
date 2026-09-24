'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readMarker, verifySkills, compareToMaster, verifyPluginRoot } = require('./bootstrap-check');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-check-'));
  const marker = path.join(dir, 'state.json');
  const skills = path.join(dir, 'skills');
  const manifest = path.join(dir, 'plugin.json');
  fs.mkdirSync(skills, { recursive: true });
  return { dir, marker, skills, manifest };
}

function writeMarker(marker, payload) {
  fs.writeFileSync(marker, JSON.stringify(payload));
}

function writeSkill(skillsDir, name) {
  const d = path.join(skillsDir, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\n---\nbody`);
}

function env(f, extra) {
  return {
    BOOTSTRAP_MARKER_FILE: f.marker,
    BOOTSTRAP_SKILLS_DIR: f.skills,
    BOOTSTRAP_MASTER_MANIFEST: f.manifest,
    ...(extra || {}),
  };
}

test('readMarker returns missing when the marker file does not exist', () => {
  const f = fixture();
  const r = readMarker(env(f));
  assert.equal(r.state, 'missing');
  assert.equal(r.path, f.marker);
});

test('readMarker returns unreadable when the marker JSON has no skills array', () => {
  const f = fixture();
  writeMarker(f.marker, { payload_version: '1' }); // no skills key
  const r = readMarker(env(f));
  assert.equal(r.state, 'unreadable');
  assert.match(r.reason, /skills/);
});

test('readMarker returns unreadable when the marker is not valid JSON', () => {
  const f = fixture();
  fs.writeFileSync(f.marker, '{not-json');
  const r = readMarker(env(f));
  assert.equal(r.state, 'unreadable');
});

test('readMarker returns failed, with stage and reason, when the hook recorded a failed stage (issue 483)', () => {
  const f = fixture();
  writeMarker(f.marker, {
    failed: true,
    stage: 'clone',
    reason: "git clone --depth 1 --branch master https://github.com/x/y.git: fatal: could not read Username for 'https://github.com': No such device or address",
    skills: [],
    failed_at: '2026-09-17T18:00:00Z',
  });
  const r = readMarker(env(f));
  assert.equal(r.state, 'failed');
  assert.equal(r.stage, 'clone');
  assert.match(r.reason, /could not read Username/);
  assert.equal(r.marker.failed_at, '2026-09-17T18:00:00Z');
  assert.equal(r.path, f.marker);
});

test('readMarker: a failed marker with no stage or reason still reads as failed, never as ok', () => {
  const f = fixture();
  writeMarker(f.marker, { failed: true, skills: [] });
  const r = readMarker(env(f));
  assert.equal(r.state, 'failed');
  assert.equal(r.stage, 'unknown stage');
  assert.equal(r.reason, 'no reason recorded');
});

test('readMarker returns ok with the parsed marker', () => {
  const f = fixture();
  writeMarker(f.marker, { payload_version: '2026.9.15', skills: ['ticket-fleet'] });
  const r = readMarker(env(f));
  assert.equal(r.state, 'ok');
  assert.equal(r.marker.payload_version, '2026.9.15');
});

// The date is taken an hour before this machine's boot, never a fixed one: a fixed date reads
// as stale only on a machine booted after it, so a long-running desktop went red (issue 681).
test('readMarker returns stale when the marker predates this container (issue 643)', () => {
  const f = fixture();
  const beforeBoot = new Date(Date.now() - os.uptime() * 1000 - 3600 * 1000).toISOString();
  writeMarker(f.marker, {
    payload_version: '2026.9.15', skills: ['ticket-fleet'],
    installed_at: beforeBoot,
  });
  const r = readMarker(env(f));
  assert.equal(r.state, 'stale');
  assert.equal(r.writtenAt, beforeBoot);
  assert.equal(r.marker.payload_version, '2026.9.15');
});

test('readMarker is ok when the marker was written after this container booted', () => {
  const f = fixture();
  writeMarker(f.marker, {
    payload_version: '2026.9.15', skills: ['ticket-fleet'],
    installed_at: new Date().toISOString(),
  });
  assert.equal(readMarker(env(f)).state, 'ok');
});

test('readMarker: a marker with no installed_at is ok, not stale — staleness needs a date', () => {
  const f = fixture();
  writeMarker(f.marker, { payload_version: '2026.9.15', skills: ['ticket-fleet'] });
  assert.equal(readMarker(env(f)).state, 'ok');
});

test('verifySkills reports every named skill that has no SKILL.md on disk', () => {
  const f = fixture();
  writeSkill(f.skills, 'ticket-fleet');
  // ask-matt named but never copied
  const v = verifySkills({ skills: ['ticket-fleet', 'ask-matt', 'caveman'] }, env(f));
  assert.equal(v.state, 'skills-missing');
  assert.deepEqual(v.missing.sort(), ['ask-matt', 'caveman']);
});

test('verifySkills is ok when every named skill has a SKILL.md on disk', () => {
  const f = fixture();
  writeSkill(f.skills, 'a');
  writeSkill(f.skills, 'b');
  const v = verifySkills({ skills: ['a', 'b'] }, env(f));
  assert.equal(v.state, 'ok');
  assert.deepEqual(v.missing, []);
});

test('compareToMaster returns same when master version equals the marker version', () => {
  const f = fixture();
  fs.writeFileSync(f.manifest, JSON.stringify({ version: '2026.9.151521' }));
  const c = compareToMaster({ payload_version: '2026.9.151521' }, env(f));
  assert.equal(c.state, 'same');
  assert.equal(c.master, '2026.9.151521');
});

test('compareToMaster returns drift when master offers a different version', () => {
  const f = fixture();
  fs.writeFileSync(f.manifest, JSON.stringify({ version: '2026.9.161010' }));
  const c = compareToMaster({ payload_version: '2026.9.151521' }, env(f));
  assert.equal(c.state, 'drift');
  assert.equal(c.master, '2026.9.161010');
  assert.equal(c.marker, '2026.9.151521');
});

test('compareToMaster returns unknown when no manifest to read against', () => {
  const f = fixture();
  // no manifest file written
  const c = compareToMaster({ payload_version: '2026.9.151521' }, env(f));
  assert.equal(c.state, 'unknown');
  assert.equal(c.marker, '2026.9.151521');
});

// The version master offers comes off the REMOTE. Reading it from the bootstrap's own clone —
// the tree the payload was cut from — made 'same' unfalsifiable: on 2026-09-21 that clone was 11
// commits behind and the check still reported a match.
function cloneFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-clone-'));
  fs.mkdirSync(path.join(dir, '.aac-dotfiles', '.git'), { recursive: true });
  const stale = path.join(dir, '.aac-dotfiles', 'marketplace', 'aac-skills', '.claude-plugin');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'plugin.json'), JSON.stringify({ version: '2026.9.211608' }));
  return dir;
}

test('compareToMaster reads the version master offers from the remote, not the local clone', () => {
  const home = cloneFixture();
  const calls = [];
  const run = (cmd, args) => {
    calls.push(args.join(' '));
    return args.includes('show')
      ? { status: 0, stdout: JSON.stringify({ version: '2026.9.212113' }) }
      : { status: 0, stdout: '' };
  };
  const c = compareToMaster({ payload_version: '2026.9.211608' }, { HOME: home }, run);
  assert.equal(c.state, 'drift');
  assert.equal(c.master, '2026.9.212113');
  assert.ok(calls.some((a) => a.includes('fetch --depth 1 origin master')), calls.join(' | '));
});

// Issue 703: a drift names the skills whose installed revision is not master's, so a Routine
// never runs an old skill silently.
test('compareToMaster on drift names each skill whose revision differs from master', () => {
  const home = cloneFixture();
  const skills = path.join(home, '.claude', 'skills');
  for (const [name, rev] of [['todoist-triage', '8'], ['caveman', '3']]) {
    fs.mkdirSync(path.join(skills, name), { recursive: true });
    fs.writeFileSync(path.join(skills, name, 'SKILL.md'), `---\nmetadata:\n  revision: '${rev}'\n---\n`);
  }
  const master = { 'todoist-triage': '17', caveman: '3', 'new-skill': '1' };
  const run = (cmd, args) => {
    const spec = args[args.length - 1];
    if (args.includes('ls-tree')) return { status: 0, stdout: Object.keys(master).join('\n') + '\n' };
    if (spec.endsWith('plugin.json')) return { status: 0, stdout: JSON.stringify({ version: '2026.9.222215' }) };
    const name = (/skills\/([^/]+)\/SKILL\.md$/.exec(spec) || [])[1];
    if (name) return { status: 0, stdout: `---\nmetadata:\n  revision: '${master[name]}'\n---\n` };
    return { status: 0, stdout: '' };
  };
  const c = compareToMaster({ payload_version: '2026.9.211608' }, { HOME: home }, run);
  assert.equal(c.state, 'drift');
  assert.deepEqual(c.stale, [
    { name: 'todoist-triage', local: '8', master: '17' },
    { name: 'new-skill', local: null, master: '1' },
  ]);
});

test('compareToMaster says unknown when the remote cannot be read — never the clone\'s own answer', () => {
  const home = cloneFixture();
  const run = () => ({ status: 128, stdout: '' });
  const c = compareToMaster({ payload_version: '2026.9.211608' }, { HOME: home }, run);
  assert.equal(c.state, 'unknown');
  assert.equal(c.marker, '2026.9.211608');
});

test('verifyPluginRoot is ok when the recorded payload still carries hooks/scripts (issue 614)', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.dir, 'payload', 'hooks', 'scripts'), { recursive: true });
  const r = verifyPluginRoot({ skills: [], plugin_root: path.join(f.dir, 'payload') });
  assert.equal(r.state, 'ok');
  assert.equal(r.root, path.join(f.dir, 'payload'));
});

test('verifyPluginRoot is absent when the payload the hooks were seated for is gone', () => {
  const f = fixture();
  const r = verifyPluginRoot({ skills: [], plugin_root: path.join(f.dir, 'no-such-payload') });
  assert.equal(r.state, 'absent');
  assert.equal(r.root, path.join(f.dir, 'no-such-payload'));
});

test('verifyPluginRoot is unrecorded on a pre-v30 marker with no plugin_root', () => {
  assert.equal(verifyPluginRoot({ skills: [] }).state, 'unrecorded');
  assert.equal(verifyPluginRoot({ skills: [], plugin_root: '' }).state, 'unrecorded');
});
