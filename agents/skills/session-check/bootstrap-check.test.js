'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readMarker, verifySkills, compareToMaster } = require('./bootstrap-check');

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

test('readMarker returns ok with the parsed marker', () => {
  const f = fixture();
  writeMarker(f.marker, { payload_version: '2026.9.15', skills: ['ticket-fleet'] });
  const r = readMarker(env(f));
  assert.equal(r.state, 'ok');
  assert.equal(r.marker.payload_version, '2026.9.15');
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
