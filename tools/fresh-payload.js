'use strict';
/**
 * A plugin payload built from this checkout's sources, in a temp directory (issue 1308).
 *
 * A branch carries sources only: payload-rebuild.yml rebuilds marketplace/aac-skills on master
 * after each merge, so on a branch the committed payload is whatever master last shipped. A test
 * that pins "the payload copy equals its source" therefore reads a fresh build, never the
 * committed copy - that one is behind on every branch that changed the source, by design.
 *
 * The build runs once per test process, with --no-marketplace and --no-stamp-write, so it writes
 * nothing into the checkout. Returns the built marketplace/aac-skills equivalent.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const OWNER_HOME = 'C:\\Users\\Dan';
let built = null;

function freshPayload() {
  if (built) return built;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-payload-'));
  const args = [path.join(REPO, 'tools', 'build-cloud-plugin.py'), '--home', OWNER_HOME,
    '--out', out, '--no-marketplace', '--no-stamp-write'];
  const res = spawnSync('python3', args, { cwd: REPO, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`build-cloud-plugin.py exited ${res.status}: ${res.error || ''}${res.stderr}`);
  }
  process.on('exit', () => fs.rmSync(out, { recursive: true, force: true }));
  built = path.join(out, 'aac-skills');
  return built;
}

module.exports = { freshPayload };
