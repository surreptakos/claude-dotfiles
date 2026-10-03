'use strict';
/**
 * Issue 1308: master builds the plugin payload after each merge (plugin-payload.yml), so a
 * branch's committed marketplace/aac-skills can be behind its own sources. A test that pins the
 * payload TO the sources - the rules text, the fleet script's generated block - reads a fresh
 * build instead. freshPayload() runs the packager once per process into a scratch directory,
 * leaving the source stamps and marketplace/ untouched, and returns that build's aac-skills root.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
// The owner's home, the one the packager folds out of every hash (CLAUDE.md, "Skill stamps").
const OWNER_HOME = 'C:\\Users\\Dan';

let built = null;

function python() {
  for (const cand of [{ cmd: 'python3', pre: [] }, { cmd: 'py', pre: ['-3'] }, { cmd: 'python', pre: [] }]) {
    const r = spawnSync(cand.cmd, cand.pre.concat(['-c', 'import yaml']), { encoding: 'utf8' });
    if (r.status === 0) return cand;
  }
  return null;
}

function freshPayload() {
  if (built) return built;
  const py = python();
  if (!py) throw new Error('no Python with PyYAML on PATH - the packager needs one (pip install pyyaml)');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-payload-'));
  process.on('exit', () => {
    try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* scratch only */ }
  });
  const r = spawnSync(py.cmd, py.pre.concat([
    path.join(REPO, 'tools', 'build-cloud-plugin.py'), '--home', OWNER_HOME,
    '--out', out, '--no-marketplace', '--no-stamp-write',
  ]), { cwd: REPO, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (r.status !== 0) {
    throw new Error(`the packager failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
  built = path.join(out, 'aac-skills');
  return built;
}

module.exports = { freshPayload };
